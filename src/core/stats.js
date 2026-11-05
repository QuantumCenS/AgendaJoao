// Read-only summaries for the Today, exam and progress screens.

import { addDays, dayRange, diffDays, startOfWeek } from './dates.js';

export const READINESS_DAYS = 10;
export const HEATMAP_WEEKS = 18;

// Rounded to 5 minutes, so "24 min" doesn't pretend to be precise.
export function estimateMinutes(count, minutesPerReview) {
  if (count === 0) return 0;
  return Math.max(5, Math.round((count * minutesPerReview) / 5) * 5);
}

// Reviews due today plus overdue ones, grouped by subject in subject order.
export function todaySummary(data, plan) {
  const due = plan.items.filter((it) => it.index === 0 && it.date <= plan.today);
  const groups = data.subjects
    .map((subject) => ({ subject, items: due.filter((it) => it.subjectId === subject.id) }))
    .filter((g) => g.items.length > 0);
  return {
    count: due.length,
    overdue: due.filter((it) => it.overdue).length,
    minutes: estimateMinutes(due.length, data.settings.minutesPerReview),
    groups,
    doneToday: data.reviewLog.filter((r) => r.doneOn === plan.today).length,
    overLimit: due.length > plan.limit,
  };
}

// Today's list counts every due review, so overdue ones land on today.
export function agendaByDay(plan) {
  const days = new Map();
  for (const it of plan.items) {
    const day = it.date < plan.today ? plan.today : it.date;
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(it);
  }
  return days;
}

export function subjectStats(data, plan, subjectId) {
  const topics = data.topics.filter((t) => t.subjectId === subjectId);
  const ids = new Set(topics.map((t) => t.id));
  const weekStart = startOfWeek(plan.today);
  return {
    topics: topics.length,
    mastered: topics.filter((t) => t.masteredOn).length,
    reviewsThisWeek: data.reviewLog.filter((r) => ids.has(r.topicId) && r.doneOn >= weekStart && r.doneOn <= plan.today).length,
    overdue: plan.items.filter((it) => it.overdue && it.subjectId === subjectId).length,
  };
}

// Share of the exam's topics reviewed recently. Mastered topics have left the
// rotation, so they don't count either way.
export function examReadiness(data, exam, today) {
  const topics = data.topics.filter((t) => t.subjectId === exam.subjectId && !t.masteredOn && t.studiedOn < exam.date);
  const since = addDays(today, -(READINESS_DAYS - 1));
  const reviewed = topics.filter((t) =>
    data.reviewLog.some((r) => r.topicId === t.id && r.doneOn >= since && r.doneOn <= today),
  );
  return {
    total: topics.length,
    reviewed: reviewed.length,
    share: topics.length ? reviewed.length / topics.length : 0,
    daysLeft: diffDays(exam.date, today),
  };
}

// Exams still to come, soonest first.
export const upcomingExams = (data, today) =>
  data.exams.filter((e) => e.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));

// Full weeks ending with the current one, as columns of Monday-first days.
export function heatmap(data, today, weeks = HEATMAP_WEEKS) {
  const counts = new Map();
  for (const r of data.reviewLog) counts.set(r.doneOn, (counts.get(r.doneOn) ?? 0) + 1);
  const start = addDays(startOfWeek(today), -7 * (weeks - 1));
  const end = addDays(startOfWeek(today), 6);
  const cells = dayRange(start, end).map((day) => ({
    day,
    count: counts.get(day) ?? 0,
    future: day > today,
  }));
  const peak = Math.max(1, ...cells.map((c) => c.count));
  return {
    weeks: Array.from({ length: weeks }, (_, i) => cells.slice(i * 7, i * 7 + 7)),
    peak,
    total: cells.reduce((sum, c) => sum + c.count, 0),
  };
}
