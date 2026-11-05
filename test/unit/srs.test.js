import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, diffDays } from '../../src/core/dates.js';
import { LADDER_DAYS, MAX_INTERVAL, MIN_EASE, RATINGS, nextEase, sm2Ladder as s } from '../../src/core/srs.js';

test('a new topic projects the default schedule from the brief', () => {
  const srs = s.init('2026-11-05');
  assert.deepEqual(
    s.project(srs).map((r) => r.date),
    ['2026-11-06', '2026-11-08', '2026-11-12', '2026-11-19', '2026-12-05', '2027-01-04'],
  );
});

test('rating Good every time on the due day follows the same schedule', () => {
  let srs = s.init('2026-11-05');
  const dates = [srs.ideal];
  for (let i = 0; i < 5; i += 1) {
    srs = s.rate(srs, 'good', srs.ideal);
    dates.push(srs.ideal);
  }
  assert.deepEqual(dates, LADDER_DAYS.map((d) => addDays('2026-11-05', d)));
});

test('brief example: Hard on 8 Nov moves the next review earlier than 12 Nov', () => {
  const onEight = s.rate(s.init('2026-11-05'), 'good', '2026-11-06');
  assert.equal(onEight.ideal, '2026-11-08');
  const hard = s.rate(onEight, 'hard', '2026-11-08');
  assert.ok(hard.ideal < '2026-11-12', hard.ideal);
  assert.ok(hard.ideal > '2026-11-08', hard.ideal);
});

test('brief example: Again brings the topic back tomorrow', () => {
  let srs = s.init('2026-11-05');
  for (let i = 0; i < 3; i += 1) srs = s.rate(srs, 'good', srs.ideal);
  const again = s.rate(srs, 'again', '2026-11-12');
  assert.equal(again.ideal, '2026-11-13');
  assert.equal(again.step, 0);
  assert.equal(again.lapses, 1);
});

test('the next interval counts from the day the review is actually done', () => {
  const srs = s.rate(s.init('2026-11-05'), 'good', '2026-11-06'); // due 8 Nov
  const late = s.rate(srs, 'good', '2026-11-20'); // done 12 days late
  assert.equal(late.ideal, '2026-11-24'); // 4-day gap from the 20th, not from the 8th
});

test('ease follows the SM-2 formula', () => {
  assert.equal(nextEase(2.5, 'good'), 2.5);
  assert.equal(nextEase(2.5, 'easy'), 2.6);
  assert.equal(nextEase(2.5, 'hard'), 2.36);
  assert.equal(nextEase(2.5, 'again'), 2.18);
  assert.equal(nextEase(1.3, 'again'), MIN_EASE);
});

test('Hard grows the interval a little, Easy grows it more', () => {
  let srs = s.init('2026-11-05');
  for (let i = 0; i < 3; i += 1) srs = s.rate(srs, 'good', srs.ideal); // interval 7
  const on = srs.ideal;
  const [hard, good, easy] = ['hard', 'good', 'easy'].map((r) => s.rate(srs, r, on).interval);
  assert.equal(hard, 8);
  assert.equal(good, 16);
  assert.equal(easy, 26); // Easy's own ease: 16 * 2.6 / 2.5 = 17, then 17 * 1.5
});

test('interval order holds from any state: Again <= Hard < Good < Easy', () => {
  // Walk through many reachable states with a fixed pseudo-random rating sequence.
  let seed = 42;
  const pick = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return RATINGS[seed % 4];
  };
  let srs = s.init('2026-01-01');
  let today = '2026-01-02';
  for (let i = 0; i < 2000; i += 1) {
    const [again, hard, good, easy] = RATINGS.map((r) => s.rate(srs, r, today).interval);
    assert.equal(again, 1);
    assert.ok(hard >= 1);
    assert.ok(hard <= good, `hard ${hard} good ${good}`);
    if (good > 1 && good < MAX_INTERVAL) assert.ok(hard < good, `hard ${hard} good ${good}`);
    assert.ok(good <= easy, `good ${good} easy ${easy}`);
    if (good < MAX_INTERVAL) assert.ok(good < easy, `good ${good} easy ${easy}`);
    assert.ok(easy <= MAX_INTERVAL);
    srs = s.rate(srs, pick(), today);
    assert.ok(srs.ease >= MIN_EASE);
    assert.equal(diffDays(srs.ideal, today), srs.interval);
    today = srs.ideal;
    if (i % 100 === 0) srs = { ...srs, step: 0, interval: 1 }; // revisit the low steps
  }
});

test('past the ladder, Good keeps growing up to the maximum', () => {
  let srs = s.init('2026-11-05');
  const intervals = [];
  for (let i = 0; i < 12; i += 1) {
    srs = s.rate(srs, 'good', srs.ideal);
    intervals.push(srs.interval);
  }
  assert.deepEqual(intervals, [2, 4, 7, 16, 30, 60, 120, 240, 365, 365, 365, 365]);
});

test('project never goes backwards and starts from the given date', () => {
  let srs = s.init('2026-11-05');
  srs = s.rate(srs, 'hard', '2026-11-06');
  const dates = s.project(srs, '2026-12-01').map((r) => r.date);
  assert.equal(dates[0], '2026-12-01');
  for (let i = 1; i < dates.length; i += 1) assert.ok(dates[i] > dates[i - 1]);
});

test('past the ladder, only the next review is projected', () => {
  let srs = s.init('2026-11-05');
  for (let i = 0; i < 6; i += 1) srs = s.rate(srs, 'good', srs.ideal);
  assert.equal(s.project(srs).length, 1);
});

test('the same input always gives the same output', () => {
  const srs = s.init('2026-11-05');
  assert.deepEqual(s.rate(srs, 'hard', '2026-11-06'), s.rate(srs, 'hard', '2026-11-06'));
  assert.deepEqual(srs, s.init('2026-11-05'));
});
