// App shell: state, routing, and the single path every change goes through.

import { refreshPlan } from '../core/actions.js';
import { movedMessage } from '../core/copy.js';
import { localDay } from '../core/dates.js';
import { todaySummary } from '../core/stats.js';
import { loadData, saveData } from '../data/store.js';
import { html } from './html.js';
import { icons } from './icons.js';
import { enableBackgroundChecks, startReminderLoop } from './notifications.js';
import { renderAdd, addHandlers } from './views/add.js';
import { renderAgenda, agendaHandlers } from './views/agenda.js';
import { renderReview, reviewHandlers } from './views/review.js';
import { renderSettings, settingsHandlers } from './views/settings.js';
import { renderSubject, renderSubjects, subjectsHandlers } from './views/subjects.js';
import { renderToday, todayHandlers } from './views/today.js';

const $ = (id) => document.getElementById(id);

const NAV = [
  { path: 'today', label: 'Hoje', icon: icons.today },
  { path: 'agenda', label: 'Agenda', icon: icons.agenda },
  { path: 'add', label: 'Adicionar', icon: icons.add },
  { path: 'subjects', label: 'Disciplinas', icon: icons.subjects },
  { path: 'settings', label: 'Definições', icon: icons.settings },
];

export const app = {
  data: null,
  plan: null,
  today: localDay(),
  route: { path: 'today', section: 'today', id: null, reviewId: null },
  ui: {
    agendaMode: 'week',
    agendaAnchor: null,
    selectedDay: null,
    draft: { subjectId: null, title: '', notes: '', studiedOn: null, durationMin: '', newSubject: false, subjectName: '', subjectColor: null, error: '' },
    examError: '',
    editingTopic: null,
    editError: '',
    installPrompt: null,
  },
};

// ---------- routing ----------

function parseRoute() {
  const [pathPart, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [section = 'today', id = null] = pathPart.split('/');
  const known = ['today', 'agenda', 'add', 'subjects', 'subject', 'settings'];
  const safeSection = known.includes(section) ? section : 'today';
  return {
    section: safeSection,
    id: id ? decodeURIComponent(id) : null,
    path: id ? `${safeSection}/${id}` : safeSection,
    reviewId: new URLSearchParams(query).get('r'),
  };
}

// A function declaration: views read this while the import cycle is still loading.
export function closeReview() {
  location.hash = `#/${app.route.path}`;
}

// ---------- rendering ----------

const isActive = (item, route) => item.path === route.section || (item.path === 'subjects' && route.section === 'subject');

function renderChrome() {
  const { route, data, plan } = app;
  const dueBySubject = new Map();
  for (const it of plan.items) {
    if (it.index === 0 && it.date <= plan.today) dueBySubject.set(it.subjectId, (dueBySubject.get(it.subjectId) ?? 0) + 1);
  }
  const current = (item) => (isActive(item, route) ? 'page' : null);
  const summary = todaySummary(data, plan);

  $('sidebar').innerHTML = html`
    <div class="brand">Recall</div>
    <a class="side-link side-add" href="#/add" aria-current="${current(NAV[2])}">${icons.add} Adicionar estudo</a>
    <div class="side-links">
      ${NAV.filter((n) => n.path !== 'add').map((n) => html`
        <a class="side-link" href="#/${n.path}" aria-current="${current(n)}">
          ${n.icon} ${n.label}
          ${n.path === 'today' && summary.count ? html`<span class="side-count">${summary.count}</span>` : ''}
        </a>`)}
    </div>
    <div>
      <div class="side-title" id="side-subjects">As tuas disciplinas</div>
      <ul class="side-links" aria-labelledby="side-subjects">
        ${data.subjects.map((s) => html`
          <li><a class="side-link" href="#/subject/${encodeURIComponent(s.id)}" aria-current="${route.section === 'subject' && route.id === s.id ? 'page' : null}">
            <span class="dot" data-color="${s.color}"></span> ${s.name}
            ${dueBySubject.get(s.id) ? html`<span class="side-count" aria-label="${dueBySubject.get(s.id)} para rever">${dueBySubject.get(s.id)}</span>` : ''}
          </a></li>`)}
      </ul>
    </div>
  `;

  $('tabs').innerHTML = html`${NAV.map((n) => html`
    <a class="tab ${n.path === 'add' ? 'tab-add' : ''}" href="#/${n.path}" aria-current="${current(n)}">
      ${n.path === 'add' ? html`<span class="tab-add-circle">${n.icon}</span>` : n.icon}
      <span>${n.label}</span>
    </a>`)}`;

  // aria-current="null" and aria-current="false" would both still be announced.
  for (const el of document.querySelectorAll('[aria-current="null"], [aria-current=""], [aria-current="false"]')) {
    el.removeAttribute('aria-current');
  }
}

function renderMain() {
  const views = {
    today: renderToday,
    agenda: renderAgenda,
    add: renderAdd,
    subjects: renderSubjects,
    subject: renderSubject,
    settings: renderSettings,
  };
  $('main').innerHTML = views[app.route.section](app);
  for (const el of $('main').querySelectorAll('[aria-current="false"]')) el.removeAttribute('aria-current');
}

function renderPane() {
  const hasReview = Boolean(app.route.reviewId);
  document.body.classList.toggle('has-review', hasReview);
  $('pane').innerHTML = renderReview(app);
}

export function renderAll() {
  renderChrome();
  renderMain();
  renderPane();
}

export function applyTheme(theme) {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}

// ---------- changes ----------

let toastTimer;
let toastRun = null;

function hideToast() {
  $('toast').classList.remove('is-visible');
  $('toast-text').textContent = '';
  $('toast-action').textContent = '';
  $('toast-action').hidden = true;
  toastRun = null;
}

// `action`, if given, is { label, run }: a button that lasts as long as the toast.
export function toast(message, action = null) {
  $('toast-text').textContent = message;
  $('toast-action').textContent = action?.label ?? '';
  $('toast-action').hidden = !action;
  toastRun = action?.run ?? null;
  $('toast').classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 8000 : 5000);
}

async function persist() {
  try {
    await saveData(app.data);
  } catch (error) {
    console.error('Falha ao guardar', error);
    toast('Não consegui guardar neste dispositivo. Exporta um backup para não perderes dados.');
  }
}

// Every change: apply it, replan, save, redraw, and mention anything balancing moved.
export async function commit(change, { message, render = true, action = null, mentionMoves = true } = {}) {
  const movedBefore = new Set(app.plan.moved.map((it) => it.key));
  const result = change(app.data);
  app.plan = refreshPlan(app.data, app.today);
  await persist();
  if (render) renderAll();
  else renderChrome();

  const text = typeof message === 'function' ? message(result, app.plan) : message;
  const newlyMoved = app.plan.moved.filter((it) => !movedBefore.has(it.key)).length;
  const moveNote = newlyMoved && mentionMoves ? movedMessage(newlyMoved) : '';
  if (text || moveNote) toast([text, moveNote].filter(Boolean).join(' '), action);
  return result;
}

// ---------- events ----------

const handlers = {
  ...addHandlers,
  ...agendaHandlers,
  ...reviewHandlers,
  ...settingsHandlers,
  ...subjectsHandlers,
  ...todayHandlers,
  toastAction() {
    const run = toastRun;
    hideToast();
    run?.();
  },
};

function delegate(type, attribute) {
  document.addEventListener(type, (event) => {
    const target = event.target.closest?.(`[${attribute}]`);
    if (!target) return;
    if (type === 'submit') event.preventDefault();
    handlers[target.getAttribute(attribute)]?.(target, event);
  });
}

function focusAfterNavigation(previous) {
  const { route } = app;
  if (route.reviewId && route.reviewId !== previous.reviewId) {
    $('pane').querySelector('h1')?.focus();
  } else if (route.path !== previous.path) {
    $('main').scrollTop = 0;
    window.scrollTo(0, 0);
    $('main').querySelector('[autofocus]')?.focus();
    if (!$('main').contains(document.activeElement)) $('main').focus({ preventScroll: true });
  }
}

function onRouteChange() {
  const previous = app.route;
  app.route = parseRoute();
  app.ui.editingTopic = null;
  renderAll();
  focusAfterNavigation(previous);
}

// The day can change while the app stays open, including overnight on a phone.
function refreshIfNewDay() {
  const day = localDay();
  if (day === app.today) return;
  app.today = day;
  app.ui.agendaAnchor = null;
  app.ui.selectedDay = null;
  app.ui.draft.studiedOn = null;
  commit(() => {});
}

async function start() {
  try {
    app.data = await loadData();
  } catch (error) {
    console.error(error);
    $('main').innerHTML = html`<p class="error">Não consegui abrir os dados neste browser. Em janelas privadas o armazenamento pode estar bloqueado.</p>`;
    return;
  }
  applyTheme(app.data.settings.theme);
  app.plan = refreshPlan(app.data, app.today);
  await persist();
  app.route = parseRoute();
  renderAll();

  delegate('click', 'data-click');
  delegate('submit', 'data-submit');
  delegate('input', 'data-input');
  delegate('change', 'data-change');
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && app.route.reviewId) closeReview();
  });
  window.addEventListener('hashchange', onRouteChange);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshIfNewDay();
  });
  setInterval(refreshIfNewDay, 30_000);
  startReminderLoop(() => app.data);

  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) {
    // Module workers are newer than the rest of what's used here. Without one the
    // app still works, just not offline.
    navigator.serviceWorker.register('sw.js', { type: 'module' })
      .then(() => {
        const { dailyReminder, eveningReminder } = app.data.settings;
        if (dailyReminder || eveningReminder) enableBackgroundChecks();
      })
      .catch((error) => console.warn('Service worker indisponível', error));
  }
}

// Chrome offers installation through this event. It's held for the button in Settings.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  app.ui.installPrompt = event;
  if (app.data && app.route.section === 'settings') renderAll();
});

start();
