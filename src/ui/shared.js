// Small pieces of markup used by more than one screen.

import { relativeDay, shortDate } from '../core/copy.js';
import { html } from './html.js';

export const subjectOf = (data, id) => data.subjects.find((s) => s.id === id);
export const topicOf = (data, id) => data.topics.find((t) => t.id === id);

// Links back to the current screen with a review open on top of it.
export const reviewHref = (route, topicId) => `#/${route.path}?r=${encodeURIComponent(topicId)}`;

export function itemChips(item, today) {
  return html`
    ${item.overdue ? html`<span class="chip chip-overdue">Em atraso · ${relativeDay(item.date, today)}</span>` : ''}
    ${item.moved ? html`<span class="chip">Movida de ${shortDate(item.originalDate)}</span>` : ''}
    ${item.packed ? html`<span class="chip chip-accent">Para o exame</span>` : ''}
    ${item.index > 0 ? html`<span class="chip">Prevista</span>` : ''}
  `;
}

export function reviewRow({ item, data, route, today, activeId, showSubject = true }) {
  const topic = topicOf(data, item.topicId);
  const subject = subjectOf(data, item.subjectId);
  return html`
    <li>
      <a class="review-row" data-color="${subject.color}" href="${reviewHref(route, topic.id)}" aria-current="${String(activeId === topic.id)}">
        <div>
          <div class="title">${topic.title}</div>
          <div class="meta">
            ${showSubject ? html`<span>${subject.name}</span>` : ''}
            ${itemChips(item, today)}
          </div>
        </div>
      </a>
    </li>
  `;
}

// One segment per subject, sized by how many reviews it has that day.
export function subjectBar(items, data) {
  const counts = new Map();
  for (const it of items) counts.set(it.subjectId, (counts.get(it.subjectId) ?? 0) + 1);
  return html`
    <span class="bar" aria-hidden="true">
      ${data.subjects
        .filter((s) => counts.has(s.id))
        .map((s) => html`<span data-color="${s.color}" style="flex:${counts.get(s.id)}"></span>`)}
    </span>
  `;
}

export function daySummaryLabel(items, data) {
  const counts = new Map();
  for (const it of items) counts.set(it.subjectId, (counts.get(it.subjectId) ?? 0) + 1);
  return data.subjects
    .filter((s) => counts.has(s.id))
    .map((s) => `${s.name}: ${counts.get(s.id)}`)
    .join(', ');
}

// Saves a generated file through the browser's normal download.
export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
