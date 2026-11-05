import {
  canUndoRating, deleteTopic, editTopic, markMastered, previewRatings, rateReview, resumeTopic, snoozeReview, undoLastRating,
} from '../../core/actions.js';
import { RATING_LABELS, longDate, nextReviewMessage, ratingHint, relativeDay, shortDate } from '../../core/copy.js';
import { addDays } from '../../core/dates.js';
import { NOTES_MAX, TOPIC_MAX } from '../../core/model.js';
import { isPausedByExam } from '../../core/planner.js';
import { RATINGS } from '../../core/srs.js';
import { app, closeReview, commit, renderAll } from '../app.js';
import { html, linkify } from '../html.js';
import { icons } from '../icons.js';
import { subjectOf, topicOf } from '../shared.js';

function ratingButtons(data, topic, today) {
  const preview = previewRatings(data, topic.id, today);
  return html`
    <div class="ratings">
      ${RATINGS.map((rating) => {
        const hint = ratingHint(preview[rating]);
        return html`
          <button type="button" class="rating rating-${rating}" data-click="rate" data-value="${rating}" data-topic="${topic.id}">
            <strong>${RATING_LABELS[rating]}</strong><span class="sep"> · </span><span class="hint">${hint}</span>
          </button>`;
      })}
    </div>`;
}

function scheduleFact(item, topic, today) {
  if (!item) return 'Sem mais revisões planeadas.';
  if (item.overdue) return `Em atraso desde ${shortDate(item.date)}. A próxima conta a partir do dia em que a fizeres.`;
  if (item.date === today) return 'Prevista para hoje.';
  return `Prevista para ${longDate(item.date)}. Se reveres agora, o plano ajusta-se.`;
}

function editForm({ data, ui, today }, topic) {
  const hasHistory = data.reviewLog.some((r) => r.topicId === topic.id);
  return html`
    <div class="pane-body">
      <div class="pane-scroll">
        <h1 tabindex="-1">Editar tópico</h1>
        <form class="stack" data-submit="saveEdit" data-topic="${topic.id}" novalidate>
          <div class="field">
            <label for="edit-subject">Disciplina</label>
            <select id="edit-subject" name="subjectId">
              ${data.subjects.map((s) => html`<option value="${s.id}" ${s.id === topic.subjectId ? 'selected' : ''}>${s.name}</option>`)}
            </select>
          </div>
          <div class="field">
            <label for="edit-title">Tópico</label>
            <input id="edit-title" name="title" type="text" required maxlength="${TOPIC_MAX}" autocomplete="off" value="${topic.title}">
          </div>
          <div class="field">
            <label for="edit-notes">Notas ou link</label>
            <textarea id="edit-notes" name="notes" maxlength="${NOTES_MAX}">${topic.notes}</textarea>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="edit-studied">Data do estudo</label>
              <input id="edit-studied" name="studiedOn" type="date" max="${today}" value="${topic.studiedOn}" ${hasHistory ? 'disabled' : ''}>
            </div>
            <div class="field">
              <label for="edit-duration">Minutos</label>
              <input id="edit-duration" name="durationMin" type="number" min="1" max="1440" inputmode="numeric" value="${topic.durationMin ?? ''}">
            </div>
          </div>
          ${hasHistory ? html`<p class="small muted">A data de estudo fica fixa depois da primeira revisão, porque o plano já parte das revisões feitas.</p>` : ''}
          ${ui.editError ? html`<p class="error" role="alert">${ui.editError}</p>` : ''}
          <button class="btn btn-primary btn-wide" type="submit">Guardar</button>
          <button class="btn btn-wide" type="button" data-click="cancelEdit">Cancelar</button>
        </form>
        <div class="danger-zone">
          <button class="btn btn-wide" type="button" data-click="deleteTopic" data-topic="${topic.id}">Apagar tópico</button>
        </div>
      </div>
    </div>
  `;
}

export function renderReview({ data, plan, route, ui, today }) {
  if (!route.reviewId) return html`<div class="pane-empty"><p>Escolhe uma revisão para a abrir aqui.</p></div>`;

  const topic = topicOf(data, route.reviewId);
  if (!topic) {
    return html`
      <div class="pane-body"><div class="pane-scroll">
        <button type="button" class="icon-btn pane-close" data-click="closeReview" aria-label="Voltar">${icons.back}</button>
        <p>Este tópico já não existe.</p>
      </div></div>`;
  }

  if (ui.editingTopic === topic.id) return editForm({ data, ui, today }, topic);

  const subject = subjectOf(data, topic.subjectId);
  const item = plan.next.get(topic.id);
  const paused = isPausedByExam(topic, data.exams, today);
  const examTomorrow = data.exams.some((e) => e.subjectId === topic.subjectId && e.date === addDays(today, 1));
  const history = data.reviewLog.filter((r) => r.topicId === topic.id);

  return html`
    <div class="pane-body">
      <div class="pane-scroll">
        <div class="pane-head">
          <button type="button" class="icon-btn pane-close" data-click="closeReview" aria-label="Voltar">${icons.back}</button>
          <button type="button" class="btn btn-small pane-edit" data-click="editTopic" data-topic="${topic.id}">Editar</button>
        </div>
        <div class="pane-subject"><span class="dot" data-color="${subject.color}"></span>${subject.name}</div>
        <h1 tabindex="-1">${topic.title}</h1>

        <div class="facts">
          <span>Estudado pela primeira vez a ${shortDate(topic.studiedOn)} (${relativeDay(topic.studiedOn, today)}).</span>
          ${history.length ? html`<span>${history.length === 1 ? 'Revisto 1 vez' : `Revisto ${history.length} vezes`}.</span>` : ''}
          ${topic.masteredOn
            ? html`<span>Marcado como dominado a ${shortDate(topic.masteredOn)}.</span>`
            : paused
              ? html`<span>As revisões terminaram com o exame.</span>`
              : html`<span>${scheduleFact(item, topic, today)}</span>`}
          ${item?.moved ? html`<span>Movida de ${shortDate(item.originalDate)} para respeitar o teu limite diário.</span>` : ''}
          ${item?.packed ? html`<span>Colocada na última semana antes do exame.</span>` : ''}
        </div>

        ${topic.notes ? html`<div class="notes">${linkify(topic.notes)}</div>` : ''}

        ${canUndoRating(data, topic.id) && !topic.masteredOn
          ? html`<div class="pane-links"><button type="button" class="btn btn-small" data-click="undoRating" data-topic="${topic.id}">Anular última avaliação</button></div>`
          : ''}
      </div>

      <div class="pane-actions">
        ${topic.masteredOn
          ? html`<button type="button" class="btn btn-wide" data-click="resume" data-topic="${topic.id}">Voltar a rever</button>`
          : paused
            ? html`<p class="small muted" style="text-align:center">Podes retomá-las na disciplina, em “Manter revisões depois do exame”.</p>`
            : html`
              <p class="question" id="rate-question">Como correu?</p>
              ${ratingButtons(data, topic, today)}
              <div class="secondary-actions">
                <button type="button" class="btn" data-click="snooze" data-topic="${topic.id}" ${examTomorrow ? 'disabled' : ''}>Adiar para amanhã</button>
                <button type="button" class="btn" data-click="master" data-topic="${topic.id}">Marcar como dominado</button>
              </div>
              ${examTomorrow ? html`<p class="small muted" style="margin-top:6px;text-align:center">O exame é amanhã, por isso hoje é o melhor dia.</p>` : ''}`}
      </div>
    </div>
  `;
}

const undoRating = (topicId) =>
  commit((data) => undoLastRating(data, topicId), { message: 'Avaliação anulada. A revisão voltou ao plano anterior.' });

function setEditing(topicId) {
  app.ui.editingTopic = topicId;
  app.ui.editError = '';
  renderAll();
  document.querySelector('#pane h1')?.focus();
}

export const reviewHandlers = {
  closeReview,
  async rate(target) {
    const { topic: topicId, value: rating } = target.dataset;
    const { today } = app;
    await commit((data) => rateReview(data, topicId, rating, today), {
      message: (_, plan) => nextReviewMessage(plan.next.get(topicId)?.date ?? null, today),
      render: false,
      action: { label: 'Anular', run: () => undoRating(topicId) },
    });
    closeReview();
  },
  async snooze(target) {
    await commit((data) => snoozeReview(data, target.dataset.topic, app.today), { message: 'Adiada para amanhã.', render: false });
    closeReview();
  },
  async master(target) {
    await commit((data) => markMastered(data, target.dataset.topic, app.today), {
      message: 'Dominado. Não volta a aparecer nas revisões.',
      render: false,
    });
    closeReview();
  },
  async resume(target) {
    await commit((data) => resumeTopic(data, target.dataset.topic, app.today), { message: 'De volta às revisões. Próxima amanhã.' });
  },
  async undoRating(target) {
    await undoRating(target.dataset.topic);
  },
  editTopic(target) {
    setEditing(target.dataset.topic);
  },
  cancelEdit() {
    setEditing(null);
  },
  async saveEdit(form) {
    const fields = Object.fromEntries(new FormData(form));
    try {
      await commit((data) => {
        editTopic(data, form.dataset.topic, fields, app.today);
        app.ui.editingTopic = null;
        app.ui.editError = '';
      }, { message: 'Guardado.' });
      document.querySelector('#pane h1')?.focus();
    } catch (error) {
      app.ui.editError = error.message;
      renderAll();
    }
  },
  async deleteTopic(target) {
    const { topic: topicId } = target.dataset;
    const { title } = topicOf(app.data, topicId);
    if (!window.confirm(`Apagar “${title}” e o seu histórico de revisões? Isto não se pode desfazer.`)) return;
    await commit((data) => {
      deleteTopic(data, topicId);
      app.ui.editingTopic = null;
    }, { message: 'Tópico apagado.', render: false });
    closeReview();
  },
};
