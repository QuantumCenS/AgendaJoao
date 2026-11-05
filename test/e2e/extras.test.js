import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addSubject, logStudy, refreshPlan } from '../../src/core/actions.js';
import { emptyData, toBackup } from '../../src/core/model.js';
import { PHONE, SMALL, goToDay, launch, logTopic, openApp, startServer, stateOf, toastText } from './helpers.js';

const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let browser;

before(async () => {
  server = await startServer(PORT);
  browser = await launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

function appTest(name, options, body) {
  const [opts, fn] = body ? [options, body] : [{}, options];
  test(name, async () => {
    const session = await openApp(browser, PORT, { now: '2026-11-05T10:00:00Z', ...opts });
    try {
      await fn(session);
      assert.deepEqual(session.errors, [], 'no page or console errors');
    } finally {
      await session.context.close();
    }
  });
}

const go = async (page, hash) => {
  await page.goto(`${BASE}/${hash}`);
  await page.waitForSelector('#main h1');
};

async function importBackup(page, data) {
  await go(page, '#/settings');
  page.once('dialog', (d) => d.accept());
  await page.setInputFiles('#import-file', {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(toBackup(data))),
  });
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('importado'));
}

async function dueTomorrow(page, title = 'Herança', extra = {}) {
  await logTopic(page, { subject: 'POO', title, ...extra });
  await goToDay(page, '2026-11-06T09:00:00Z');
  await go(page, '#/today');
  await page.locator('.review-row', { hasText: title }).click();
  await page.waitForSelector('#pane h1');
}

const closed = (page) => page.waitForFunction(() => !document.body.classList.contains('has-review'));

// ---------- editing and deleting ----------

appTest('a topic can be edited from its review, and the change shows at once', async ({ page }) => {
  await dueTomorrow(page, 'Hernaça', { notes: 'Antigas' });
  await page.click('[data-click="editTopic"]');
  assert.equal(await page.locator('#pane h1').textContent(), 'Editar tópico');
  assert.equal(await page.inputValue('#edit-title'), 'Hernaça');
  assert.equal(await page.inputValue('#edit-notes'), 'Antigas');

  await page.fill('#edit-title', 'Herança');
  await page.fill('#edit-notes', 'Novas https://example.com');
  await page.click('form[data-submit="saveEdit"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#pane h1').textContent === 'Herança');

  assert.equal(await toastText(page), 'Guardado.');
  assert.equal(await page.locator('.notes a').getAttribute('href'), 'https://example.com');
  assert.match(await page.locator('.review-row').textContent(), /Herança/);
  const { topics } = await stateOf(page);
  assert.equal(topics[0].title, 'Herança');
  assert.equal(topics[0].srs.due, '2026-11-06', 'the schedule is untouched');
});

appTest('a bad edit is explained and keeps the form open', async ({ page }) => {
  await dueTomorrow(page);
  await page.click('[data-click="editTopic"]');
  await page.fill('#edit-title', '   ');
  await page.click('form[data-submit="saveEdit"] button[type="submit"]');
  await page.waitForSelector('#pane .error');
  assert.match(await page.locator('#pane .error').textContent(), /tópico/);
  assert.equal(await page.locator('#pane h1').textContent(), 'Editar tópico');
  assert.equal((await stateOf(page)).topics[0].title, 'Herança');
});

appTest('cancelling an edit changes nothing', async ({ page }) => {
  await dueTomorrow(page);
  await page.click('[data-click="editTopic"]');
  await page.fill('#edit-title', 'Outro');
  await page.click('[data-click="cancelEdit"]');
  assert.equal(await page.locator('#pane h1').textContent(), 'Herança');
  assert.equal((await stateOf(page)).topics[0].title, 'Herança');
});

appTest('moving a topic to another subject regroups it', async ({ page }) => {
  await logTopic(page, { subject: 'Física', title: 'Newton' });
  await dueTomorrow(page);
  await page.click('[data-click="editTopic"]');
  await page.selectOption('#edit-subject', { label: 'Física' });
  await page.click('form[data-submit="saveEdit"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#pane h1').textContent === 'Herança');
  const groups = await page.locator('#main section h2').allTextContents();
  assert.equal(groups.length, 1);
  assert.match(groups[0], /Física/);
});

appTest('the study date locks after the first review, and says why', async ({ page }) => {
  await dueTomorrow(page);
  await page.click('[data-click="editTopic"]');
  assert.equal(await page.isDisabled('#edit-studied'), false);
  await page.click('[data-click="cancelEdit"]');
  await page.locator('.rating-good').click();
  await closed(page);
  const { subjects } = await stateOf(page);
  await go(page, `#/subject/${subjects[0].id}`);
  await page.locator('.topic-link').click();
  await page.waitForSelector('#pane h1');
  await page.click('[data-click="editTopic"]');
  assert.equal(await page.isDisabled('#edit-studied'), true);
  assert.match(await page.locator('#pane').textContent(), /fica fixa depois da primeira revisão/);
  // A disabled date isn't sent, and saving must still work.
  await page.fill('#edit-title', 'Renomeado');
  await page.click('form[data-submit="saveEdit"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#pane h1').textContent === 'Renomeado');
});

appTest('deleting asks first, and declining keeps the topic', async ({ page }) => {
  await dueTomorrow(page);
  await page.click('[data-click="editTopic"]');
  const asked = new Promise((resolve) => {
    page.once('dialog', async (d) => {
      await d.dismiss();
      resolve(d.message());
    });
  });
  await page.click('[data-click="deleteTopic"]');
  assert.match(await asked, /Apagar “Herança”.*não se pode desfazer/);
  assert.equal((await stateOf(page)).topics.length, 1);
});

appTest('deleting removes the topic from the agenda and the data', async ({ page }) => {
  await dueTomorrow(page);
  await page.locator('.rating-again').click();
  await closed(page);
  await goToDay(page, '2026-11-07T09:00:00Z');
  await go(page, '#/today');
  await page.locator('.review-row').click();
  await page.waitForSelector('#pane h1');
  await page.click('[data-click="editTopic"]');
  page.once('dialog', (d) => d.accept());
  await page.click('[data-click="deleteTopic"]');
  await closed(page);
  assert.equal(await toastText(page), 'Tópico apagado.');
  assert.equal(await page.locator('.review-row').count(), 0);
  const data = await stateOf(page);
  assert.equal(data.topics.length, 0);
  assert.equal(data.reviewLog.length, 0);
});

// ---------- undo ----------

appTest('the toast after rating can undo it', async ({ page }) => {
  await dueTomorrow(page);
  await page.locator('.rating-again').click();
  await closed(page);
  assert.equal(await toastText(page), 'Próxima revisão amanhã.');
  assert.equal(await page.locator('.review-row').count(), 0);

  await page.click('#toast-action');
  await page.waitForSelector('.review-row');
  assert.match(await toastText(page), /Avaliação anulada/);
  assert.equal(await page.locator('#toast-action').isHidden(), true);
  const data = await stateOf(page);
  assert.equal(data.reviewLog.length, 0);
  assert.equal(data.topics[0].srs.due, '2026-11-06');
  assert.equal(data.topics[0].srs.lapses, 0);
});

appTest('a rating can also be undone later, from the review', async ({ page }) => {
  await dueTomorrow(page);
  assert.equal(await page.locator('[data-click="undoRating"]').count(), 0, 'nothing to undo yet');
  await page.locator('.rating-good').click();
  await closed(page);
  await page.reload();
  await page.waitForSelector('#main h1');

  const { subjects } = await stateOf(page);
  await go(page, `#/subject/${subjects[0].id}`);
  await page.locator('.topic-link').click();
  await page.waitForSelector('#pane h1');
  await page.click('[data-click="undoRating"]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('anulada'));
  const data = await stateOf(page);
  assert.equal(data.reviewLog.length, 0);
  assert.equal(data.topics[0].srs.due, '2026-11-06');
});

appTest('the undo button can be reached on a phone: it sits above the tabs', { viewport: SMALL }, async ({ page }) => {
  await dueTomorrow(page);
  await page.locator('.rating-good').click();
  await closed(page);
  const button = await page.locator('#toast-action').boundingBox();
  const tabs = await page.locator('#tabs').boundingBox();
  assert.ok(button.y + button.height <= tabs.y, 'above the tabs');
  assert.ok(button.x + button.width <= SMALL.width, 'on screen');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0);
});

// ---------- spreading overdue ----------

function afterBreak(count, maxReviews) {
  const data = emptyData();
  data.settings.maxReviews = maxReviews;
  data.settings.maxMinutes = 0;
  const poo = addSubject(data, { name: 'POO', color: 'teal' });
  for (let i = 0; i < count; i += 1) {
    const day = `2026-10-${String(i + 1).padStart(2, '0')}`;
    logStudy(data, { subjectId: poo.id, title: `Tópico ${i}`, studiedOn: day }, day);
  }
  refreshPlan(data, '2026-11-05');
  return data;
}

appTest('one tap spreads overdue reviews across the next days, and can be undone', async ({ page }) => {
  await importBackup(page, afterBreak(12, 5));
  await go(page, '#/today');
  assert.match(await page.locator('#today-line').textContent(), /^12 revisões/);

  await page.click('[data-click="spreadOverdue"]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Passei'));
  assert.equal(await toastText(page), 'Passei 7 revisões para os próximos dias.');
  assert.match(await page.locator('#today-line').textContent(), /^5 revisões/);
  assert.equal(await page.locator('[data-click="spreadOverdue"]').count(), 0, 'nothing left to spread');

  await go(page, '#/agenda');
  await page.click('[data-click="agendaMode"][data-value="month"]');
  assert.equal((await page.locator('.month-day[data-value="2026-11-06"] .count').textContent()).trim(), '5');

  await page.reload();
  await page.waitForSelector('#main h1');
  await go(page, '#/today');
  assert.match(await page.locator('#today-line').textContent(), /^5 revisões/, 'kept after a reload');

  await page.click('.tab[href="#/agenda"]');
  await page.click('.tab[href="#/today"]');
  assert.equal(await page.locator('[data-click="spreadOverdue"]').count(), 0);
});

appTest('the undo in the toast brings the overdue reviews back', async ({ page }) => {
  await importBackup(page, afterBreak(12, 5));
  await go(page, '#/today');
  await page.click('[data-click="spreadOverdue"]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Passei'));
  await page.click('#toast-action');
  await page.waitForFunction(() => document.querySelector('#today-line').textContent.startsWith('12 revisões'));
  assert.equal(await toastText(page), 'Atrasos de volta a hoje.');
  assert.equal((await stateOf(page)).topics.filter((t) => t.srs.snoozed).length, 0);
});

appTest('the button only appears when there is something to spread', async ({ page }) => {
  await importBackup(page, afterBreak(3, 20));
  await go(page, '#/today');
  assert.equal(await page.locator('.review-row').count(), 3);
  assert.equal(await page.locator('[data-click="spreadOverdue"]').count(), 0);
});

// ---------- calendar alarm ----------

const exportIcs = async (page) => {
  await go(page, '#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-click="exportIcs"]')]);
  return readFile(await download.path(), 'utf8');
};

appTest('the .ics has one alarm a day, and the setting turns it off', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'A' });
  await logTopic(page, { subject: 'POO', title: 'B' });
  const ics = await exportIcs(page);
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 12);
  assert.equal(ics.match(/BEGIN:VALARM/g).length, 6);
  assert.match(ics.replaceAll('\r\n ', ''), /DESCRIPTION:2 revisões hoje\\, cerca de 10 min/);

  await page.uncheck('#ics-alarm');
  await page.waitForFunction(() => document.activeElement?.id === 'ics-alarm');
  assert.equal((await stateOf(page)).settings.icsAlarm, false);
  assert.ok(!(await exportIcs(page)).includes('VALARM'));
});

// ---------- installing ----------

appTest('Settings explains how to install when the browser offers no button', async ({ page }) => {
  await go(page, '#/settings');
  assert.match(await page.locator('#install-help').textContent(), /No Android.*Instalar app.*No PC/);
});

appTest('the install button uses the browser prompt', async ({ page }) => {
  await go(page, '#/settings');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => { window.__prompted = true; };
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
  });
  await page.click('[data-click="installApp"]');
  await page.waitForSelector('#install-help');
  assert.equal(await page.evaluate(() => window.__prompted), true);
});

// ---------- under a subfolder, as on GitHub Pages ----------

test('the whole app works from a subfolder, offline included', async () => {
  const port = 5197;
  const subfolder = await startServer(port, { BASE_PATH: '/recall' });
  const origin = `http://127.0.0.1:${port}`;
  const { page, context, errors } = await openApp(browser, port, {
    now: '2026-11-05T10:00:00Z', viewport: PHONE, blockWorker: false, path: '/recall/',
  });
  try {
    assert.equal((await fetch(`${origin}/index.html`)).status, 404, 'nothing outside the subfolder');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    assert.equal(scope, `${origin}/recall/`);

    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel=manifest]').href;
      const parsed = await (await fetch(link)).json();
      const icons = await Promise.all(parsed.icons.map(async (i) => (await fetch(new URL(i.src, link))).status));
      return { start: new URL(parsed.start_url, link).href, scope: new URL(parsed.scope, link).href, icons };
    });
    assert.equal(manifest.start, `${origin}/recall/`);
    assert.equal(manifest.scope, `${origin}/recall/`);
    assert.deepEqual(manifest.icons, [200, 200, 200]);

    await page.goto(`${origin}/recall/#/add`);
    await page.fill('#subject-name', 'POO');
    await page.fill('#topic', 'Herança');
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Guardado'));

    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('#main h1');
    await page.goto(`${origin}/recall/#/agenda`);
    await page.waitForFunction(() => document.querySelector('#main h1').textContent === 'Agenda');
    assert.equal((await stateOf(page)).topics.length, 1);
    await context.setOffline(false);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    subfolder.kill();
  }
});
