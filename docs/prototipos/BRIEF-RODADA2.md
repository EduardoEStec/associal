# Brief — Rodada 2: 3 variações da Proposta B com a identidade do site intecsbr.org

O usuário **escolheu a Proposta B** (`docs/prototipos/proposta-B-acolhedor.html`) — gostou da cara de app acolhedor: cards bem arredondados, tiles coloridos com ícones grandes, botões "gordinhos", herói de boas-vindas, barra inferior no celular, selos com ícone+texto, chips grandes. **Mantenha essa estrutura e essa sensação**, mas troque a identidade visual pela do site oficial **intecsbr.org**.

**Ponto de partida obrigatório:** copie `proposta-B-acolhedor.html` para o seu arquivo e evolua a partir dele (mesmas 3 telas — Início, Novo atendimento, Famílias — em celular 390×844 + desktop 1280, mesmo conteúdo fictício). Corrija um defeito da B: no desktop a coluna de pendências ("Pra ficar de olho") ficou estreita demais e o texto quebra palavra a palavra — dê largura adequada.

## Identidade do site intecsbr.org (extraída do CSS e de screenshots)
Referência visual: `docs/prototipos/assets/referencia-site-intecs.png` (abra e olhe).
- **Logo**: `assets/intecs-logo-laranja.png` (wordmark "intecs" laranja, letras arredondadas) e `assets/intecs-submarca.png` (ícone quadrado). Use o logo real (caminho relativo `assets/...`) no cabeçalho/menu.
- **Cores**: Laranja INTECS `#FF7507` (cor da marca, botões CTA em pílula, títulos de seção) · Roxo `#5C3EEB` (hover `#5036CC`) · Azul `#1739FF` · Verde `#32A64E` (é a cor do card "Assistência Social" no site) · Creme `#FDF6E9` (fundo de seção) · Cinzas `#ECECEC` / `#F1F1F1` / `#9B9B9B` · Texto `#1D1D1F`/preto.
- **Assinatura gráfica**: gradiente **laranja → roxo → azul** (`#FF7507 → #5C3EEB → #1739FF`) em faixas largas e como **sublinhado fino sob os títulos de seção** (título laranja + linha gradiente de ~3px). Cards de áreas com **fundo de cor sólida** (verde / roxo / laranja) e texto branco, ícones de linha brancos. Botões em **pílula** (border-radius 999px), laranja com texto branco e caixa alta pequena.
- **Tipografia**: **Inter** (400/600/700/800) em tudo; títulos em peso 700–800. (O site usa Dancing Script só como detalhe decorativo — opcional e com muita parcimônia.)
- Cantos de cards ~16–20px, fotos/blocos arredondados, muito espaço em branco.

**Acessibilidade**: laranja `#FF7507` com texto branco NÃO atinge AA em texto pequeno — para texto/botões use texto branco em **negrito ≥ 16px** ou um laranja mais escuro para texto (`#C2410C` ou similar) e documente. Verde `#32A64E` idem (use `#1E7A36` para texto). Foco visível, alvos ≥ 44px.

## Entrega
Arquivo autocontido em `docs/prototipos/` (CSS/JS inline OK; Google Fonts OK; imagens só de `assets/`). No topo: nome da variação, 3–4 linhas explicando, paleta com hex. Verifique renderizando no Chrome headless (`"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --screenshot=... --window-size=1400,2600 file:///...`) e olhe o screenshot antes de entregar. Não toque no app. Sem commit.
Reporte: `maestri ask "gerente" "<variação pronta: caminho, resumo>"`.
