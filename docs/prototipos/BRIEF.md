# Brief — Protótipos visuais (para aprovação do usuário)

Objetivo: 3 propostas de identidade visual BEM DIFERENTES entre si para o ASSOCIAL. O usuário vai abrir os 3 arquivos e escolher a direção (ou misturar). **Não altere o app** (`public/`), só crie o seu arquivo.

## Entrega (cada terminal faz UMA proposta)
Um único arquivo `docs/prototipos/<seu-arquivo>.html`, autocontido (CSS e JS inline são permitidos AQUI — é protótipo, não o app; fontes do Google Fonts permitidas; sem outras dependências externas; ícones em SVG inline).

No topo da página: nome da proposta + 3–4 linhas explicando a ideia (paleta com os hex, tipografia, sensação). Abaixo, as **3 telas**, cada uma mostrada em **duas molduras lado a lado**: celular (390×844, com moldura de aparelho) e desktop (~1280px de largura, escala reduzida se preciso, ex. `transform: scale(.6)` ou rolagem horizontal). Em telas pequenas, empilhe.

1. **Início** da Assistente Social (unidade Brasilândia): saudação, resumo do mês (atendimentos 48, encaminhamentos 31, ações 3, participantes 95, famílias acompanhadas 4), pendências ("Questionário final de Família Santos vence em 5 dias"), atalhos grandes (Novo atendimento, Nova ação, Famílias), navegação (barra inferior no celular / menu lateral no desktop: Início, Atendimentos, Ações, Famílias, Relatórios).
2. **Novo atendimento** (formulário): seções Dados pessoais (CPF com aviso "Cadastro existente — dados preenchidos", nome, nascimento, telefone, endereço...), Demanda (chips/checkbox múltiplos: Atualização do CadÚnico, Novo cadastro do CadÚnico, Informações/Orientações, Saúde, Proteção Social Básica...), Vulnerabilidade (nível em opções), Encaminhamento (CRAS, CREAS, UBS, Centro de Referência da Mulher, Unidade Descomplica...), Resumo, botão Salvar fixo no rodapé no celular. Mostre um campo com erro de validação.
3. **Famílias acompanhadas** (lista): 5 famílias fictícias com responsável, nº membros, data de início, selo do questionário final (Em dia · Vence em 5 dias · Vencido · Concluído), busca e filtros; no celular vira cards.

Dados em português, realistas e fictícios. Interface em português. Mobile-first, alvos de toque ≥ 44px, contraste AA. Inclua estados (hover/foco visível). Não precisa funcionar de verdade — só navegar visualmente (pode ter interações simples: tabs, chips selecionáveis).

Contexto da marca: INTECS (Instituto Nacional de Tecnologia, Educação, Cultura e Saúde) — logo com gradiente laranja → roxo (#F26A21 → #7B3FE4 aprox.); programa "Armazém Solidário" (Prefeitura de SP) usa verde e laranja. Público: assistentes sociais, uso no celular em loja/visita e no PC da loja.

Ao terminar, abra o arquivo no navegador (`cmd //c start "" "<caminho>"`) só se o gerente pedir — apenas reporte: `maestri ask "gerente" "<proposta pronta: caminho, resumo do visual>"`. Sem commit.
