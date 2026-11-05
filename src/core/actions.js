// Everything that changes the data. Pure apart from mutating the `data` passed
// in, so the UI, the seed script and the tests all go through the same rules.

import { addDays, diffDays, isValidDay } from './dates.js';
import { NOTES_MAX, SUBJECT_COLORS, TOPIC_MAX } from './model.js';
import { examsFor, planAgenda, settlePlan } from './planner.js';
import { RATINGS, scheduler } from './srs.js';

export const newId = () => crypto.randomUUID();

// Plans the agenda and stores each topic's assigned date. Run after every change.
export function refreshPlan(data, today) {
  const plan = planAgenda(data, today);
  settlePlan(data, plan);
  return plan;
}

const withDue = (srs) => ({ ...srs, due: srs.ideal });

export function addSubject(data, { name, color }, id = newId()) {
  const clean = (name ?? '').trim();
  if (!clean) throw new Error('A disciplina precisa de um nome.');
  const existing = data.subjects.find((s) => s.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const subject = { id, name: clean, color: SUBJECT_COLORS.includes(color) ? color : SUBJECT_COLORS[0] };
  data.subjects.push(subject);
  return subject;
}

// Shared by logging and editing, so both follow the same limits.
function cleanTopicFields(data, { subjectId, title, notes, studiedOn, durationMin }, today) {
  const cleanTitle = (title ?? '').trim();
  const cleanNotes = (notes ?? '').trim();
  if (!data.subjects.some((s) => s.id === subjectId)) throw new Error('Escolhe uma disciplina.');
  if (!cleanTitle) throw new Error('Escreve o tópico que estudaste.');
  if (cleanTitle.length > TOPIC_MAX) throw new Error(`O tópico pode ter até ${TOPIC_MAX} caracteres.`);
  if (cleanNotes.length > NOTES_MAX) throw new Error(`As notas podem ter até ${NOTES_MAX} caracteres.`);
  if (!isValidDay(studiedOn)) throw new Error('Escolhe uma data válida.');
  if (studiedOn > today) throw new Error('A data de estudo não pode ser no futuro.');
  const duration = Number(durationMin);
  return {
    subjectId,
    title: cleanTitle,
    notes: cleanNotes,
    studiedOn,
    durationMin: duration > 0 ? Math.round(duration) : null,
  };
}

export function logStudy(data, fields, today, now = new Date(), id = newId()) {
  const clean = cleanTopicFields(data, fields, today);
  const { studiedOn } = clean;
  const topic = {
    id,
    ...clean,
    createdAt: now.toISOString(),
    masteredOn: null,
    srs: withDue(scheduler.init(studiedOn)),
  };
  data.topics.push(topic);
  return topic;
}

const findTopic = (data, topicId) => {
  const topic = data.topics.find((t) => t.id === topicId);
  if (!topic) throw new Error('Tópico não encontrado.');
  return topic;
};

const historyOf = (data, topicId) => data.reviewLog.filter((r) => r.topicId === topicId);

// The study date anchors the schedule, so it can only change before the first
// review: after that, the schedule follows the reviews actually done.
export function editTopic(data, topicId, fields, today) {
  const topic = findTopic(data, topicId);
  const clean = cleanTopicFields(data, { ...topic, ...fields }, today);
  const movedDate = clean.studiedOn !== topic.studiedOn;
  if (movedDate && historyOf(data, topicId).length > 0) {
    throw new Error('A data de estudo já não pode mudar, porque o tópico já tem revisões.');
  }
  Object.assign(topic, clean);
  if (movedDate) topic.srs = withDue(scheduler.init(clean.studiedOn));
  return topic;
}

export function deleteTopic(data, topicId) {
  findTopic(data, topicId);
  data.topics = data.topics.filter((t) => t.id !== topicId);
  data.reviewLog = data.reviewLog.filter((r) => r.topicId !== topicId);
}

const lastRating = (data, topicId) => historyOf(data, topicId).at(-1);

export const canUndoRating = (data, topicId) => Boolean(lastRating(data, topicId)?.srsBefore);

// Puts the topic back exactly as it was. Can be repeated, one rating at a time.
export function undoLastRating(data, topicId) {
  const entry = lastRating(data, topicId);
  if (!entry?.srsBefore) return null;
  findTopic(data, topicId).srs = entry.srsBefore;
  data.reviewLog = data.reviewLog.filter((r) => r !== entry);
  return entry;
}

export function rateReview(data, topicId, rating, today, now = new Date(), id = newId()) {
  if (!RATINGS.includes(rating)) throw new Error(`Unknown rating: ${rating}`);
  const topic = findTopic(data, topicId);
  const srs = withDue(scheduler.rate(topic.srs, rating, today));
  data.reviewLog.push({
    id,
    topicId,
    doneAt: now.toISOString(),
    doneOn: today,
    rating,
    scheduledFor: topic.srs.due,
    intervalAfter: srs.interval,
    srsBefore: topic.srs,
  });
  topic.srs = srs;
  return topic;
}

// Stays on tomorrow however full the day is: the user asked for that day.
export function snoozeReview(data, topicId, today) {
  const topic = findTopic(data, topicId);
  const tomorrow = addDays(today, 1);
  topic.srs = { ...topic.srs, ideal: tomorrow, due: tomorrow, snoozed: true };
  return topic;
}

// How far ahead the overdue reviews may be spread when the days are full.
const SPREAD_HORIZON_DAYS = 60;

// One tap after a break: as many overdue reviews as fit stay today, and the rest
// go to the next days with room. Reviews with the nearest exam are placed first,
// then the oldest. Whatever can't fit before its exam stays on today's list.
export function spreadOverdue(data, plan, today) {
  const { limit } = plan;
  // Next reviews only. Projected ones shift as soon as these get done, and after
  // a break they'd make the coming days look full when they aren't.
  const counts = new Map();
  for (const it of plan.items.filter((i) => i.index === 0)) {
    const day = it.date < today ? today : it.date;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const lastDayFor = (topic) => {
    const exam = examsFor(topic, data.exams).find((e) => e.date > today);
    const horizon = addDays(today, SPREAD_HORIZON_DAYS);
    if (!exam) return horizon;
    const eve = addDays(exam.date, -1);
    return eve < horizon ? eve : horizon;
  };

  const overdue = plan.items
    .filter((it) => it.overdue)
    .map((item) => {
      const topic = findTopic(data, item.topicId);
      return { item, topic, lastDay: lastDayFor(topic) };
    })
    .sort((a, b) => (a.lastDay < b.lastDay ? -1 : a.lastDay > b.lastDay ? 1 : 0)
      || (a.item.date < b.item.date ? -1 : a.item.date > b.item.date ? 1 : 0)
      || (a.topic.id < b.topic.id ? -1 : 1));

  const doneToday = data.reviewLog.filter((r) => r.doneOn === today).length;
  const others = (counts.get(today) ?? 0) - overdue.length;
  const staying = Math.max(0, limit - others - doneToday);

  let moved = 0;
  for (const { topic, lastDay } of overdue.slice(staying)) {
    for (let day = addDays(today, 1); day <= lastDay; day = addDays(day, 1)) {
      if ((counts.get(day) ?? 0) < limit) {
        topic.srs = { ...topic.srs, ideal: day, due: day, snoozed: true };
        counts.set(day, (counts.get(day) ?? 0) + 1);
        moved += 1;
        break;
      }
    }
  }
  return { moved, staying: overdue.length - moved };
}

export function markMastered(data, topicId, today) {
  const topic = findTopic(data, topicId);
  topic.masteredOn = today;
  return topic;
}

export function resumeTopic(data, topicId, today) {
  const topic = findTopic(data, topicId);
  topic.masteredOn = null;
  const tomorrow = addDays(today, 1);
  topic.srs = { ...topic.srs, ideal: tomorrow, due: tomorrow, snoozed: false };
  return topic;
}

export function addExam(data, { subjectId, date, keepAfter = false }, today, id = newId()) {
  if (!data.subjects.some((s) => s.id === subjectId)) throw new Error('Escolhe uma disciplina.');
  if (!isValidDay(date)) throw new Error('Escolhe uma data válida.');
  if (date <= today) throw new Error('A data do exame tem de ser no futuro.');
  const exam = { id, subjectId, date, keepAfter: Boolean(keepAfter) };
  data.exams.push(exam);
  return exam;
}

export function setExamKeepAfter(data, examId, keepAfter) {
  const exam = data.exams.find((e) => e.id === examId);
  if (exam) exam.keepAfter = Boolean(keepAfter);
}

export function removeExam(data, examId) {
  data.exams = data.exams.filter((e) => e.id !== examId);
}

// Where the next review lands for each rating, using the full plan so the buttons
// match what really happens, exams and balancing included. `date` is null when no
// review follows, which happens when an exam cuts the schedule short.
export function previewRatings(data, topicId, today) {
  const preview = {};
  for (const rating of RATINGS) {
    const copy = {
      ...data,
      topics: data.topics.map((t) => (t.id === topicId ? { ...t } : t)),
      reviewLog: [...data.reviewLog],
    };
    rateReview(copy, topicId, rating, today, new Date(0), 'preview');
    const date = planAgenda(copy, today).next.get(topicId)?.date ?? null;
    preview[rating] = { date, days: date ? diffDays(date, today) : null };
  }
  return preview;
}
