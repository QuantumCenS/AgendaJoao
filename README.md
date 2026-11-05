# Recall

Agenda de estudo com repetição espaçada. Registas o que estudaste e a app marca as revisões na agenda. Depois de cada revisão dizes como correu, e a data seguinte ajusta-se.

É uma PWA sem servidor de dados: tudo fica no IndexedDB do teu browser e nada é enviado para terceiros.

## Como correr

Precisas de Node.js 20 ou mais recente. A app não tem dependências em runtime nem passo de build.

```bash
npm start
```

Abre <http://127.0.0.1:5173>.

| Variável | Predefinição | Para quê |
| --- | --- | --- |
| `PORT` | `5173` | Porta do servidor local |
| `HOST` | `127.0.0.1` | Interface do servidor local |
| `BASE_PATH` | (vazio) | Serve a app numa subpasta, por exemplo `/recall` |

Há um `.env.example` só como referência: o `npm start` não lê ficheiros `.env`, por isso define as variáveis na shell.

### Usar no PC e no Android

A app é a mesma nos dois: abre o endereço publicado no Chrome.

- **Android:** menu do Chrome > **Instalar app**.
- **PC:** ícone de instalação na barra de endereço do Chrome ou do Edge.

Cada dispositivo guarda os seus dados. Para os passar de um para o outro, usa **Definições > Exportar backup** num e **Importar backup** no outro. Importar substitui o que lá estiver.

### Publicar no GitHub Pages

1. Cria um repositório vazio no GitHub.
2. Envia o código: `git remote add origin <url>` e depois `git push -u origin main`.
3. No repositório, abre **Settings > Pages**, escolhe **Deploy from a branch**, depois **main** e **/ (root)**.
4. Passados uns minutos, a app fica em `https://<utilizador>.github.io/<repositório>/`.

Para experimentar localmente numa subpasta, como no GitHub Pages, corre o servidor com `BASE_PATH=/recall` e abre `/recall/`.

### Dados de exemplo

```bash
npm run seed
```

Cria `seed/recall-exemplo.json`, com 3 disciplinas, 23 tópicos, histórico de revisões e 1 exame, com datas à volta de hoje. Depois importa-o na app, em **Definições > Importar backup**. Isto substitui os dados atuais.

## Testes

```bash
npm install        # só para os testes E2E (playwright-core)
npm test           # unitários, sem browser
npm run test:e2e   # app real no Chrome instalado, com relógio simulado
npm run test:all   # os dois
```

Os testes E2E usam o Google Chrome instalado na máquina.

## Algoritmo

SM-2 adaptado a uma escada fixa, em `src/core/srs.js`. Fica atrás de uma interface com três funções (`init`, `rate`, `project`), por isso trocá-lo por FSRS só exige outro objeto com a mesma forma.

- **Escada:** 1, 3, 7, 14, 30 e 60 dias desde o estudo, ou seja, intervalos de 1, 2, 4, 7, 16 e 30 dias. Depois, os intervalos duplicam (60, 120, 240) até um máximo de 365.
- **Facilidade (EF):** começa em 2.5, com mínimo de 1.3. A atualização é `EF' = EF + 0.1 − (5−q)(0.08 + (5−q)·0.02)`, com q = 2, 3, 4, 5 para De novo, Difícil, Bom e Fácil.

| Avaliação | Próximo intervalo | Escada |
| --- | --- | --- |
| De novo | 1 dia | volta ao início |
| Difícil | `max(atual + 1, atual × 1.2)`, sempre abaixo de Bom quando possível | fica no mesmo degrau |
| Bom | `degrau seguinte × EF / 2.5`, nunca menos que o atual | avança |
| Fácil | `max(Bom + 1, Bom × 1.5)` | avança |

Exemplo, para um tópico estudado a 5 nov, sempre com Bom: 6, 8, 12 e 19 nov, 5 dez, 4 jan. O intervalo conta sempre a partir do dia em que a revisão foi mesmo feita.

## Como o plano é calculado

As revisões futuras não são gravadas. `planAgenda(dados, hoje)`, em `src/core/planner.js`, é uma função pura que as calcula em três camadas:

1. **Tópico.** Só a próxima revisão fica pendente. Se estiver atrasada, mantém-se em Hoje, e as seguintes são previstas a partir de hoje, por isso não há acumulação.
2. **Exames.** Corta as revisões a partir do dia do exame, exceto com "Manter revisões depois do exame". Se um tópico não tiver revisão na semana anterior (E−7 a E−1), ganha uma, no dia menos carregado dessa janela.
3. **Balanceamento.** Move revisões de dias futuros acima do limite para dias próximos: 0 dias para intervalos abaixo de 7, ±1 de 7 a 29, ±2 a partir de 30. Nunca mexe em hoje nem em atrasos, nunca sai da janela do exame e nunca mexe numa revisão adiada. Se um dia não couber no limite, a app diz isso.

Cada tópico guarda só o dia atribuído à próxima revisão (`srs.due`), para ela não mudar de dia quando esse dia chega.

**Datas.** Os instantes (`doneAt`, `createdAt`) são ISO em UTC. Os dias de calendário são `YYYY-MM-DD`, com contas em UTC, por isso a mudança de hora nunca acrescenta nem tira um dia. "Hoje" vem do fuso do dispositivo.

## Estrutura

```
src/core/     Regras, sem browser: srs, planner, actions, stats, reminders, ics, copy, dates, model
src/data/     IndexedDB
src/ui/       Interface: shell, ecrãs, notificações
sw.js         Offline e lembretes em segundo plano
scripts/      Servidor local e seed
test/unit/    Testes das regras
test/e2e/     Testes da app real no Chrome
```

## Limitações

- **Lembretes com a app fechada.** Sem servidor de push, uma PWA não consegue garantir a hora exata. Com a app aberta, o lembrete chega à hora. Com ela fechada, só no Chromium/Android com a app instalada, a uma hora aproximada escolhida pelo sistema. No iPhone, só com a app aberta.
- **Dados por dispositivo.** Não há sincronização entre dispositivos. Limpar os dados do browser apaga tudo, por isso convém exportar backups.
- **Duas abas abertas.** A última a gravar ganha.
- **Alarmes no .ics.** O ficheiro é uma fotografia do plano, por isso tem de ser exportado de novo quando o plano muda. Há relatos de o Google Calendar ignorar alarmes em ficheiros importados; nesse caso, define uma notificação no próprio calendário.
