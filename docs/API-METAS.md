# API Plano de metas (F4)

Cada acompanhamento pode ter **metas** (opcionais, decisão D7): o que a família quer conquistar, por dimensão, com prazo e situação. O avanço
é registrado nos contatos (um registro pode marcar uma ou mais metas). Proposta e decisões: `docs/propostas/acompanhamento-e-satisfacao.md`
(seções 4.2 e 10.4). Mesmas regras de unidade (outra unidade ⇒ `404`), de perfil (escrita: `ASSISTENTE`, `COORDENADOR` e `ADMIN`; leitura: quem
tem acesso à unidade), de erro (CONVENCOES §4) e de auditoria (`CRIAR`/`ALTERAR` em `acompanhamento_meta`, com o usuário). Todos os `:id` são o `acompanhamentoId`.

O plano é **da equipe**: qualquer perfil de escrita com acesso à unidade cria e atualiza metas (não só o autor). Não há exclusão: a meta que deixou
de fazer sentido vira `CANCELADA` e fica no histórico. Só em acompanhamento `EM_ANDAMENTO` (senão `409`).

## Dimensões e situações

- `dimensao`: `ALIMENTACAO` · `RENDA` · `ECONOMIA` · `AUTONOMIA` · `OUTRA` (rótulos: Alimentação, Renda, Economia, Autonomia, Outra).
- `status`: `EM_ANDAMENTO` (nasce assim) · `ATINGIDA` · `NAO_ATINGIDA` · `CANCELADA`. Ao sair de `EM_ANDAMENTO` grava-se `concluidaEm`; reabrir (`EM_ANDAMENTO`) limpa a data.
- `avanco` (por registro): `AVANCOU` · `SEM_MUDANCA` · `RETROCEDEU`.

## Rotas

### `GET /api/familias/acompanhamentos/:id/metas`
```json
{ "acompanhamentoId": 3, "status": "EM_ANDAMENTO", "semMetaDias": 30,
  "semMeta": { "desde": "2026-09-01", "dias": 45, "limiteDias": 30 },
  "dimensoes": [ { "codigo": "ALIMENTACAO", "nome": "Alimentação" } ],
  "metas": [ { "id": 5, "dimensao": "RENDA", "dimensaoNome": "Renda", "descricao": "Retomar o bico", "prazo": "2026-11-20T00:00:00.000Z",
               "status": "EM_ANDAMENTO", "concluidaEm": null, "vencida": false, "autor": { "id": 10, "nome": "Ana" },
               "criadoEm": "…", "alteradoEm": null, "ultimoAvanco": "AVANCOU",
               "historico": [ { "registroId": 9, "data": "2026-10-11T00:00:00.000Z", "avanco": "AVANCOU" } ] } ] }
```
Ordem: em andamento primeiro, depois as encerradas; dentro de cada grupo, as mais novas primeiro. `vencida` = em andamento com `prazo` anterior a hoje.
`historico` só conta registros **não anulados**. `semMeta` é `null` quando não há alerta (ver abaixo).

### `POST /api/familias/acompanhamentos/:id/metas` → `201 { id }`
```json
{ "dimensao": "ALIMENTACAO", "descricao": "Passar a comprar frutas e verduras 3 vezes por semana", "prazo": "2026-12-20" }
```
- `descricao` obrigatória, até 300 caracteres. `prazo` opcional, não anterior ao `dataInicio` do acompanhamento. `status` não se informa (nasce `EM_ANDAMENTO`).
- `400` com `detalhes` por campo (`dimensao`, `descricao`, `prazo`); `409` se o acompanhamento está encerrado.

### `PUT /api/familias/acompanhamentos/:id/metas/:metaId` → mesmo formato do `GET`
Mesmo corpo, mais `status` (padrão: o atual) e `concluidaEm` (para `ATINGIDA`, `NAO_ATINGIDA` ou `CANCELADA`; padrão hoje; não futura, não anterior ao início).
Meta de outro acompanhamento ⇒ `404`.

## Avanço nos registros de contato

`POST`/`PUT /api/familias/acompanhamentos/:id/registros[/:registroId]` aceitam `"metas": [ { "metaId": 5, "avanco": "AVANCOU" } ]` (até 10, sem repetir).
- Só metas **em andamento** deste acompanhamento (na edição, também as que o registro já tinha marcado). Outra ⇒ `400` com `detalhes.metas`.
- Tentativa sem contato (`houveContato: false`) não grava metas. No `PUT`, omitir `metas` mantém o que havia; `[]` remove.
- `GET …/registros` devolve em cada registro `metas: [ { metaId, dimensao, dimensaoNome, descricao, avanco } ]`.

## Alerta "família sem meta" (D7)

Acompanhamento `EM_ANDAMENTO` **sem nenhuma meta em andamento há mais de `alerta_sem_meta_dias` dias** (padrão 30; Administração > Configurações, 7 a 365, também
pela coordenação), contados do início ou da última meta encerrada (a mais recente). Exatamente o limite ainda não alerta. Meta encerrada recomeça a contagem.

- `GET /api/familias/acompanhamentos/:id` → `metas: { emAndamento, atingidas, naoAtingidas, canceladas, vencidas, semMeta }`.
- `GET /api/familias/acompanhamentos/:id/metas` → `semMeta`, `semMetaDias`.
- `GET /api/painel/resumo-inicio` → `pendentes.semMeta` (total) e `pendentes.semMetaItens` (até 10: `acompanhamentoId`, `unidadeSigla`, `responsavelNome`, `semMetaDesde`, `diasSemMeta`), filtrados pelas unidades do usuário.

## Linha do tempo

Tipo `META` (`GET …/linha-do-tempo?tipos=META`): "Meta definida" (na data de criação; detalhe com dimensão e prazo) e, quando encerrada, "Meta atingida", "Meta não atingida"
ou "Meta cancelada" (em `concluidaEm`). O evento do contato (`REGISTRO`) traz em `detalhe` as metas tratadas: `Metas: <descrição> (avançou); …`.
