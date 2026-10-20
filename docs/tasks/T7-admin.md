# T7 — Administração

Leia primeiro `docs/tasks/_REGRAS-PARALELO.md`. Porta de teste: **3107**.

## Seus arquivos
`server/routes/admin.js`, `server/services/admin*.js`, `public/admin.html`, `public/js/paginas/admin.js`, `public/js/admin/*`, `public/css/admin.css`, `database/060–069_*.sql`, `tests/admin/`.

## Escopo
1. **Usuários** (ADMIN): listar, criar (login, nome, e-mail, perfil, CRESS, unidades vinculadas — obrigatório ≥1 para ASSISTENTE), editar, ativar/desativar (nunca excluir; não permitir desativar o último ADMIN nem a si mesmo), redefinir senha (gera senha provisória exibida uma vez + `deve_trocar_senha = 1`). Política de senha mínima (8+ caracteres) coerente com o que `auth.js` já aplica.
2. **Unidades** (ADMIN): listar, criar, editar (sigla, nome, endereço, ordem), ativar/desativar.
3. **Tabelas de apoio** (ADMIN): CRUD genérico para todas as `TABELAS_APOIO` de `server/lib/dominios.js` (nome, ordem, ativo, exige_texto; faixa_etaria também idade_min/max) usando whitelist de tabelas; desativar em vez de excluir quando já usada (excluir só se não referenciada → senão 409 explicando).
4. **Configurações**: listar/editar `dbo.configuracao`. `prazo_questionario_final_dias` e `alerta_questionario_final_dias_antes` editáveis pelo **COORDENADOR também** (o Elinaldo define o prazo); demais só ADMIN. Validar tipos (inteiros positivos).
5. **Auditoria** (ADMIN): consulta paginada com filtros (usuário, ação, tabela, período).
6. **Tela** `admin.html` com abas (Usuários · Unidades · Listas · Configurações · Auditoria), mobile-first. Ajuste no menu: se o COORDENADOR precisar acessar Configurações, **não** edite `layout.js` — crie em `admin.html` a verificação de perfil e reporte ao gerente a necessidade de liberar o item de menu para COORDENADOR.
