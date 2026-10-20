# ASSOCIAL

Sistema do Serviço Social da INTECS nos **Armazéns Solidários** (Termo de Colaboração TCL/073/2023/SMDHC/SESANA).
Substitui o MS Forms de atendimento, o Excel de controle, o questionário familiar em papel e os relatórios Word montados à mão.

- Especificação (fonte da verdade): [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md)
- Convenções para quem vai desenvolver módulos: [`docs/CONVENCOES.md`](docs/CONVENCOES.md)

**Stack:** HTML + CSS + JavaScript puro (ES modules, sem build) · Node.js 22 + Express 5 (CommonJS) · SQL Server (`mssql`) · sessão `express-session` + `bcrypt` · PWA.

## Estrutura

```
server/            app Express
  index.js, app.js   inicialização, middlewares globais (helmet, sessão, CSRF, erros)
  config.js, db.js   variáveis de ambiente / pool mssql + helpers parametrizados
  middlewares/       auth.js (requireAuth, requirePerfil, filtro por unidade), erros.js
  lib/               validacao.js (CPF...), auditoria.js, erros.js, dominios.js, session-store.js
  routes/            um arquivo por módulo => /api/<arquivo> (montagem automática)
public/            front estático (html, css/, js/, js/paginas/, icons/, manifest, sw.js)
database/          001_schema.sql, 002_seed.sql, migrate.js, admin-senha.js
docs/              especificação, convenções, tarefas
uploads/           fotos enviadas (volume no Docker)
```

## Rodar localmente (sem Docker)

Pré-requisitos: Node.js 22+ e um SQL Server acessível.

```bash
npm install
cp .env.example .env          # edite DB_*, SESSION_SECRET, ADMIN_SENHA_INICIAL
npm run db:migrate            # cria o banco ASSOCIAL, as tabelas, os dados iniciais e o usuário admin
npm run dev                   # http://localhost:3000  (reinicia ao salvar)
# produção: npm start
```

### SQL Server para teste (Docker)

Sem SQL Server à mão, suba um local de teste (precisa do Docker):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app npm run db:migrate
# app em http://localhost:3000
```

Para usar esse banco com `npm run dev` (Node fora do container): `docker compose -f docker-compose.dev.yml up -d db` e no `.env` use
`DB_SERVER=localhost`, `DB_USER=sa`, `DB_PASSWORD=Associal#Dev2026` (ou o valor de `DEV_SA_PASSWORD`).

## Rodar com Docker (produção, SQL Server externo)

```bash
cp .env.example .env          # preencha DB_SERVER/DB_USER/DB_PASSWORD/DB_NAME, SESSION_SECRET, ADMIN_SENHA_INICIAL
docker compose up -d --build
docker compose exec app npm run db:migrate
```

- O SQL Server está fora do compose; se ele roda na própria máquina do Docker, use `DB_SERVER=host.docker.internal`.
- As fotos ficam no volume `uploads` (persistem entre atualizações).
- Atrás de HTTPS/proxy reverso, defina `COOKIE_SECURE=true` e `TRUST_PROXY=1`.
- Atualizar: `git pull && docker compose up -d --build && docker compose exec app npm run db:migrate`.

## Banco de dados

`npm run db:migrate` executa, em ordem, todos os `database/NNN_*.sql` (todos **idempotentes** — pode rodar quantas vezes quiser):

1. cria o banco `DB_NAME` se não existir (o usuário do `.env` precisa de permissão `CREATE DATABASE`; senão crie o banco vazio antes);
2. roda `001_schema.sql` (tabelas, índices, constraints) e `002_seed.sql` (7 unidades, opções das listas, configurações padrão, usuário `admin`);
3. define a senha inicial do `admin` (ver abaixo).

Quem criar scripts novos usa o próximo número (`003_...sql`), com `IF NOT EXISTS`/`IF OBJECT_ID ... IS NULL`, e lotes separados por `GO`.

## Primeiro login

1. Defina `ADMIN_SENHA_INICIAL` no `.env` (mín. 8 caracteres) **antes** do `db:migrate`; se deixar vazio, o `db:migrate` gera uma senha aleatória e a imprime **uma única vez** no console.
2. Acesse o sistema com usuário **`admin`** e essa senha. O sistema exige trocar a senha no primeiro acesso.
3. Para redefinir a senha de qualquer usuário pelo servidor: `npm run admin:senha -- <login> [novaSenha]` (sem senha informada, gera uma aleatória). Em Docker: `docker compose exec app npm run admin:senha -- admin`.
4. Depois do primeiro login: cadastrar usuários, vincular assistentes às unidades (módulo Administração — T7).

Perfis: **ASSISTENTE** (somente as unidades vinculadas), **COORDENADOR** (todas as unidades), **ADMIN** (TI).

## Segurança e LGPD (resumo)

- Senhas só como hash bcrypt; sessão em cookie `httpOnly`/`sameSite=lax` armazenada no banco; Helmet com CSP restritiva (sem scripts inline); rate-limit no login (10 falhas/15 min por IP); proteção CSRF por cabeçalho `X-Requested-With` (já enviado por `public/js/api.js`).
- O **filtro por unidade é sempre aplicado no back-end** (`clausulaUnidades` / `unidadesPermitidas`). Pessoa é única por CPF no sistema todo, mas atendimentos/acompanhamentos de outra unidade nunca são expostos.
- Não registre CPF/dados pessoais em logs. Auditoria em `dbo.auditoria` + colunas `criado_por/em`, `alterado_por/em`.

## Testes rápidos

```bash
npm run dev
curl http://localhost:3000/api/saude            # {"ok":true}
curl -i http://localhost:3000/api/auth/me       # 401 sem login
```

Depois do `db:migrate`: entrar em `http://localhost:3000`, logar como `admin`, navegar pelas telas-esqueleto (no celular, o menu fica embaixo; no desktop, à esquerda).
