# Catálogo de perguntas e opções (P1 + P2)

A coordenação (COORDENADOR) e o ADMIN configuram, em **Administração > Perguntas e opções**, três formulários:
**Questionário Individual Familiar** (`QUESTIONARIO`), **Pesquisa de satisfação** (`PESQUISA`) e **Novo atendimento** (`ATENDIMENTO`).
Migração: `database/085_catalogo_perguntas.sql` (idempotente; no SQL Server real fica na fila do fim, com backup).

## Permissões (P1)

| Perfil | `/api/admin` |
|---|---|
| ASSISTENTE | 403 em tudo |
| COORDENADOR | 200 em `apoio`, `unidades`, `configuracoes` (todas as chaves) e `perguntas`; **403** em `usuarios` (criar, editar perfil, desativar, redefinir senha) e `auditoria` |
| ADMIN | tudo (e continua operando como a coordenação nos processos, V12) |

Leitura das perguntas pelos formulários (`GET /api/apoio/perguntas/:formulario`, `GET /api/familias/questionario/modelo`, modelo da pesquisa) vale para todos os perfis logados.

## Decisões de projeto

1. **Perguntas oficiais não mudam de estrutura.** Continuam sendo colunas fixas de `dbo.questionario` (e `pesquisa_pergunta`), alimentando o índice de progresso (F5), a comparação inicial × final e os relatórios. A coordenação só **renomeia** o texto (e a ajuda) e **acrescenta opções**; não desativa nem exclui pergunta oficial.
2. **Código estável.** Pergunta e opção têm `codigo` que nunca muda (`2a`, `NAO_TINHA`; extras: `E0001`, `OP01`). Renomear troca só o texto, então histórico, comparação e índice seguem válidos.
3. **Opção nova em pergunta oficial de escolha** (2a, 2b, 2c, 2d, 3b, 3d, 3e, 5a) obriga a coordenação a dizer **como pontua**: *vale como* uma opção oficial (usa a mesma posição na escala: índice de progresso, semáforo e comparação tratam as duas igual) ou *não pontua* (fica fora do índice e da comparação, como pergunta não respondida). Depois que a opção foi usada **não se muda** o quanto ela vale (409): crie outra e desative esta.
4. **CHECK fixo trocado por formato.** As 8 colunas de escolha viraram `VARCHAR(40)` com CHECK de formato (`A-Z`, `0-9`, `_`). A validade do código é conferida pela API contra o catálogo (opção desativada continua válida para quem já respondeu com ela).
5. **Nunca apaga o que tem resposta.** Pergunta/opção com respostas só se **desativa** (409 ao excluir). Perguntas extras e opções acrescentadas **sem** resposta podem ser excluídas. Mínimo de 2 opções ativas por pergunta de escolha.
6. **Perguntas extras** (criadas pela coordenação): tipos `TEXTO`, `NUMERO`, `SIM_NAO`, `ESCOLHA`, `MULTIPLA`; ficam no **fim da seção** escolhida (questionário: seções 1 a 5; pesquisa e atendimento: seção única), na ordem definida; podem ser **obrigatórias** (questionário: ao concluir; atendimento: ao salvar). **Na pesquisa são sempre opcionais** (a família pode não querer responder). A reavaliação rápida (F5) não tem extras. Extras **não entram** no índice de progresso nem nos agregados do painel; aparecem no formulário, no detalhe, na comparação da família, no .docx individual e no CSV.
7. **Respostas extras** ficam em `dbo.resposta_extra` (uma linha por pergunta; uma por opção na múltipla), ligadas a um único dono (`questionario_id` | `atendimento_id` | `pesquisa_resposta_id`) com exclusão em cascata junto do dono.
8. **Catálogo em memória.** `server/services/catalogo.js` carrega o catálogo do banco (TTL de 20 s e recarga imediata após cada edição); sem as tabelas (migração não aplicada) vale o padrão do código (`catalogo-estado.js`), igual ao anterior à P2.
9. **Auditoria**: toda criação, alteração, ativação/desativação, ordem e exclusão grava em `dbo.auditoria` (`catalogo_pergunta`, `catalogo_opcao`), com o texto antes/depois; só o ADMIN consulta.

## Tabelas

- `catalogo_pergunta` — `formulario`, `secao`, `codigo`, `oficial`, `campo` (oficial do questionário: nome do campo na API), `tipo`, `texto`, `texto_final` (questionário: texto do FINAL), `ajuda`, `obrigatoria`, `ordem`, `ativa`.
- `catalogo_opcao` — `pergunta_id`, `codigo`, `texto`, `texto_final`, `ordem`, `ativa`, `base` (opção oficial, define a escala), `posicao` (0 = pior), `equivale_a_id` (acrescentada: vale como esta base; `NULL` = não pontua).
- `resposta_extra` — `pergunta_id`, dono, `opcao_id`, `valor_texto`, `valor_num` (sim/não = 1/0).

## API de administração (COORDENADOR e ADMIN)

| Método e rota | Corpo | Resultado |
|---|---|---|
| `GET /api/admin/perguntas?formulario=QUESTIONARIO\|PESQUISA\|ATENDIMENTO` | — | `{ formulario, secoes: [{ numero, titulo, perguntas: [{ id, codigo, oficial, tipo, texto, textoFinal, ajuda, obrigatoria, ativa, respostas, apoio, opcoes: [{ id, codigo, texto, textoFinal, ativa, base, pontua, equivaleCodigo, respostas }] }] }] }` |
| `POST /api/admin/perguntas` | `{ formulario, secao, tipo, texto, textoFinal?, ajuda?, obrigatoria?, opcoes?: ["A", "B"] }` | 201 `{ id, codigo }` (opções obrigatórias em `ESCOLHA`/`MULTIPLA`, 2 a 30) |
| `PUT /api/admin/perguntas/:id` | `{ texto, textoFinal?, ajuda?, obrigatoria?, secao? }` | renomeia (oficial: só texto e ajuda) |
| `PATCH /api/admin/perguntas/:id/ativa` | `{ ativa }` | só extras (oficial: 409) |
| `PUT /api/admin/perguntas/ordem` | `{ formulario, secao, ids: [...] }` | 204; `ids` = todas as extras da seção, na nova ordem |
| `DELETE /api/admin/perguntas/:id` | — | 204; 409 se tiver respostas ou for oficial |
| `POST /api/admin/perguntas/:id/opcoes` | `{ texto, textoFinal?, equivaleA? \| naoPontua? }` | 201 `{ id, codigo }`; em pergunta oficial de escolha, `equivaleA` (código de uma opção oficial) ou `naoPontua: true` é obrigatório |
| `PUT /api/admin/perguntas/:id/opcoes/:opcaoId` | `{ texto, textoFinal?, equivaleA? \| naoPontua? }` | renomeia; mudar o "vale como" de opção já usada: 409 |
| `PATCH /api/admin/perguntas/:id/opcoes/:opcaoId/ativa` | `{ ativa }` | 409 se deixar menos de 2 ativas |
| `PUT /api/admin/perguntas/:id/opcoes/ordem` | `{ ids: [...] }` | 204; só a ordem de exibição (a escala do índice não muda) |
| `DELETE /api/admin/perguntas/:id/opcoes/:opcaoId` | — | 204; 409 se oficial ou já usada |

## API dos formulários

- `GET /api/apoio/perguntas/:formulario` → perguntas extras **ativas**: `[{ codigo, secao, tipo, texto, ajuda, obrigatoria, opcoes?: [{ valor, rotulo, ativa }] }]`.
- **Questionário**: `GET /api/familias/questionario/modelo?tipo=` traz textos e opções do catálogo e as extras no fim de cada bloco (`extra: true`, `campo: "extras.E0001"`, tipos `texto`, `numero`, `booleano`, `escolha`, `multipla-extra`). `GET`/`PUT .../questionarios/:tipo` aceitam e devolvem `extras` (`{ "E0001": valor }`) e devolvem `respostasExtras` (`[{ codigo, pergunta, tipo, resposta }]` legível). `GET .../comparacao` traz `extras: [{ codigo, pergunta, inicial, final }]`.
- **Pesquisa**: o modelo (`GET .../pesquisas`) traz `extras` (sempre opcionais); `POST`/`PUT` aceitam `extras`; `GET .../pesquisas/:id` devolve `extras` e `respostasExtras`; a lista traz `respostasExtras` por pesquisa concluída.
- **Atendimento**: `POST`/`PUT /api/atendimentos` aceitam `extras`; `GET /api/atendimentos/:id` devolve `extras` e `respostasExtras`.
- Valor de `extras` por tipo: `TEXTO` string (até 1000) · `NUMERO` número (vírgula decimal aceita) · `SIM_NAO` true/false · `ESCOLHA` código da opção · `MULTIPLA` lista de códigos. **`extras` ausente = não mexe nas respostas já gravadas**; valor vazio/`null` limpa a resposta. Erros de validação vêm em `erro.detalhes["extras.E0001"]`.
- **Relatórios**: o .docx individual acrescenta as extras do inicial ao *Diagnóstico* e as do final ao *Feedback*; `GET /api/relatorios/exportar/perguntas-extras.csv?dataInicio=&dataFim=&unidadeIds=` (COORDENADOR/ADMIN) exporta uma linha por resposta (formulário, data, unidade, nº do registro, momento, código, pergunta, resposta) **sem identificar** pessoa ou família, mas pode conter texto livre.

## Limites conhecidos

- Perguntas extras não alimentam o índice de progresso, o painel nem os agregados de satisfação (NPS/concordância): são informação qualitativa/complementar. Quem quiser que uma pergunta nova pese no índice precisa de mudança de código (nova versão da regra, `VERSAO_REGRA`).
- Mudar o tipo de uma pergunta extra não é permitido (crie outra e desative a antiga).
- Opções das perguntas oficiais de lista (1d benefícios, 3c destino da economia) continuam na aba **Listas**.
- Textos das perguntas oficiais renomeados valem para todos os registros (histórico mostra o texto atual).
- Servidor com várias instâncias: cada uma recarrega o catálogo em até 20 s após uma edição.
