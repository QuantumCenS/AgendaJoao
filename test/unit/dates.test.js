import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, addMonths, dayRange, diffDays, isValidDay, localDay, localMinutes, localTimeToUtc, monthGrid, startOfWeek,
} from '../../src/core/dates.js';

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2026-11-05', 60), '2027-01-04');
});

test('addDays handles leap years', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
});

test('day arithmetic ignores daylight-saving changes in any device zone', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['Europe/Lisbon', 'America/New_York', 'Australia/Lord_Howe', 'Pacific/Apia']) {
      process.env.TZ = zone;
      // Lisbon's clocks change on these dates in 2026 and 2027.
      assert.equal(addDays('2026-10-24', 1), '2026-10-25', zone);
      assert.equal(addDays('2026-10-25', 1), '2026-10-26', zone);
      assert.equal(addDays('2027-03-27', 1), '2027-03-28', zone);
      assert.equal(addDays('2027-03-28', 1), '2027-03-29', zone);
      assert.equal(diffDays('2027-03-29', '2027-03-27'), 2, zone);
      assert.equal(diffDays('2026-10-26', '2026-10-24'), 2, zone);
      assert.equal(dayRange('2026-10-24', '2026-10-26').length, 3, zone);
    }
  } finally {
    process.env.TZ = original;
  }
});

test('localDay puts a UTC instant on the right day for the zone', () => {
  const instant = new Date('2026-11-05T23:30:00Z');
  assert.equal(localDay(instant, 'UTC'), '2026-11-05');
  assert.equal(localDay(instant, 'Europe/Lisbon'), '2026-11-05');
  assert.equal(localDay(instant, 'Asia/Tokyo'), '2026-11-06');
  assert.equal(localDay(new Date('2026-11-06T02:00:00Z'), 'America/New_York'), '2026-11-05');
});

test('localDay is right around Lisbon daylight-saving changes', () => {
  // Summer time: UTC+1, so 23:30 UTC is already the next day.
  assert.equal(localDay(new Date('2026-10-24T23:30:00Z'), 'Europe/Lisbon'), '2026-10-25');
  // Clocks go back at 02:00 on 25 Oct, leaving a 25-hour day.
  assert.equal(localDay(new Date('2026-10-25T00:30:00Z'), 'Europe/Lisbon'), '2026-10-25');
  assert.equal(localDay(new Date('2026-10-25T23:30:00Z'), 'Europe/Lisbon'), '2026-10-25');
  assert.equal(localDay(new Date('2026-10-26T00:30:00Z'), 'Europe/Lisbon'), '2026-10-26');
  // Clocks go forward at 01:00 on 28 Mar, leaving a 23-hour day.
  assert.equal(localDay(new Date('2027-03-27T23:30:00Z'), 'Europe/Lisbon'), '2027-03-27');
  assert.equal(localDay(new Date('2027-03-28T23:30:00Z'), 'Europe/Lisbon'), '2027-03-29');
});

test('localMinutes follows the zone offset across a daylight-saving change', () => {
  assert.equal(localMinutes(new Date('2026-10-24T17:00:00Z'), 'Europe/Lisbon'), 18 * 60);
  assert.equal(localMinutes(new Date('2026-10-26T17:00:00Z'), 'Europe/Lisbon'), 17 * 60);
  assert.equal(localMinutes(new Date('2026-11-05T00:05:00Z'), 'UTC'), 5);
});

test('localTimeToUtc keeps the wall-clock time on both sides of a change', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Lisbon';
    assert.equal(localTimeToUtc('2026-10-24', '18:00').toISOString(), '2026-10-24T17:00:00.000Z');
    assert.equal(localTimeToUtc('2026-10-26', '18:00').toISOString(), '2026-10-26T18:00:00.000Z');
    assert.equal(localTimeToUtc('2027-03-29', '18:00').toISOString(), '2027-03-29T17:00:00.000Z');
  } finally {
    process.env.TZ = original;
  }
});

test('startOfWeek returns the Monday', () => {
  assert.equal(startOfWeek('2026-11-05'), '2026-11-02');
  assert.equal(startOfWeek('2026-11-02'), '2026-11-02');
  assert.equal(startOfWeek('2026-11-08'), '2026-11-02');
  assert.equal(startOfWeek('2027-01-01'), '2026-12-28');
});

test('addMonths lands on the first of the month across years', () => {
  assert.equal(addMonths('2026-12-31', 1), '2027-01-01');
  assert.equal(addMonths('2027-01-15', -1), '2026-12-01');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-01');
});

test('monthGrid is six Monday-first weeks that include the whole month', () => {
  const grid = monthGrid('2026-11-15');
  assert.equal(grid.length, 42);
  assert.equal(grid[0], '2026-10-26');
  assert.ok(grid.includes('2026-11-01'));
  assert.ok(grid.includes('2026-11-30'));
});

test('isValidDay rejects impossible and malformed days', () => {
  assert.ok(isValidDay('2028-02-29'));
  assert.ok(!isValidDay('2027-02-29'));
  assert.ok(!isValidDay('2026-13-01'));
  assert.ok(!isValidDay('5 Nov'));
  assert.ok(!isValidDay(null));
});
