// Decides whether a reminder is due right now. No timers or browser APIs here.

import { parseTime } from './dates.js';
import { reviewsCount } from './copy.js';

export function isQuiet(minutes, quietStart, quietEnd) {
  if (!quietStart || !quietEnd) return false;
  const start = parseTime(quietStart);
  const end = parseTime(quietEnd);
  if (start === end) return false;
  // A window such as 22:30-07:30 runs past midnight.
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export const dailyBody = (count, minutes) => `${reviewsCount(count)} hoje, cerca de ${minutes} min`;
export const eveningBody = (count) =>
  count === 1 ? 'Ainda há 1 revisão para hoje, se te apetecer.' : `Ainda há ${count} revisões para hoje, se te apetecer.`;

// `sent` is { daily, evening }, the last day each one went out. `maxLateMinutes`
// stops a reminder firing long after its time when the app is simply reopened.
// Returns { kind, body, marks } or null. `marks` lists what to record as sent.
export function dueReminder({ settings, nowMinutes, today, count, minutes, sent = {}, maxLateMinutes = Infinity }) {
  if (count === 0) return null;
  if (isQuiet(nowMinutes, settings.quietStart, settings.quietEnd)) return null;

  const isDue = (enabled, time, kind) => {
    if (!enabled || sent[kind] === today) return false;
    const late = nowMinutes - parseTime(time);
    return late >= 0 && late <= maxLateMinutes;
  };

  // The evening one goes first: if both are due, one notification is enough.
  if (isDue(settings.eveningReminder, settings.eveningTime, 'evening')) {
    return { kind: 'evening', body: eveningBody(count), marks: ['daily', 'evening'] };
  }
  if (isDue(settings.dailyReminder, settings.dailyTime, 'daily')) {
    return { kind: 'daily', body: dailyBody(count, minutes), marks: ['daily'] };
  }
  return null;
}
