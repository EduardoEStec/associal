# T1 — Fundação

Leia antes: `docs/ESPECIFICACAO.md` (fonte da verdade; stack já decidida, não altere).

## Objetivo
Criar a base do projeto em `C:\Projetos\ASSOCIAL` sobre a qual as tasks T2–T7 serão construídas **em paralelo** por outros terminais. Portanto: estrutura clara, convenções explícitas e o **schema completo do banco** para todos os módulos.

## Entregas
1. **Estrutura**: `/server` (app Express, `db.js` com pool `mssql`, middlewares, rotas por módulo em `/server/routes/<modulo>.js`), `/public` (html/css/js), `/database`, `/docs`. `package.json` com scripts `start`, `dev` (node --watch), `db:migrate` (executa os .sql em ordem).
2. **Banco (SQL Server)** — `database/001_schema.sql` cobrindo TODOS os módulos da especificação: unidade, usuario, usuario_unidade, perfis; tabelas de apoio (opcoes por tipo: demanda, encaminhamento, vulnerabilidade, escolaridade, raca, genero, faixa_etaria, nivel_vulnerabilidade, tema, tipo_acao, beneficio, destino_economia...); pessoa (CPF único); atendimento + tabelas N:N (demandas, vulnerabilidades, encaminhamentos); acao_visita + temas + fotos; familia, familia_membro, acompanhamento, questionario (tipo INICIAL/FINAL) com respostas estruturadas (colunas tipadas para as fechadas + texto para as abertas; múltiplas em tabela N:N); configuracao (chave/valor, ex. prazo_questionario_final_dias); auditoria (criado_por/em, alterado_por/em). Scripts idempotentes (IF NOT EXISTS). `002_seed.sql`: 7 unidades, todas as opções da especificação, usuário ADMIN inicial (senha via instrução documentada — gerar hash bcrypt), config padrão.
3. **Auth e permissões**: login/logout (`express-session`, bcrypt), `/api/auth/me`; middleware `requireAuth`, `requirePerfil(...)`, e helper `unidadesPermitidas(req)` que todas as rotas devem usar para filtrar por unidade. Rate-limit simples no login. Helmet.
4. **Front base mobile-first**: `public/css/` com design tokens (variáveis CSS), componentes reutilizáveis (botões, cards, formulários, tabela responsiva que vira lista no celular, toast, modal); `public/js/api.js` (fetch wrapper com tratamento de 401), `public/js/layout.js` (cabeçalho, menu inferior no celular / lateral no desktop conforme perfil); páginas: `login.html`, `index.html` (início com atalhos), e páginas-esqueleto vazias para os módulos (atendimentos, acoes, familias, relatorios, painel, admin) com o layout aplicado. PWA: manifest + service worker mínimo.
5. **Docker**: `Dockerfile`, `docker-compose.yml` (app + volume uploads, SQL Server externo via .env), `docker-compose.dev.yml` (SQL Server 2022 local para teste), `.env.example`, `.dockerignore`, `.gitignore`.
6. **Docs**: `README.md` (como rodar local e com Docker, como criar o banco, primeiro login) e `docs/CONVENCOES.md` explicando para os próximos devs: como criar uma rota de módulo, como aplicar filtro de unidade, como criar uma página usando o layout/componentes, padrões de validação e de erro da API.
7. `git init` e um commit inicial (mensagem terminando com `Co-Authored-By: Claude <noreply@anthropic.com>`).

## Restrições
- Não implemente as telas/regras dos módulos T2–T7, só o esqueleto e o schema.
- Não há SQL Server disponível agora (credenciais virão depois): valide que o app sobe e que os scripts SQL são sintaticamente coerentes; se conseguir, teste com o compose dev.
- Interface em português.

## Ao terminar
Reporte ao gerente com: `maestri ask "gerente" "<resumo: arquivos principais, tabelas criadas, como testar, pendências>"`.
