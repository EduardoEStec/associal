# API Painel: progresso das famílias, satisfação, alertas e relatórios (F6)

Complementa o Painel do Coordenador (`/api/painel`, só `COORDENADOR` e `ADMIN`; a `ASSISTENTE` recebe `403`). Proposta e decisões:
`docs/propostas/acompanhamento-e-satisfacao.md` (seções 7 e 10.5). Tudo passa por `clausulaUnidades` (e pelo `?unidadeId=` opcional,
que precisa estar entre as unidades do usuário, senão `403`). Período: `?inicio=AAAA-MM-DD&fim=AAAA-MM-DD` (mesma regra do painel de operação; padrão: mês corrente).
Código: `server/services/painel-familias.js` (agregações puras + consultas) e `relatorios-progresso.js` (relatório semestral).

## n mínimo e semáforos (decisão D13)

- **n mínimo** = configuração `pesquisa_n_minimo` (padrão 5). Abaixo dele só o **número absoluto** aparece: percentuais, nota geral (NPS), concordância e
  semáforo vêm `null` e `suficiente: false`. Vale por recorte (geral, cada unidade, cada dimensão, cada afirmação).
- **Semáforos** são **provisórios** (a validar com a coordenação) e editáveis em Administração > Configurações (migração `084_painel_semaforos.sql`; a coordenação também edita):
  - Progresso, por % de famílias que melhoraram: verde ≥ `semaforo_progresso_verde_pct` (50); amarelo ≥ `semaforo_progresso_amarelo_pct` (30); senão vermelho.
  - Satisfação: verde se NPS ≥ `semaforo_nps_verde` (50) **e** concordância ≥ `semaforo_concordancia_verde` (80%); vermelho se NPS < `semaforo_nps_amarelo` (0) **ou** concordância < `semaforo_concordancia_amarelo` (60%); senão amarelo.
  - Valores: `VERDE` (Bom), `AMARELO` (Atenção), `VERMELHO` (Crítico). A tela sempre mostra ícone e palavra, nunca só a cor.
- A tolerância do índice (`indice_tolerancia_pontos`, F5) continua definindo o que é "melhorou", "igual" e "piorou".

## `GET /api/painel/progresso`

```json
{ "periodo": { "inicio": "2026-07-01", "fim": "2026-12-31" }, "unidades": [ { "id": 1, "sigla": "BRA", "nome": "Brasilândia" } ],
  "tolerancia": 5, "nMinimo": 5, "semaforos": { "limiares": { "progressoVerde": 50, "progressoAmarelo": 30, "…": 0 }, "rotulos": { "VERDE": "Bom" } },
  "geral": { "n": 11, "melhoraram": 6, "iguais": 2, "pioraram": 3, "suficiente": true, "pctMelhoraram": 54.5, "pctIguais": 18.2, "pctPioraram": 27.3,
             "semaforo": "VERDE", "indiceMedioInicial": 34.5, "indiceMedioAtual": 53.1, "variacaoMedia": 18.6 },
  "dimensoes": [ { "codigo": "ALIMENTACAO", "nome": "Alimentação", "n": 11, "melhoraram": 6, "iguais": 0, "pioraram": 5, "pctMelhoraram": 54.5, "semaforo": "VERDE", "suficiente": true } ],
  "unidades": [ { "unidadeId": 1, "sigla": "BRA", "nome": "…", "n": 7, "…": 0, "indiceMedioInicial": 31.5, "indiceMedioAtual": 54.9, "porDimensao": [ ] } ],
  "distribuicao": { "n": 11, "faixas": [ { "faixa": "0 a 19", "n": 3 } ] },
  "metas": { "total": 7, "emAndamento": 2, "atingidas": 3, "naoAtingidas": 1, "canceladas": 1, "pctAtingidas": null, "familiasComMeta": 6,
             "porDimensao": [ ], "porUnidade": [ ] },
  "acompanhamentos": { "emAndamento": 13, "iniciados": 1, "concluidos": 0, "desligados": 0, "tempoMedioDias": null,
                       "contatos": { "total": 12, "familiasComContato": 8, "mediaPorFamilia": 1.5 } },
  "anterior": { "periodo": { "inicio": "2026-01-01", "fim": "2026-06-30" }, "geral": { "n": 0 } } }
```
- **Famílias comparadas**: acompanhamentos com **2 ou mais pontos** do índice (instantâneo `acompanhamento_indice`, F5) até o fim do período e cujo **último ponto** caiu dentro do período. Compara o primeiro ponto (inicial) com o último, com a tolerância. A comparação geral de cada família usa só as dimensões com nível nos dois pontos. Por dimensão, a família sem nível naquela dimensão fica de fora.
- `distribuicao`: o último ponto do índice geral de cada família com pontos no período, em 5 faixas.
- `metas`: **fotografia do fim do período** das metas definidas até essa data (meta encerrada depois do fim ainda conta como em andamento); `pctAtingidas` = atingidas ÷ (atingidas + não atingidas), só com pelo menos `nMinimo` metas encerradas.
- `acompanhamentos`: situação no período (concluídos e desligados **encerrados dentro do período**; tempo médio entre início e encerramento).
- `anterior`: o período imediatamente anterior, de mesma duração (mês e semestre fechados voltam o mesmo número de meses).
- Questionários concluídos antes da F5 sem instantâneo não entram até rodar `scripts/recalcular-indices.js`.

## `GET /api/painel/satisfacao`

```json
{ "periodo": { }, "unidades": [ ], "nMinimo": 5, "semaforos": { },
  "geral": { "respostas": 8, "recusas": 1, "suficiente": true, "nps": 25, "promotoras": 4, "neutras": 2, "detratoras": 2, "indice": 73, "concordancia": 65,
             "taxaRecusa": 11.1, "elegiveis": 13, "familiasComPesquisa": 9, "taxaCobertura": 69.2, "semaforo": "AMARELO" },
  "perguntas": [ { "codigo": "L6", "texto": "…", "n": 8, "suficiente": true, "concordancia": 50, "media": 3.2 } ],
  "unidades": [ { "unidadeId": 1, "sigla": "BRA", "respostas": 5, "recusas": 0, "nps": 20, "…": 0 } ],
  "comentarios": [ { "id": "12.T1", "pesquisaId": 12, "acompanhamentoId": 7, "unidadeId": 1, "sigla": "BRA", "data": "2026-10-19", "codigo": "T1",
                     "pergunta": "O que faz de melhor", "texto": "…" } ],
  "anterior": { "periodo": { }, "geral": { } } }
```
- Conta pesquisas `CONCLUIDA` e `RECUSADA` com `dataAplicacao` no período (as anuladas não entram). **NPS** = % promotoras − % detratoras; **concordância** = % das afirmações respondidas com 4 ou 5; **índice** = média das afirmações em 0 a 100.
- `taxaRecusa` = recusas ÷ famílias que receberam a pesquisa; `taxaCobertura` = famílias com pesquisa ÷ famílias em acompanhamento no período (`elegiveis`).
- `perguntas`: **da pior para a melhor** concordância (as sem n suficiente vão para o fim).
- `comentarios`: textos T1/T2 das pesquisas concluídas, **só para COORDENADOR e ADMIN** (os únicos perfis desta rota), sem os de pesquisa com `comentarioOculto`. Identificados só por unidade e data; `acompanhamentoId` e `pesquisaId` servem ao link para a ficha e ao botão "Ocultar nos relatórios" (`PUT /api/familias/acompanhamentos/:id/pesquisas/:pesquisaId/comentario-oculto`).

## `GET /api/painel/alertas` (ampliado)

Além de `questionariosFinais`, `acoesDesatualizadas` e `familiasSemContato`, traz:
- `familiasSemMeta: [{ acompanhamentoId, unidadeSigla, responsavelNome, semMetaDesde, diasSemMeta }]` (regra em `docs/API-METAS.md`);
- `pesquisasPendentes: [{ acompanhamentoId, unidadeSigla, responsavelNome, momento, devidaEm, diasAtraso }]` (regra em `docs/API-PESQUISA.md`);
- `reavaliacoesPendentes: [{ acompanhamentoId, unidadeSigla, responsavelNome, devidaEm, diasAtraso }]`: em andamento, questionário inicial concluído, sem reavaliação nem final, e já passou `reavaliacao_dias` (padrão 45) do início;
- `resumoPorUnidade[]` ganha `familiasSemMeta`, `pesquisasPendentes` e `reavaliacoesPendentes`.

`GET /api/painel/resumo-inicio` (todos os perfis, só as unidades do usuário) ganha `pendentes.reavaliacao` e `pendentes.reavaliacaoItens` (até 10), ao lado de `semContato`, `semMeta` e `pesquisa`.

## Relatórios (`/api/relatorios`)

- **Semestral** (`GET /semestral/previa`, `POST /semestral`): duas seções novas, "4. Acompanhamento e evolução das famílias" (famílias que melhoraram, iguais e pioraram por dimensão e por unidade, índice médio, metas por dimensão, concluídos, desligados e contatos) e "5. Satisfação das famílias" (NPS, concordância por afirmação, por unidade, taxa de resposta e recusa); as considerações finais passam a ser a seção 6.
  - A prévia devolve `progresso`, `satisfacao` (os mesmos números do painel, para o recorte escolhido), os textos padrão em `textos.progresso` e `textos.satisfacao` (editáveis) e `comentariosSatisfacao: [{ id, sigla, data, pergunta, texto }]` (**só COORDENADOR/ADMIN**; a assistente recebe lista vazia).
  - O `POST` aceita `textos.progresso`, `textos.satisfacao` e `comentariosSatisfacao: [{ id, texto }]` (até 5 trechos escolhidos, com o texto que pode ser editado para tirar identificação; ids fora do escopo ou ocultos são ignorados).
  - Abaixo do n mínimo o texto diz que o número é insuficiente e as tabelas trazem "n < mín." no lugar de percentuais.
- **Individual** (`POST /individual/:id`): a seção "Evolução durante o acompanhamento" aparece também quando só há metas e traz o texto "Foram combinadas com a família N metas…" e a **tabela de metas** (dimensão, meta, prazo, situação, encerrada em), além da tabela do índice (F5).
- **CSV** (`GET /exportar/progresso.csv` e `/exportar/satisfacao.csv`, `?dataInicio=&dataFim=&unidadeIds=`, só `COORDENADOR`/`ADMIN`, `403` para a assistente): separador `;`, BOM UTF-8, sem dados pessoais nem comentários. Progresso: uma linha por recorte (total e cada unidade) e dimensão (geral e as 4). Satisfação: total e cada unidade.
- O modelo `semestral.docx` é gerado por `tests/relatorios/construir-templates.js` a partir do modelo original da INTECS (as seções novas só aparecem quando há dados).
