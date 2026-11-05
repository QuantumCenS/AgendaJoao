// All the app's wording about reviews and dates, in one place.
// Calendar days are formatted in UTC because that's how they're stored.

import { diffDays } from './dates.js';

const fmt = (options) => new Intl.DateTimeFormat('pt-PT', { timeZone: 'UTC', ...options });
const toDate = (day) => new Date(`${day}T00:00:00Z`);

const shortMonthFmt = fmt({ month: 'short' });
const longFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const weekdayFmt = fmt({ weekday: 'short' });
const monthFmt = fmt({ month: 'long', year: 'numeric' });

const clean = (text) => text.replace(/\.$/, '');

// Composed by hand: pt-PT formats day plus short month as "5/11".
export const shortDate = (day) => `${Number(day.slice(8))} ${clean(shortMonthFmt.format(toDate(day)))}`;
export const longDate = (day) => longFmt.format(toDate(day));
export const weekday = (day) => clean(weekdayFmt.format(toDate(day)));
export const monthTitle = (day) => monthFmt.format(toDate(day));

export const reviewsCount = (n) => (n === 1 ? '1 revisão' : `${n} revisões`);
export const topicsCount = (n) => (n === 1 ? '1 tópico' : `${n} tópicos`);
export const daysCount = (n) => (n === 1 ? '1 dia' : `${n} dias`);

// "6 revisões · cerca de 25 min"
export const todayLine = (count, minutes) => `${reviewsCount(count)} · cerca de ${minutes} min`;

// "hoje", "amanhã", "em 7 dias"
export function inDays(days) {
  if (days <= 0) return 'hoje';
  if (days === 1) return 'amanhã';
  return `em ${days} dias`;
}

export function relativeDay(day, today) {
  const days = diffDays(day, today);
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days === -1) return 'ontem';
  if (days < 0) return `há ${-days} dias`;
  return `em ${days} dias`;
}

export const RATING_LABELS = { again: 'De novo', hard: 'Difícil', good: 'Bom', easy: 'Fácil' };

export const ratingHint = (preview) => (preview.date === null ? 'sem mais antes do exame' : inDays(preview.days));

// Shown after rating or logging.
export function nextReviewMessage(date, today) {
  if (date === null) return 'Sem mais revisões antes do exame.';
  const days = diffDays(date, today);
  if (days <= 0) return 'Próxima revisão hoje.';
  if (days === 1) return 'Próxima revisão amanhã.';
  return `Próxima revisão em ${days} dias.`;
}

export function savedMessage(date, today) {
  if (date === null) return 'Guardado. Sem revisões antes do exame.';
  const days = diffDays(date, today);
  if (days <= 0) return 'Guardado. Primeira revisão hoje.';
  if (days === 1) return 'Guardado. Primeira revisão amanhã.';
  return `Guardado. Primeira revisão ${inDays(days)}.`;
}

export const movedMessage = (n) =>
  n === 1
    ? 'Movi 1 revisão para um dia próximo, para respeitar o teu limite diário.'
    : `Movi ${n} revisões para dias próximos, para respeitar o teu limite diário.`;

export const overLimitMessage = (n) =>
  n === 1
    ? '1 dia continua acima do limite: não dá para mover mais sem afastar demasiado as revisões.'
    : `${n} dias continuam acima do limite: não dá para mover mais sem afastar demasiado as revisões.`;

export function spreadMessage(moved) {
  if (moved === 0) return 'Os próximos dias também estão cheios, por isso ficam aqui.';
  return moved === 1 ? 'Passei 1 revisão para os próximos dias.' : `Passei ${moved} revisões para os próximos dias.`;
}

export function examCountdown(daysLeft) {
  if (daysLeft < 0) return 'Já passou';
  if (daysLeft === 0) return 'É hoje';
  if (daysLeft === 1) return 'É amanhã';
  return `Faltam ${daysLeft} dias`;
}

export const readinessLine = (reviewed, total, windowDays) =>
  total === 0
    ? 'Ainda sem tópicos nesta disciplina.'
    : `${reviewed} de ${total} tópicos revistos nos últimos ${windowDays} dias`;
