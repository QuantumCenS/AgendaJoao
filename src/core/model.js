// Data shape, defaults and backup validation. No browser APIs here.

import { isValidDay, isValidTime } from './dates.js';
import { RATINGS } from './srs.js';

export const SCHEMA_VERSION = 1;
export const TOPIC_MAX = 120;
export const NOTES_MAX = 1000;

export const SUBJECT_COLORS = ['teal', 'blue', 'violet', 'rose', 'amber', 'green', 'slate', 'coral'];

export const DEFAULT_SETTINGS = {
  maxReviews: 20,
  maxMinutes: 60,
  minutesPerReview: 4,
  preferredTime: '',
  theme: 'auto',
  dailyReminder: false,
  dailyTime: '18:00',
  eveningReminder: false,
  eveningTime: '21:00',
  quietStart: '22:30',
  quietEnd: '07:30',
  icsAlarm: true,
};

export const emptyData = () => ({
  subjects: [],
  topics: [],
  reviewLog: [],
  exams: [],
  settings: { ...DEFAULT_SETTINGS },
});

// Reviews per day, taking both limits into account.
export function dailyLimit({ maxReviews, maxMinutes, minutesPerReview }) {
  const byCount = maxReviews > 0 ? maxReviews : Infinity;
  const byTime = maxMinutes > 0 ? Math.floor(maxMinutes / Math.max(1, minutesPerReview)) : Infinity;
  return Math.max(1, Math.min(byCount, byTime));
}

export const toBackup = (data, now = new Date()) => ({
  app: 'Recall',
  version: SCHEMA_VERSION,
  exportedAt: now.toISOString(),
  data,
});

const isString = (v) => typeof v === 'string';
const isInstant = (v) => isString(v) && !Number.isNaN(Date.parse(v));
const isCount = (v) => Number.isFinite(v) && v >= 0;

function subjectProblem(s) {
  if (!isString(s.id) || !isString(s.name) || !s.name.trim()) return 'disciplina sem nome';
  if (!SUBJECT_COLORS.includes(s.color)) return `cor desconhecida em "${s.name}"`;
  return null;
}

function srsProblem(srs) {
  if (!srs || typeof srs !== 'object') return 'sem plano de revisão';
  if (!isCount(srs.step) || !(srs.interval >= 1) || !(srs.ease > 0) || !isCount(srs.lapses)) return 'plano inválido';
  if (!isValidDay(srs.ideal) || !isValidDay(srs.due)) return 'datas do plano inválidas';
  return null;
}

function topicProblem(t, subjectIds) {
  if (!isString(t.id) || !isString(t.title) || !t.title.trim()) return 'tópico sem título';
  if (t.title.length > TOPIC_MAX) return `título demasiado longo em "${t.title.slice(0, 30)}…"`;
  if (t.notes !== undefined && (!isString(t.notes) || t.notes.length > NOTES_MAX)) return `notas inválidas em "${t.title}"`;
  if (!subjectIds.has(t.subjectId)) return `disciplina em falta para "${t.title}"`;
  if (!isValidDay(t.studiedOn)) return `data de estudo inválida em "${t.title}"`;
  if (t.masteredOn && !isValidDay(t.masteredOn)) return `data inválida em "${t.title}"`;
  const srs = srsProblem(t.srs);
  return srs ? `${srs} em "${t.title}"` : null;
}

function logProblem(r, topicIds) {
  if (!topicIds.has(r.topicId)) return 'revisão de um tópico em falta';
  if (!RATINGS.includes(r.rating)) return 'avaliação desconhecida';
  if (!isInstant(r.doneAt) || !isValidDay(r.doneOn)) return 'revisão com data inválida';
  if (r.srsBefore && srsProblem(r.srsBefore)) return 'revisão com plano anterior inválido';
  return null;
}

function examProblem(e, subjectIds) {
  if (!isString(e.id) || !subjectIds.has(e.subjectId)) return 'exame sem disciplina';
  if (!isValidDay(e.date)) return 'exame com data inválida';
  return null;
}

// Returns { data } when the backup can be restored, otherwise { error }.
export function parseBackup(backup) {
  const fail = (error) => ({ error });
  if (!backup || backup.app !== 'Recall' || !backup.data) return fail('Este ficheiro não parece ser um backup do Recall.');
  if (backup.version !== SCHEMA_VERSION) return fail('Este backup é de uma versão diferente da app.');
  const { subjects, topics, reviewLog, exams, settings } = backup.data;
  if (![subjects, topics, reviewLog, exams].every(Array.isArray)) return fail('O backup está incompleto.');

  const subjectIds = new Set(subjects.map((s) => s.id));
  const topicIds = new Set(topics.map((t) => t.id));
  if (subjectIds.size !== subjects.length || topicIds.size !== topics.length) return fail('O backup tem identificadores repetidos.');

  const problem =
    subjects.map(subjectProblem).find(Boolean) ||
    topics.map((t) => topicProblem(t, subjectIds)).find(Boolean) ||
    reviewLog.map((r) => logProblem(r, topicIds)).find(Boolean) ||
    exams.map((e) => examProblem(e, subjectIds)).find(Boolean);
  if (problem) return fail(`O backup tem um problema: ${problem}.`);

  const merged = { ...DEFAULT_SETTINGS, ...settings };
  for (const key of ['preferredTime', 'dailyTime', 'eveningTime', 'quietStart', 'quietEnd']) {
    if (merged[key] !== '' && !isValidTime(merged[key])) merged[key] = DEFAULT_SETTINGS[key];
  }
  for (const key of ['maxReviews', 'maxMinutes', 'minutesPerReview']) {
    if (!isCount(merged[key])) merged[key] = DEFAULT_SETTINGS[key];
  }
  if (!['auto', 'light', 'dark'].includes(merged.theme)) merged.theme = 'auto';
  merged.icsAlarm = merged.icsAlarm !== false;

  return { data: { subjects, topics, reviewLog, exams, settings: merged } };
}
