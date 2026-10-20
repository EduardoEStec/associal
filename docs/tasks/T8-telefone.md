# T8 — Telefone/contato da pessoa

Lacuna encontrada na integração: `dbo.pessoa` não tem telefone, mas o questionário familiar e o relatório individual pedem "Contato".

## Escopo
1. `database/070_pessoa_telefone.sql` (idempotente, `IF COL_LENGTH('dbo.pessoa','telefone') IS NULL ALTER TABLE ... ADD`): `telefone VARCHAR(11) NULL` (só dígitos, 10 ou 11) e `telefone2 VARCHAR(11) NULL` (recado). CHECK de dígitos.
2. `server/services/pessoas.js` + `server/routes/pessoas.js`: validar/normalizar (só dígitos, 10–11), gravar, devolver em `buscar`. Atualizar `docs/API-PESSOAS.md`.
3. Atendimentos (`server/services/atendimentos.js`, `public/js/atendimentos/*`): campo Telefone (e telefone de recado opcional) no bloco de dados pessoais, máscara `(11) 91234-5678`, `inputmode="tel"`; mostrar no detalhe.
4. Famílias (`server/services/familias.js` `gravarPessoa` etc., `public/js/familias/cadastro.js`, `detalhe.js`): mesmo campo para o responsável (COALESCE: omitido não apaga).
5. Relatórios (`server/services/relatorios-dados.js` / `relatorios-textos.js`): preencher "Contato" com o telefone formatado do responsável (continua editável).
6. Ajustar os testes existentes (`tests/atendimentos`, `tests/familias`, `tests/relatorios`) e rodar todos.

## Banco real disponível
SQL Server de teste no Docker: `localhost:1433`, usuário `sa`, senha `Associal#Dev2026`, banco `ASSOCIAL` (o `.env` da raiz já aponta para ele — app do Docker roda na porta 3000). Rode `npm run db:migrate` localmente (Node) para aplicar o 070 e teste o fluxo real numa porta própria: `PORT=3108 node server/index.js`. **NÃO altere a senha do usuário `admin`** (é do usuário humano): crie usuários de teste próprios (ex.: `t8_assist`) direto no banco com hash bcrypt. NÃO derrube os containers nem processos node de outros.

## Regras
Não faça commit (o gerente commita). Ao terminar: `maestri ask "gerente" "<T8 concluída: arquivos, testes, o que foi testado contra o banco real>"`.
