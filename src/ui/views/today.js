import { spreadOverdue } from '../../core/actions.js';
import { READINESS_DAYS, examReadiness, todaySummary, upcomingExams } from '../../core/stats.js';
import { examCountdown, longDate, overLimitMessage, readinessLine, reviewsCount, spreadMessage, todayLine } from '../../core/copy.js';
import { app, commit } from '../app.js';
import { html } from '../html.js';
import { reviewRow, subjectOf } from '../shared.js';

function examStrip({ data, today }) {
  const exams = upcomingExams(data, today).slice(0, 2);
  return exams.map((exam) => {
    const subject = subjectOf(data, exam.subjectId);
    const ready = examReadiness(data, exam, today);
    return html`
      <a class="card subject-card" href="#/subject/${encodeURIComponent(subject.id)}">
        <div class="exam-head">
          <span class="group-title" style="margin:0"><span class="dot" data-color="${subject.color}"></span><strong>Exame de ${subject.name}</strong></span>
          <span class="exam-countdown">${examCountdown(ready.daysLeft)}</span>
        </div>
        <div class="small muted">${readinessLine(ready.reviewed, ready.total, READINESS_DAYS)}</div>
      </a>`;
  });
}

export function renderToday(appState) {
  const { data, plan, route, today } = appState;
  const summary = todaySummary(data, plan);
  const { preferredTime } = data.settings;
  const headline = summary.count
    ? todayLine(summary.count, summary.minutes) + (preferredTime ? ` · às ${preferredTime}` : '')
    : summary.doneToday
      ? `Feito por hoje: ${reviewsCount(summary.doneToday)}.`
      : '';

  return html`
    <header class="page-head">
      <h1>Hoje</h1>
      <p><span id="today-line">${headline}</span>${headline ? html` · ` : ''}<span class="small">${longDate(today)}</span></p>
    </header>

    ${summary.overLimit ? html`
      <div class="notice" style="margin-bottom:14px">
        <p>Hoje há mais do que o teu limite de ${plan.limit}. Faz o que der: o resto fica aqui.</p>
        ${summary.overdue ? html`<button type="button" class="btn btn-small" style="margin-top:8px" data-click="spreadOverdue">Espalhar atrasos pelos próximos dias</button>` : ''}
      </div>` : ''}

    ${summary.count === 0
      ? html`
        <div class="card empty">
          ${summary.doneToday
            ? html`<p>Tudo revisto por hoje. Até amanhã.</p>`
            : html`<p>Nada para rever hoje. Regista o que estudaste e a app planeia as revisões.</p>`}
          <a class="btn btn-primary" href="#/add">Adicionar estudo</a>
        </div>`
      : html`
        <div class="stack">
          ${summary.groups.map((group) => html`
            <section aria-label="${group.subject.name}">
              <h2 class="group-title"><span class="dot" data-color="${group.subject.color}"></span>${group.subject.name}
                <span class="small muted" style="font-weight:400">${group.items.length}</span></h2>
              <ul class="review-list">
                ${group.items.map((item) => reviewRow({ item, data, route, today, activeId: route.reviewId, showSubject: false }))}
              </ul>
            </section>`)}
        </div>`}

    ${plan.overLimitDays.length ? html`<p class="notice" style="margin-top:14px">${overLimitMessage(plan.overLimitDays.length)}</p>` : ''}

    ${data.exams.some((e) => e.date >= today) ? html`
      <section class="section" aria-label="Exames">
        <h2>Exames</h2>
        <div class="stack">${examStrip(appState)}</div>
      </section>` : ''}
  `;
}

export const todayHandlers = {
  async spreadOverdue() {
    // Kept for the undo button, which puts every topic back where it was.
    const before = new Map(app.data.topics.map((t) => [t.id, t.srs]));
    let moved = 0;
    await commit((data) => {
      ({ moved } = spreadOverdue(data, app.plan, app.today));
    }, {
      message: () => spreadMessage(moved),
      action: {
        label: 'Anular',
        run: () => commit((data) => {
          for (const topic of data.topics) {
            if (before.has(topic.id)) topic.srs = before.get(topic.id);
          }
        }, { message: 'Atrasos de volta a hoje.', mentionMoves: false }),
      },
    });
  },
};
