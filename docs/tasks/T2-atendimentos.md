# T2 — Atendimentos (substitui o MS Forms)

Leia primeiro `docs/tasks/_REGRAS-PARALELO.md`. Porta de teste: **3102**.

## Seus arquivos
`server/routes/atendimentos.js`, `server/routes/pessoas.js` (novo), `server/services/atendimentos*.js`, `server/services/pessoas*.js`, `public/atendimentos.html`, `public/js/paginas/atendimentos.js`, `public/js/atendimentos/*`, `public/css/atendimentos.css`, `database/010–019_*.sql`, `tests/atendimentos/`.

## Escopo
1. **API Pessoas** (`/api/pessoas`) — compartilhada com T4 (Famílias), que vai consumir este contrato:
   - `GET /api/pessoas/buscar?cpf=<11 dígitos>` → `{ encontrada: bool, pessoa?: { id, cpf, nome, dataNascimento, nis, endereco, cep, bairro, trabalhoAtual, generoId, escolaridadeId, racaId } }` — **apenas dados pessoais**, nada de atendimentos/acompanhamentos (LGPD, ver CONVENCOES §2.3).
   - `GET /api/pessoas/buscar?nome=<texto>` (mín. 3 letras) → até 20 pessoas que tenham atendimento ou acompanhamento **em unidade permitida** (para não expor o cadastro inteiro).
   - `POST /api/pessoas` (cria; CPF único → 409 se já existe) e `PUT /api/pessoas/:id` (atualiza dados pessoais; permitido para quem tem a pessoa em unidade permitida, ou quando acabou de localizá-la por CPF).
   - Documente o contrato em `docs/API-PESSOAS.md`.
2. **API Atendimentos** (`/api/atendimentos`): listar (filtros: período, unidade permitida, texto nome/CPF, demanda, encaminhamento; paginação), detalhe, criar, editar, excluir (só COORDENADOR/ADMIN ou o próprio autor em até 24h — decisão conservadora, liste em "Decisões a validar"). Criação em uma transação: localizar/criar/atualizar pessoa por CPF + atendimento + N:N (demandas, vulnerabilidades, encaminhamentos) + textos "Outra". Faixa etária calculada pela data de nascimento na data do atendimento.
3. **Tela** (`atendimentos.html`): 
   - Lista mobile-first (cards no celular / tabela no desktop) com filtros e busca.
   - Formulário "Novo atendimento" com os 18 campos da especificação, em seções; ao digitar o CPF válido, busca a pessoa e pré-preenche (indicando "cadastro existente"); múltipla escolha com checkboxes grandes; "Outra" abre campo de texto; unidade automática (seletor só se o usuário tiver mais de uma); data padrão = hoje.
   - Rascunho local do formulário (localStorage com try/catch) para não perder dados se a internet cair; limpar após salvar.
   - Detalhe/edição do atendimento.
4. Histórico da pessoa: no detalhe, listar os atendimentos dela **somente da(s) unidade(s) permitida(s)**.

## Fora do escopo
Painel/indicadores (T6), relatórios (T5).
