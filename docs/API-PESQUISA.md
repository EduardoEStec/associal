# API Pesquisa de satisfação (F3)

Pesquisa **identificada** (a resposta fica ligada ao acompanhamento da família), aplicada **pessoalmente pela assistente** no celular
dela: ela lê as perguntas, a família responde, ela registra. Sem link público. Proposta e decisões:
`docs/propostas/acompanhamento-e-satisfacao.md` (seções 6 e 10). Mesmas regras de unidade (outra unidade ⇒ `404`), de erro
(CONVENCOES §4) e de auditoria (a auditoria registra o fato, **nunca** respostas nem comentários). Todos os `:id` são o `acompanhamentoId`.

**Privacidade (D11 ajustada; revista em 21/10/2026 — V12):** `ASSISTENTE` vê as pesquisas das famílias das suas unidades; `COORDENADOR`
e `ADMIN` (que opera como a coordenação) veem todas, leem respostas e comentários e podem ocultar o comentário dos relatórios.
Escrita: `ASSISTENTE`, `COORDENADOR` e `ADMIN`. Antes da V12 o `ADMIN` recebia lista vazia com `textoRestrito: true`, `403` no detalhe e
nada na linha do tempo; **o campo `textoRestrito` foi removido**. A auditoria registra o fato e o usuário (inclusive o ADMIN), nunca o conteúdo.

## Modelo de perguntas versionado

Tabelas `pesquisa_modelo` (`codigo`, `versao`, `aviso`, `ativo`) e `pesquisa_pergunta` (`codigo`, `ordem`, `tipo`, `texto`). A pesquisa nova
usa o modelo **ativo de maior versão** do código `SATISFACAO`; cada resposta guarda o `modelo_id` com que foi feita, então trocar o
instrumento não altera as respostas antigas. **Para trocar** (quando o Termo, D6, definir o formato): inserir um novo `pesquisa_modelo`
(`versao + 1`, `aviso` revisado pelo jurídico, D12), as suas `pesquisa_pergunta` e desativar o anterior (`ativo = 0`) — por migração nova.

Modelo v1 (texto provisório): `NPS` (0–10), `L1`–`L6` (concordância 1–5: 1 discordo totalmente … 5 concordo totalmente) e `T1`/`T2` (textos opcionais:
o que faz de melhor / o que precisa melhorar).

## Rotas

### `GET /api/familias/acompanhamentos/:id/pesquisas`
```json
{ "acompanhamentoId": 3, "status": "EM_ANDAMENTO", "textoRestrito": false, "intervaloDias": 180,
  "modelo": { "id": 1, "codigo": "SATISFACAO", "versao": 1, "titulo": "…", "aviso": "texto lido à família",
              "perguntas": [ { "codigo": "NPS", "ordem": 1, "tipo": "NPS", "texto": "…" } ] },
  "pendencia": { "momento": "SEMESTRAL", "devidaEm": "2026-10-01", "diasAtraso": 20 },
  "pesquisas": [ { "id": 9, "momento": "SEMESTRAL", "dataAplicacao": "…", "situacao": "CONCLUIDA", "modo": "FAMILIA_FALOU",
                   "consentimentoLido": true, "comentarioOculto": false, "modeloVersao": 1, "autor": { "id": 10, "nome": "Ana" },
                   "resumo": { "nps": 9, "categoriaNps": "PROMOTORA", "concordancia": 100, "indice": 75,
                               "afirmacoesRespondidas": 6, "afirmacoesTotal": 6, "recusas": 0 },
                   "podeAlterar": true } ] }
```
Não traz as anuladas. `situacao`: `RASCUNHO | CONCLUIDA | RECUSADA`. `resumo` só na `CONCLUIDA`.

### `GET /api/familias/acompanhamentos/:id/pesquisas/:pesquisaId`
O mesmo item, com `itens: [{ codigo, tipo, valorNum, valorTexto, preferNaoResponder }]` e o `modelo` **da resposta**. Só quem tem acesso ao acompanhamento (outra unidade ⇒ `404`).

### `POST /api/familias/acompanhamentos/:id/pesquisas` → `201 { id, situacao }`
```json
{ "momento": "SEMESTRAL", "situacao": "CONCLUIDA", "consentimentoLido": true, "modo": "FAMILIA_FALOU", "dataAplicacao": "2026-10-21",
  "itens": [ { "codigo": "NPS", "valorNum": 9 }, { "codigo": "L5", "preferNaoResponder": true }, { "codigo": "T1", "valorTexto": "…" } ] }
```
- `momento`: `FINAL` (ao encerrar), `SEMESTRAL` ou `AVULSA`.
  - `FINAL` exige o questionário final concluído **ou** acompanhamento já encerrado (senão `409`); uma por acompanhamento (a segunda ⇒ `409`; para refazer, anule a anterior).
  - `SEMESTRAL` só em acompanhamento em andamento (`409`).
  - `AVULSA` em qualquer situação.
  - Já existindo um `RASCUNHO` do mesmo momento ⇒ `409` com `detalhes.respostaId`.
- `situacao`: `RASCUNHO` (parcial; salvo a cada passo da tela), `CONCLUIDA` ou `RECUSADA` (a família preferiu não responder; nenhum item é guardado).
- `consentimentoLido` (obrigatório, `true`, em `RASCUNHO` e `CONCLUIDA`): a assistente leu o aviso e a família concordou.
- `CONCLUIDA` exige `modo` (`FAMILIA_FALOU | FAMILIA_PREENCHEU | COM_AJUDA`) e, para `NPS` e `L1`–`L6`, uma resposta **ou** `preferNaoResponder: true`; os textos são opcionais.
  Faixas: NPS 0–10, afirmações 1–5, texto até 1000 caracteres. Erros em `detalhes` com chave `itens.<codigo>` (ex.: `itens.L3`), `modo`, `consentimentoLido`, `dataAplicacao`.
- `dataAplicacao` (padrão hoje): não futura e não anterior ao início do acompanhamento.

### `PUT /api/familias/acompanhamentos/:id/pesquisas/:pesquisaId` → `{ id, situacao }`
Só `RASCUNHO` (concluída ⇒ `409`: anule e aplique de novo). Só o autor, o `COORDENADOR` ou o `ADMIN` (`403`). Mesmo corpo do `POST` (o `momento` não muda).

### `POST …/pesquisas/:pesquisaId/anular`
`{ "motivo": "…" }` (obrigatório, até 200). Sai da lista, da linha do tempo e dos números; linha e motivo ficam no banco e a anulação vai para a
auditoria. Também descarta rascunho. Autor, `COORDENADOR` ou `ADMIN`. Devolve a lista (mesmo formato do `GET`).

### `PUT …/pesquisas/:pesquisaId/comentario-oculto`
`{ "oculto": true }` — só `COORDENADOR` e `ADMIN`; o comentário deixa de poder aparecer nos relatórios (F6). Devolve a lista.

## Pendência e alertas

`pendencia` (na lista e em `GET /api/familias/acompanhamentos/:id` → `pesquisa.pendencia`) é `null` ou `{ momento, devidaEm, diasAtraso }`.
Só contam respostas `CONCLUIDA` ou `RECUSADA` (rascunho e anulada não resolvem).
- **FINAL:** acompanhamento em andamento com questionário final concluído, ou `CONCLUIDO` há até `pesquisa_prazo_final_dias` (padrão 60), sem pesquisa final. Desligamento não gera pendência.
- **SEMESTRAL:** acompanhamento em andamento sem pesquisa há `pesquisa_intervalo_dias` (padrão 180), contados do início ou da última pesquisa.

Configurações (Administração > Configurações, editáveis também pelo COORDENADOR): `pesquisa_intervalo_dias`, `pesquisa_prazo_final_dias`,
`pesquisa_n_minimo` (usada pelos agregados da F6).

`GET /api/painel/resumo-inicio` → `pendentes.pesquisa` (total) e `pendentes.pesquisaItens` (até 10: `acompanhamentoId`, `unidadeSigla`,
`responsavelNome`, `momento`, `devidaEm`, `diasAtraso`), filtrados pelas unidades do usuário.

Aplicar a pesquisa **conta como contato** com a família (e a recusa também) no alerta "sem contato" (`docs/API-ACOMPANHAMENTO.md`).

## Resultado

- **NPS:** nota 0–10; `categoriaNps` = `PROMOTORA` (9–10), `NEUTRA` (7–8), `DETRATORA` (0–6).
- **Satisfação:** `concordancia` = % das afirmações respondidas com 4 ou 5; `indice` = média das afirmações respondidas em 0–100 (`(valor − 1) / 4 × 100`).
- Linha do tempo (`tipos=PESQUISA`): evento "Pesquisa de satisfação aplicada" (nota, satisfação e comentários) ou "…a família preferiu não responder".
- Os números agregados por unidade e período (NPS, satisfação, taxa de resposta e de recusa, `pesquisa_n_minimo`) são da **F6**: `docs/API-PAINEL-FAMILIAS.md`.
