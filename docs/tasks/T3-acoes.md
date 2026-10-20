# T3 — Visitas e Ações (substitui CRONOGRAMA e BASE_UNICA_ACOES)

Leia primeiro `docs/tasks/_REGRAS-PARALELO.md`. Porta de teste: **3103**.

## Seus arquivos
`server/routes/acoes.js`, `server/services/acoes*.js`, `public/acoes.html`, `public/js/paginas/acoes.js`, `public/js/acoes/*`, `public/css/acoes.css`, `database/020–029_*.sql`, `tests/acoes/`.

## Escopo
1. **API** `/api/acoes`: listar (filtros: período, unidade permitida, status, tipo, tema, texto; ordenação por data), detalhe, criar, editar, excluir (COORDENADOR/ADMIN ou autor), mudar status (Planejada → Realizada exige qtd de participantes; Cancelada). Até 4 temas (ordem 1..4) — validar no back-end.
2. **Fotos**: `POST /api/acoes/:id/fotos` (multer, várias por vez, jpeg/png/webp, limite `upload_max_mb` da configuração, nome gerado aleatório, gravar em `config.uploadDir/acoes/`), `PATCH` legenda/ordem, `DELETE`. Servir por `GET /api/acoes/:id/fotos/:fotoId` **autenticado e verificando a unidade da ação** (nunca pasta pública). Redimensionar no navegador antes do upload (canvas → JPEG, lado maior 1600px, qualidade ~0.8) para economizar dados móveis.
3. **Tela** `acoes.html`:
   - Visão "Agenda/Cronograma" agrupada por mês (como o Excel CRONOGRAMA) e visão lista; filtros.
   - Formulário: data, tipo, instituição/local, endereço, temas (chips, máx. 4), status, participantes, descrição.
   - Fotos: botão que abre a câmera no celular (`<input type="file" accept="image/*" capture="environment" multiple>`) e galeria; miniaturas com legenda; visualização ampliada.
4. Endpoint auxiliar para T5/T6 (somente leitura, respeitando unidade): `GET /api/acoes/resumo?inicio=&fim=` → por unidade: qtd ações realizadas, qtd participantes, lista de instituições visitadas. Documente em `docs/API-ACOES.md`.

## Fora do escopo
Relatório semestral (T5), painel (T6).
