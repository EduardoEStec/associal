# Rodada 4 — três versões sóbrias da tela Início

Resposta a "muito coloridos e pouco profissionais". Regras seguidas nas três: quase monocromático (branco, cinzas, texto quase preto); laranja INTECS só como acento mínimo (item ativo do menu em texto + linha fina, foco e hover de link); sem faixa/herói/bloco laranja, gradiente, ondas, fundos coloridos, selos ou alertas — estado com texto + ponto cinza discreto (vencido: texto em vermelho escuro); logo azul só no tamanho dela; bordas de 1px, sombras nulas, raios de 4–6px; sem emojis; ícones de linha cinza. Fluidez discreta: skeleton cinza, fade curto de entrada, hover com fundo cinza sutil, `prefers-reduced-motion` desliga tudo.

Conteúdo igual ao app real: saudação por horário (sem frase extra), unidade e data; **Seu mês — 10/2026** (Atendimentos, Ações realizadas, Participantes, Famílias acompanhadas, Total de atendimento, % encaminhamentos); **O que vamos fazer?** (Atendimentos, Ações, Famílias, Relatórios, Painel, Administração); **Pendências** (questionário final vencido/a vencer, sem contato há 30+ dias, pesquisa de satisfação pendente). Menu lateral no desktop, barra inferior no celular, usuário no topo. Dados fictícios; só o Início está pronto.

| Proposta | Arquivo | Prints |
|---|---|---|
| **A · Corporativo** | `proposta-a-corporativo.html` | `prints/proposta-a-corporativo-inicio-1366.png` / `-390.png` |
| **B · Institucional** | `proposta-b-institucional.html` | `prints/proposta-b-institucional-inicio-1366.png` / `-390.png` |
| **C · Minimal** | `proposta-c-minimal.html` | `prints/proposta-c-minimal-inicio-1366.png` / `-390.png` |

- **A · Corporativo** (estilo Linear/Stripe): painéis com cabeçalho cinza e borda fina; "Seu mês" como faixa de 6 indicadores divididos por linhas; Pendências em **tabela** (tipo, família, situação, ação em link sublinhado); atalhos como lista em linhas com ícone. Mais denso. Esforço: baixo–médio (reestiliza `inicio.css`/`componentes.css`; Pendências viram `<table>`).
- **B · Institucional** (estilo GOV.UK/GOV.BR): faixa de cabeçalho cinza com linha escura no topo, trilha "Início", títulos grandes e seções separadas por régua escura de 2px; "Seu mês" como lista chave–valor em 2 colunas; Pendências com filete lateral cinza (vermelho escuro se vencida); atalhos como links em grade 3×2. Esforço: médio (novo cabeçalho global e estrutura de seções).
- **C · Minimal** (estilo Notion/Vercel): sem caixas, muito espaço; saudação grande e leve; "Seu mês" como grade de números grandes; atalhos e pendências em listas com linha fina; menu só com texto/ícone cinza. Menos informação por tela. Esforço: baixo (remove bordas/cards; ajusta tipografia e espaçamento).

Nada em `public/` ou `server/` foi alterado e nada foi commitado.
