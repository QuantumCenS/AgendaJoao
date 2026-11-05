// Offline support and background reminders. Network first, so a new version shows
// up straight away, with the cache as the fallback when offline.

import { todaySummary } from './src/core/stats.js';
import { planAgenda } from './src/core/planner.js';
import { dueReminder } from './src/core/reminders.js';
import { localDay, localMinutes } from './src/core/dates.js';
import { loadData, loadSent, saveSent } from './src/data/store.js';

const CACHE = 'recall-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'src/core/actions.js', 'src/core/copy.js', 'src/core/dates.js', 'src/core/ics.js', 'src/core/model.js',
  'src/core/planner.js', 'src/core/reminders.js', 'src/core/srs.js', 'src/core/stats.js',
  'src/data/store.js',
  'src/ui/app.js', 'src/ui/html.js', 'src/ui/icons.js', 'src/ui/notifications.js', 'src/ui/shared.js',
  'src/ui/views/add.js', 'src/ui/views/agenda.js', 'src/ui/views/review.js', 'src/ui/views/settings.js',
  'src/ui/views/subjects.js', 'src/ui/views/today.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? caches.match('index.html')),
  );
});

// Chromium on an installed PWA only. The browser picks the moment, so the
// reminder can arrive late, but never during quiet hours and never twice.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'recall-reminders') event.waitUntil(checkReminders());
});

async function checkReminders() {
  const data = await loadData();
  const sent = await loadSent();
  const now = new Date();
  const today = localDay(now);
  const summary = todaySummary(data, planAgenda(data, today));
  const reminder = dueReminder({
    settings: data.settings,
    nowMinutes: localMinutes(now),
    today,
    count: summary.count,
    minutes: summary.minutes,
    sent,
  });
  if (!reminder) return;
  await self.registration.showNotification('Recall', { body: reminder.body, icon: 'icons/icon-192.png', tag: 'recall-reminder' });
  for (const kind of reminder.marks) sent[kind] = today;
  await saveSent(sent);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((windows) => {
      const open = windows[0];
      return open ? open.focus() : self.clients.openWindow('./');
    }),
  );
});
