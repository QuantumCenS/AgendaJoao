// Scheduler interface. The rest of the app only uses these three functions, so
// swapping SM-2 for FSRS means writing another object with the same shape.
//
//   init(studiedOn)            -> srs state for a newly logged topic
//   rate(srs, rating, today)   -> srs state after a review done on `today`
//   project(srs, from)         -> planned dates if every review goes "Good"
//
// Here: SM-2's ease factor applied to a fixed ladder of review days.

import { addDays } from './dates.js';

export const RATINGS = ['again', 'hard', 'good', 'easy'];

// Review days counted from the study date, and the gaps between them.
export const LADDER_DAYS = [1, 3, 7, 14, 30, 60];
const GAPS = LADDER_DAYS.map((day, i) => day - (LADDER_DAYS[i - 1] ?? 0));
const LAST_STEP = GAPS.length - 1;

export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MAX_INTERVAL = 365;
export const HARD_FACTOR = 1.2;
export const EASY_BONUS = 1.5;

const QUALITY = { again: 2, hard: 3, good: 4, easy: 5 };

// Past the ladder, gaps keep doubling: 60, 120, 240, 365.
const gapAt = (step) =>
  step <= LAST_STEP ? GAPS[step] : Math.min(MAX_INTERVAL, GAPS[LAST_STEP] * 2 ** (step - LAST_STEP));

// The SM-2 ease update. Good leaves ease unchanged, so a topic rated Good every
// time follows the ladder exactly.
export function nextEase(ease, rating) {
  const miss = 5 - QUALITY[rating];
  const updated = ease + 0.1 - miss * (0.08 + miss * 0.02);
  return Math.max(MIN_EASE, Math.round(updated * 100) / 100);
}

const goodInterval = (srs, ease) =>
  Math.min(MAX_INTERVAL, Math.max(srs.interval, Math.max(1, Math.round((gapAt(srs.step + 1) * ease) / START_EASE))));

function intervalFor(srs, rating, ease) {
  switch (rating) {
    case 'again':
      return 1;
    case 'hard': {
      const grown = Math.max(srs.interval + 1, Math.round(srs.interval * HARD_FACTOR));
      // Compared with Good at today's ease, so Hard stays the shorter of the two.
      return Math.max(1, Math.min(grown, goodInterval(srs, srs.ease) - 1));
    }
    case 'good':
      return goodInterval(srs, ease);
    case 'easy': {
      const good = goodInterval(srs, ease);
      return Math.min(MAX_INTERVAL, Math.max(good + 1, Math.round(good * EASY_BONUS)));
    }
    default:
      throw new Error(`Unknown rating: ${rating}`);
  }
}

const nextStep = (step, rating) => {
  if (rating === 'again') return 0;
  return rating === 'hard' ? step : step + 1;
};

export const sm2Ladder = {
  id: 'sm2-ladder',

  init(studiedOn) {
    return { step: 0, interval: GAPS[0], ease: START_EASE, ideal: addDays(studiedOn, GAPS[0]), lapses: 0 };
  },

  // `ideal` always counts from the day the review was actually done.
  rate(srs, rating, today) {
    const ease = nextEase(srs.ease, rating);
    const interval = intervalFor(srs, rating, ease);
    return {
      step: nextStep(srs.step, rating),
      interval,
      ease,
      ideal: addDays(today, interval),
      lapses: srs.lapses + (rating === 'again' ? 1 : 0),
    };
  },

  // The next review, then the rest of the ladder if each one goes well. Past the
  // ladder only the next review is shown: anything further out is guesswork.
  project(srs, from = srs.ideal) {
    const reviews = [{ date: from, interval: srs.interval }];
    let current = srs;
    let date = from;
    while (current.step < LAST_STEP) {
      const interval = goodInterval(current, current.ease);
      date = addDays(date, interval);
      reviews.push({ date, interval });
      current = { ...current, step: current.step + 1, interval };
    }
    return reviews;
  },
};

export const scheduler = sm2Ladder;
