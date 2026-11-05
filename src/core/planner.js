// Turns stored state into the agenda. Pure: the same data and day always give
// the same plan. Three layers run in a fixed order:
//
//   1. Topic plan: the next review (overdue ones stay put) and its projection.
//   2. Exams: cut reviews on or after the exam, make sure the final week is covered.
//   3. Balancing: move reviews off overloaded future days, within a tolerance.
//
// Only a topic's next review is actionable. Today and earlier are never moved.

import { addDays } from './dates.js';
import { dailyLimit } from './model.js';
import { scheduler } from './srs.js';

export const EXAM_WINDOW_DAYS = 7;

const maxDay = (a, b) => (a > b ? a : b);
const minDay = (a, b) => (a < b ? a : b);
const byKey = (a, b) => (a.key < b.key ? -1 : 1);

// How far a review may move, by the length of its interval.
export function toleranceFor(interval) {
  if (interval >= 30) return 2;
  if (interval >= 7) return 1;
  return 0;
}

// Exams that apply to a topic: only those after it was studied.
export const examsFor = (topic, exams) =>
  exams
    .filter((e) => e.subjectId === topic.subjectId && e.date > topic.studiedOn)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

// The date reviews stop, or null if they carry on. Decided by the last exam.
const cutoffFor = (topicExams) => {
  const last = topicExams.at(-1);
  return last && !last.keepAfter ? last.date : null;
};

// Reviews finish once the last exam has passed, unless the user keeps them.
export function isPausedByExam(topic, exams, today) {
  const cutoff = cutoffFor(examsFor(topic, exams));
  return cutoff !== null && today > cutoff;
}

const makeItem = (topic, index, date, interval, extra = {}) => ({
  key: `${topic.id}#${index}`,
  topicId: topic.id,
  subjectId: topic.subjectId,
  index,
  date,
  ideal: date,
  interval,
  min: date,
  max: date,
  locked: false,
  packed: false,
  ...extra,
});

// Layer 1: the raw sequence for one topic.
function baseItems(topic, today) {
  const { srs } = topic;

  // Due today or earlier: stays where it is until it's done, and the rest of the
  // schedule is projected from today so past dates never pile up.
  if (srs.due <= today) {
    const [next, ...rest] = scheduler.project(srs, today);
    return [
      makeItem(topic, 0, srs.due, next.interval, { ideal: srs.ideal, locked: true }),
      ...rest.map((r, i) => makeItem(topic, i + 1, r.date, r.interval)),
    ];
  }

  // Its ideal day has passed but balancing had already pushed it forward: keep
  // that later day rather than dropping it back into today.
  const anchor = srs.ideal <= today ? srs.due : srs.ideal;
  return scheduler.project(srs, anchor).map((r, i) => {
    const item = makeItem(topic, i, r.date, r.interval);
    if (i === 0) {
      item.ideal = srs.ideal;
      item.locked = Boolean(srs.snoozed);
    }
    return item;
  });
}

// Layer 2: fit one topic's sequence around its exams.
function applyExams(topic, items, topicExams, reviewLog, today) {
  const tomorrow = addDays(today, 1);
  const cutoff = cutoffFor(topicExams);
  let result = items.filter((it) => it.locked || cutoff === null || it.date < cutoff);

  for (const exam of topicExams) {
    if (exam.date <= today) continue;
    const lastDay = addDays(exam.date, -1);
    const windowStart = addDays(exam.date, -EXAM_WINDOW_DAYS);
    const from = maxDay(windowStart, tomorrow);

    // An overdue review waiting in today's list counts: today is what it shows on.
    const onDay = (it) => (it.locked ? maxDay(it.date, today) : it.date);
    const covered =
      result.some((it) => onDay(it) >= windowStart && onDay(it) <= lastDay) ||
      reviewLog.some((r) => r.topicId === topic.id && r.doneOn >= windowStart && r.doneOn <= today);

    if (!covered && (from <= lastDay || topic.studiedOn < today)) {
      const before = result.filter((it) => it.date < windowStart);
      const after = result.filter((it) => it.date > lastDay);
      const index = before.length;
      // With the exam tomorrow, today is the only day left in the window.
      const packed = from <= lastDay
        ? makeItem(topic, index, lastDay, topic.srs.interval, { packed: true, min: from, max: lastDay })
        : makeItem(topic, index, today, topic.srs.interval, { packed: true, locked: true });
      if (index === 0) packed.ideal = topic.srs.ideal;
      result = [
        ...before,
        packed,
        ...after.map((it, i) => ({ ...it, index: index + 1 + i, key: `${topic.id}#${index + 1 + i}` })),
      ];
    }

    // Balancing may not carry a review across the edges of the window, so the
    // final week stays covered and a topic's reviews stay in date order.
    for (const it of result) {
      if (it.date < windowStart) {
        it.limitMax = minDay(it.limitMax ?? addDays(windowStart, -1), addDays(windowStart, -1));
      } else if (it.date <= lastDay) {
        it.limitMin = maxDay(it.limitMin ?? from, from);
        it.limitMax = minDay(it.limitMax ?? lastDay, lastDay);
      } else {
        it.limitMin = maxDay(it.limitMin ?? exam.date, exam.date);
      }
    }
  }
  return result;
}

// Sets how far each review may travel. Locked and packed ones are already set.
function setBounds(items, today) {
  const tomorrow = addDays(today, 1);
  for (const it of items) {
    if (it.locked || it.packed) continue;
    const tolerance = toleranceFor(it.interval);
    // Once its ideal day has passed, a pushed-back review can't move back to it.
    let min = it.ideal <= today ? it.date : maxDay(addDays(it.ideal, -tolerance), tomorrow);
    let max = addDays(it.ideal, tolerance);
    if (it.limitMin) min = maxDay(min, it.limitMin);
    if (it.limitMax) max = minDay(max, it.limitMax);
    it.min = minDay(min, it.date);
    it.max = maxDay(max, it.date);
  }
}

function countByDay(items) {
  const counts = new Map();
  for (const it of items) counts.set(it.date, (counts.get(it.date) ?? 0) + 1);
  return counts;
}

// Packed reviews go to the emptiest day of their window, latest day on a tie.
function spreadPacked(items) {
  const isFloating = (it) => it.packed && !it.locked;
  const counts = countByDay(items.filter((it) => !isFloating(it)));
  for (const it of items.filter(isFloating).sort(byKey)) {
    let best = it.max;
    for (let d = it.max; d >= it.min; d = addDays(d, -1)) {
      if ((counts.get(d) ?? 0) < (counts.get(best) ?? 0)) best = d;
    }
    it.date = best;
    counts.set(best, (counts.get(best) ?? 0) + 1);
  }
}

// At each distance a later day is tried first: staying inside the tolerance, a
// day late is as good as a day early and doesn't crowd the days already planned.
function nearestFreeDay(item, day, counts, limit) {
  const hasRoom = (d) => d >= item.min && d <= item.max && (counts.get(d) ?? 0) < limit;
  for (let distance = 1; ; distance += 1) {
    const later = addDays(day, distance);
    const earlier = addDays(day, -distance);
    if (later > item.max && earlier < item.min) return null;
    if (hasRoom(later)) return later;
    if (hasRoom(earlier)) return earlier;
  }
}

// Layer 3: walk the overloaded future days in order, moving the longest intervals
// first since a day or two matters least to them.
function balance(items, limit, today) {
  const counts = countByDay(items);
  const days = [...counts.keys()].filter((d) => d > today && counts.get(d) > limit).sort();

  for (const day of days) {
    const candidates = items
      .filter((it) => it.date === day && it.min < it.max)
      .sort((a, b) => b.interval - a.interval || byKey(a, b));

    for (const it of candidates) {
      if (counts.get(day) <= limit) break;
      const target = nearestFreeDay(it, day, counts, limit);
      if (target) {
        it.date = target;
        counts.set(day, counts.get(day) - 1);
        counts.set(target, (counts.get(target) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export function planAgenda(data, today) {
  const { topics, exams, reviewLog, settings } = data;
  const items = [];
  const paused = [];

  for (const topic of topics) {
    if (topic.masteredOn) continue;
    if (isPausedByExam(topic, exams, today)) {
      paused.push(topic.id);
      continue;
    }
    const topicItems = applyExams(topic, baseItems(topic, today), examsFor(topic, exams), reviewLog, today);
    setBounds(topicItems, today);
    items.push(...topicItems);
  }

  spreadPacked(items);

  const limit = dailyLimit(settings);
  const counts = balance(items, limit, today);

  for (const it of items) {
    // The date before balancing, so `moved` means balancing moved it, not an exam.
    it.originalDate = it.locked || it.packed ? it.date : it.ideal;
    it.moved = it.date !== it.originalDate;
    it.overdue = it.index === 0 && it.date < today;
  }
  items.sort((a, b) => (a.date === b.date ? byKey(a, b) : a.date < b.date ? -1 : 1));

  const next = new Map();
  for (const it of items) if (it.index === 0) next.set(it.topicId, it);

  return {
    today,
    limit,
    items,
    next,
    paused,
    moved: items.filter((it) => it.moved),
    overLimitDays: [...counts.entries()].filter(([d, n]) => d > today && n > limit).map(([d]) => d).sort(),
  };
}

// Stores each topic's assigned next date, so a review balancing moved keeps that
// day when it arrives. Returns how many topics changed.
export function settlePlan(data, plan) {
  let changed = 0;
  for (const topic of data.topics) {
    const item = plan.next.get(topic.id);
    if (item && topic.srs.due !== item.date) {
      topic.srs.due = item.date;
      changed += 1;
    }
  }
  return changed;
}
