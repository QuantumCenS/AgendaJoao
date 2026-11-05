// Calendar days are 'YYYY-MM-DD' strings. All arithmetic runs in UTC, so a
// daylight-saving change can never add or lose a day. Instants (doneAt,
// createdAt) are ISO strings in UTC and only become a calendar day here.

const MS_PER_DAY = 86_400_000;

const toUtcMs = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

const fromUtcMs = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (day, n) => fromUtcMs(toUtcMs(day) + n * MS_PER_DAY);

export const diffDays = (later, earlier) => Math.round((toUtcMs(later) - toUtcMs(earlier)) / MS_PER_DAY);

export const isValidDay = (day) => {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return fromUtcMs(toUtcMs(day)) === day;
};

// The calendar day an instant falls on in a time zone (default: the device's).
export function localDay(instant = new Date(), timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Minutes since local midnight, for reminder times and quiet hours.
export function localMinutes(instant = new Date(), timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return get('hour') * 60 + get('minute');
}

export const parseTime = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const isValidTime = (hhmm) => typeof hhmm === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm);

// The UTC instant of a wall-clock time on a calendar day, in the device's zone.
export function localTimeToUtc(day, hhmm) {
  const [y, m, d] = day.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hour, minute);
}

// Monday is the first day of the week.
export function startOfWeek(day) {
  const weekday = new Date(toUtcMs(day)).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export const startOfMonth = (day) => `${day.slice(0, 7)}-01`;

export function addMonths(day, n) {
  const [y, m] = day.split('-').map(Number);
  return fromUtcMs(Date.UTC(y, m - 1 + n, 1));
}

export function dayRange(from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

// Six full weeks, so the month grid never changes height between months.
export function monthGrid(day) {
  const first = startOfWeek(startOfMonth(day));
  return dayRange(first, addDays(first, 41));
}
