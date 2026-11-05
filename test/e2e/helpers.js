// Starts the real server and drives the real app in Chrome, with a controllable clock.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const PHONE = { width: 390, height: 844 };
export const SMALL = { width: 320, height: 568 };
export const DESKTOP = { width: 1440, height: 900 };

export async function startServer(port, env = {}) {
  const server = spawn(process.execPath, ['scripts/serve.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.once('data', resolve);
    server.once('exit', () => reject(new Error('Server exited early')));
  });
  server.removeAllListeners('exit');
  return server;
}

export const launch = () => chromium.launch({ channel: 'chrome' });

// A fresh browser profile, so tests can't see each other's data. Any page error
// or console error fails the test through `errors`.
export async function openApp(browser, port, {
  now = '2026-11-05T10:00:00', viewport = PHONE, timezoneId = 'Europe/Lisbon', colorScheme = 'light', blockWorker = true, path = '/',
} = {}) {
  const context = await browser.newContext({
    viewport,
    timezoneId,
    colorScheme,
    locale: 'pt-PT',
    acceptDownloads: true,
    serviceWorkers: blockWorker ? 'block' : 'allow',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.clock.install({ time: new Date(now) });
  await page.goto(`http://127.0.0.1:${port}${path}`);
  await page.waitForSelector('#main h1');
  return { context, page, errors };
}

export async function logTopic(page, { subject, title, notes, color, studiedOn }) {
  await page.goto(`${new URL(page.url()).origin}/#/add`);
  await page.waitForSelector('#topic');
  const existing = page.locator('.subject-chip', { hasText: subject });
  if (await existing.count()) {
    await existing.click();
  } else {
    if (await page.locator('.subject-chip', { hasText: '+ Nova' }).count()) {
      await page.locator('.subject-chip', { hasText: '+ Nova' }).click();
    }
    await page.fill('#subject-name', subject);
    if (color) await page.click(`.swatch[data-color="${color}"]`);
  }
  await page.fill('#topic', title);
  if (notes) await page.fill('#notes', notes);
  if (studiedOn) await page.fill('#studied-on', studiedOn);
  await page.click('button[type="submit"]');
  // The form only clears once the save has finished.
  await page.waitForFunction(() => document.querySelector('#topic')?.value === '');
}

export const toastText = (page) => page.locator('#toast-text').textContent();

// Moves the fake clock to another day and lets the app notice.
export async function goToDay(page, time) {
  await page.clock.setFixedTime(new Date(time));
  await page.reload();
  await page.waitForSelector('#main h1');
}

export const stateOf = (page) =>
  page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('recall', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction('kv').objectStore('kv').get('data');
      get.onsuccess = () => {
        open.result.close();
        resolve(get.result);
      };
    };
  }));
