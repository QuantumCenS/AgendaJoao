import { addSubject, logStudy } from '../../core/actions.js';
import { savedMessage } from '../../core/copy.js';
import { NOTES_MAX, SUBJECT_COLORS, TOPIC_MAX } from '../../core/model.js';
import { app, commit, renderAll } from '../app.js';
import { html } from '../html.js';

const COLOR_NAMES = {
  teal: 'Verde-azulado', blue: 'Azul', violet: 'Violeta', rose: 'Rosa', amber: 'Âmbar', green: 'Verde', slate: 'Cinza', coral: 'Coral',
};

// The first colour no subject is using yet, so a new subject stands out.
export const nextFreeColor = (data) =>
  SUBJECT_COLORS.find((c) => !data.subjects.some((s) => s.color === c)) ?? SUBJECT_COLORS[0];

export function colorSwatches(selected, action) {
  return html`
    <div class="swatches" role="group" aria-label="Cor da disciplina">
      ${SUBJECT_COLORS.map((color) => html`
        <button type="button" class="swatch" data-color="${color}" data-click="${action}" data-value="${color}"
          aria-pressed="${String(color === selected)}" aria-label="${COLOR_NAMES[color]}"></button>`)}
    </div>`;
}

export function renderAdd({ data, ui, today }) {
  const { draft } = ui;
  const subjectId = draft.subjectId ?? data.subjects.at(-1)?.id ?? null;
  const showNewSubject = draft.newSubject || data.subjects.length === 0;
  const color = draft.subjectColor ?? nextFreeColor(data);

  return html`
    <header class="page-head">
      <h1>Adicionar estudo</h1>
      <p>O que estudaste? A app trata das revisões.</p>
    </header>

    <form class="card stack" data-submit="saveStudy" novalidate>
      <div class="field">
        <span class="label" id="subject-label">Disciplina</span>
        ${data.subjects.length ? html`
          <div class="chips" role="group" aria-labelledby="subject-label">
            ${data.subjects.map((s) => html`
              <button type="button" class="subject-chip" data-click="pickSubject" data-value="${s.id}" aria-pressed="${String(!showNewSubject && s.id === subjectId)}">
                <span class="dot" data-color="${s.color}"></span>${s.name}
              </button>`)}
            <button type="button" class="subject-chip" data-click="toggleNewSubject" aria-pressed="${String(showNewSubject)}">+ Nova</button>
          </div>` : ''}
        ${showNewSubject ? html`
          <div class="stack" style="margin-top:6px">
            <div class="field">
              <label for="subject-name">Nome da disciplina</label>
              <input id="subject-name" type="text" maxlength="60" autocomplete="off" value="${draft.subjectName}" data-input="draftField" data-field="subjectName">
            </div>
            ${colorSwatches(color, 'pickColor')}
          </div>` : ''}
      </div>

      <div class="field">
        <label for="topic">Tópico</label>
        <input id="topic" type="text" required maxlength="${TOPIC_MAX}" autocomplete="off" autofocus
          placeholder="Ex.: Herança e polimorfismo" value="${draft.title}" data-input="draftField" data-field="title">
      </div>

      <div class="field">
        <label for="notes">Notas ou link <span class="muted" style="font-weight:400">(opcional)</span></label>
        <textarea id="notes" maxlength="${NOTES_MAX}" data-input="draftField" data-field="notes">${draft.notes}</textarea>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="studied-on">Data do estudo</label>
          <input id="studied-on" type="date" max="${today}" value="${draft.studiedOn ?? today}" data-input="draftField" data-field="studiedOn">
        </div>
        <div class="field">
          <label for="duration">Minutos <span class="muted" style="font-weight:400">(opcional)</span></label>
          <input id="duration" type="number" min="1" max="1440" inputmode="numeric" value="${draft.durationMin}" data-input="draftField" data-field="durationMin">
        </div>
      </div>

      ${draft.error ? html`<p class="error" role="alert">${draft.error}</p>` : ''}

      <button class="btn btn-primary btn-wide" type="submit">Guardar</button>
    </form>
  `;
}

export const addHandlers = {
  draftField(target) {
    app.ui.draft[target.dataset.field] = target.value;
  },
  pickSubject(target) {
    Object.assign(app.ui.draft, { subjectId: target.dataset.value, newSubject: false, error: '' });
    renderAll();
    document.getElementById('topic')?.focus();
  },
  toggleNewSubject() {
    app.ui.draft.newSubject = !app.ui.draft.newSubject;
    renderAll();
    document.getElementById(app.ui.draft.newSubject ? 'subject-name' : 'topic')?.focus();
  },
  pickColor(target) {
    app.ui.draft.subjectColor = target.dataset.value;
    renderAll();
  },
  async saveStudy() {
    const { draft } = app.ui;
    const { data, today } = app;
    const creating = draft.newSubject || data.subjects.length === 0;

    // Checked up front so a failed save doesn't leave a new subject behind.
    if (creating && !draft.subjectName.trim()) return showError('Dá um nome à disciplina.');
    const preview = structuredClone(data);
    try {
      const subject = creating
        ? addSubject(preview, { name: draft.subjectName, color: draft.subjectColor ?? nextFreeColor(data) }, 'preview')
        : { id: draft.subjectId ?? data.subjects.at(-1).id };
      logStudy(preview, { ...draft, subjectId: subject.id, studiedOn: draft.studiedOn ?? today }, today);
    } catch (error) {
      return showError(error.message);
    }

    const keptSubjectId = await commit((d) => {
      const subject = creating
        ? addSubject(d, { name: draft.subjectName, color: draft.subjectColor ?? nextFreeColor(d) })
        : { id: draft.subjectId ?? d.subjects.at(-1).id };
      const topic = logStudy(d, { ...draft, subjectId: subject.id, studiedOn: draft.studiedOn ?? today }, today);
      Object.assign(draft, {
        subjectId: subject.id, title: '', notes: '', studiedOn: null, durationMin: '', newSubject: false, subjectName: '', subjectColor: null, error: '',
      });
      return topic;
    }, {
      message: (topic, plan) => savedMessage(plan.next.get(topic.id)?.date ?? null, today),
    });
    document.getElementById('topic')?.focus();
    return keptSubjectId;
  },
};

function showError(message) {
  app.ui.draft.error = message;
  renderAll();
  document.querySelector('.error')?.scrollIntoView({ block: 'nearest' });
}
