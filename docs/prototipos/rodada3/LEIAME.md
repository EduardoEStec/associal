# Rodada 3 — três direções para a tela Início

Escopo: **somente a tela Início**, para escolher o estilo. Cada HTML é autocontido (CSS/JS, logo e fonte Inter embutidos; sem CDN) e abre direto no navegador. Dados fictícios. Os demais itens do menu mostram um aviso e não navegam.

Em todas: identidade B1 (laranja INTECS + logo azul), fundo branco, cards neutros (cor só no ícone), ícones SVG de linha, sem emojis, escala atual (html 75%, botões ~36px), menu lateral no desktop e barra inferior no celular, saudação por horário sem frase abaixo. Fluidez: skeleton ao carregar, entrada animada escalonada, hover/foco, contadores animados, barra de progresso de carregamento, e `prefers-reduced-motion` desliga animações e escalonamentos.

| Proposta | Arquivo | Prints (1366 / 390) |
|---|---|---|
| **A · Correnteza** (fluida e suave) | `proposta-a-correnteza.html` | `prints/proposta-a-correnteza-inicio-1366.png`, `...-390.png` |
| **B · Revista** (editorial e espaçosa) | `proposta-b-revista.html` | `prints/proposta-b-revista-inicio-1366.png`, `...-390.png` |
| **C · Operação** (densa e produtiva) | `proposta-c-operacao.html` | `prints/proposta-c-operacao-inicio-1366.png`, `...-390.png` |

## A · Correnteza
**Conceito:** o app "escorrega". Herói laranja com ondas lentas, cards com sombra em camadas que sobem no hover, indicador do menu que **desliza** entre itens (barra lateral e inferior), números que contam, agenda com ponto pulsante.
**Muda em relação ao app atual:** herói e tiles ganham movimento; "Seu mês" vira um card único com 6 mini-cards; entra uma **Agenda de hoje**; "Pra ficar de olho" fica ao lado em coluna própria; atalhos viram 4 cards em linha.
**Esforço para aplicar:** baixo–médio. Quase tudo é CSS (`inicio.css`, `layout.css`, `componentes.css`); o indicador deslizante e o contador pedem ~40 linhas de JS no `layout.js`. A agenda precisa de dado novo (API).

## B · Revista
**Conceito:** tipografia manda. Saudação enorme com fio em gradiente, números grandes separados por filetes, listas em linhas (sem caixas), menu lateral só texto com barra laranja no item ativo. Um único bloco laranja de destaque: **Próximo compromisso**.
**Muda:** troca o herói por tipografia + destaque; "Seu mês" vira faixa de 4 números; pendências e atalhos viram índices com linha que se desenha no hover. É a mais espaçosa (menos informação por tela).
**Esforço:** médio. Muda a estrutura do HTML do Início e o visual do menu; a lógica não muda. Demais telas precisariam do mesmo tratamento de títulos/seções para ficar coerente.

## C · Operação
**Conceito:** app de gestão. Faixa laranja enxuta, **KPIs com sparklines** numa só barra, **Minha fila** em tabela (prazo com selo), agenda compacta, atalhos com teclas (N = novo atendimento), busca global com **Ctrl K** (paleta animada) e menu lateral que é **trilho de ícones** e expande ao passar o mouse.
**Muda:** mais densidade (tudo cabe em uma tela de 1366×768); pendências viram tabela; entra a busca global no topo. No celular vira barra inferior e tabela compacta.
**Esforço:** médio–alto. Trilho recolhido muda o layout de todas as páginas; a busca global exige endpoint de busca; a tabela de fila e as sparklines pedem dados agregados.

## Observações
- O tempo do skeleton é fixo no mockup (≈0,5–0,9 s); no app real vale o tempo da API.
- Para ver o skeleton de novo, recarregue a página; com "reduzir movimento" no sistema ele some quase de imediato.
- Mockups só em `docs/prototipos/rodada3/`; nada em `public/` ou `server/` foi alterado, nada foi commitado.
