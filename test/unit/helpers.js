import { emptyData } from '../../src/core/model.js';
import { addSubject, logStudy } from '../../src/core/actions.js';

export function makeData(settings = {}) {
  const data = emptyData();
  Object.assign(data.settings, settings);
  addSubject(data, { name: 'POO', color: 'teal' }, 'poo');
  addSubject(data, { name: 'Cálculo', color: 'blue' }, 'calc');
  return data;
}

let counter = 0;
export function addTopic(data, studiedOn, subjectId = 'poo', title) {
  counter += 1;
  const id = `t${String(counter).padStart(5, '0')}`;
  return logStudy(data, { subjectId, title: title ?? `Tópico ${id}`, studiedOn }, studiedOn, new Date(`${studiedOn}T10:00:00Z`), id);
}

export const dates = (plan, topicId) => plan.items.filter((it) => it.topicId === topicId).map((it) => it.date);
