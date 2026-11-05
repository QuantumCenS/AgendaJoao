// Browser side of reminders: permission, the timer while the app is open, and the
// background registration where the browser offers it. The decision of whether a
// reminder is due lives in core/reminders.js.

import { localDay, localMinutes } from '../core/dates.js';
import { planAgenda } from '../core/planner.js';
import { dueReminder } from '../core/reminders.js';
import { todaySummary } from '../core/stats.js';
import { loadSent, saveSent } from '../data/store.js';

const CHECK_EVERY_MS = 30_000;
// While the app is open it fires on time. Opening it hours later stays silent.
const MAX_LATE_MINUTES = 5;
const BACKGROUND_INTERVAL_MS = 12 * 60 * 60 * 1000;

export const notificationsSupported = () => 'Notification' in window;
export const permissionState = () => (notificationsSupported() ? Notification.permission : 'unsupported');

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.requestPermission();
}

export async function enableBackgroundChecks() {
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (!registration?.periodicSync) return false;
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state !== 'granted') return false;
    await registration.periodicSync.register('recall-reminders', { minInterval: BACKGROUND_INTERVAL_MS });
    return true;
  } catch {
    return false;
  }
}

async function show(body) {
  const options = { body, icon: 'icons/icon-192.png', tag: 'recall-reminder' };
  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration) await registration.showNotification('Recall', options);
  else new Notification('Recall', options);
}

export async function checkReminders(data) {
  if (permissionState() !== 'granted') return null;
  const now = new Date();
  const today = localDay(now);
  const sent = await loadSent();
  const summary = todaySummary(data, planAgenda(data, today));
  const reminder = dueReminder({
    settings: data.settings,
    nowMinutes: localMinutes(now),
    today,
    count: summary.count,
    minutes: summary.minutes,
    sent,
    maxLateMinutes: MAX_LATE_MINUTES,
  });
  if (!reminder) return null;
  for (const kind of reminder.marks) sent[kind] = today;
  await saveSent(sent);
  await show(reminder.body);
  return reminder;
}

export function startReminderLoop(getData) {
  return setInterval(() => {
    const data = getData();
    if (data) checkReminders(data).catch((error) => console.error('Lembrete falhou', error));
  }, CHECK_EVERY_MS);
}
