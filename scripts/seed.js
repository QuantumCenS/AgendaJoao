// Writes seed/recall-exemplo.json: sample subjects, topics, reviews and one exam,
// dated around today. Import it in the app under Definições > Importar backup.
// It goes through the same actions as the app, so the data follows the real rules.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addExam, addSubject, logStudy, rateReview, refreshPlan } from '../src/core/actions.js';
import { addDays, localDay } from '../src/core/dates.js';
import { emptyData, toBackup } from '../src/core/model.js';

const CATALOG = {
  'Programação Orientada por Objetos': {
    color: 'teal',
    topics: [
      'Classes e objetos', 'Encapsulamento', 'Herança e polimorfismo', 'Classes abstratas', 'Interfaces', 'Exceções em Java',
      'Coleções: List e Map', 'Genéricos', 'Padrão Strategy', 'Padrão Observer', 'Testes com JUnit', 'Streams e lambdas',
    ],
  },
  'Cálculo': {
    color: 'blue',
    topics: ['Limites', 'Derivadas', 'Regra da cadeia', 'Integrais definidas', 'Integração por partes', 'Séries de Taylor'],
  },
  'Física': {
    color: 'coral',
    topics: ['Leis de Newton', 'Trabalho e energia', 'Quantidade de movimento', 'Movimento harmónico', 'Campo elétrico'],
  },
};

export function buildSeed(today) {
  const data = emptyData();

  // Fixed sequence and topic ids, so the sample comes out the same every run.
  let topicNumber = 0;
  let state = 11;
  const random = (n) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % n;
  };
  const ratings = ['good', 'good', 'good', 'good', 'hard', 'easy', 'again'];

  const queue = Object.entries(CATALOG).flatMap(([name, { color, topics }]) => {
    const subject = addSubject(data, { name, color });
    return topics.map((title) => ({ subject, title }));
  });

  const start = addDays(today, -42);
  const gap = 42 / queue.length;
  queue.forEach((entry, i) => {
    entry.studiedOn = addDays(start, Math.floor(i * gap));
  });
  queue.sort((a, b) => (a.studiedOn < b.studiedOn ? -1 : 1));

  for (let day = start; day < today; day = addDays(day, 1)) {
    for (const entry of queue.filter((q) => q.studiedOn === day)) {
      topicNumber += 1;
      logStudy(data, {
        subjectId: entry.subject.id,
        title: entry.title,
        notes: entry.title === 'Herança e polimorfismo' ? 'Capítulo 3 do livro. Resumo: https://dev.java/learn/inheritance/' : '',
        studiedOn: day,
        durationMin: 30 + random(4) * 15,
      }, day, new Date(`${day}T15:00:00Z`), `topic-${topicNumber}`);
    }
    const plan = refreshPlan(data, day);
    for (const item of plan.items.filter((it) => it.index === 0 && it.date <= day)) {
      // A review gets skipped now and then, which leaves a few overdue ones today.
      if (random(6) !== 0) {
        rateReview(data, item.topicId, ratings[random(ratings.length)], day, new Date(`${day}T18:00:00Z`));
      }
    }
    refreshPlan(data, day);
  }

  addExam(data, { subjectId: data.subjects[0].id, date: addDays(today, 25) }, today);
  refreshPlan(data, today);
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const today = localDay();
  const data = buildSeed(today);
  const dir = new URL('../seed/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = new URL('recall-exemplo.json', dir);
  writeFileSync(file, JSON.stringify(toBackup(data), null, 2));
  console.log(`${data.subjects.length} disciplinas, ${data.topics.length} tópicos, ${data.reviewLog.length} revisões, ${data.exams.length} exame.`);
  console.log(`Escrito em ${fileURLToPath(file)}`);
  console.log('Importa-o na app, em Definições > Importar backup.');
}
