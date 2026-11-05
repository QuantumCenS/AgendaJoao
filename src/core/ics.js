// Builds an iCalendar (RFC 5545) file from the planned reviews.

import { addDays, localTimeToUtc, parseTime } from './dates.js';
import { dailyBody, isQuiet } from './reminders.js';
import { estimateMinutes } from './stats.js';

const compactDay = (day) => day.replaceAll('-', '');
const compactInstant = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export const escapeText = (text) =>
  text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines may not exceed 75 bytes. Folding by byte, never inside a character.
export function foldLine(line) {
  const encoder = new TextEncoder();
  const chunks = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const room = chunks.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + bytes > room) {
      chunks.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  chunks.push(current);
  return chunks.join('\r\n ');
}

// Minutes after local midnight the alarm should ring, out of quiet hours.
function alarmMinutes(settings) {
  const minutes = parseTime(settings.preferredTime || settings.dailyTime);
  return isQuiet(minutes, settings.quietStart, settings.quietEnd) ? parseTime(settings.quietEnd) : minutes;
}

// All-day events start at midnight, timed ones at the preferred time.
function alarmLines(settings, count) {
  const start = settings.preferredTime ? parseTime(settings.preferredTime) : 0;
  const offset = alarmMinutes(settings) - start;
  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(dailyBody(count, estimateMinutes(count, settings.minutesPerReview)))}`,
    `TRIGGER;RELATED=START:${offset < 0 ? '-' : ''}PT${Math.abs(offset)}M`,
    'END:VALARM',
  ];
}

function eventLines(item, topic, subject, settings, stamp, dayCount) {
  const day = item.date < item.today ? item.today : item.date;
  const lines = [
    'BEGIN:VEVENT',
    `UID:${item.topicId}-${item.index}@recall.local`,
    `DTSTAMP:${stamp}`,
  ];
  if (settings.preferredTime) {
    const start = localTimeToUtc(day, settings.preferredTime);
    const end = new Date(start.getTime() + settings.minutesPerReview * 60_000);
    lines.push(`DTSTART:${compactInstant(start)}`, `DTEND:${compactInstant(end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${compactDay(day)}`, `DTEND;VALUE=DATE:${compactDay(addDays(day, 1))}`);
  }
  lines.push(`SUMMARY:${escapeText(`Rever: ${topic.title}`)}`);
  lines.push(`CATEGORIES:${escapeText(subject.name)}`);
  if (topic.notes) lines.push(`DESCRIPTION:${escapeText(topic.notes)}`);
  lines.push('TRANSP:TRANSPARENT');
  // Set only on a day's first event: six reviews shouldn't mean six alarms.
  if (dayCount) lines.push(...alarmLines(settings, dayCount));
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcs(data, plan, now = new Date()) {
  const stamp = compactInstant(now);
  const topics = new Map(data.topics.map((t) => [t.id, t]));
  const subjects = new Map(data.subjects.map((s) => [s.id, s]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Recall//Agenda de estudo//PT', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Recall'];
  const dayOf = (item) => (item.date < plan.today ? plan.today : item.date);
  const perDay = new Map();
  for (const item of plan.items) perDay.set(dayOf(item), (perDay.get(dayOf(item)) ?? 0) + 1);
  const withAlarm = new Set();
  for (const item of plan.items) {
    const topic = topics.get(item.topicId);
    const day = dayOf(item);
    const alarmFor = data.settings.icsAlarm && !withAlarm.has(day) ? perDay.get(day) : 0;
    withAlarm.add(day);
    lines.push(...eventLines({ ...item, today: plan.today }, topic, subjects.get(topic.subjectId), data.settings, stamp, alarmFor));
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
