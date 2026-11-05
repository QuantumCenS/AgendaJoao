import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addExam, rateReview, refreshPlan } from '../../src/core/actions.js';
import {
  examCountdown, inDays, longDate, monthTitle, movedMessage, nextReviewMessage, ratingHint, readinessLine, savedMessage, shortDate, todayLine,
} from '../../src/core/copy.js';
import { buildIcs, escapeText, foldLine } from '../../src/core/ics.js';
import { dailyLimit, emptyData, parseBackup, toBackup } from '../../src/core/model.js';
import { dueReminder, isQuiet } from '../../src/core/reminders.js';
import { agendaByDay, estimateMinutes, examReadiness, heatmap, subjectStats, todaySummary } from '../../src/core/stats.js';
import { addTopic, makeData } from './helpers.js';

// ---------- copy ----------

test('copy matches the tone examples from the brief', () => {
  assert.equal(todayLine(6, 25), '6 revisões · cerca de 25 min');
  assert.equal(todayLine(1, 5), '1 revisão · cerca de 5 min');
  assert.equal(savedMessage('2026-11-06', '2026-11-05'), 'Guardado. Primeira revisão amanhã.');
  assert.equal(nextReviewMessage('2026-11-12', '2026-11-05'), 'Próxima revisão em 7 dias.');
  assert.equal(inDays(1), 'amanhã');
  assert.equal(inDays(7), 'em 7 dias');
  assert.equal(ratingHint({ date: null, days: null }), 'sem mais antes do exame');
  assert.equal(movedMessage(1), 'Movi 1 revisão para um dia próximo, para respeitar o teu limite diário.');
  assert.equal(readinessLine(14, 18, 10), '14 de 18 tópicos revistos nos últimos 10 dias');
  assert.equal(examCountdown(1), 'É amanhã');
  assert.equal(examCountdown(25), 'Faltam 25 dias');
});

test('dates are formatted on the stored calendar day in any device zone', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['Pacific/Apia', 'Pacific/Pago_Pago', 'Europe/Lisbon']) {
      process.env.TZ = zone;
      assert.equal(shortDate('2026-11-05'), '5 nov', zone);
      assert.match(longDate('2026-11-01'), /domingo/, zone);
      assert.match(monthTitle('2027-01-01'), /janeiro de 2027/, zone);
    }
  } finally {
    process.env.TZ = original;
  }
});

// ---------- stats ----------

test('estimate rounds to 5 minutes and matches the brief example', () => {
  assert.equal(estimateMinutes(6, 4), 25);
  assert.equal(estimateMinutes(1, 4), 5);
  assert.equal(estimateMinutes(0, 4), 0);
});

test('today summary groups due and overdue reviews by subject', () => {
  const data = makeData();
  addTopic(data, '2026-11-05', 'poo');
  addTopic(data, '2026-11-01', 'poo');
  addTopic(data, '2026-11-05', 'calc');
  addTopic(data, '2026-11-06', 'calc'); // first review on the 7th, not due yet
  const plan = refreshPlan(data, '2026-11-06');
  const summary = todaySummary(data, plan);
  assert.equal(summary.count, 3);
  assert.equal(summary.overdue, 1);
  assert.deepEqual(summary.groups.map((g) => [g.subject.id, g.items.length]), [['poo', 2], ['calc', 1]]);
  assert.equal(summary.minutes, 10);
});

test('agendaByDay shows overdue reviews on today, not on past days', () => {
  const data = makeData();
  addTopic(data, '2026-11-01');
  const plan = refreshPlan(data, '2026-11-20');
  const days = agendaByDay(plan);
  assert.equal(days.get('2026-11-20').length, 1);
  assert.ok(!days.has('2026-11-02'));
});

test('subject stats count topics, reviews this week, overdue and mastered', () => {
  const data = makeData();
  const a = addTopic(data, '2026-11-01');
  const b = addTopic(data, '2026-11-01');
  addTopic(data, '2026-10-01');
  data.topics.find((t) => t.id === b.id).masteredOn = '2026-11-02';
  rateReview(data, a.id, 'good', '2026-11-02'); // Monday of this week
  rateReview(data, a.id, 'good', '2026-11-01'); // Sunday, last week
  const plan = refreshPlan(data, '2026-11-05');
  assert.deepEqual(subjectStats(data, plan, 'poo'), { topics: 3, mastered: 1, reviewsThisWeek: 1, overdue: 1 });
});

test('readiness: brief example, 14 of 18 topics reviewed in the last 10 days', () => {
  const data = makeData();
  const topics = [];
  for (let i = 0; i < 18; i += 1) topics.push(addTopic(data, '2026-10-01'));
  topics.slice(0, 14).forEach((t) => rateReview(data, t.id, 'good', '2026-11-20'));
  const exam = addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  const ready = examReadiness(data, exam, '2026-11-25');
  assert.equal(ready.total, 18);
  assert.equal(ready.reviewed, 14);
  assert.equal(ready.daysLeft, 5);
});

test('readiness window is exactly 10 days and skips mastered topics', () => {
  const data = makeData();
  const inside = addTopic(data, '2026-10-01');
  const outside = addTopic(data, '2026-10-01');
  const mastered = addTopic(data, '2026-10-01');
  rateReview(data, inside.id, 'good', '2026-11-16');
  rateReview(data, outside.id, 'good', '2026-11-15');
  mastered.masteredOn = '2026-11-01';
  const exam = addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  const ready = examReadiness(data, exam, '2026-11-25');
  assert.equal(ready.total, 2);
  assert.equal(ready.reviewed, 1);
});

test('heatmap counts reviews per day in Monday-first weeks', () => {
  const data = makeData();
  const t = addTopic(data, '2026-10-01');
  rateReview(data, t.id, 'good', '2026-11-05');
  rateReview(data, t.id, 'good', '2026-11-05');
  rateReview(data, t.id, 'good', '2026-10-20');
  const map = heatmap(data, '2026-11-05', 4);
  assert.equal(map.weeks.length, 4);
  assert.ok(map.weeks.every((w) => w.length === 7));
  assert.equal(map.weeks[3][0].day, '2026-11-02');
  assert.equal(map.weeks[3][3].count, 2);
  assert.equal(map.weeks[3][4].future, true);
  assert.equal(map.total, 3);
  assert.equal(map.peak, 2);
});

// ---------- limits ----------

test('daily limit uses whichever limit is tighter and ignores switched-off ones', () => {
  assert.equal(dailyLimit({ maxReviews: 20, maxMinutes: 60, minutesPerReview: 4 }), 15);
  assert.equal(dailyLimit({ maxReviews: 10, maxMinutes: 60, minutesPerReview: 4 }), 10);
  assert.equal(dailyLimit({ maxReviews: 0, maxMinutes: 60, minutesPerReview: 4 }), 15);
  assert.equal(dailyLimit({ maxReviews: 10, maxMinutes: 0, minutesPerReview: 4 }), 10);
  assert.equal(dailyLimit({ maxReviews: 0, maxMinutes: 0, minutesPerReview: 4 }), Infinity);
});

// ---------- reminders ----------

const reminderSettings = {
  dailyReminder: true, dailyTime: '18:00', eveningReminder: true, eveningTime: '21:00', quietStart: '22:30', quietEnd: '07:30',
};
const remind = (nowMinutes, extra = {}) => dueReminder({
  settings: reminderSettings, nowMinutes, today: '2026-11-05', count: 6, minutes: 25, ...extra,
});

test('the daily reminder uses the wording from the brief, in Portuguese', () => {
  const r = remind(18 * 60);
  assert.equal(r.kind, 'daily');
  assert.equal(r.body, '6 revisões hoje, cerca de 25 min');
});

test('no reminder before its time', () => {
  assert.equal(remind(17 * 60 + 59), null);
});

test('each reminder goes out once a day', () => {
  assert.equal(remind(18 * 60 + 1, { sent: { daily: '2026-11-05' } }), null);
  assert.equal(remind(18 * 60 + 1, { sent: { daily: '2026-11-04' } }).kind, 'daily');
});

test('the evening reminder only goes out if reviews are still due', () => {
  const sent = { daily: '2026-11-05' };
  assert.equal(remind(21 * 60, { sent }).kind, 'evening');
  assert.equal(remind(21 * 60, { sent, count: 0 }), null);
});

test('with no reviews there is no notification at all', () => {
  assert.equal(remind(18 * 60, { count: 0 }), null);
});

test('quiet hours block reminders, across midnight too', () => {
  assert.ok(isQuiet(23 * 60, '22:30', '07:30'));
  assert.ok(isQuiet(3 * 60, '22:30', '07:30'));
  assert.ok(!isQuiet(12 * 60, '22:30', '07:30'));
  assert.ok(isQuiet(13 * 60, '12:00', '14:00'));
  assert.ok(!isQuiet(15 * 60, '12:00', '14:00'));
  assert.ok(!isQuiet(15 * 60, '12:00', '12:00'));
  const late = { ...reminderSettings, dailyTime: '23:00', eveningReminder: false };
  assert.equal(remind(23 * 60, { settings: late }), null);
});

test('a reminder set inside quiet hours waits until they end', () => {
  const early = { ...reminderSettings, dailyTime: '07:00', eveningReminder: false };
  assert.equal(remind(7 * 60, { settings: early }), null);
  assert.equal(remind(7 * 60 + 30, { settings: early }).kind, 'daily');
});

test('reopening the app long after the reminder time stays silent', () => {
  assert.equal(remind(20 * 60, { maxLateMinutes: 5 }), null);
  assert.equal(remind(18 * 60 + 3, { maxLateMinutes: 5 }).kind, 'daily');
});

test('when both are due, only one notification goes out', () => {
  const r = remind(21 * 60 + 30);
  assert.equal(r.kind, 'evening');
  assert.deepEqual(r.marks, ['daily', 'evening']);
});

test('reminders that are off stay off', () => {
  const off = { ...reminderSettings, dailyReminder: false, eveningReminder: false };
  assert.equal(remind(21 * 60, { settings: off }), null);
});

// ---------- ics ----------

test('text escaping and folding follow RFC 5545', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const folded = foldLine(`SUMMARY:${'é'.repeat(100)}`);
  const encoder = new TextEncoder();
  for (const line of folded.split('\r\n')) assert.ok(encoder.encode(line).length <= 75, line);
  assert.equal(folded.replaceAll('\r\n ', ''), `SUMMARY:${'é'.repeat(100)}`);
});

const unfold = (ics) => ics.replaceAll('\r\n ', '');

test('ics export has an all-day event for each planned review', () => {
  const data = makeData();
  const t = addTopic(data, '2026-11-05', 'poo', 'Herança, polimorfismo; etc');
  t.notes = 'Ver capítulo 3';
  const plan = refreshPlan(data, '2026-11-05');
  const ics = buildIcs(data, plan, new Date('2026-11-05T10:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 6);
  const text = unfold(ics);
  assert.ok(text.includes('DTSTART;VALUE=DATE:20261106\r\nDTEND;VALUE=DATE:20261107'));
  assert.ok(text.includes('DTSTART;VALUE=DATE:20261231') === false);
  assert.ok(text.includes('DTEND;VALUE=DATE:20270105'));
  assert.ok(text.includes('SUMMARY:Rever: Herança\\, polimorfismo\\; etc'));
  assert.ok(text.includes('DESCRIPTION:Ver capítulo 3'));
  assert.ok(text.includes('DTSTAMP:20261105T100000Z'));
  assert.ok(!/[^\r]\n/.test(ics), 'all line endings are CRLF');
});

test('ics uses the preferred time in UTC, correct on both sides of a clock change', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Lisbon';
    const data = makeData({ preferredTime: '18:00', minutesPerReview: 4 });
    addTopic(data, '2026-10-22'); // reviews on 23 Oct (summer) and 29 Oct (winter)
    const ics = buildIcs(data, refreshPlan(data, '2026-10-22'));
    assert.ok(ics.includes('DTSTART:20261023T170000Z'));
    assert.ok(ics.includes('DTEND:20261023T170400Z'));
    assert.ok(ics.includes('DTSTART:20261029T180000Z'));
  } finally {
    process.env.TZ = original;
  }
});

test('ics puts overdue reviews on today', () => {
  const data = makeData();
  addTopic(data, '2026-11-01');
  const ics = buildIcs(data, refreshPlan(data, '2026-11-20'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261120'));
  assert.ok(!ics.includes('DTSTART;VALUE=DATE:20261102'));
});

// ---------- backup ----------

test('a backup restores to identical data', () => {
  const data = makeData();
  const t = addTopic(data, '2026-11-01');
  rateReview(data, t.id, 'hard', '2026-11-02');
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  refreshPlan(data, '2026-11-05');
  const restored = parseBackup(JSON.parse(JSON.stringify(toBackup(data))));
  assert.deepEqual(restored.data, data);
});

test('bad backups are refused with a reason, never half-applied', () => {
  const good = () => JSON.parse(JSON.stringify(toBackup((() => {
    const d = makeData();
    addTopic(d, '2026-11-01');
    return d;
  })())));
  assert.ok(parseBackup(null).error);
  assert.ok(parseBackup({ app: 'Outra' }).error);
  assert.ok(parseBackup({ ...good(), version: 99 }).error);

  const cases = [
    (b) => { b.data.topics = 'x'; },
    (b) => { b.data.topics[0].subjectId = 'ghost'; },
    (b) => { b.data.topics[0].studiedOn = '2026-13-45'; },
    (b) => { b.data.topics[0].srs.due = 'amanhã'; },
    (b) => { b.data.topics[0].title = 'x'.repeat(121); },
    (b) => { b.data.topics.push({ ...b.data.topics[0] }); },
    (b) => { b.data.subjects[0].color = 'red;background:url(//evil)'; },
    (b) => { b.data.reviewLog.push({ topicId: 'ghost', rating: 'good', doneAt: '2026-11-01T00:00:00Z', doneOn: '2026-11-01' }); },
    (b) => { b.data.exams.push({ id: 'x', subjectId: 'poo', date: 'soon' }); },
  ];
  for (const breakIt of cases) {
    const backup = good();
    breakIt(backup);
    assert.ok(parseBackup(backup).error, breakIt.toString());
  }
});

test('bad settings in a backup fall back to defaults', () => {
  const data = emptyData();
  data.settings.dailyTime = '99:99';
  data.settings.maxReviews = -3;
  data.settings.theme = 'neon';
  const { data: restored } = parseBackup(toBackup(data));
  assert.equal(restored.settings.dailyTime, '18:00');
  assert.equal(restored.settings.maxReviews, 20);
  assert.equal(restored.settings.theme, 'auto');
});
