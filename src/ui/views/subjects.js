import { addExam, addSubject, removeExam, setExamKeepAfter } from '../../core/actions.js';
import { examCountdown, longDate, readinessLine, relativeDay, reviewsCount, shortDate, topicsCount } from '../../core/copy.js';
import { addDays } from '../../core/dates.js';
import { isPausedByExam } from '../../core/planner.js';
import { READINESS_DAYS, examReadiness, heatmap, subjectStats } from '../../core/stats.js';
import { app, commit, renderAll } from '../app.js';
import { html } from '../html.js';
import { reviewHref, subjectOf } from '../shared.js';
import { colorSwatches, nextFreeColor } from './add.js';

function statBlock(stats) {
  const cell = (value, label) => html`<div class="stat"><strong>${value}</strong><span>${label}</span></div>`;
  return html`
    <div class="stats">
      ${cell(stats.topics, 'tópicos')}
      ${cell(stats.reviewsThisWeek, 'revisões esta semana')}
      ${cell(stats.overdue, 'em atraso')}
      ${cell(stats.mastered, 'dominados')}
    </div>`;
}

export function examCard(appState, exam) {
  const { data, today } = appState;
  const subject = subjectOf(data, exam.subjectId);
  const ready = examReadiness(data, exam, today);
  const finished = exam.date < today;
  return html`
    <div class="card" data-exam="${exam.id}">
      <div class="exam-head">
        <span class="group-title" style="margin:0"><span class="dot" data-color="${subject.color}"></span><strong>${subject.name}</strong></span>
        <span class="exam-countdown">${examCountdown(ready.daysLeft)}</span>
      </div>
      <div class="small muted">${longDate(exam.date)}</div>
      ${finished ? '' : html`
        <div class="progress" role="progressbar" aria-label="Preparação para o exame" aria-valuemin="0" aria-valuemax="${ready.total}" aria-valuenow="${ready.reviewed}">
          <span style="width:${Math.round(ready.share * 100)}%"></span>
        </div>
        <div class="small readiness">${readinessLine(ready.reviewed, ready.total, READINESS_DAYS)}</div>`}
      <div class="exam-actions">
        <label class="check small">
          <input type="checkbox" data-change="toggleKeepAfter" data-exam-id="${exam.id}" ${exam.keepAfter ? 'checked' : ''}>
          Manter revisões depois do exame
        </label>
        <button type="button" class="btn btn-ghost btn-small" data-click="deleteExam" data-exam-id="${exam.id}">Remover exame</button>
      </div>
    </div>`;
}

function examForm({ data, ui, today }, fixedSubjectId) {
  if (data.subjects.length === 0) return '';
  return html`
    <form class="card stack" data-submit="saveExam" novalidate>
      <h3>Adicionar exame</h3>
      <div class="field-row">
        ${fixedSubjectId
          ? html`<input type="hidden" name="subjectId" value="${fixedSubjectId}">`
          : html`
            <div class="field">
              <label for="exam-subject">Disciplina</label>
              <select id="exam-subject" name="subjectId">
                ${data.subjects.map((s) => html`<option value="${s.id}">${s.name}</option>`)}
              </select>
            </div>`}
        <div class="field">
          <label for="exam-date">Data</label>
          <input id="exam-date" name="date" type="date" min="${addDays(today, 1)}" required>
        </div>
      </div>
      <label class="check small"><input type="checkbox" name="keepAfter"> Manter revisões depois do exame</label>
      ${ui.examError ? html`<p class="error" role="alert">${ui.examError}</p>` : ''}
      <button class="btn btn-primary" type="submit">Guardar exame</button>
    </form>`;
}

function heatmapSection({ data, today }) {
  const map = heatmap(data, today);
  const level = (count) => (count === 0 ? 0 : Math.max(1, Math.ceil((count / map.peak) * 4)));
  return html`
    <section class="section" aria-labelledby="heat-title">
      <h2 id="heat-title">Revisões feitas</h2>
      <div class="card">
        <p class="small muted" id="heat-summary" style="margin-bottom:10px">${reviewsCount(map.total)} nas últimas ${map.weeks.length} semanas</p>
        <div class="heatmap-wrap" role="img" aria-labelledby="heat-summary">
          <div class="heatmap">
            ${map.weeks.map((week) => html`
              <div class="heat-week">
                ${week.map((cell) => html`
                  <div class="heat-cell ${cell.future ? 'is-future' : ''}" data-level="${level(cell.count)}" data-day="${cell.day}"
                    title="${cell.future ? '' : `${shortDate(cell.day)}: ${reviewsCount(cell.count)}`}"></div>`)}
              </div>`)}
          </div>
        </div>
      </div>
    </section>`;
}

export function renderSubjects(appState) {
  const { data, plan, ui, today } = appState;
  const color = ui.newSubjectColor ?? nextFreeColor(data);
  const exams = [...data.exams].sort((a, b) => (a.date < b.date ? -1 : 1));
  return html`
    <header class="page-head"><h1>Disciplinas</h1></header>

    ${data.subjects.length === 0 ? html`<div class="card empty"><p>Ainda sem disciplinas. Cria a primeira aqui ou ao adicionar estudo.</p></div>` : ''}
    <div class="stack">
      ${data.subjects.map((s) => html`
        <a class="card subject-card" href="#/subject/${encodeURIComponent(s.id)}" data-subject="${s.id}">
          <span class="group-title" style="margin:0"><span class="dot" data-color="${s.color}"></span><strong>${s.name}</strong></span>
          ${statBlock(subjectStats(data, plan, s.id))}
        </a>`)}
    </div>

    <form class="card stack section" data-submit="saveSubject" novalidate>
      <h3>Nova disciplina</h3>
      <div class="field">
        <label for="new-subject-name">Nome</label>
        <input id="new-subject-name" name="name" type="text" maxlength="60" autocomplete="off">
      </div>
      ${colorSwatches(color, 'pickNewSubjectColor')}
      <button class="btn" type="submit">Criar disciplina</button>
    </form>

    <section class="section" aria-labelledby="exam-title">
      <h2 id="exam-title">Exames</h2>
      <div class="stack">
        ${exams.map((exam) => examCard(appState, exam))}
        ${examForm({ data, ui, today })}
      </div>
    </section>

    ${heatmapSection(appState)}
  `;
}

export function renderSubject(appState) {
  const { data, plan, route, ui, today } = appState;
  const subject = subjectOf(data, route.id);
  if (!subject) {
    return html`<div class="card empty"><p>Esta disciplina já não existe.</p><a class="btn" href="#/subjects">Ver disciplinas</a></div>`;
  }
  const topics = data.topics.filter((t) => t.subjectId === subject.id);
  const exams = data.exams.filter((e) => e.subjectId === subject.id).sort((a, b) => (a.date < b.date ? -1 : 1));

  const when = (topic) => {
    if (topic.masteredOn) return 'Dominado';
    if (isPausedByExam(topic, data.exams, today)) return 'Terminado com o exame';
    const next = plan.next.get(topic.id);
    if (!next) return 'Sem mais revisões';
    return next.overdue ? `Em atraso · ${relativeDay(next.date, today)}` : shortDate(next.date);
  };

  return html`
    <header class="page-head">
      <h1 class="group-title" style="margin:0"><span class="dot" data-color="${subject.color}"></span>${subject.name}</h1>
      <p>${topicsCount(topics.length)}</p>
    </header>

    <div class="card">${statBlock(subjectStats(data, plan, subject.id))}</div>

    <section class="section" aria-labelledby="subject-exams">
      <h2 id="subject-exams">Exames</h2>
      <div class="stack">
        ${exams.map((exam) => examCard(appState, exam))}
        ${examForm({ data, ui, today }, subject.id)}
      </div>
    </section>

    <section class="section" aria-labelledby="subject-topics">
      <h2 id="subject-topics">Tópicos</h2>
      ${topics.length === 0
        ? html`<div class="card empty"><p>Ainda sem tópicos.</p><a class="btn btn-primary" href="#/add">Adicionar estudo</a></div>`
        : html`
          <ul class="card topic-list">
            ${topics.map((t) => html`
              <li><a class="topic-link" href="${reviewHref(route, t.id)}"><span>${t.title}</span><span class="when">${when(t)}</span></a></li>`)}
          </ul>`}
    </section>
  `;
}

export const subjectsHandlers = {
  pickNewSubjectColor(target) {
    app.ui.newSubjectColor = target.dataset.value;
    const name = document.getElementById('new-subject-name')?.value;
    renderAll();
    const input = document.getElementById('new-subject-name');
    if (input && name) input.value = name;
  },
  async saveSubject(form) {
    const name = new FormData(form).get('name');
    if (!String(name).trim()) {
      form.querySelector('input').focus();
      return;
    }
    const color = app.ui.newSubjectColor ?? nextFreeColor(app.data);
    app.ui.newSubjectColor = null;
    await commit((data) => addSubject(data, { name, color }), { message: 'Disciplina criada.' });
  },
  async saveExam(form) {
    const fields = new FormData(form);
    const exam = { subjectId: fields.get('subjectId'), date: fields.get('date'), keepAfter: fields.has('keepAfter') };
    try {
      await commit((data) => addExam(data, exam, app.today), {
        message: 'Exame guardado. As revisões foram ajustadas.',
      });
      app.ui.examError = '';
      renderAll();
    } catch (error) {
      app.ui.examError = error.message;
      renderAll();
    }
  },
  async toggleKeepAfter(target) {
    await commit((data) => setExamKeepAfter(data, target.dataset.examId, target.checked), {
      message: target.checked ? 'As revisões continuam depois do exame.' : 'As revisões param no dia do exame.',
    });
  },
  async deleteExam(target) {
    await commit((data) => removeExam(data, target.dataset.examId), { message: 'Exame removido. As revisões voltaram ao plano normal.' });
  },
};
