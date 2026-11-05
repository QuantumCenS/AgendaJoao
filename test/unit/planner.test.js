import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../../src/core/dates.js';
import {
  addExam, logStudy, markMastered, previewRatings, rateReview, refreshPlan, resumeTopic, setExamKeepAfter, snoozeReview,
} from '../../src/core/actions.js';
import { planAgenda, toleranceFor } from '../../src/core/planner.js';
import { todaySummary } from '../../src/core/stats.js';
import { addTopic, dates, makeData } from './helpers.js';

// ---------- scheduling ----------

test('logging a topic puts the six reviews from the brief on the agenda', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  const plan = planAgenda(data, '2026-11-05');
  assert.deepEqual(dates(plan, topic.id), ['2026-11-06', '2026-11-08', '2026-11-12', '2026-11-19', '2026-12-05', '2027-01-04']);
  assert.equal(plan.next.get(topic.id).date, '2026-11-06');
});

test('brief example: Hard on 8 Nov replans the rest of the schedule earlier', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  rateReview(data, topic.id, 'good', '2026-11-06');
  rateReview(data, topic.id, 'hard', '2026-11-08');
  const plan = refreshPlan(data, '2026-11-08');
  assert.ok(plan.next.get(topic.id).date < '2026-11-12');
  assert.equal(plan.next.get(topic.id).date, '2026-11-11');
});

test('rating is recorded in the log with UTC time and the local day', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  rateReview(data, topic.id, 'good', '2026-11-06', new Date('2026-11-06T23:30:00Z'));
  const [entry] = data.reviewLog;
  assert.equal(entry.doneAt, '2026-11-06T23:30:00.000Z');
  assert.equal(entry.doneOn, '2026-11-06');
  assert.equal(entry.scheduledFor, '2026-11-06');
  assert.equal(entry.intervalAfter, 2);
});

// ---------- overdue ----------

test('a missed review moves to overdue and stays on the list', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  const plan = refreshPlan(data, '2026-11-10');
  const next = plan.next.get(topic.id);
  assert.equal(next.date, '2026-11-06');
  assert.equal(next.overdue, true);
  const summary = todaySummary(data, plan);
  assert.equal(summary.count, 1);
  assert.equal(summary.overdue, 1);
});

test('overdue reviews do not pile up: only one per topic, the rest stay in the future', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  const today = '2026-12-20';
  const plan = refreshPlan(data, today);
  const [first, ...rest] = dates(plan, topic.id);
  assert.equal(first, '2026-11-06');
  for (const d of rest) assert.ok(d > today, d);
  assert.equal(todaySummary(data, plan).count, 1);
});

test('after an overdue review, the next one is calculated from the day it was done', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  rateReview(data, topic.id, 'good', '2026-11-20');
  const plan = refreshPlan(data, '2026-11-20');
  assert.equal(plan.next.get(topic.id).date, '2026-11-22');
  assert.equal(plan.next.get(topic.id).overdue, false);
});

test('a review studied in the past starts overdue rather than being lost', () => {
  const data = makeData();
  const topic = logStudy(data, { subjectId: 'poo', title: 'Antigo', studiedOn: '2026-10-01' }, '2026-11-05');
  const plan = refreshPlan(data, '2026-11-05');
  assert.equal(plan.next.get(topic.id).overdue, true);
});

test('logStudy rejects bad input', () => {
  const data = makeData();
  const today = '2026-11-05';
  assert.throws(() => logStudy(data, { subjectId: 'poo', title: ' ', studiedOn: today }, today));
  assert.throws(() => logStudy(data, { subjectId: 'poo', title: 'x'.repeat(121), studiedOn: today }, today));
  assert.throws(() => logStudy(data, { subjectId: 'poo', title: 'ok', notes: 'x'.repeat(1001), studiedOn: today }, today));
  assert.throws(() => logStudy(data, { subjectId: 'nope', title: 'ok', studiedOn: today }, today));
  assert.throws(() => logStudy(data, { subjectId: 'poo', title: 'ok', studiedOn: '2026-11-06' }, today));
  assert.doesNotThrow(() => logStudy(data, { subjectId: 'poo', title: 'x'.repeat(120), studiedOn: today }, today));
});

// ---------- snooze and mastered ----------

test('snooze moves the review to tomorrow without touching the schedule', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  const before = { step: topic.srs.step, ease: topic.srs.ease };
  snoozeReview(data, topic.id, '2026-11-06');
  const plan = refreshPlan(data, '2026-11-06');
  assert.equal(plan.next.get(topic.id).date, '2026-11-07');
  assert.equal(data.reviewLog.length, 0);
  assert.equal(topic.srs.step, before.step);
  assert.equal(topic.srs.ease, before.ease);
});

test('a snoozed review stays on tomorrow even when that day is full', () => {
  const data = makeData({ maxReviews: 1, maxMinutes: 0 });
  const other = addTopic(data, '2026-11-06');
  const topic = addTopic(data, '2026-11-05');
  snoozeReview(data, topic.id, '2026-11-06');
  const plan = refreshPlan(data, '2026-11-06');
  assert.equal(plan.next.get(topic.id).date, '2026-11-07');
  assert.equal(plan.next.get(other.id).date, '2026-11-07');
});

test('a snoozed long-interval review is not moved off tomorrow by balancing', () => {
  const data = makeData({ maxReviews: 1, maxMinutes: 0 });
  // Topic first: without the snooze rule, balancing would pick it to move.
  const [topic, other] = withStep(data, 2, '2026-10-01', 5, 30, '2026-11-07');
  topic.srs = { ...topic.srs, ideal: '2026-11-06', due: '2026-11-06' };
  snoozeReview(data, topic.id, '2026-11-06');
  const plan = refreshPlan(data, '2026-11-06');
  assert.equal(plan.next.get(topic.id).date, '2026-11-07');
  assert.notEqual(plan.next.get(other.id).date, '2026-11-07', 'the other one gives way');
});

test('rating a snoozed review clears the snooze', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  snoozeReview(data, topic.id, '2026-11-06');
  rateReview(data, topic.id, 'good', '2026-11-07');
  assert.ok(!topic.srs.snoozed);
  assert.equal(topic.srs.ideal, '2026-11-09');
});

test('mastered topics leave the agenda and can come back', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  markMastered(data, topic.id, '2026-11-06');
  assert.deepEqual(dates(refreshPlan(data, '2026-11-06'), topic.id), []);
  resumeTopic(data, topic.id, '2026-11-20');
  assert.equal(refreshPlan(data, '2026-11-20').next.get(topic.id).date, '2026-11-21');
});

// ---------- exam mode ----------

test('brief example: every topic gets a review between 23 and 29 Nov, none after the exam', () => {
  const data = makeData({ maxReviews: 0, maxMinutes: 0 });
  const topics = [];
  for (let i = 0; i < 18; i += 1) topics.push(addTopic(data, addDays('2026-10-01', i * 3)));
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  const plan = refreshPlan(data, '2026-11-05');
  for (const t of topics) {
    const all = dates(plan, t.id).map((d) => (d < plan.today ? plan.today : d));
    assert.ok(all.some((d) => d >= '2026-11-23' && d <= '2026-11-29'), `${t.title}: ${all}`);
    assert.ok(all.every((d) => d < '2026-11-30'), `${t.title}: ${all}`);
  }
});

test('reviews from another subject are left alone by an exam', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05', 'calc');
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  assert.equal(dates(planAgenda(data, '2026-11-05'), topic.id).at(-1), '2027-01-04');
});

test('a topic with a natural review in the final week keeps it', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05'); // natural review on 19 Nov
  addExam(data, { subjectId: 'poo', date: '2026-11-26' }, '2026-11-05');
  const plan = planAgenda(data, '2026-11-05');
  assert.deepEqual(dates(plan, topic.id), ['2026-11-06', '2026-11-08', '2026-11-12', '2026-11-19']);
});

test('a topic whose next review falls after the exam gets pulled into the final week', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-09-01');
  for (let i = 0; i < 5; i += 1) rateReview(data, topic.id, 'good', topic.srs.ideal);
  assert.equal(topic.srs.ideal, '2026-10-31');
  rateReview(data, topic.id, 'good', '2026-10-31'); // next is in 60 days, 30 Dec
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  const plan = refreshPlan(data, '2026-11-05');
  const [only, ...rest] = dates(plan, topic.id);
  assert.ok(only >= '2026-11-23' && only <= '2026-11-29', only);
  assert.deepEqual(rest, []);
  assert.equal(plan.next.get(topic.id).packed, true);
});

test('a review done in the final week covers the topic, and nothing follows after the exam', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-09-01');
  for (let i = 0; i < 6; i += 1) rateReview(data, topic.id, 'good', topic.srs.ideal);
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  rateReview(data, topic.id, 'good', '2026-11-25');
  const plan = refreshPlan(data, '2026-11-25');
  assert.deepEqual(dates(plan, topic.id), []);
});

test('the rating buttons say so when no review follows before the exam', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-09-01');
  for (let i = 0; i < 6; i += 1) rateReview(data, topic.id, 'good', topic.srs.ideal);
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-25');
  refreshPlan(data, '2026-11-25');
  const preview = previewRatings(data, topic.id, '2026-11-25');
  assert.equal(preview.good.date, null);
  assert.equal(preview.again.date, '2026-11-26');
});

test('keepAfter keeps reviews after the exam, and can be switched at any time', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  const exam = addExam(data, { subjectId: 'poo', date: '2026-11-30', keepAfter: true }, '2026-11-05');
  assert.ok(dates(planAgenda(data, '2026-11-05'), topic.id).includes('2027-01-04'));
  setExamKeepAfter(data, exam.id, false);
  assert.ok(!dates(planAgenda(data, '2026-11-05'), topic.id).includes('2027-01-04'));
});

test('after the exam, its topics stop until the user chooses to keep them', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  const exam = addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  const plan = refreshPlan(data, '2026-12-01');
  assert.deepEqual(dates(plan, topic.id), []);
  assert.deepEqual(plan.paused, [topic.id]);
  setExamKeepAfter(data, exam.id, true);
  assert.notDeepEqual(dates(refreshPlan(data, '2026-12-01'), topic.id), []);
});

test('a topic studied after the exam is scheduled normally', () => {
  const data = makeData();
  const old = addTopic(data, '2026-11-05');
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  const fresh = addTopic(data, '2026-12-02');
  const plan = refreshPlan(data, '2026-12-02');
  assert.equal(plan.next.get(fresh.id).date, '2026-12-03');
  assert.equal(plan.next.get(old.id), undefined);
});

test('an overdue review on exam day stays visible, and is gone the day after', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-11-05');
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  assert.equal(refreshPlan(data, '2026-11-30').next.get(topic.id).overdue, true);
  assert.equal(refreshPlan(data, '2026-12-01').next.get(topic.id), undefined);
});

test('exam added late, tomorrow: uncovered topics are due today', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-09-01');
  for (let i = 0; i < 6; i += 1) rateReview(data, topic.id, 'good', topic.srs.ideal);
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-29');
  const plan = refreshPlan(data, '2026-11-29');
  assert.equal(plan.next.get(topic.id).date, '2026-11-29');
});

test('with the exam tomorrow, a topic studied today gets no impossible review', () => {
  const data = makeData();
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-29');
  const topic = addTopic(data, '2026-11-29');
  assert.deepEqual(dates(refreshPlan(data, '2026-11-29'), topic.id), []);
});

test('deleting an exam from the data restores the normal schedule', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-09-01');
  for (let i = 0; i < 6; i += 1) rateReview(data, topic.id, 'good', topic.srs.ideal);
  const original = topic.srs.ideal;
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  refreshPlan(data, '2026-11-05');
  data.exams = [];
  assert.equal(refreshPlan(data, '2026-11-05').next.get(topic.id).date, original);
});

test('two exams: the first window is covered and reviews run until the last one', () => {
  const data = makeData({ maxReviews: 0, maxMinutes: 0 });
  const topic = addTopic(data, '2026-09-01');
  for (let i = 0; i < 6; i += 1) rateReview(data, topic.id, 'good', topic.srs.ideal);
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  addExam(data, { subjectId: 'poo', date: '2027-01-20' }, '2026-11-05');
  const all = dates(refreshPlan(data, '2026-11-05'), topic.id);
  assert.ok(all.some((d) => d >= '2026-11-23' && d <= '2026-11-29'), all.join());
  assert.ok(all.some((d) => d >= '2027-01-13' && d <= '2027-01-19'), all.join());
  assert.ok(all.every((d) => d < '2027-01-20'), all.join());
});

test('an overdue review shown during the final week counts as its review', () => {
  const data = makeData();
  const topic = addTopic(data, '2026-09-01');
  for (let i = 0; i < 6; i += 1) rateReview(data, topic.id, 'good', topic.srs.ideal);
  topic.srs = { ...topic.srs, ideal: '2026-11-20', due: '2026-11-20' };
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  const plan = refreshPlan(data, '2026-11-25');
  assert.deepEqual(dates(plan, topic.id), ['2026-11-20'], 'no second review stacked on top');
  assert.equal(plan.next.get(topic.id).overdue, true);
});

test('balancing never carries a final-week review out of the window', () => {
  const data = makeData({ maxReviews: 1, maxMinutes: 0 });
  const topics = withStep(data, 3, '2026-10-01', 5, 30, '2026-11-23'); // first day of the window
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  const plan = refreshPlan(data, '2026-11-05');
  for (const t of topics) {
    const { date } = plan.next.get(t.id);
    assert.ok(date >= '2026-11-23' && date <= '2026-11-29', date);
  }
});

test('packed reviews spread evenly across the final week', () => {
  const data = makeData();
  for (let i = 0; i < 14; i += 1) {
    const topic = addTopic(data, '2026-09-01');
    for (let j = 0; j < 6; j += 1) rateReview(data, topic.id, 'good', topic.srs.ideal);
  }
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  const plan = refreshPlan(data, '2026-11-05');
  const perDay = new Map();
  for (const it of plan.items) perDay.set(it.date, (perDay.get(it.date) ?? 0) + 1);
  assert.equal(perDay.size, 7);
  for (const n of perDay.values()) assert.equal(n, 2);
});

// ---------- balancing ----------

test('tolerance depends on the interval', () => {
  assert.equal(toleranceFor(1), 0);
  assert.equal(toleranceFor(6), 0);
  assert.equal(toleranceFor(7), 1);
  assert.equal(toleranceFor(29), 1);
  assert.equal(toleranceFor(30), 2);
  assert.equal(toleranceFor(60), 2);
});

function withStep(data, count, studiedOn, step, interval, ideal) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = addTopic(data, studiedOn);
    t.srs = { ...t.srs, step, interval, ideal, due: ideal };
    out.push(t);
  }
  return out;
}

test('an over-limit day spreads to nearby days and reports it', () => {
  const data = makeData({ maxReviews: 3, maxMinutes: 0 });
  withStep(data, 5, '2026-10-01', 5, 30, '2026-12-10');
  const plan = refreshPlan(data, '2026-11-05');
  const count = (d) => plan.items.filter((it) => it.date === d).length;
  assert.equal(count('2026-12-10'), 3);
  assert.equal(plan.moved.length, 2);
  assert.ok(plan.moved.every((it) => it.originalDate === '2026-12-10'));
  assert.deepEqual(plan.overLimitDays, []);
});

test('reviews move at most two days, and short intervals do not move at all', () => {
  const data = makeData({ maxReviews: 1, maxMinutes: 0 });
  withStep(data, 20, '2026-10-01', 5, 30, '2026-12-10');
  withStep(data, 5, '2026-10-01', 1, 2, '2026-12-20');
  const plan = refreshPlan(data, '2026-11-05');
  for (const it of plan.moved) {
    const distance = Math.abs(new Date(it.date) - new Date(it.originalDate)) / 86_400_000;
    assert.ok(distance <= 2, `${it.key} moved ${distance}`);
    assert.ok(it.interval >= 7);
  }
  assert.equal(plan.items.filter((it) => it.index === 0 && it.date === '2026-12-20').length, 5);
  assert.ok(plan.overLimitDays.includes('2026-12-10'), 'says so when a day cannot fit');
  assert.ok(plan.overLimitDays.includes('2026-12-20'));
});

test('the minutes limit is applied too', () => {
  const data = makeData({ maxReviews: 100, maxMinutes: 12, minutesPerReview: 4 });
  withStep(data, 5, '2026-10-01', 5, 30, '2026-12-10');
  const plan = refreshPlan(data, '2026-11-05');
  assert.equal(plan.limit, 3);
  assert.equal(plan.items.filter((it) => it.date === '2026-12-10').length, 3);
});

test('today and overdue reviews are never moved, whatever the limit', () => {
  const data = makeData({ maxReviews: 2, maxMinutes: 0 });
  const topics = withStep(data, 10, '2026-10-01', 5, 30, '2026-11-05');
  const plan = refreshPlan(data, '2026-11-05');
  for (const t of topics) assert.equal(plan.next.get(t.id).date, '2026-11-05');
  const summary = todaySummary(data, plan);
  assert.equal(summary.count, 10);
  assert.equal(summary.overLimit, true);
});

test('balancing never moves a review into today or the past', () => {
  const data = makeData({ maxReviews: 1, maxMinutes: 0 });
  withStep(data, 6, '2026-10-01', 5, 30, '2026-11-06');
  const plan = refreshPlan(data, '2026-11-05');
  assert.ok(plan.items.every((it) => it.date > '2026-11-05'));
});

test('a review moved earlier arrives on that earlier day', () => {
  const data = makeData({ maxReviews: 1, maxMinutes: 0 });
  // Blocks the later days, so one of these goes earlier.
  const [a, b] = withStep(data, 2, '2026-10-01', 5, 30, '2026-12-10');
  withStep(data, 1, '2026-10-01', 1, 2, '2026-12-11');
  withStep(data, 1, '2026-10-01', 1, 2, '2026-12-12');
  const first = refreshPlan(data, '2026-11-05');
  const moved = [a, b].find((t) => first.next.get(t.id).date === '2026-12-09');
  assert.ok(moved, 'one review moved a day earlier');
  // The eve of the earlier day settles it, then it stays on that day.
  refreshPlan(data, '2026-12-08');
  const onDay = refreshPlan(data, '2026-12-09');
  assert.equal(onDay.next.get(moved.id).date, '2026-12-09');
  assert.equal(onDay.next.get(moved.id).locked, true);
});

test('a review moved later does not drop back or keep drifting as days pass', () => {
  const data = makeData({ maxReviews: 1, maxMinutes: 0 });
  const [a, b] = withStep(data, 2, '2026-10-01', 5, 30, '2026-12-10');
  const first = refreshPlan(data, '2026-12-05');
  const moved = [a, b].find((t) => first.next.get(t.id).date === '2026-12-11');
  assert.ok(moved);
  const onIdeal = refreshPlan(data, '2026-12-10');
  assert.equal(onIdeal.next.get(moved.id).date, '2026-12-11');
  assert.equal(onIdeal.next.get(moved.id).overdue, false);
  // New reviews fill the 11th: it may shift inside its tolerance but no further.
  withStep(data, 3, '2026-10-01', 1, 2, '2026-12-11');
  const fuller = refreshPlan(data, '2026-12-10');
  assert.ok(fuller.next.get(moved.id).date <= '2026-12-12');
});

test('replanning is stable: running it twice changes nothing', () => {
  const data = makeData({ maxReviews: 2, maxMinutes: 0 });
  withStep(data, 8, '2026-10-01', 5, 30, '2026-12-10');
  addExam(data, { subjectId: 'poo', date: '2026-12-20' }, '2026-11-05');
  const a = refreshPlan(data, '2026-11-05').items.map((it) => `${it.key}:${it.date}`);
  const b = refreshPlan(data, '2026-11-05').items.map((it) => `${it.key}:${it.date}`);
  assert.deepEqual(a, b);
});

test('the rating buttons predict exactly what rating does, balancing included', () => {
  const data = makeData({ maxReviews: 1, maxMinutes: 0 });
  const topic = addTopic(data, '2026-11-05');
  withStep(data, 1, '2026-10-01', 1, 2, '2026-11-08');
  refreshPlan(data, '2026-11-06');
  const preview = previewRatings(data, topic.id, '2026-11-06');
  for (const rating of ['again', 'hard', 'good', 'easy']) {
    const copy = structuredClone(data);
    rateReview(copy, topic.id, rating, '2026-11-06');
    assert.equal(refreshPlan(copy, '2026-11-06').next.get(topic.id).date, preview[rating].date, rating);
  }
  assert.equal(data.reviewLog.length, 0, 'preview leaves the real data alone');
});

// ---------- the three layers together ----------

test('an exam window stays covered even when balancing is under pressure', () => {
  const data = makeData({ maxReviews: 2, maxMinutes: 0 });
  const poo = [];
  for (let i = 0; i < 20; i += 1) {
    const t = addTopic(data, '2026-09-01');
    for (let j = 0; j < 6; j += 1) rateReview(data, t.id, 'good', t.srs.ideal);
    poo.push(t);
  }
  for (let i = 0; i < 10; i += 1) addTopic(data, '2026-11-20', 'calc');
  addExam(data, { subjectId: 'poo', date: '2026-11-30' }, '2026-11-05');
  const plan = refreshPlan(data, '2026-11-05');
  for (const t of poo) {
    const all = dates(plan, t.id);
    assert.equal(all.length, 1);
    assert.ok(all[0] >= '2026-11-23' && all[0] <= '2026-11-29', all[0]);
  }
});

test('stress: a simulated semester keeps every invariant', () => {
  let seed = 7;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const data = makeData({ maxReviews: 12, maxMinutes: 0 });
  const exam = addExam(data, { subjectId: 'poo', date: '2027-01-25' }, '2026-09-15');
  const ratings = ['again', 'hard', 'good', 'good', 'good', 'easy'];

  for (let day = '2026-09-15'; day < '2027-01-25'; day = addDays(day, 1)) {
    if (rand(3) === 0) addTopic(data, day, rand(2) ? 'poo' : 'calc');
    const plan = refreshPlan(data, day);
    const skippedDay = rand(7) === 0;
    if (!skippedDay) {
      for (const it of plan.items.filter((i) => i.index === 0 && i.date <= day)) {
        if (rand(5) !== 0) rateReview(data, it.topicId, ratings[rand(ratings.length)], day);
      }
    }

    const after = refreshPlan(data, day);
    const seen = new Map();
    for (const it of after.items) {
      // One actionable review per topic, in date order, none before today unless overdue.
      if (it.index === 0) {
        assert.ok(!seen.has(it.topicId), `${it.topicId} has two next reviews`);
        seen.set(it.topicId, it.date);
      } else {
        assert.ok(it.date > day, `${it.key} planned in the past on ${day}: ${it.date}`);
      }
      const topic = data.topics.find((t) => t.id === it.topicId);
      if (topic.subjectId === 'poo' && it.date > day) {
        assert.ok(it.date < exam.date, `${it.key} after the exam: ${it.date}`);
      }
    }
    for (const topic of data.topics) {
      const all = dates(after, topic.id);
      for (let i = 1; i < all.length; i += 1) {
        assert.ok(all[i] >= all[i - 1], `${topic.id} out of order on ${day}: ${all}`);
      }
    }
    for (const d of after.overLimitDays) assert.ok(d > day);
  }

  // On the eve of the exam, every POO topic studied early enough is covered.
  const eve = '2027-01-24';
  const plan = refreshPlan(data, eve);
  const from = '2027-01-18';
  for (const t of data.topics.filter((x) => x.subjectId === 'poo' && x.studiedOn < eve)) {
    const reviewed = data.reviewLog.some((r) => r.topicId === t.id && r.doneOn >= from);
    const planned = plan.next.has(t.id);
    assert.ok(reviewed || planned, `${t.id} not covered`);
  }
});
