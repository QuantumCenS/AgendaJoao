import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addExam, canUndoRating, deleteTopic, editTopic, rateReview, refreshPlan, snoozeReview, spreadOverdue, undoLastRating,
} from '../../src/core/actions.js';
import { spreadMessage } from '../../src/core/copy.js';
import { buildIcs } from '../../src/core/ics.js';
import { parseBackup, toBackup } from '../../src/core/model.js';
import { todaySummary } from '../../src/core/stats.js';
import { addTopic, dates, makeData } from './helpers.js';

// ---------- editing ----------

test('editing changes the text and subject and leaves the schedule alone', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  const srs = topic.srs;
  editTopic(data, topic.id, { title: ' Novo título ', notes: 'Notas', subjectId: 'calc', durationMin: '45' }, '2026-11-05');
  assert.equal(topic.title, 'Novo título');
  assert.equal(topic.notes, 'Notas');
  assert.equal(topic.subjectId, 'calc');
  assert.equal(topic.durationMin, 45);
  assert.deepEqual(topic.srs, srs);
});

test('editing follows the same limits as logging, and a refusal changes nothing', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05', 'poo', 'Original');
  const today = '2026-11-05';
  assert.throws(() => editTopic(data, topic.id, { title: '  ' }, today));
  assert.throws(() => editTopic(data, topic.id, { title: 'x'.repeat(121) }, today));
  assert.throws(() => editTopic(data, topic.id, { notes: 'x'.repeat(1001) }, today));
  assert.throws(() => editTopic(data, topic.id, { subjectId: 'ghost' }, today));
  assert.throws(() => editTopic(data, topic.id, { studiedOn: '2026-11-06' }, today));
  assert.equal(topic.title, 'Original');
  assert.equal(topic.subjectId, 'poo');
});

test('changing the study date before any review redoes the schedule', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  editTopic(data, topic.id, { studiedOn: '2026-11-03' }, '2026-11-05');
  assert.equal(topic.srs.ideal, '2026-11-04');
  assert.equal(topic.srs.due, '2026-11-04');
});

test('the study date cannot change once the topic has reviews', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  rateReview(data, topic.id, 'good', '2026-11-06');
  assert.throws(() => editTopic(data, topic.id, { studiedOn: '2026-11-01' }, '2026-11-06'), /já tem revisões/);
  assert.equal(topic.studiedOn, '2026-11-05');
  assert.doesNotThrow(() => editTopic(data, topic.id, { title: 'Só o título' }, '2026-11-06'));
});

test('a topic edited into a subject with an exam follows that exam', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05', 'poo');
  addExam(data, { subjectId: 'calc', date: '2026-11-26' }, '2026-11-05');
  assert.ok(dates(refreshPlan(data, '2026-11-05'), topic.id).includes('2027-01-04'));
  editTopic(data, topic.id, { subjectId: 'calc' }, '2026-11-05');
  assert.ok(dates(refreshPlan(data, '2026-11-05'), topic.id).every((d) => d < '2026-11-26'));
});

// ---------- deleting ----------

test('deleting removes the topic and its history, and nothing else', () => {
  const data = makeData();
  const gone = addTopic(data, '2026-11-05');
  const kept = addTopic(data, '2026-11-05');
  rateReview(data, gone.id, 'good', '2026-11-06');
  rateReview(data, kept.id, 'good', '2026-11-06');
  deleteTopic(data, gone.id);
  assert.deepEqual(data.topics.map((t) => t.id), [kept.id]);
  assert.deepEqual(data.reviewLog.map((r) => r.topicId), [kept.id]);
  const plan = refreshPlan(data, '2026-11-06');
  assert.deepEqual(dates(plan, gone.id), []);
  assert.notDeepEqual(dates(plan, kept.id), []);
  assert.throws(() => deleteTopic(data, 'ghost'));
});

// ---------- undo ----------

test('undo puts the topic back exactly as it was and removes the rating', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  const before = structuredClone(topic.srs);
  rateReview(data, topic.id, 'again', '2026-11-06');
  assert.ok(canUndoRating(data, topic.id));
  undoLastRating(data, topic.id);
  assert.deepEqual(topic.srs, before);
  assert.equal(data.reviewLog.length, 0);
  assert.equal(canUndoRating(data, topic.id), false);
  assert.equal(undoLastRating(data, topic.id), null);
});

test('undo works one rating at a time and only touches that topic', () => {
  const data = makeData();
  const a = addTopic(data, '2026-11-05');
  const b = addTopic(data, '2026-11-05');
  const start = structuredClone(a.srs);
  rateReview(data, a.id, 'good', '2026-11-06');
  const afterFirst = structuredClone(a.srs);
  rateReview(data, b.id, 'hard', '2026-11-06');
  rateReview(data, a.id, 'easy', '2026-11-08');
  undoLastRating(data, a.id);
  assert.deepEqual(a.srs, afterFirst);
  assert.equal(data.reviewLog.length, 2);
  undoLastRating(data, a.id);
  assert.deepEqual(a.srs, start);
  assert.deepEqual(data.reviewLog.map((r) => r.topicId), [b.id]);
});

test('undoing a rating restores a snooze that was in place', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  snoozeReview(data, topic.id, '2026-11-06');
  rateReview(data, topic.id, 'good', '2026-11-07');
  undoLastRating(data, topic.id);
  assert.equal(topic.srs.snoozed, true);
  assert.equal(topic.srs.due, '2026-11-07');
});

test('undoing a late review brings it back as overdue', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  rateReview(data, topic.id, 'good', '2026-11-20');
  undoLastRating(data, topic.id);
  assert.equal(refreshPlan(data, '2026-11-20').next.get(topic.id).overdue, true);
});

test('older backups without the undo snapshot still load, but cannot undo', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  rateReview(data, topic.id, 'good', '2026-11-06');
  delete data.reviewLog[0].srsBefore;
  delete data.settings.icsAlarm;
  const { data: restored, error } = parseBackup(JSON.parse(JSON.stringify(toBackup(data))));
  assert.equal(error, undefined);
  assert.equal(canUndoRating(restored, topic.id), false);
  assert.equal(restored.settings.icsAlarm, true);
});

test('a backup with a broken undo snapshot is refused', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  rateReview(data, topic.id, 'good', '2026-11-06');
  data.reviewLog[0].srsBefore = { step: 'x' };
  assert.ok(parseBackup(JSON.parse(JSON.stringify(toBackup(data)))).error);
});

// ---------- spreading overdue ----------

function backFromBreak(settings, count) {
  const data = makeData({ maxMinutes: 0, ...settings });
  const topics = [];
  for (let i = 0; i < count; i += 1) topics.push(addTopic(data, `2026-10-${String(1 + i).padStart(2, '0')}`));
  return { data, topics };
}

test('spreading keeps what fits today and moves the rest without going over the limit', () => {
  const { data } = backFromBreak({ maxReviews: 5 }, 12);
  const today = '2026-11-05';
  const before = refreshPlan(data, today);
  assert.equal(todaySummary(data, before).count, 12);

  const result = spreadOverdue(data, before, today);
  const after = refreshPlan(data, today);
  const summary = todaySummary(data, after);

  assert.equal(summary.count, 5);
  assert.equal(result.moved, 7);
  assert.equal(result.staying, 5);
  const perDay = new Map();
  for (const it of after.items.filter((i) => i.index === 0)) perDay.set(it.date, (perDay.get(it.date) ?? 0) + 1);
  for (const [day, n] of perDay) if (day > today) assert.ok(n <= 5, `${day}: ${n}`);
});

test('the oldest overdue reviews are the ones that stay today', () => {
  const { data, topics } = backFromBreak({ maxReviews: 2 }, 5);
  const today = '2026-11-05';
  spreadOverdue(data, refreshPlan(data, today), today);
  const plan = refreshPlan(data, today);
  assert.equal(plan.next.get(topics[0].id).date < today, true);
  assert.equal(plan.next.get(topics[1].id).date < today, true);
  assert.ok(plan.next.get(topics[4].id).date > today);
});

test('spreading leaves today alone if it already fits', () => {
  const { data, topics } = backFromBreak({ maxReviews: 20 }, 3);
  const today = '2026-11-05';
  const result = spreadOverdue(data, refreshPlan(data, today), today);
  assert.equal(result.moved, 0);
  assert.equal(refreshPlan(data, today).next.get(topics[2].id).overdue, true);
});

test('reviews done today count toward today', () => {
  const { data, topics } = backFromBreak({ maxReviews: 4 }, 6);
  const today = '2026-11-05';
  rateReview(data, topics[0].id, 'good', today);
  rateReview(data, topics[1].id, 'good', today);
  spreadOverdue(data, refreshPlan(data, today), today);
  assert.equal(todaySummary(data, refreshPlan(data, today)).count, 2);
});

test('spread reviews stay put when replanning and no day gets more next reviews than the limit', () => {
  const { data, topics } = backFromBreak({ maxReviews: 2 }, 7);
  const today = '2026-11-05';
  spreadOverdue(data, refreshPlan(data, today), today);
  const first = topics.map((t) => refreshPlan(data, today).next.get(t.id).date);
  const second = topics.map((t) => refreshPlan(data, today).next.get(t.id).date);
  assert.deepEqual(first, second);
  const perDay = new Map();
  for (const d of first) if (d > today) perDay.set(d, (perDay.get(d) ?? 0) + 1);
  for (const [day, n] of perDay) assert.ok(n <= 2, `${day}: ${n}`);
});

test('a spread review is rated like any other and counts from the day it is done', () => {
  const { data, topics } = backFromBreak({ maxReviews: 1 }, 2);
  const today = '2026-11-05';
  spreadOverdue(data, refreshPlan(data, today), today);
  const moved = topics[1];
  assert.equal(moved.srs.due, '2026-11-06');
  rateReview(data, moved.id, 'good', '2026-11-06');
  assert.equal(moved.srs.ideal, '2026-11-08');
  assert.ok(!moved.srs.snoozed);
});

test('spreading never pushes a review past its exam', () => {
  const { data, topics } = backFromBreak({ maxReviews: 1 }, 5);
  const today = '2026-11-05';
  addExam(data, { subjectId: 'poo', date: '2026-11-08' }, today);
  spreadOverdue(data, refreshPlan(data, today), today);
  const plan = refreshPlan(data, today);
  for (const t of topics) assert.ok(plan.next.get(t.id).date < '2026-11-08', plan.next.get(t.id).date);
  // Only the 6th and 7th have room: the rest stay on today's list.
  assert.equal(todaySummary(data, plan).count, 3);
});

test('reviews with an exam get the room first', () => {
  const { data, topics } = backFromBreak({ maxReviews: 1 }, 2);
  const today = '2026-11-05';
  const urgent = addTopic(data, '2026-10-20', 'calc');
  addExam(data, { subjectId: 'calc', date: '2026-11-06' }, today);
  spreadOverdue(data, refreshPlan(data, today), today);
  const plan = refreshPlan(data, today);
  assert.ok(plan.next.get(urgent.id).date <= today, 'the one with the exam tomorrow stays today');
  assert.ok(plan.next.get(topics[0].id).date > today);
});

test('with every day full, nothing moves and the message says so', () => {
  const { data } = backFromBreak({ maxReviews: 1 }, 2);
  const today = '2026-11-05';
  const plan = refreshPlan(data, today);
  // Sixty-one full days ahead.
  for (let i = 1; i <= 61; i += 1) {
    const day = new Date(Date.UTC(2026, 10, 5 + i)).toISOString().slice(0, 10);
    plan.items.push({ date: day, index: 0 });
  }
  assert.equal(spreadOverdue(data, plan, today).moved, 0);
  assert.equal(spreadMessage(0), 'Os próximos dias também estão cheios, por isso ficam aqui.');
  assert.equal(spreadMessage(3), 'Passei 3 revisões para os próximos dias.');
});

// ---------- calendar alarms ----------

const unfold = (ics) => ics.replaceAll('\r\n ', '');
const events = (ics) => unfold(ics).split('BEGIN:VEVENT').slice(1);

test('one alarm per day, however many reviews that day has', () => {
  const data = makeData({ dailyTime: '18:00' });
  addTopic(data, '2026-11-05');
  addTopic(data, '2026-11-05');
  addTopic(data, '2026-11-05');
  const ics = buildIcs(data, refreshPlan(data, '2026-11-05'));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 18);
  assert.equal(ics.match(/BEGIN:VALARM/g).length, 6, 'six review days');
  assert.equal(ics.match(/END:VALARM/g).length, 6);
  const first = events(ics).find((e) => e.includes('20261106') && e.includes('VALARM'));
  assert.ok(first.includes('DESCRIPTION:3 revisões hoje\\, cerca de 10 min'));
  assert.ok(first.includes('ACTION:DISPLAY'));
  assert.ok(first.indexOf('END:VALARM') < first.indexOf('END:VEVENT'), 'the alarm sits inside the event');
});

test('an all-day event rings at the reminder time, counted from midnight', () => {
  const data = makeData({ dailyTime: '18:00' });
  addTopic(data, '2026-11-05');
  const ics = buildIcs(data, refreshPlan(data, '2026-11-05'));
  assert.ok(ics.includes('TRIGGER;RELATED=START:PT1080M'));
});

test('a timed event rings when it starts', () => {
  const data = makeData({ preferredTime: '19:30' });
  addTopic(data, '2026-11-05');
  const ics = buildIcs(data, refreshPlan(data, '2026-11-05'));
  assert.ok(ics.includes('TRIGGER;RELATED=START:PT0M'));
});

test('alarms respect quiet hours', () => {
  const allDay = makeData({ dailyTime: '23:00', quietStart: '22:30', quietEnd: '07:30' });
  addTopic(allDay, '2026-11-05');
  assert.ok(buildIcs(allDay, refreshPlan(allDay, '2026-11-05')).includes('TRIGGER;RELATED=START:PT450M'));

  // Studying at 23:00 with quiet hours until 07:30: the alarm comes earlier that day.
  const timed = makeData({ preferredTime: '23:00', quietStart: '22:30', quietEnd: '07:30' });
  addTopic(timed, '2026-11-05');
  assert.ok(buildIcs(timed, refreshPlan(timed, '2026-11-05')).includes('TRIGGER;RELATED=START:-PT930M'));
});

test('alarms can be switched off', () => {
  const data = makeData({ icsAlarm: false });
  addTopic(data, '2026-11-05');
  const ics = buildIcs(data, refreshPlan(data, '2026-11-05'));
  assert.ok(!ics.includes('VALARM'));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 6);
});

test('overdue reviews share today\'s single alarm', () => {
  const data = makeData();
  addTopic(data, '2026-11-01');
  addTopic(data, '2026-11-02');
  const ics = buildIcs(data, refreshPlan(data, '2026-11-20'));
  const today = events(ics).filter((e) => e.includes('DTSTART;VALUE=DATE:20261120'));
  assert.equal(today.length, 2);
  assert.equal(today.filter((e) => e.includes('VALARM')).length, 1);
});
