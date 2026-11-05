import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addExam, addSubject, logStudy, rateReview, refreshPlan } from '../../src/core/actions.js';
import { addDays } from '../../src/core/dates.js';
import { emptyData, toBackup } from '../../src/core/model.js';
import { buildSeed } from '../../scripts/seed.js';
import { DESKTOP, PHONE, SMALL, goToDay, launch, logTopic, openApp, startServer, stateOf, toastText } from './helpers.js';

const PORT = 5199;
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

// Opens the app, runs the test, closes the profile, and fails on any page error.
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

const openReview = async (page, title) => {
  await page.locator('.review-row', { hasText: title }).first().click();
  await page.waitForSelector('#pane h1');
};

const rating = (page, value) => page.locator(`.rating-${value}`);
const dayCount = async (page, day) => (await page.locator(`.month-day[data-value="${day}"] .count`).textContent()).trim();

// ---------- 1. Logging ----------

appTest('first run shows the calm empty state from the brief', async ({ page }) => {
  const text = await page.locator('#main').textContent();
  assert.match(text, /Nada para rever hoje\. Regista o que estudaste e a app planeia as revisões\./);
});

appTest('logging creates the subject and topic and confirms, in a few steps', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança e polimorfismo', notes: 'Capítulo 3', color: 'violet' });
  await page.waitForFunction(() => document.querySelector('#toast').textContent);
  assert.equal(await toastText(page), 'Guardado. Primeira revisão amanhã.');

  const data = await stateOf(page);
  assert.equal(data.subjects[0].name, 'POO');
  assert.equal(data.subjects[0].color, 'violet');
  assert.equal(data.topics[0].title, 'Herança e polimorfismo');
  assert.equal(data.topics[0].notes, 'Capítulo 3');
  assert.equal(data.topics[0].studiedOn, '2026-11-05');
  assert.equal(data.topics[0].srs.due, '2026-11-06');

  // Ready for the next one: form cleared, subject kept, cursor in the topic field.
  assert.equal(await page.inputValue('#topic'), '');
  assert.equal(await page.locator('.subject-chip[aria-pressed="true"]').textContent().then((t) => t.trim()), 'POO');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'topic');
});

appTest('with a subject chosen, a topic takes one field and one key press', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Primeiro' });
  await page.fill('#topic', 'Segundo');
  await page.press('#topic', 'Enter');
  await page.waitForFunction(() => document.querySelector('#topic').value === '');
  assert.equal((await stateOf(page)).topics.length, 2);
});

appTest('logging keeps its limits and explains what is missing', async ({ page }) => {
  await go(page, '#/add');
  assert.equal(await page.getAttribute('#topic', 'maxlength'), '120');
  assert.equal(await page.getAttribute('#notes', 'maxlength'), '1000');

  await page.fill('#topic', 'Sem disciplina');
  await page.click('button[type="submit"]');
  assert.match(await page.locator('.error').textContent(), /nome à disciplina/);

  await page.fill('#subject-name', 'POO');
  await page.fill('#topic', '   ');
  await page.click('button[type="submit"]');
  assert.match(await page.locator('.error').textContent(), /tópico/);

  const data = await stateOf(page);
  assert.equal(data.subjects.length, 0, 'a failed save leaves nothing behind');
  assert.equal(data.topics.length, 0);
});

appTest('topic date cannot be in the future and a past date starts overdue', async ({ page }) => {
  await go(page, '#/add');
  assert.equal(await page.getAttribute('#studied-on', 'max'), '2026-11-05');
  await logTopic(page, { subject: 'POO', title: 'Antigo', studiedOn: '2026-10-01' });
  await page.waitForFunction(() => document.querySelector('#toast').textContent);
  assert.equal(await toastText(page), 'Guardado. Primeira revisão hoje.');
  await go(page, '#/today');
  assert.match(await page.locator('.review-row').textContent(), /Em atraso/);
});

appTest('user text stays text, however it is written', async ({ page }) => {
  const evil = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>';
  await logTopic(page, { subject: `${evil}S`.slice(0, 60), title: evil, notes: `${evil} javascript:alert(1) https://example.com/a?b=1` });
  await page.clock.setFixedTime(new Date('2026-11-06T10:00:00Z'));
  await page.reload();
  await go(page, '#/today');
  await page.locator('.review-row').click();
  await page.waitForSelector('#pane h1');
  assert.equal(await page.locator('#pane h1').textContent(), evil);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.locator('#main img, #pane img, #sidebar img').count(), 0);
  // Only the real http link becomes a link.
  const links = await page.locator('.notes a').evaluateAll((els) => els.map((a) => [a.getAttribute('href'), a.rel]));
  assert.deepEqual(links, [['https://example.com/a?b=1', 'noopener noreferrer']]);
});

// ---------- 2 and 3. Scheduling and agenda ----------

appTest('brief example: the six reviews appear on the agenda on the right days', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'POO: herança e polimorfismo' });
  await go(page, '#/agenda');
  await page.click('[data-click="agendaMode"][data-value="month"]');
  for (const day of ['2026-11-06', '2026-11-08', '2026-11-12', '2026-11-19']) {
    assert.equal(await dayCount(page, day), '1', day);
  }
  assert.equal(await dayCount(page, '2026-11-07'), '');
  await page.click('[data-click="agendaStep"][data-value="1"]');
  assert.match(await page.locator('#agenda-title').textContent(), /dezembro de 2026/);
  assert.equal(await dayCount(page, '2026-12-05'), '1');
  await page.click('[data-click="agendaStep"][data-value="1"]');
  assert.match(await page.locator('#agenda-title').textContent(), /janeiro de 2027/);
  assert.equal(await dayCount(page, '2027-01-04'), '1');
});

appTest('week view colours days by subject, and tapping a day then a review opens it', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança', color: 'teal' });
  await logTopic(page, { subject: 'Física', title: 'Newton', color: 'coral' });
  await go(page, '#/agenda');
  const friday = page.locator('.week-day[data-value="2026-11-06"]');
  assert.equal((await friday.locator('.count').textContent()).trim(), '2');
  assert.deepEqual(await friday.locator('.bar > span').evaluateAll((els) => els.map((e) => e.dataset.color)), ['teal', 'coral']);
  assert.match(await friday.getAttribute('aria-label'), /2 revisões\. POO: 1, Física: 1/);

  await friday.click();
  assert.equal(await page.locator('.review-row').count(), 2);
  await page.locator('.review-row', { hasText: 'Newton' }).click();
  await page.waitForSelector('#pane h1');
  assert.equal(await page.locator('#pane h1').textContent(), 'Newton');
});

appTest('heavy days stand out in advance', async ({ page }) => {
  const data = emptyData();
  data.settings.maxReviews = 2;
  data.settings.maxMinutes = 0;
  const subject = addSubject(data, { name: 'POO', color: 'teal' });
  for (let i = 0; i < 4; i += 1) logStudy(data, { subjectId: subject.id, title: `T${i}`, studiedOn: '2026-11-05' }, '2026-11-05');
  await importBackup(page, data);
  await go(page, '#/agenda');
  // Short intervals can't move, so the day stays over the limit and the app says so.
  assert.equal(await page.locator('.week-day.is-heavy[data-value="2026-11-06"]').count(), 1);
  assert.match(await page.locator('#main').textContent(), /continua[m]? acima do limite/);
});

appTest('Today groups by subject with the total time, wording from the brief', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'A' });
  await logTopic(page, { subject: 'POO', title: 'B' });
  await logTopic(page, { subject: 'POO', title: 'C' });
  await logTopic(page, { subject: 'Física', title: 'D' });
  await logTopic(page, { subject: 'Física', title: 'E' });
  await logTopic(page, { subject: 'Física', title: 'F' });
  await goToDay(page, '2026-11-06T09:00:00Z');
  await go(page, '#/today');
  assert.equal(await page.locator('#today-line').textContent(), '6 revisões · cerca de 25 min');
  const groups = await page.locator('#main section h2').allTextContents();
  assert.match(groups[0], /POO/);
  assert.match(groups[1], /Física/);
});

// ---------- overdue ----------

appTest('a missed review moves to overdue, stays, and counts from when it is done', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await goToDay(page, '2026-11-10T09:00:00Z');
  await go(page, '#/today');
  assert.match(await page.locator('.review-row').textContent(), /Em atraso · há 4 dias/);
  assert.equal(await page.locator('.review-row').count(), 1, 'one review, not a pile');

  await openReview(page, 'Herança');
  assert.match(await page.locator('#pane').textContent(), /Em atraso desde 6 nov/);
  assert.equal((await rating(page, 'good').textContent()).replace(/\s+/g, ' ').trim(), 'Bom · em 2 dias');
  await rating(page, 'good').click();
  await page.waitForFunction(() => !document.body.classList.contains('has-review'));

  const data = await stateOf(page);
  assert.equal(data.topics[0].srs.ideal, '2026-11-12');
  assert.equal(data.reviewLog[0].doneOn, '2026-11-10');
  assert.equal(data.reviewLog[0].scheduledFor, '2026-11-06');
  assert.equal(await page.locator('.review-row').count(), 0);
});

// ---------- 4. Review flow ----------

appTest('the review shows the topic, notes, link and first study date', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança', notes: 'Ver https://example.com/livro' });
  await goToDay(page, '2026-11-06T09:00:00Z');
  await go(page, '#/today');
  await openReview(page, 'Herança');
  const pane = await page.locator('#pane').textContent();
  assert.match(pane, /Estudado pela primeira vez a 5 nov \(ontem\)/);
  assert.match(pane, /POO/);
  assert.equal(await page.locator('.notes a').getAttribute('href'), 'https://example.com/livro');
});

appTest('brief example: each button shows its interval, and Hard on 8 Nov comes before 12 Nov', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await goToDay(page, '2026-11-06T09:00:00Z');
  await go(page, '#/today');
  await openReview(page, 'Herança');
  await rating(page, 'good').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent);
  assert.equal(await toastText(page), 'Próxima revisão em 2 dias.');

  await goToDay(page, '2026-11-08T09:00:00Z');
  await go(page, '#/today');
  await openReview(page, 'Herança');
  const label = async (r) => (await rating(page, r).textContent()).replace(/\s+/g, ' ').trim();
  assert.equal(await label('again'), 'De novo · amanhã');
  assert.equal(await label('hard'), 'Difícil · em 3 dias');
  assert.equal(await label('good'), 'Bom · em 4 dias');
  assert.equal(await label('easy'), 'Fácil · em 6 dias');
  await rating(page, 'hard').click();
  await page.waitForFunction(() => !document.body.classList.contains('has-review'));
  assert.equal((await stateOf(page)).topics[0].srs.due, '2026-11-11');

  // Updates the agenda at once, without a reload.
  await page.click('.tab[href="#/agenda"]');
  await page.click('[data-click="agendaMode"][data-value="month"]');
  assert.equal(await dayCount(page, '2026-11-11'), '1');
  assert.equal(await dayCount(page, '2026-11-12'), '');
});

appTest('brief example: Again brings a topic back tomorrow', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await goToDay(page, '2026-11-06T09:00:00Z');
  await go(page, '#/today');
  await openReview(page, 'Herança');
  await rating(page, 'again').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent);
  assert.equal(await toastText(page), 'Próxima revisão amanhã.');
  assert.equal((await stateOf(page)).topics[0].srs.due, '2026-11-07');
});

appTest('snooze moves it to tomorrow and leaves no rating behind', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await goToDay(page, '2026-11-06T09:00:00Z');
  await go(page, '#/today');
  await openReview(page, 'Herança');
  await page.click('[data-click="snooze"]');
  await page.waitForFunction(() => !document.body.classList.contains('has-review'));
  const data = await stateOf(page);
  assert.equal(data.topics[0].srs.due, '2026-11-07');
  assert.equal(data.reviewLog.length, 0);
  assert.equal(await page.locator('.review-row').count(), 0);
});

appTest('mastered stops the reviews, and can be undone', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await goToDay(page, '2026-11-06T09:00:00Z');
  await go(page, '#/today');
  await openReview(page, 'Herança');
  await page.click('[data-click="master"]');
  await page.waitForFunction(() => !document.body.classList.contains('has-review'));
  await go(page, '#/agenda');
  await page.click('[data-click="agendaMode"][data-value="month"]');
  assert.equal(await dayCount(page, '2026-11-08'), '');

  const { subjects } = await stateOf(page);
  await go(page, `#/subject/${subjects[0].id}`);
  assert.match(await page.locator('.topic-link').textContent(), /Dominado/);
  assert.equal(await page.locator('[data-subject], .stat').first().locator('strong').textContent(), '1');
  await page.locator('.topic-link').click();
  await page.click('[data-click="resume"]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('De volta'));
  assert.equal((await stateOf(page)).topics[0].masteredOn, null);
});

appTest('Escape and the back button both close a review', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await goToDay(page, '2026-11-06T09:00:00Z');
  await go(page, '#/today');
  await openReview(page, 'Herança');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.classList.contains('has-review'));
  await openReview(page, 'Herança');
  await page.goBack();
  await page.waitForFunction(() => !document.body.classList.contains('has-review'));
  assert.equal(new URL(page.url()).hash, '#/today');
});

// ---------- 5. Exam mode ----------

function examData() {
  const data = emptyData();
  data.settings.maxReviews = 0;
  data.settings.maxMinutes = 0;
  const poo = addSubject(data, { name: 'POO', color: 'teal' });
  const other = addSubject(data, { name: 'Física', color: 'coral' });
  // Far along the ladder: the next review is on 18 Dec, after a 30 Nov exam.
  for (let i = 0; i < 18; i += 1) {
    const t = logStudy(data, { subjectId: poo.id, title: `Tópico ${i}`, studiedOn: '2026-08-20' }, '2026-08-20');
    for (let j = 0; j < 6; j += 1) rateReview(data, t.id, 'good', t.srs.ideal);
    t.srs.due = t.srs.ideal;
  }
  logStudy(data, { subjectId: other.id, title: 'Newton', studiedOn: '2026-11-05' }, '2026-11-05');
  refreshPlan(data, '2026-11-05');
  return { data, poo };
}

appTest('brief example: an exam packs every topic into 23-29 Nov, with countdown', async ({ page }) => {
  const { data, poo } = examData();
  await importBackup(page, data);
  await go(page, `#/subject/${poo.id}`);
  await page.fill('#exam-date', '2026-11-30');
  await page.click('form[data-submit="saveExam"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Exame guardado'));
  assert.match(await page.locator('.exam-countdown').textContent(), /Faltam 25 dias/);

  await go(page, '#/agenda');
  await page.click('[data-click="agendaMode"][data-value="month"]');
  let total = 0;
  for (const day of ['23', '24', '25', '26', '27', '28', '29']) {
    const count = Number(await dayCount(page, `2026-11-${day}`));
    assert.ok(count >= 2, `final-week day ${day} has ${count}`);
    total += count;
  }
  assert.equal(total, 18, 'every topic once, spread across the week');
  assert.equal(await dayCount(page, '2026-11-30'), '', 'none on exam day');

  await page.click('[data-click="agendaStep"][data-value="1"]');
  const counts = await page.locator('.month-day:not(.is-out) .count').allTextContents();
  // Only the other subject's topic stays after the exam.
  assert.equal(counts.map(Number).reduce((a, b) => a + b, 0), 1);

  await page.click('[data-click="agendaStep"][data-value="-1"]');
  await page.locator('.month-day[data-value="2026-11-29"]').click();
  assert.match(await page.locator('.review-row').first().textContent(), /Para o exame/);
});

appTest('brief example: readiness shows 14 of 18 topics reviewed in the last 10 days', async ({ page }) => {
  const { data, poo } = examData();
  data.topics.filter((t) => t.subjectId === poo.id).slice(0, 14).forEach((t) => {
    rateReview(data, t.id, 'good', '2026-11-04');
  });
  addExam(data, { subjectId: poo.id, date: '2026-11-30' }, '2026-11-05');
  await importBackup(page, data);
  await go(page, `#/subject/${poo.id}`);
  assert.equal(await page.locator('.readiness').textContent(), '14 de 18 tópicos revistos nos últimos 10 dias');
  assert.equal(await page.locator('.progress').getAttribute('aria-valuenow'), '14');
  assert.equal(await page.locator('.progress > span').evaluate((el) => el.style.width), '78%');
  await go(page, '#/today');
  assert.match(await page.locator('#main').textContent(), /Exame de POO\s*Faltam 25 dias\s*14 de 18/);
});

appTest('keeping reviews after the exam brings them back, and removing the exam restores the plan', async ({ page }) => {
  const data = emptyData();
  const poo = addSubject(data, { name: 'POO', color: 'teal' });
  logStudy(data, { subjectId: poo.id, title: 'Herança', studiedOn: '2026-11-05' }, '2026-11-05');
  addExam(data, { subjectId: poo.id, date: '2026-11-26' }, '2026-11-05');
  refreshPlan(data, '2026-11-05');
  await importBackup(page, data);

  const monthOfDec = async () => {
    await page.reload(); // the agenda remembers its month while the app is open
    await go(page, '#/agenda');
    await page.click('[data-click="agendaMode"][data-value="month"]');
    await page.click('[data-click="agendaStep"][data-value="1"]');
    return dayCount(page, '2026-12-05');
  };
  assert.equal(await monthOfDec(), '');

  await go(page, `#/subject/${poo.id}`);
  await page.check('[data-change="toggleKeepAfter"]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('continuam'));
  assert.equal(await monthOfDec(), '1');

  await go(page, `#/subject/${poo.id}`);
  await page.uncheck('[data-change="toggleKeepAfter"]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('param'));
  await page.click('[data-click="deleteExam"]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('removido'));
  assert.equal(await monthOfDec(), '1');
});

appTest('after the exam its reviews stop, and the review says why', async ({ page }) => {
  const data = emptyData();
  const poo = addSubject(data, { name: 'POO', color: 'teal' });
  logStudy(data, { subjectId: poo.id, title: 'Herança', studiedOn: '2026-11-05' }, '2026-11-05');
  addExam(data, { subjectId: poo.id, date: '2026-11-08' }, '2026-11-05');
  await importBackup(page, data);
  await goToDay(page, '2026-11-09T09:00:00Z');
  await go(page, '#/today');
  assert.equal(await page.locator('.review-row').count(), 0);
  await go(page, `#/subject/${poo.id}`);
  assert.match(await page.locator('.topic-link').textContent(), /Terminado com o exame/);
  assert.match(await page.locator('.exam-countdown').textContent(), /Já passou/);
  await page.locator('.topic-link').click();
  await page.waitForSelector('#pane h1');
  assert.match(await page.locator('#pane').textContent(), /As revisões terminaram com o exame/);
  assert.equal(await page.locator('.rating').count(), 0);
});

appTest('the buttons say so when no more reviews fit before the exam, and snooze steps aside', async ({ page }) => {
  const { data, poo } = examData();
  addExam(data, { subjectId: poo.id, date: '2026-11-30' }, '2026-11-05');
  await importBackup(page, data);
  await goToDay(page, '2026-11-29T09:00:00Z');
  await go(page, '#/today');
  await page.locator('.review-row').first().click();
  await page.waitForSelector('.ratings');
  assert.match(await rating(page, 'good').textContent(), /sem mais antes do exame/);
  assert.equal(await page.locator('[data-click="snooze"]').isDisabled(), true);
});

// ---------- 6. Workload balancing ----------

function crowdedData() {
  const data = emptyData();
  data.settings.maxReviews = 3;
  data.settings.maxMinutes = 0;
  const poo = addSubject(data, { name: 'POO', color: 'teal' });
  for (let i = 0; i < 5; i += 1) {
    const t = logStudy(data, { subjectId: poo.id, title: `Longo ${i}`, studiedOn: '2026-10-01' }, '2026-10-01');
    t.srs = { ...t.srs, step: 5, interval: 30, ideal: '2026-12-10', due: '2026-12-10' };
  }
  return data;
}

appTest('an over-limit day spreads to nearby days and says so', async ({ page }) => {
  await importBackup(page, crowdedData());
  await go(page, '#/agenda');
  assert.match(await page.locator('#moved-notice').textContent(), /Movi 2 revisões para dias próximos/);
  await page.click('[data-click="agendaMode"][data-value="month"]');
  await page.click('[data-click="agendaStep"][data-value="1"]');
  assert.equal(await dayCount(page, '2026-12-10'), '3');
  assert.equal(await dayCount(page, '2026-12-11'), '2');
  await page.locator('.month-day[data-value="2026-12-11"]').click();
  assert.match(await page.locator('.review-row').first().textContent(), /Movida de 10 dez/);
  await page.locator('.review-row').first().click();
  await page.waitForSelector('#pane h1');
  assert.match(await page.locator('#pane').textContent(), /Movida de 10 dez para respeitar o teu limite diário/);
});

appTest('changing the limit in Settings rebalances at once and mentions it', async ({ page }) => {
  const data = crowdedData();
  data.settings.maxReviews = 10;
  await importBackup(page, data);
  await go(page, '#/settings');
  await page.fill('#max-reviews', '3');
  await page.press('#max-reviews', 'Tab');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Movi 2 revisões'));
  assert.match(await page.locator('#limit-summary').textContent(), /Até 3 revisões por dia/);
  assert.equal((await stateOf(page)).settings.maxReviews, 3);
});

appTest('a moved review keeps its day through a reload and when that day arrives', async ({ page }) => {
  await importBackup(page, crowdedData());
  // Three stay on the 10th and two were moved to the 11th. On the 10th, their
  // original day, the moved ones don't drop back in.
  await goToDay(page, '2026-12-10T09:00:00Z');
  await go(page, '#/today');
  assert.equal(await page.locator('.review-row').count(), 3);
  assert.equal(await page.locator('.chip-overdue').count(), 0);

  await goToDay(page, '2026-12-11T09:00:00Z');
  await go(page, '#/today');
  assert.equal(await page.locator('.review-row').count(), 5);
  assert.equal(await page.locator('.chip-overdue').count(), 3, 'the three from the 10th, undone');
});

// ---------- 7. Reminders ----------

// Records notifications instead of showing them, and grants permission.
const stubNotifications = (context) =>
  context.addInitScript(() => {
    window.__sent = [];
    class FakeNotification {
      static permission = 'granted';

      static requestPermission = async () => 'granted';

      constructor(title, options) {
        window.__sent.push({ title, body: options.body });
      }
    }
    window.Notification = FakeNotification;
  });

const sentNotifications = (page) => page.evaluate(() => window.__sent);

async function reminderSession(page, context, settings) {
  await stubNotifications(context);
  const data = emptyData();
  Object.assign(data.settings, settings);
  const poo = addSubject(data, { name: 'POO', color: 'teal' });
  for (let i = 0; i < 6; i += 1) logStudy(data, { subjectId: poo.id, title: `T${i}`, studiedOn: '2026-11-04' }, '2026-11-04');
  await importBackup(page, data);
  await page.reload();
  await page.waitForSelector('#main h1');
}

appTest('the daily reminder fires once at its time, with the brief\'s wording', { now: '2026-11-05T17:59:00Z' }, async ({ page, context }) => {
  await reminderSession(page, context, { dailyReminder: true, dailyTime: '18:00' });
  assert.deepEqual(await sentNotifications(page), []);
  await page.clock.fastForward('02:00');
  await page.waitForFunction(() => window.__sent.length > 0);
  assert.deepEqual(await sentNotifications(page), [{ title: 'Recall', body: '6 revisões hoje, cerca de 25 min' }]);
  await page.clock.fastForward('10:00');
  await page.waitForTimeout(100);
  assert.equal((await sentNotifications(page)).length, 1, 'once a day');
});

appTest('the evening reminder only fires if reviews are still due', { now: '2026-11-05T20:59:00Z' }, async ({ page, context }) => {
  await reminderSession(page, context, { eveningReminder: true, eveningTime: '21:00' });
  await page.clock.fastForward('02:00');
  await page.waitForFunction(() => window.__sent.length > 0);
  assert.match((await sentNotifications(page))[0].body, /Ainda há 6 revisões/);
});

appTest('nothing fires when nothing is due', { now: '2026-11-05T17:59:00Z' }, async ({ page, context }) => {
  await stubNotifications(context);
  const data = emptyData();
  data.settings.dailyReminder = true;
  await importBackup(page, data);
  await page.reload();
  await page.waitForSelector('#main h1');
  await page.clock.fastForward('03:00');
  await page.waitForTimeout(100);
  assert.deepEqual(await sentNotifications(page), []);
});

appTest('quiet hours hold a reminder back', { now: '2026-11-05T22:59:00Z' }, async ({ page, context }) => {
  await reminderSession(page, context, { dailyReminder: true, dailyTime: '23:00', quietStart: '22:30', quietEnd: '07:30' });
  await page.clock.fastForward('03:00');
  await page.waitForTimeout(100);
  assert.deepEqual(await sentNotifications(page), []);
});

appTest('turning a reminder on asks for permission and enables its time field', async ({ page, context }) => {
  await stubNotifications(context);
  await page.reload();
  await go(page, '#/settings');
  assert.equal(await page.isDisabled('#daily-time'), true);
  await page.check('#daily-reminder');
  await page.waitForFunction(() => !document.querySelector('#daily-time').disabled);
  assert.equal((await stateOf(page)).settings.dailyReminder, true);
});

// ---------- 8. Progress ----------

appTest('progress shows the per-subject numbers and a heatmap, with no gamification', async ({ page }) => {
  const data = emptyData();
  const poo = addSubject(data, { name: 'POO', color: 'teal' });
  const a = logStudy(data, { subjectId: poo.id, title: 'A', studiedOn: '2026-10-20' }, '2026-10-20');
  const b = logStudy(data, { subjectId: poo.id, title: 'B', studiedOn: '2026-10-20' }, '2026-10-20');
  const c = logStudy(data, { subjectId: poo.id, title: 'C', studiedOn: '2026-10-20' }, '2026-10-20');
  rateReview(data, a.id, 'good', '2026-11-03');
  rateReview(data, a.id, 'good', '2026-11-05');
  rateReview(data, b.id, 'good', '2026-11-01'); // last week
  c.masteredOn = '2026-11-02';
  await importBackup(page, data);
  await go(page, '#/subjects');

  const stats = await page.locator(`[data-subject="${poo.id}"] .stat strong`).allTextContents();
  assert.deepEqual(stats, ['3', '2', '1', '1']); // topics, this week, overdue (B, due on the 3rd), mastered

  assert.equal(await page.locator('.heat-cell[data-day="2026-11-05"]').getAttribute('data-level'), '4');
  assert.equal(await page.locator('.heat-cell[data-day="2026-11-04"]').getAttribute('data-level'), '0');
  assert.match(await page.locator('#heat-summary').textContent(), /3 revisões nas últimas 18 semanas/);
});

test('no streaks, badges or guilt anywhere in the app', async () => {
  const sources = ['src/ui/views/today.js', 'src/ui/views/review.js', 'src/ui/views/subjects.js', 'src/ui/views/settings.js', 'src/ui/views/agenda.js', 'src/ui/views/add.js', 'src/core/copy.js', 'src/core/reminders.js'];
  for (const source of sources) {
    const text = await readFile(new URL(`../../${source}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /streak|sequência|badge|conquista|medalha|falhaste|falhou!|a ficar para trás|😱|!!/i, source);
  }
});

// ---------- 9. Data and calendar ----------

appTest('exports reviews to a valid .ics file', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança, polimorfismo' });
  await go(page, '#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-click="exportIcs"]')]);
  assert.equal(download.suggestedFilename(), 'recall-revisoes-2026-11-05.ics');
  const ics = await readFile(await download.path(), 'utf8');
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 6);
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261106'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20270104'));
  assert.ok(ics.includes('SUMMARY:Rever: Herança\\, polimorfismo'));
});

appTest('a JSON backup restores everything in a fresh browser profile', async ({ page }) => {
  await importBackup(page, buildSeed('2026-11-05'));
  await go(page, '#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-click="exportJson"]')]);
  const content = await readFile(await download.path(), 'utf8');
  const before = await stateOf(page);

  const second = await openApp(browser, PORT, { now: '2026-11-05T10:00:00Z' });
  try {
    await second.page.goto(`${BASE}/#/settings`);
    await second.page.waitForSelector('#import-file');
    second.page.once('dialog', (d) => d.accept());
    await second.page.setInputFiles('#import-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(content) });
    await second.page.waitForFunction(() => document.querySelector('#toast').textContent.includes('importado'));
    assert.deepEqual(await stateOf(second.page), before);
    assert.deepEqual(second.errors, []);
  } finally {
    await second.context.close();
  }
});

appTest('a bad backup is refused and leaves the data untouched', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await go(page, '#/settings');
  const upload = (text) => page.setInputFiles('#import-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await upload('não é json');
  await page.waitForFunction(() => !document.querySelector('#import-error').hidden);
  assert.match(await page.locator('#import-error').textContent(), /JSON válido/);
  await upload(JSON.stringify({ app: 'Outra' }));
  await page.waitForFunction(() => document.querySelector('#import-error').textContent.includes('backup do Recall'));
  assert.equal((await stateOf(page)).topics.length, 1);
});

appTest('declining the import confirmation changes nothing', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await go(page, '#/settings');
  const asked = new Promise((resolve) => {
    page.once('dialog', async (d) => {
      await d.dismiss();
      resolve(d.message());
    });
  });
  await page.setInputFiles('#import-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(toBackup(emptyData()))) });
  assert.match(await asked, /Substituir os dados atuais/);
  assert.equal((await stateOf(page)).topics.length, 1);
});

appTest('data survives a reload and nothing is sent to anyone else', async ({ page, context }) => {
  const requests = [];
  context.on('request', (r) => requests.push(r.url()));
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await page.reload();
  await page.waitForSelector('#main h1');
  await go(page, '#/agenda');
  await go(page, '#/subjects');
  await go(page, '#/settings');
  assert.equal((await stateOf(page)).topics.length, 1);
  const external = requests.filter((u) => !u.startsWith(BASE) && !u.startsWith('blob:') && !u.startsWith('data:'));
  assert.deepEqual(external, []);
  // Only navigations and the app's own files: no POST or analytics of any kind.
  assert.ok(requests.every((u) => !/analytics|telemetry|track/.test(u)));
});

// ---------- Dates ----------

appTest('Lisbon clock change: the 25-hour day stays one day', { now: '2026-10-24T22:30:00Z' }, async ({ page }) => {
  // 23:30 on 24 Oct in Lisbon (UTC+1). Already the 24th in UTC too.
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  assert.equal((await stateOf(page)).topics[0].studiedOn, '2026-10-24');
  assert.equal((await stateOf(page)).topics[0].srs.due, '2026-10-25');

  // 23:30 on 25 Oct in Lisbon, now UTC+0: still the 25th, a day of 25 hours.
  await goToDay(page, '2026-10-25T23:30:00Z');
  await go(page, '#/today');
  assert.match(await page.locator('#main .page-head').textContent(), /25 de outubro/);
  assert.equal(await page.locator('.review-row').count(), 1);
  assert.equal(await page.locator('.chip-overdue').count(), 0, 'due today, not overdue');
});

appTest('Lisbon clock change in spring: the 23-hour day is one day', { now: '2027-03-27T12:00:00Z' }, async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await goToDay(page, '2027-03-28T22:30:00Z'); // 23:30 in Lisbon, now UTC+1
  await go(page, '#/today');
  assert.match(await page.locator('#main .page-head').textContent(), /28 de março/);
  assert.equal(await page.locator('.review-row').count(), 1);
  assert.equal(await page.locator('.chip-overdue').count(), 0);
});

appTest('late at night in New York it is still that local day, though UTC has moved on', { now: '2026-11-06T04:30:00Z', timezoneId: 'America/New_York' }, async ({ page }) => {
  // 23:30 on the 5th in New York; 04:30 on the 6th in UTC.
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  const { topics, reviewLog } = await stateOf(page);
  assert.equal(topics[0].studiedOn, '2026-11-05');
  assert.equal(topics[0].srs.due, '2026-11-06');
  assert.match(topics[0].createdAt, /^2026-11-06T04:30:\d\d\.\d{3}Z$/, 'instants are stored in UTC');
  assert.equal(reviewLog.length, 0);
});

appTest('just after midnight in Tokyo it is already the next day', { now: '2026-11-04T15:30:00Z', timezoneId: 'Asia/Tokyo' }, async ({ page }) => {
  await go(page, '#/today');
  assert.match(await page.locator('#main .page-head').textContent(), /5 de novembro/);
});

appTest('month and year boundaries: reviews land on the right days', { now: '2026-12-31T12:00:00Z' }, async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await go(page, '#/agenda');
  await page.click('[data-click="agendaMode"][data-value="month"]');
  await page.click('[data-click="agendaStep"][data-value="1"]');
  assert.match(await page.locator('#agenda-title').textContent(), /janeiro de 2027/);
  for (const day of ['2027-01-01', '2027-01-03', '2027-01-07', '2027-01-14', '2027-01-30']) {
    assert.equal(await dayCount(page, day), '1', day);
  }
  await page.click('[data-click="agendaStep"][data-value="1"]');
  await page.click('[data-click="agendaStep"][data-value="1"]');
  assert.equal(await dayCount(page, '2027-03-01'), '1');
});

appTest('with the app left open overnight, today rolls over by itself', { now: '2026-11-05T23:59:00Z' }, async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await go(page, '#/today');
  assert.equal(await page.locator('.review-row').count(), 0);
  await page.clock.fastForward('02:00');
  await page.waitForSelector('.review-row');
  assert.match(await page.locator('#main .page-head').textContent(), /6 de novembro/);
});

// ---------- Design and accessibility ----------

const ROUTES = ['#/today', '#/agenda', '#/add', '#/subjects', '#/settings'];

for (const [label, viewport] of [['320px', SMALL], ['phone', PHONE], ['desktop', DESKTOP]]) {
  appTest(`no sideways scrolling and nothing unlabelled at ${label}`, { viewport }, async ({ page }) => {
    await importBackup(page, buildSeed('2026-11-05'));
    const check = async (where) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${where} overflows by ${overflow}px`);
      const unlabelled = await page.evaluate(() => {
        const name = (el) =>
          el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || el.getAttribute('aria-labelledby');
        return [...document.querySelectorAll('button:not([hidden]), a, input:not([type=hidden]), select, textarea')]
          .filter((el) => !String(name(el)).trim())
          .map((el) => el.outerHTML.slice(0, 80));
      });
      assert.deepEqual(unlabelled, [], where);
    };
    for (const route of ROUTES) {
      await go(page, route);
      await check(route);
    }
    await go(page, '#/agenda');
    await page.click('[data-click="agendaMode"][data-value="month"]');
    await check('month');
    await go(page, '#/today');
    await page.locator('.review-row').first().click();
    await page.waitForSelector('.ratings');
    await check('review');
  });
}

appTest('phone: bottom tabs, a prominent Add, and rating buttons in thumb reach', { viewport: PHONE }, async ({ page }) => {
  await importBackup(page, buildSeed('2026-11-05'));
  await go(page, '#/today');
  assert.deepEqual(
    (await page.locator('.tab').allTextContents()).map((t) => t.trim()),
    ['Hoje', 'Agenda', 'Adicionar', 'Disciplinas', 'Definições'],
  );
  assert.equal(await page.locator('#sidebar').isVisible(), false);
  const add = await page.locator('.tab-add-circle').boundingBox();
  assert.ok(add.height >= 48, 'Add stands out');

  await page.locator('.review-row').first().click();
  await page.waitForSelector('.ratings');
  for (const r of ['again', 'hard', 'good', 'easy']) {
    const box = await rating(page, r).boundingBox();
    assert.ok(box.height >= 60, `${r} is a big button`);
    assert.ok(box.y > PHONE.height / 2, `${r} is in the lower half of the screen`);
    assert.ok(box.y + box.height <= PHONE.height, `${r} is on screen`);
  }
});

appTest('desktop: sidebar with subjects, list in the middle, selected review on the right', { viewport: DESKTOP }, async ({ page }) => {
  await importBackup(page, buildSeed('2026-11-05'));
  await go(page, '#/today');
  assert.equal(await page.locator('#tabs').isVisible(), false);
  assert.equal(await page.locator('#sidebar .dot').count(), 3);
  await page.locator('.review-row').first().click();
  await page.waitForSelector('.ratings');
  const main = await page.locator('#main').boundingBox();
  const pane = await page.locator('#pane').boundingBox();
  const side = await page.locator('#sidebar').boundingBox();
  assert.ok(side.x < main.x && main.x < pane.x, 'three columns in order');
  assert.equal(await page.locator('#main .review-row').first().isVisible(), true, 'the list stays visible');
  assert.equal(await page.locator('.pane-close').isVisible(), false);
  await rating(page, 'good').click();
  await page.waitForFunction(() => document.querySelector('.pane-empty'));
});

for (const colorScheme of ['light', 'dark']) {
  appTest(`${colorScheme} mode: text has enough contrast (WCAG AA)`, { colorScheme, viewport: DESKTOP }, async ({ page }) => {
    await importBackup(page, buildSeed('2026-11-05'));
    const scan = () => page.evaluate(() => {
      const parse = (c) => {
        const m = c.match(/[\d.]+/g).map(Number);
        return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
      };
      const lin = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const bgOf = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c.a > 0.9) return c;
        }
        return parse(getComputedStyle(document.body).backgroundColor);
      };
      const bad = [];
      const walker = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!node.textContent.trim() || !el.checkVisibility()) continue;
        if (el.closest('option, .btn:disabled')) continue;
        const style = getComputedStyle(el);
        const fg = lum(parse(style.color));
        const bg = lum(bgOf(el));
        const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) bad.push(`${ratio.toFixed(2)}: "${node.textContent.trim().slice(0, 40)}"`);
      }
      return bad;
    });
    for (const route of ROUTES) {
      await go(page, route);
      assert.deepEqual(await scan(), [], route);
    }
    await go(page, '#/today');
    await page.locator('.review-row').first().click();
    await page.waitForSelector('.ratings');
    assert.deepEqual(await scan(), [], 'review');
  });
}

appTest('the theme setting overrides the system', { colorScheme: 'light' }, async ({ page }) => {
  await go(page, '#/settings');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await bg();
  await page.selectOption('#theme', 'dark');
  await page.waitForFunction((was) => getComputedStyle(document.body).backgroundColor !== was, light);
  await page.reload();
  await page.waitForSelector('#main h1');
  assert.notEqual(await bg(), light, 'kept after a reload');
});

appTest('a preferred time shows on Today', async ({ page }) => {
  await logTopic(page, { subject: 'POO', title: 'Herança' });
  await go(page, '#/settings');
  await page.fill('#preferred-time', '18:30');
  await page.press('#preferred-time', 'Tab');
  await page.waitForFunction(() => document.activeElement?.id !== '');
  await goToDay(page, '2026-11-06T09:00:00Z');
  await go(page, '#/today');
  assert.match(await page.locator('#today-line').textContent(), /· às 18:30/);
});

// ---------- PWA ----------

appTest('installable and works offline once loaded', { blockWorker: false }, async ({ page, context }) => {
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512'));
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192'));

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await logTopic(page, { subject: 'POO', title: 'Herança' });

  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#main h1');
  await go(page, '#/agenda');
  assert.equal((await stateOf(page)).topics.length, 1);
  await logTopic(page, { subject: 'POO', title: 'Sem rede' });
  assert.equal((await stateOf(page)).topics.length, 2);
  await context.setOffline(false);
});

const shownNotifications = (page) => page.evaluate(async () => {
  const registration = await navigator.serviceWorker.ready;
  return (await registration.getNotifications()).map((n) => n.body);
});

// Real time, on purpose: the page's clock is under the test's control.
async function waitForNotifications(page, count) {
  for (let i = 0; i < 100; i += 1) {
    if ((await shownNotifications(page)).length === count) return;
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  assert.fail(`Expected ${count} notification(s), found ${(await shownNotifications(page)).length}`);
}

// The service worker runs on real time, so this data is due whatever today is.
function alwaysDueData() {
  const data = emptyData();
  Object.assign(data.settings, {
    dailyReminder: true, dailyTime: '00:00', quietStart: '00:00', quietEnd: '00:00',
  });
  const poo = addSubject(data, { name: 'POO', color: 'teal' });
  logStudy(data, { subjectId: poo.id, title: 'Herança', studiedOn: '2020-01-01' }, '2020-01-01');
  return data;
}

appTest('a real notification goes out through the service worker', { blockWorker: false, now: '2026-11-05T17:59:00Z' }, async ({ page, context }) => {
  await context.grantPermissions(['notifications'], { origin: BASE });
  await page.evaluate(() => navigator.serviceWorker.ready);
  const data = alwaysDueData();
  data.settings.dailyTime = '18:00';
  await importBackup(page, data);
  await page.reload();
  await page.waitForSelector('#main h1');
  await page.clock.fastForward('02:00');
  await waitForNotifications(page, 1);
  assert.deepEqual(await shownNotifications(page), ['1 revisão hoje, cerca de 5 min']);
});

appTest('the background check runs in the service worker, once a day', { blockWorker: false }, async ({ page, context }) => {
  await context.grantPermissions(['notifications'], { origin: BASE });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await importBackup(page, alwaysDueData());

  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  const registrationId = await new Promise((resolve) => {
    cdp.once('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => resolve(registrations[0].registrationId));
  });
  const fire = () => cdp.send('ServiceWorker.dispatchPeriodicSyncEvent', { origin: BASE, registrationId, tag: 'recall-reminders' });

  await fire();
  await waitForNotifications(page, 1);
  const sentAfterFirst = await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('recall', 1);
    open.onsuccess = () => {
      const get = open.result.transaction('kv').objectStore('kv').get('sent');
      get.onsuccess = () => {
        open.result.close();
        resolve(get.result);
      };
    };
  }));
  assert.ok(sentAfterFirst.daily, 'recorded as sent');

  await page.evaluate(() => navigator.serviceWorker.ready.then(async (r) => {
    for (const n of await r.getNotifications()) n.close();
  }));
  await fire();
  await page.waitForTimeout(300);
  assert.deepEqual(await shownNotifications(page), [], 'not sent twice');
});

test('every app file the offline cache lists exists', async () => {
  const sw = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');
  const list = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  for (const file of list.filter((f) => f !== './')) {
    await readFile(new URL(`../../${file}`, import.meta.url));
  }
  assert.ok(list.includes('src/ui/views/today.js'));
});

test('the server only hands out the app\'s own files', async () => {
  for (const path of ['/package.json', '/scripts/serve.js', '/%2e%2e/%2e%2e/secret', '/seed/recall-exemplo.json', '/node_modules/playwright-core/package.json']) {
    const response = await fetch(`${BASE}${path}`);
    assert.equal(response.status, 404, path);
  }
});

// Keeps `addDays` honest with the seed used across these tests.
test('the seed data is valid and has the promised contents', async () => {
  const data = buildSeed('2026-11-05');
  assert.equal(data.subjects.length, 3);
  assert.ok(data.topics.length >= 20);
  assert.ok(data.reviewLog.length >= 50);
  assert.equal(data.exams.length, 1);
  assert.equal(data.exams[0].date, addDays('2026-11-05', 25));

  const shape = (d) => d.topics.map((t) => [t.id, t.srs]);
  assert.deepEqual(shape(buildSeed('2026-11-05')), shape(data), 'the same every run');
});
