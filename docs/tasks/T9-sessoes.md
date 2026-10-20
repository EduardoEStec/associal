# T9 — Derrubar sessões ao desativar usuário / redefinir senha

Hoje `dbo.sessao` guarda as sessões (JSON em `dados`, com `usuarioId`). Desativar usuário já é barrado pelo `requireAuth`, mas **redefinir senha não derruba sessões abertas**.

## Escopo
1. Em `server/services/admin.js`: ao **redefinir senha**, **desativar** usuário, ou **trocar o perfil/unidades** de um usuário, apagar as sessões dele: `DELETE FROM sessao WHERE TRY_CAST(JSON_VALUE(dados, '$.usuarioId') AS INT) = @id` (na mesma transação). Não derrubar a sessão do próprio admin que executa a ação quando o alvo é ele mesmo (ex.: troca do próprio perfil já é bloqueada).
2. Em `server/routes/auth.js` (arquivo compartilhado — mudança pequena e permitida para esta task): ao o próprio usuário **trocar a senha**, apagar as demais sessões dele, mantendo a atual (`AND sid <> @sidAtual`).
3. Registrar na auditoria quantas sessões foram encerradas (sem dados pessoais).
4. Testes: ajustar `tests/admin/admin.test.js` e testar contra o banco real.

## Banco real disponível
SQL Server de teste no Docker: `localhost:1433`, `sa` / `Associal#Dev2026`, banco `ASSOCIAL` (o `.env` da raiz já aponta). Teste numa porta própria: `PORT=3109 node server/index.js`. **NÃO altere a senha do usuário `admin`** (é do usuário humano): crie seus próprios usuários de teste (ex.: `t9_admin`, `t9_assist`) inserindo direto no banco com hash bcrypt e remova-os/desative-os ao final. NÃO derrube os containers nem processos node de outros. Atenção: a T8 está rodando em paralelo (pessoas/atendimentos/famílias/relatórios) — não mexa nesses arquivos.

## Regras
Não faça commit (o gerente commita). Ao terminar: `maestri ask "gerente" "<T9 concluída: arquivos, testes, o que foi testado contra o banco real>"`.
