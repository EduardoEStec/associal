# API — Visitas e Ações (`/api/acoes`)

Todas as rotas exigem sessão e filtram pelas unidades do usuário (outra unidade ⇒ 404; filtro `unidadeId` fora do escopo ⇒ 403).
Corpo/resposta em camelCase; datas `AAAA-MM-DD`. Escrita (POST/PUT/PATCH/DELETE) exige o cabeçalho `X-Requested-With: fetch`.

## Endpoint auxiliar para Relatórios (T5) e Painel (T6)

`GET /api/acoes/resumo?inicio=AAAA-MM-DD&fim=AAAA-MM-DD&unidadeId=` — somente leitura; considera **apenas ações REALIZADAS** no período.
Devolve uma linha por unidade permitida (com zeros quando não há ações):

```json
[{ "unidadeId": 1, "sigla": "BRA", "nome": "Brasilândia", "qtdAcoes": 4, "qtdParticipantes": 120,
   "instituicoes": ["EMEF Central", "UBS Sul"] }]
```

`instituicoes` = valores distintos de `instituicaoLocal`, em ordem alfabética.

## Ações

| Método e rota | Descrição |
|---|---|
| `GET /api/acoes` | Lista. Filtros: `inicio`, `fim`, `unidadeId`, `status` (PLANEJADA/REALIZADA/CANCELADA), `tipoAcaoId`, `temaId`, `q` (instituição/endereço/descrição), `ordem=asc\|desc` (por data). Máx. 1000 itens. Cada item traz `temas[]` e `qtdFotos`. |
| `GET /api/acoes/:id` | Detalhe com `temas[]`, `fotos[]` (`id`, `legenda`, `ordem`, `url`) e `podeExcluir`. |
| `POST /api/acoes` | Cria. Corpo: `dataAcao`*, `tipoAcaoId`*, `unidadeId` (omitir se o usuário só tem uma), `instituicaoLocal`, `endereco`, `status` (padrão PLANEJADA), `qtdParticipantes`, `descricao`, `temaIds` (até 4, ordem preservada). `REALIZADA` exige `qtdParticipantes`. Resposta 201 `{ id }`. |
| `PUT /api/acoes/:id` | Edita (mesmo corpo; `unidadeId` só muda se informado e permitido). |
| `PATCH /api/acoes/:id/status` | `{ status, qtdParticipantes? }`. Para `REALIZADA` a quantidade é obrigatória (usa a já gravada se existir). |
| `DELETE /api/acoes/:id` | Somente COORDENADOR/ADMIN ou o autor (`criado_por`). Apaga também as fotos (banco e arquivos). 204. |

Perfis que escrevem: ASSISTENTE, COORDENADOR, ADMIN.

## Fotos

| Método e rota | Descrição |
|---|---|
| `POST /api/acoes/:id/fotos` | `multipart/form-data`: campo `fotos` (até 10 por envio, 40 por ação) e `legendas` (opcional, repetido, mesma ordem). JPEG/PNG/WebP, tamanho máx. = configuração `upload_max_mb`; os primeiros bytes são conferidos. Salva em `UPLOAD_DIR/acoes/<32 hex>.<ext>`. 201 `{ fotos: [{ id, url }] }`. |
| `GET /api/acoes/:id/fotos/:fotoId` | Devolve a imagem (autenticado; verifica a unidade da ação). |
| `PATCH /api/acoes/:id/fotos/:fotoId` | `{ legenda?, ordem? }`. |
| `DELETE /api/acoes/:id/fotos/:fotoId` | Remove registro e arquivo. 204. |

O navegador reduz as fotos (lado maior 1600 px, JPEG ~0.8) antes de enviar.

## Banco

`database/020_acoes_indices.sql` (idempotente): índices extras. As tabelas `acao_visita`, `acao_visita_tema` e `acao_visita_foto` vêm de `001_schema.sql`.
