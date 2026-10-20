# V1 — Aplicar a identidade visual B1 "Laranja INTECS" no app

O usuário aprovou `docs/prototipos/proposta-B1-laranja.html`. Aplique esse visual **no app real** (`public/`), em todas as telas. Ajustes finos de layout o usuário fará depois, aos poucos — o objetivo agora é o app inteiro com a cara da B1, consistente e sem quebrar nada.

## Escopo
1. **Design tokens** (`public/css/tokens.css`): paleta da B1 (laranja #FF7507 e variações, roxo #5C3EEB, azul #1739FF, verde #32A64E p/ sucesso, creme #FDF6E9, cinzas, texto #1D1D1F, cores de estado), raios (cards ~22px, pílula 999px), sombras, espaçamentos, tipografia **Inter**. Mantenha os NOMES de variáveis já usados pelo app sempre que possível (os CSS dos módulos dependem deles); se renomear, atualize todos os usos.
2. **Fonte Inter auto-hospedada** em `public/fonts/` (woff2 400/600/700/800 + `@font-face`) — a CSP do app não libera Google Fonts; não afrouxe a CSP.
3. **Logo**: copie `docs/prototipos/assets/intecs-logo-laranja.png` e `intecs-submarca.png` para `public/img/`; use o logo no cabeçalho do celular, no menu lateral do desktop e na tela de login. Atualize ícones do PWA/manifest com a submarca se fizer sentido (cor de tema laranja).
4. **Componentes** (`public/css/componentes.css`): botões em pílula (primário laranja, secundário, texto, perigo), chips/opções grandes (selecionado em laranja), cards 22px, campos com foco visível **azul #1739FF**, selos com ícone+texto, avisos, tabela responsiva, toast, modal, títulos de seção laranja com **sublinhado gradiente laranja→roxo→azul**.
5. **Layout** (`public/css/layout.css` + `public/js/layout.js`): barra inferior no celular com item ativo laranja e filete gradiente no topo; menu lateral no desktop com logo e item ativo em pílula laranja; cabeçalho como na B1. Não altere a lógica de perfis/`ITENS_MENU` (só apresentação).
6. **Telas**: login (com logo e visual B1), início (herói laranja de boas-vindas com faixa gradiente, resumo em tiles suaves nas 4 cores, atalhos em blocos sólidos, "Pra ficar de olho"), e revise **todas** as páginas dos módulos (`atendimentos`, `acoes`, `familias`, `relatorios`, `painel`, `admin`) e seus CSS (`public/css/<modulo>.css`) trocando cores fixas por tokens e alinhando ao visual B1 (cards, chips, selos de status das famílias como na B1, gráficos do painel usando a paleta). Não mude comportamento/JS de negócio.
7. **Contraste (correção pedida)**: texto branco sobre o laranja #FF7507 não atinge AA em texto normal. Botões e qualquer texto pequeno sobre laranja devem atingir **≥ 4,5:1** — use um laranja mais profundo para o fundo de botões (ex.: ~#C2410C/#D4540A — escolha mantendo a cara da marca) e reserve o #FF7507 vivo para superfícies grandes com texto grande/negrito (herói) e detalhes. Documente as escolhas no topo de `tokens.css`.
8. Suba `VERSAO` em `public/sw.js` e inclua `/img/*` e fontes se precacheadas.

## Como validar
- O app sobe (`PORT=3110 node server/index.js`) contra o SQL Server de teste do Docker (o `.env` já aponta; usuários de teste `e2e_assist`, `e2e_coord`, `e2e_admin`, senha `Teste@2026`; **não** altere a senha do `admin`).
- Faça screenshots com Chrome headless logado (ex.: Puppeteer não está instalado — use `--remote-debugging` ou um script com `fetch` para obter o cookie e injetar via `--user-data-dir`/DevTools; ou simplesmente valide pelas páginas públicas + login e descreva). No mínimo: login, início, atendimentos (lista e novo), famílias, painel — em 390px e 1280px. Use `--disable-gpu --user-data-dir=<pasta própria>`.
- `node --check` nos JS alterados; rode as suítes de teste existentes (`tests/*`) para garantir que nada quebrou.

## Regras
Sem commit (o gerente commita). Não altere regras de negócio, rotas ou SQL. Ao terminar: `maestri ask "gerente" "<V1 concluída: arquivos, decisões de cor/contraste, screenshots feitos, o que não foi validado>"`.
