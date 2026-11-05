import { longDate, monthTitle, movedMessage, overLimitMessage, reviewsCount, shortDate, weekday } from '../../core/copy.js';
import { addDays, addMonths, dayRange, monthGrid, startOfMonth, startOfWeek } from '../../core/dates.js';
import { agendaByDay } from '../../core/stats.js';
import { app, renderAll } from '../app.js';
import { html } from '../html.js';
import { icons } from '../icons.js';
import { daySummaryLabel, reviewRow, reviewHref, subjectBar, subjectOf, topicOf } from '../shared.js';

const WEEKDAY_HEADS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function doneByDay(data) {
  const days = new Map();
  for (const r of data.reviewLog) {
    if (!days.has(r.doneOn)) days.set(r.doneOn, []);
    days.get(r.doneOn).push(r);
  }
  return days;
}

function dayLabel(day, items, data) {
  const base = `${longDate(day)}, ${reviewsCount(items.length)}`;
  return items.length ? `${base}. ${daySummaryLabel(items, data)}` : base;
}

function weekView({ data, plan, today }, anchor, byDay, selected) {
  const days = dayRange(startOfWeek(anchor), addDays(startOfWeek(anchor), 6));
  return html`
    <div class="week">
      ${days.map((day) => {
        const items = byDay.get(day) ?? [];
        const heavy = items.length > plan.limit;
        return html`
          <button type="button" class="week-day ${day === today ? 'is-today' : ''} ${heavy ? 'is-heavy' : ''}"
            data-click="selectDay" data-value="${day}" aria-pressed="${String(day === selected)}" aria-label="${dayLabel(day, items, data)}">
            <span class="label">${weekday(day)}<br><span class="small muted">${shortDate(day)}</span></span>
            ${subjectBar(items, data)}
            <span class="count">${items.length || ''}</span>
          </button>`;
      })}
    </div>`;
}

function monthView({ data, plan, today }, anchor, byDay, done, selected) {
  const month = anchor.slice(0, 7);
  return html`
    <div class="month">
      ${WEEKDAY_HEADS.map((d) => html`<div class="month-head" aria-hidden="true">${d}</div>`)}
      ${monthGrid(anchor).map((day) => {
        const items = byDay.get(day) ?? [];
        const past = day < today;
        const count = past ? (done.get(day)?.length ?? 0) : items.length;
        const classes = [
          day.slice(0, 7) !== month && 'is-out',
          day === today && 'is-today',
          items.length > plan.limit && 'is-heavy',
          past && 'is-done',
        ].filter(Boolean).join(' ');
        return html`
          <button type="button" class="month-day ${classes}" data-click="selectDay" data-value="${day}"
            aria-pressed="${String(day === selected)}"
            aria-label="${past ? `${longDate(day)}, ${count} feitas` : dayLabel(day, items, data)}">
            <span class="num">${Number(day.slice(8))}</span>
            <span class="count">${count || ''}</span>
            ${items.length ? subjectBar(items, data) : ''}
          </button>`;
      })}
    </div>`;
}

function dayDetail(appState, day, byDay, done) {
  const { data, route, today } = appState;
  const items = byDay.get(day) ?? [];
  const finished = done.get(day) ?? [];
  return html`
    <section class="section" aria-label="${longDate(day)}">
      <h2 style="margin-bottom:10px">${longDate(day)}</h2>
      ${items.length === 0 && finished.length === 0 ? html`<p class="muted">Sem revisões neste dia.</p>` : ''}
      <ul class="review-list">
        ${items.map((item) => reviewRow({ item, data, route, today, activeId: route.reviewId }))}
        ${finished.map((r) => {
          const topic = topicOf(data, r.topicId);
          return html`
            <li>
              <a class="review-row is-done" href="${reviewHref(route, topic.id)}">
                <div>
                  <div class="title">${topic.title}</div>
                  <div class="meta"><span>${subjectOf(data, topic.subjectId).name}</span><span class="chip">Feita</span></div>
                </div>
              </a>
            </li>`;
        })}
      </ul>
    </section>`;
}

export function renderAgenda(appState) {
  const { ui, plan, today, data } = appState;
  const anchor = ui.agendaAnchor ?? today;
  const selected = ui.selectedDay ?? today;
  const byDay = agendaByDay(plan);
  const done = doneByDay(data);
  const mode = ui.agendaMode;

  const title = mode === 'week'
    ? `${shortDate(startOfWeek(anchor))} a ${shortDate(addDays(startOfWeek(anchor), 6))}`
    : monthTitle(anchor);

  return html`
    <header class="page-head"><h1>Agenda</h1></header>

    <div class="agenda-bar">
      <div class="segmented" role="group" aria-label="Vista">
        <button type="button" data-click="agendaMode" data-value="week" aria-pressed="${String(mode === 'week')}">Semana</button>
        <button type="button" data-click="agendaMode" data-value="month" aria-pressed="${String(mode === 'month')}">Mês</button>
      </div>
      <div class="agenda-nav">
        <button type="button" class="icon-btn" data-click="agendaStep" data-value="-1" aria-label="${mode === 'week' ? 'Semana anterior' : 'Mês anterior'}">${icons.back}</button>
        <h2 id="agenda-title" aria-live="polite">${title}</h2>
        <button type="button" class="icon-btn" data-click="agendaStep" data-value="1" aria-label="${mode === 'week' ? 'Semana seguinte' : 'Mês seguinte'}">${icons.forward}</button>
      </div>
    </div>

    ${plan.moved.length ? html`<p class="notice" id="moved-notice">${movedMessage(plan.moved.length)}</p>` : ''}
    ${plan.overLimitDays.length ? html`<p class="notice">${overLimitMessage(plan.overLimitDays.length)}</p>` : ''}
    ${plan.moved.length || plan.overLimitDays.length ? html`<div style="height:12px"></div>` : ''}

    ${mode === 'week' ? weekView(appState, anchor, byDay, selected) : monthView(appState, anchor, byDay, done, selected)}
    ${dayDetail(appState, selected, byDay, done)}
  `;
}

export const agendaHandlers = {
  agendaMode(target) {
    app.ui.agendaMode = target.dataset.value;
    renderAll();
  },
  agendaStep(target) {
    const step = Number(target.dataset.value);
    const anchor = app.ui.agendaAnchor ?? app.today;
    const next = app.ui.agendaMode === 'week' ? addDays(anchor, step * 7) : addMonths(startOfMonth(anchor), step);
    app.ui.agendaAnchor = next;
    // Keep the day list in step with what's on screen.
    app.ui.selectedDay = app.ui.agendaMode === 'week' ? startOfWeek(next) : next;
    renderAll();
    document.querySelector(`[data-click="agendaStep"][data-value="${step}"]`)?.focus();
  },
  selectDay(target) {
    app.ui.selectedDay = target.dataset.value;
    renderAll();
    document.querySelector(`[data-click="selectDay"][data-value="${target.dataset.value}"]`)?.focus();
  },
};
