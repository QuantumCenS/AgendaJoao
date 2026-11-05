import { refreshPlan } from '../../core/actions.js';
import { localDay } from '../../core/dates.js';
import { buildIcs } from '../../core/ics.js';
import { dailyLimit, parseBackup, toBackup } from '../../core/model.js';
import { saveData } from '../../data/store.js';
import { app, applyTheme, commit, renderAll, toast } from '../app.js';
import { html } from '../html.js';
import { enableBackgroundChecks, permissionState, requestPermission } from '../notifications.js';
import { downloadFile } from '../shared.js';

const permissionNote = {
  unsupported: 'Este browser não tem notificações.',
  denied: 'As notificações estão bloqueadas nas definições do browser.',
  default: 'O browser vai pedir autorização quando ligares um lembrete.',
  granted: '',
};

function timeField(id, label, key, value, disabled) {
  return html`
    <div class="field">
      <label for="${id}">${label}</label>
      <input id="${id}" type="time" value="${value}" data-change="setting" data-key="${key}" ${disabled ? 'disabled' : ''}>
    </div>`;
}

function numberField(id, label, key, value, hint) {
  return html`
    <div class="field">
      <label for="${id}">${label}</label>
      <input id="${id}" type="number" min="0" max="999" inputmode="numeric" value="${value}" data-change="setting" data-key="${key}" data-type="number">
      ${hint ? html`<span class="hint">${hint}</span>` : ''}
    </div>`;
}

function installSection(ui) {
  if (window.matchMedia('(display-mode: standalone)').matches) return '';
  return html`
    <section class="card settings-group" aria-labelledby="set-install">
      <h2 id="set-install">Instalar a app</h2>
      ${ui.installPrompt
        ? html`<button type="button" class="btn btn-primary" data-click="installApp">Instalar o Recall neste dispositivo</button>`
        : html`<p class="small muted" id="install-help">No Android, abre o menu do Chrome e escolhe “Instalar app”. No PC, usa o ícone de instalação na barra de endereço do Chrome ou do Edge.</p>`}
    </section>`;
}

export function renderSettings({ data, ui }) {
  const s = data.settings;
  const limit = dailyLimit(s);
  const permission = permissionState();
  return html`
    <header class="page-head"><h1>Definições</h1></header>

    <div class="stack">
      ${installSection(ui)}

      <section class="card settings-group" aria-labelledby="set-limit">
        <h2 id="set-limit">Limite diário</h2>
        <div class="field-row">
          ${numberField('max-reviews', 'Máximo de revisões', 'maxReviews', s.maxReviews, '0 para sem limite')}
          ${numberField('max-minutes', 'Máximo de minutos', 'maxMinutes', s.maxMinutes, '0 para sem limite')}
          ${numberField('per-review', 'Minutos por revisão', 'minutesPerReview', s.minutesPerReview, 'Usado nas estimativas')}
        </div>
        <p class="small muted" id="limit-summary">${limit === Infinity
          ? 'Sem limite diário.'
          : `Até ${limit} ${limit === 1 ? 'revisão' : 'revisões'} por dia. Quando um dia passa disso, as revisões com intervalos longos movem-se 1 a 2 dias.`}</p>
      </section>

      <section class="card settings-group" aria-labelledby="set-time">
        <h2 id="set-time">Hora de estudo</h2>
        ${timeField('preferred-time', 'Hora preferida (opcional)', 'preferredTime', s.preferredTime, false)}
        <p class="small muted">Sem hora escolhida, as revisões são tarefas para o dia todo.</p>
      </section>

      <section class="card settings-group" aria-labelledby="set-reminders">
        <h2 id="set-reminders">Lembretes</h2>
        <label class="check"><input type="checkbox" id="daily-reminder" data-change="reminderToggle" data-key="dailyReminder" ${s.dailyReminder ? 'checked' : ''}> Lembrete diário</label>
        ${timeField('daily-time', 'Hora do lembrete diário', 'dailyTime', s.dailyTime, !s.dailyReminder)}
        <label class="check"><input type="checkbox" id="evening-reminder" data-change="reminderToggle" data-key="eveningReminder" ${s.eveningReminder ? 'checked' : ''}> Lembrete à noite, só se ainda houver revisões</label>
        ${timeField('evening-time', 'Hora do lembrete à noite', 'eveningTime', s.eveningTime, !s.eveningReminder)}
        <div class="field-row">
          ${timeField('quiet-start', 'Silêncio a partir das', 'quietStart', s.quietStart, false)}
          ${timeField('quiet-end', 'Silêncio até às', 'quietEnd', s.quietEnd, false)}
        </div>
        ${permissionNote[permission] ? html`<p class="notice" id="permission-note">${permissionNote[permission]}</p>` : ''}
        <p class="small muted">Com a app aberta, o lembrete chega à hora certa. Com ela fechada, só no Android com a app instalada, e a hora é aproximada, porque quem decide é o sistema. No iPhone, só com a app aberta.</p>
      </section>

      <section class="card settings-group" aria-labelledby="set-theme">
        <h2 id="set-theme">Aspeto</h2>
        <div class="field">
          <label for="theme">Tema</label>
          <select id="theme" data-change="setting" data-key="theme">
            ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([value, label]) => html`
              <option value="${value}" ${s.theme === value ? 'selected' : ''}>${label}</option>`)}
          </select>
        </div>
      </section>

      <section class="card settings-group" aria-labelledby="set-data">
        <h2 id="set-data">Os teus dados</h2>
        <p class="small muted">Tudo fica guardado neste dispositivo, e nada é enviado para lado nenhum. O PC e o telemóvel têm cada um os seus dados: para passar de um para o outro, exporta um backup e importa-o no outro, o que substitui o que lá estiver. Se limpares os dados do browser, perdes-os, por isso faz um backup de vez em quando.</p>
        <div class="actions-row">
          <button type="button" class="btn" data-click="exportIcs">Exportar calendário (.ics)</button>
          <button type="button" class="btn" data-click="exportJson">Exportar backup (JSON)</button>
          <label class="btn file-btn">Importar backup (JSON)
            <input type="file" id="import-file" accept="application/json,.json" data-change="importJson">
          </label>
        </div>
        <p class="error" id="import-error" role="alert" hidden></p>
        <label class="check"><input type="checkbox" id="ics-alarm" data-change="setting" data-key="icsAlarm" ${s.icsAlarm ? 'checked' : ''}> Incluir um alarme por dia no calendário</label>
        <p class="small muted">O ficheiro .ics mostra o plano no momento em que o exportas, por isso volta a exportá-lo quando o plano mudar. O alarme toca à hora preferida ou à do lembrete diário. O Google Calendar pode ignorar alarmes de ficheiros importados: nesse caso, define uma notificação no próprio calendário.</p>
      </section>
    </div>
  `;
}

function readSettingValue(target) {
  if (target.type === 'checkbox') return target.checked;
  if (target.dataset.type !== 'number') return target.value;
  const value = Number(target.value);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

export const settingsHandlers = {
  async setting(target) {
    const { key } = target.dataset;
    let value = readSettingValue(target);
    // At least 1 minute per review, or the time estimates and limit stop making sense.
    if (key === 'minutesPerReview') value = Math.max(1, value);
    // Reminder and quiet-hour times can't be blank; only the preferred time can.
    if (target.type === 'time' && key !== 'preferredTime' && !value) {
      target.value = app.data.settings[key];
      return;
    }
    await commit((data) => { data.settings[key] = value; }, { render: key === 'theme' || target.dataset.type === 'number' });
    if (key === 'theme') applyTheme(value);
    document.getElementById(target.id)?.focus();
  },

  async reminderToggle(target) {
    const { key } = target.dataset;
    if (target.checked) {
      const permission = await requestPermission();
      if (permission === 'granted') enableBackgroundChecks();
    }
    await commit((data) => { data.settings[key] = target.checked; });
    document.getElementById(target.id)?.focus();
  },

  async installApp() {
    const prompt = app.ui.installPrompt;
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    app.ui.installPrompt = null;
    renderAll();
  },

  exportIcs() {
    const content = buildIcs(app.data, app.plan);
    downloadFile(`recall-revisoes-${app.today}.ics`, content, 'text/calendar;charset=utf-8');
    toast('Calendário exportado.');
  },

  exportJson() {
    const content = JSON.stringify(toBackup(app.data), null, 2);
    downloadFile(`recall-backup-${app.today}.json`, content, 'application/json');
    toast('Backup exportado.');
  },

  async importJson(target) {
    const [file] = target.files;
    if (!file) return;
    const errorEl = document.getElementById('import-error');
    const fail = (message) => {
      errorEl.textContent = message;
      errorEl.hidden = false;
      target.value = '';
    };

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return fail('Este ficheiro não é um JSON válido.');
    }
    const { data, error } = parseBackup(parsed);
    if (error) return fail(error);

    const replace = window.confirm(
      `Substituir os dados atuais por este backup (${data.subjects.length} disciplinas, ${data.topics.length} tópicos)? Os dados atuais deixam de existir.`,
    );
    if (!replace) {
      target.value = '';
      return undefined;
    }

    app.data = data;
    app.today = localDay();
    app.plan = refreshPlan(app.data, app.today);
    await saveData(app.data);
    applyTheme(app.data.settings.theme);
    Object.assign(app.ui.draft, { subjectId: null });
    renderAll();
    toast('Backup importado.');
    return undefined;
  },
};
