# API Acompanhamento — registros de contato e linha do tempo (F2)

Complementa `docs/API-FAMILIAS.md`. Todos os `:id` são o **`acompanhamentoId`**. Mesmas regras de unidade (outra unidade ⇒ `404`),
de perfil (escrita só `ASSISTENTE` e `COORDENADOR`; `ADMIN` apenas lê) e de erro (CONVENCOES §4). Proposta e decisões:
`docs/propostas/acompanhamento-e-satisfacao.md`.

**Privacidade (decisão D11):** para `ADMIN`, todo texto livre (`resumo` de registros e de atendimentos, observações do encerramento)
chega `null` e a resposta traz `textoRestrito: true`.

## Registros de acompanhamento

Um registro por contato ou visita com a família. `houveContato = false` é tentativa sem sucesso (não conta como contato).
Só em acompanhamento `EM_ANDAMENTO` (senão `409`).

### `GET /api/familias/acompanhamentos/:id/registros`
```json
{ "acompanhamentoId": 3, "status": "EM_ANDAMENTO", "textoRestrito": false, "semContatoDias": 30,
  "resumo": { "ultimoContatoEm": "2026-10-12", "diasSemContato": 9, "semContato": false,
              "ultimaSituacao": { "situacao": "MELHORANDO", "data": "2026-10-12" },
              "proximoContatoEm": "2026-11-11", "proximoContatoAtrasado": false },
  "tiposContato": [ { "id": 1, "nome": "Visita domiciliar", "exigeTexto": false }, { "id": 5, "nome": "Outro", "exigeTexto": true } ],
  "registros": [ { "id": 9, "dataRegistro": "…", "tipoContatoId": 1, "tipoContato": "Visita domiciliar", "tipoContatoOutro": null,
                   "houveContato": true, "situacao": "MELHORANDO", "resumo": "…", "proximoContatoEm": "…",
                   "autor": { "id": 10, "nome": "Ana" }, "criadoEm": "…", "alteradoEm": null, "podeAlterar": true } ] }
```
Registros anulados não aparecem. Ordem: data e id decrescentes. `tiposContato` são os ativos (tabela de apoio `tipo_contato`, editável pelo ADMIN).

### `POST /api/familias/acompanhamentos/:id/registros` → `201 { id }`
```json
{ "dataRegistro": "2026-10-12", "tipoContatoId": 1, "tipoContatoOutro": null, "houveContato": true,
  "situacao": "MELHORANDO", "resumo": "Texto curto", "proximoContatoEm": "2026-11-11" }
```
- `dataRegistro` (padrão hoje): não futura e não anterior ao `dataInicio` do acompanhamento.
- `tipoContatoId`: tipo ativo; se o tipo `exigeTexto` ("Outro"), `tipoContatoOutro` é obrigatório (e é descartado nos demais).
- `houveContato`: obrigatório (boolean). Com contato: `situacao` (`MELHORANDO | IGUAL | PIORANDO | NAO_SEI`) e `resumo` (até 1000) obrigatórios.
  Sem contato: `situacao` é ignorada (gravada `null`) e `resumo` é opcional.
- `proximoContatoEm`: opcional, não anterior à `dataRegistro`.
- `400` com `detalhes` por campo; `409` se o acompanhamento está encerrado.

### `PUT /api/familias/acompanhamentos/:id/registros/:registroId`
Mesmo corpo; devolve o mesmo formato do `GET`. Só o **autor** ou o **COORDENADOR** (`403`); registro anulado ⇒ `404`.

### `POST /api/familias/acompanhamentos/:id/registros/:registroId/anular`
`{ "motivo": "…" }` (obrigatório, até 200). O registro sai da lista e dos números; linha e motivo ficam no banco, e a
anulação vai para a auditoria. Mesmas permissões do `PUT`. Devolve o mesmo formato do `GET`.

## Linha do tempo

### `GET /api/familias/acompanhamentos/:id/linha-do-tempo?tipos=&pagina=&tamanho=`
`tipos`: lista separada por vírgula entre `INICIO, QUESTIONARIO, REGISTRO, ATENDIMENTO, ENCAMINHAMENTO, PRAZO, ENCERRAMENTO`
(inválido ⇒ `400`). `tamanho` padrão 30, máx. 100. Do mais novo ao mais antigo.
```json
{ "acompanhamentoId": 3, "textoRestrito": false, "total": 9, "pagina": 1, "tamanho": 30,
  "itens": [ { "tipo": "REGISTRO", "data": "2026-10-12", "momento": "2026-10-12T15:00:00.000Z", "titulo": "Contato: Telefone",
               "detalhe": null, "resumo": "…", "autor": "Ana", "situacao": "MELHORANDO", "proximoContatoEm": "2026-11-11",
               "referencia": { "tipo": "REGISTRO", "id": 9 } } ] }
```
| Tipo | Origem |
|---|---|
| `INICIO` | `acompanhamento.data_inicio` |
| `QUESTIONARIO` | questionários **concluídos** (inicial/final), na `data_aplicacao` |
| `REGISTRO` | registros de contato (tentativas incluídas, `situacao` null) |
| `ATENDIMENTO` | atendimentos do **responsável** (os demais membros não são `pessoa`) em unidades **permitidas ao usuário**; `antesDoInicio: true` se anteriores ao início |
| `ENCAMINHAMENTO` | encaminhamentos do atendimento (um evento por atendimento, na mesma data) |
| `PRAZO` | virtual: `data_prevista_final` enquanto não houver questionário final (`futuro`/`vencido`) |
| `ENCERRAMENTO` | `CONCLUIDO` ou `DESLIGADO`, com as observações |

## Alerta "família sem contato"

**Último contato** = a data mais recente entre: início do acompanhamento, registro **com contato** (não anulado), atendimento do
responsável **na unidade do acompanhamento** e questionário concluído. **Sem contato** = acompanhamento `EM_ANDAMENTO` com mais de
`alerta_sem_contato_dias` dias (padrão 30; editável em Administração > Configurações, também pelo COORDENADOR).

Onde aparece:
- `GET /api/familias` — cada item traz `ultimoContatoEm`, `diasSemContato`, `semContato`; filtro `?contato=SEM_CONTATO`.
- `GET /api/familias/acompanhamentos/:id` — campo `contato` (mesmo formato do `resumo` acima).
- `GET /api/painel/alertas` — `familiasSemContato: [{ acompanhamentoId, unidadeSigla, responsavelNome, ultimoContato, diasSemContato }]` e
  `resumoPorUnidade[].familiasSemContato`.
- `GET /api/painel/resumo-inicio` — `pendentes.semContato` (total) e `pendentes.semContatoItens` (até 10).
