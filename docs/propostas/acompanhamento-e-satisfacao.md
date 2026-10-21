# Proposta — Acompanhamento das famílias e pesquisa de satisfação

Status: **proposta (F1) — nenhum código, migração ou commit foi feito.** Depende das decisões da seção 9.
Origem: pedido do usuário — "esse sistema precisa ter todo acompanhamento das famílias e entender como estão progredindo, se o projeto está sendo bom ou ruim, como uma pesquisa de satisfação".

## 0. Resumo

Hoje o ASSOCIAL mede **a operação** (atendimentos, ações, participantes, famílias em acompanhamento) e **dois retratos** de cada família (questionário inicial e final, com prazo de 90 dias). Entre os dois retratos, e depois deles, o sistema não sabe nada: não há registro de contato ou visita à família, não há plano/metas, não há índice de progresso, e a única "voz da família" sobre o projeto são 3 perguntas do bloco 5, respondidas por intermédio da própria assistente.

A proposta tem seis peças que se encaixam no que já existe:

1. **Registro de acompanhamento** (contato/visita curto, em 30 segundos no celular) com a situação da família.
2. **Plano de metas** da família, com status.
3. **Linha do tempo** da família, montada a partir de tudo que já é gravado + os registros novos (consulta, não tabela duplicada).
4. **Índice de progresso por dimensão** (alimentação, renda, economia/poupança, autonomia) calculado a partir do questionário, com semáforo melhorou / igual / piorou e gráfico; opcionalmente uma **reavaliação rápida** no meio do prazo para ter mais de 2 pontos no tempo.
5. **Pesquisa de satisfação do projeto** respondida pela família (NPS 0–10 + 6 perguntas Likert + 2 textos), **híbrida quanto ao anonimato** (resposta sem vínculo com a família, controle de quem já respondeu separado), aplicada primeiro no aparelho da unidade e, depois, por link/QR se a TI puder publicar um endereço público mínimo.
6. **Visão do coordenador**: % de famílias que melhoraram, NPS/satisfação por unidade e período, alertas de família sem contato há X dias, e novas seções no relatório semestral e no individual.

Entrega em 6 etapas (F2 a F7), começando pelo que gera dado mais cedo (registros e satisfação), porque indicadores só existem depois que há dado acumulado. As decisões que dependem do usuário estão na seção 9, cada uma com a recomendação.

---

## 1. O que existe hoje

### 1.1 Banco (`database/`)

| Script | Conteúdo |
|---|---|
| `001_schema.sql` | Schema completo (perfis, unidades, usuários, tabelas de apoio, pessoa, atendimento, ação/visita, família, acompanhamento, questionário, configuração, auditoria) |
| `002_seed.sql` | Perfis, unidades, apoio, configurações (`prazo_questionario_final_dias` = 90, `alerta_questionario_final_dias_antes` = 15…) |
| `010`, `020`, `030`, `040` | Índices de apoio de atendimentos, ações, famílias e painel |
| `060_admin.sql` | Índice da auditoria |
| `070_pessoa_telefone.sql` | `pessoa.telefone` e `telefone2` (já aplicado no Docker de teste; no SQL Server real continua pendente, ver nota na seção 8) |

A faixa `050` está livre (era dos relatórios, que não precisaram de tabela). **A próxima numeração livre é `080`.**

Tabelas que importam para esta proposta:

- `pessoa` (global por CPF), `familia` (1 por responsável), `familia_membro` (nome, nascimento/idade, gênero, parentesco, trabalha; **não são `pessoa`**, não têm CPF).
- `acompanhamento`: família numa unidade, assistente responsável, `data_inicio`, `data_prevista_final`, `data_encerramento`, `status` (`EM_ANDAMENTO` | `CONCLUIDO` | `DESLIGADO`), `observacoes` (texto único). No máximo 1 em andamento por família.
- `questionario` (`INICIAL` | `FINAL`, unique por acompanhamento+tipo; colunas fixas por pergunta; `concluido`; rascunho) + `questionario_beneficio` e `questionario_destino_economia`.
- `atendimento` (+ demanda, vulnerabilidade, encaminhamento): ligado a `pessoa_id` e `unidade_id`, **não** ao acompanhamento.
- `acao_visita` (+ tema, foto): ação/visita institucional **da unidade** (data, local, temas, participantes, status). Sem vínculo com família.
- `configuracao` (chave/valor editável pela aba Configurações), `auditoria` (CRIAR, ALTERAR, EXCLUIR, LOGIN…, CONSULTAR).

### 1.2 Questionário familiar (5 etapas)

Uma única tabela com as mesmas colunas para inicial e final (o texto da final fala no presente: "hoje…"):

| Bloco | Perguntas | Tipo |
|---|---|---|
| 1 Dados da família | 1a nº de pessoas · 1b renda mensal média (R$) · 1c nº com renda · 1d recebe auxílio (+ quais) | número, moeda, sim/não, múltipla |
| 2 Alimentação | 2a acesso a in natura · 2b frequência de frutas/verduras · 2c qualidade da alimentação · 2d saúde/bem-estar nutricional | escalas ordenadas (`ESCALAS` em `server/services/questionario.js`) |
| 3 Economia | 3a consegue poupar · 3b economia mensal no armazém (faixa + valor) · 3c destino da economia · 3d capacidade de poupança · 3e dívidas/gestão financeira | sim/não, escalas, múltipla |
| 4 Empoderamento | 4a mais empoderada(o) para decidir · 4b autonomia (texto) · 4c planeja melhor os gastos · 4d impacto na comunidade (texto) · 4e o que melhorar (texto) | sim/não e textos |
| 5 Percepção | 5a avaliação do armazém (ótima/boa/regular/ruim) · 5b principal benefício (texto) · 5c recomendaria (sim/não) | escala, texto, sim/não |

### 1.3 Comparação, alertas, relatórios, painel

- **Comparação por família** (`GET /api/familias/acompanhamentos/:id/comparacao`): pergunta a pergunta, `melhorou | igual | piorou | neutro | sem_dados`, variação de renda e de economia, "passou a poupar". Sai um `resumo` com contagem de **itens** (ex.: 8 melhoraram, 4 iguais, 1 piorou).
- **Comparação consolidada** (`GET /api/familias/comparacao`): famílias com os dois questionários concluídos; distribuição antes/depois por pergunta fechada, média de renda e economia, % que passou a poupar, quebra por unidade. Usada só no relatório semestral.
- **Alertas** (`/api/painel/alertas` e bloco da tela Início): questionário final vencendo/vencido (por unidade) e ações planejadas cuja data passou sem atualização.
- **Relatório individual .docx**: identificação, diagnóstico inicial, impacto, feedback (texto gerado do bloco 5 do final), considerações; textos editáveis antes de gerar.
- **Relatório semestral .docx**: atendimentos, encaminhamentos, visitas/ações, empoderamento econômico (consolidado inicial × final), fotos por unidade.
- **Painel do coordenador**: KPIs por unidade e mês (atendimentos, encaminhamentos, ações, participantes, famílias acompanhadas, % encaminhamentos), evolução mensal, perfil do público, alertas. Exporta CSV.

### 1.4 O que já mede progresso

Somente a comparação inicial × final por família e o consolidado no relatório semestral. É um bom começo: já existem a direção de "melhora" por pergunta, a regra de elegibilidade (ambos concluídos) e o consolidado por unidade.

### 1.5 Lacunas

| # | Lacuna | Consequência |
|---|---|---|
| L1 | **Só 2 pontos no tempo**, com 90 dias entre eles. Nada entre o início e o fim, e nada depois do encerramento | Ninguém sabe se uma família em andamento está evoluindo ou estagnada até o final vencer |
| L2 | **Não há histórico de contato/visita.** `acao_visita` é ação institucional da unidade (sem família); `atendimento` liga à pessoa (e só ao responsável, pois membros não são `pessoa`), não ao acompanhamento | Não dá para saber quando a assistente falou com a família pela última vez, nem alertar "sem contato há X dias" |
| L3 | **Sem plano/metas.** `acompanhamento.observacoes` é um campo único, sobrescrito | O acompanhamento não tem objetivo verificável |
| L4 | **Sem índice sintético.** O `resumo` conta itens, não dimensões; não há série por família nem gráfico | Difícil responder "esta família melhorou?" de relance |
| L5 | **Fragilidade metodológica do instrumento.** 2c, 2d e 3e perguntam "melhorou?" (mudança) mas são tratadas como estado ordenado também no inicial (a tela orienta "registre a percepção atual"); 4a e 4c ("mais empoderada", "planeja melhor") têm o mesmo problema; 1b é renda **total** (cresce se a família aumenta); 3b depende de comprar no armazém | Parte da "melhora" é artefato de pergunta, e isso aparece nos relatórios |
| L6 | **A voz da família é fraca e enviesada.** Só 5a/5b/5c, aplicadas pela assistente à própria família, sem anonimato, sem NPS, sem avaliar o acompanhamento em si, e também no inicial (quando a família ainda não conhece o projeto) | Não responde "o projeto é bom ou ruim?" com credibilidade |
| L7 | **Painel só mede operação.** Não há "% de famílias que melhoraram", taxa de conclusão x desligamento, tempo médio, satisfação por unidade | O coordenador não vê resultado, só volume |
| L8 | **Desligamento sem motivo estruturado** (texto em `observacoes`) | Não se analisa por que as famílias saem, que é um sinal direto de qualidade |
| L9 | **Encaminhamento sem retorno.** Só existe dentro do atendimento; não se registra se resolveu | Perde-se o "efeito" do encaminhamento |
| L10 | **Relatório individual só mostra o antes e o depois**, não o processo (contatos, metas) | Relatório menos defensável na prestação de contas |

---

## 2. Princípios do desenho

1. **Reaproveitar antes de criar.** Linha do tempo é consulta sobre o que já existe; encaminhamentos, configuração, auditoria, filtro por unidade, SVG de gráficos e geração de .docx são os já usados.
2. **Registro curto vence registro completo.** Se o contato leva mais de 1 minuto no celular, não será preenchido. Os campos obrigatórios são poucos.
3. **Número sempre com o n ao lado** e sem percentual quando o n é pequeno (poucas famílias por unidade em cada semestre).
4. **Acessível sem cor** (semáforo = ícone SVG + palavra, sem emoji, como já feito na comparação) e no visual sóbrio atual (fundo branco, laranja só como acento, sem emojis).
5. **LGPD por padrão**: filtro por unidade no back-end em tudo (`clausulaUnidades`), menor visibilidade possível para texto livre, satisfação sem vínculo com a família (seção 6).
6. **Tudo editável pelo coordenador/admin sem deploy**: prazos, tolerâncias e limiares em `configuracao`; tipos de contato como tabela de apoio.
7. **Cada entrega gera valor sozinha**, com testes no padrão de `tests/familias` (API com banco real no Docker de teste) e validação visual desktop/celular como nas fases V.

---

## 3. (a) Linha do tempo da família

### Conceito
Uma lista cronológica (mais recente primeiro) na ficha da família, com filtros por tipo, montada **por consulta** (`UNION ALL`) no momento da leitura. Nenhuma tabela `evento` duplicando dados: só as fontes novas ganham tabela própria.

### Eventos

| Tipo | Fonte | Existe hoje? | Título exibido |
|---|---|---|---|
| INICIO | `acompanhamento.data_inicio` | sim | "Início do acompanhamento" |
| QUESTIONARIO | `questionario` (concluído; data = `data_aplicacao`) | sim | "Questionário inicial / final / reavaliação concluído" |
| REGISTRO | `acompanhamento_registro` | **novo** | tipo de contato + situação da família + resumo |
| META | `acompanhamento_meta` (criada, atingida, não atingida) | **novo** | "Meta: …" |
| ATENDIMENTO | `atendimento` onde `pessoa_id` = responsável **e** `unidade_id` permitida | sim (vínculo por CPF do responsável) | demanda(s), encaminhamento(s) |
| ACAO | `acao_visita_familia` (família marcada como presente) | **novo, opcional** | tipo e tema da ação |
| ENCAMINHAMENTO | `atendimento_encaminhamento` + `registro_encaminhamento` | parcial | aparece como "chips" dentro do evento pai |
| PESQUISA | `pesquisa_convite` (somente "foi oferecida / foi respondida", nunca o conteúdo) | **novo** | "Pesquisa de satisfação respondida" |
| PRAZO | virtual: `data_prevista_final` | sim | "Prazo do questionário final" (futuro, em destaque se vencido) |
| ENCERRAMENTO | `acompanhamento.data_encerramento` + status | sim | "Concluído / Desligado" (+ motivo, ver L8) |

Cada evento devolve `{ data, tipo, titulo, resumo, autor, referencia: { tipo, id } }`, paginado por data.

### Regras
- **Atendimentos de outra unidade nunca aparecem** (a mesma regra de CONVENCOES §2.3: nem como contador). O `JOIN` leva `clausulaUnidades(req, 'a.unidade_id')`.
- Atendimentos anteriores ao início do acompanhamento aparecem agrupados como "Antes do acompanhamento" (contexto), os de depois entram na cronologia.
- Limitação conhecida: **atendimentos de outros membros da família não entram**, porque só o responsável é `pessoa` com CPF. Aceitável na v1; a evolução natural é permitir vincular um membro a uma `pessoa` (fora desta proposta).
- Para ASSISTENTE: família da(s) sua(s) unidade(s). COORDENADOR: todas. ADMIN: ver decisão D11 (recomendação: sem acesso aos textos livres).

### Tela
Na ficha da família (hoje `familias/detalhe.js`), virar abas: **Resumo · Linha do tempo · Registros · Metas · Indicadores · Questionários**. No celular, abas roláveis na horizontal; a linha do tempo é uma lista vertical com marcador por tipo (ícone SVG existente no `layout.js`: `check`, `relogio`, `alerta`, `editar`…, mais 3 ou 4 novos).

---

## 4. (b) Acompanhamentos periódicos: registro, metas e status

### 4.1 Registro de acompanhamento

Um registro por contato ou visita. Campos pensados para o celular (um botão fixo "Registrar contato" na ficha da família):

| Campo | Tipo | Observação |
|---|---|---|
| Data | data (padrão hoje, não futura) | |
| Tipo de contato | lista (tabela de apoio `tipo_contato`, editável pelo ADMIN) | semente: Visita domiciliar · Atendimento na unidade · Telefone · WhatsApp · Encontro/ação coletiva (ver D8: depende de como o projeto de fato acompanha) |
| Conseguiu falar com a família? | Sim / Não | "Não" é registro de tentativa (busca ativa) e também conta como esforço |
| Como a família está? | Melhorando · Igual · Piorando · Não sei (4 botões grandes) | é o **semáforo qualitativo** da assistente |
| Resumo | texto curto, até 1000 caracteres | orientação na tela: "não registre detalhes de saúde nem de violência aqui" |
| Metas tratadas | chips das metas abertas, cada uma com status (opcional) | gera histórico de cada meta |
| Encaminhamentos | múltipla, reaproveita `encaminhamento` (opcional, recolhido) | |
| Próximo contato | data (sugerida = hoje + intervalo configurado) | alimenta o alerta de contato atrasado |

Regras: só em acompanhamento `EM_ANDAMENTO`; editável pelo autor e pelo COORDENADOR; sem exclusão física na v1 (anulado com motivo, auditado). Gravar sempre `criado_por`/`registrarAuditoria`.

### 4.2 Plano de metas

Cada acompanhamento pode ter metas (recomendação: 1 a 5 abertas):

| Campo | Observação |
|---|---|
| Dimensão | `ALIMENTACAO` · `RENDA` · `ECONOMIA` · `AUTONOMIA` · `ACESSO_A_DIREITOS` (documentos, benefícios, saúde, escola) · `OUTRA` — códigos fixos em `dominios.js`, alinhados às dimensões do índice |
| Descrição | até 300 caracteres. Ex.: "Passar a comprar frutas e verduras 3x por semana" |
| Prazo | data, opcional |
| Status | `ABERTA` → `EM_ANDAMENTO` → `ATINGIDA` / `NAO_ATINGIDA` / `CANCELADA` |
| Data de conclusão | preenchida ao fechar |

A meta nasce no primeiro contato após o questionário inicial (a tela do inicial pode terminar com "Definir metas da família", sem obrigar). O histórico de status por contato fica em `registro_meta` (status registrado em cada visita).

### 4.3 Status do acompanhamento

Os três status atuais (`EM_ANDAMENTO`, `CONCLUIDO`, `DESLIGADO`) continuam. Duas mudanças pequenas:
- **Motivo estruturado do desligamento** (lista de apoio `motivo_desligamento`: mudou de bairro, não localizada, sem interesse, conseguiu autonomia, outro) além do texto — resolve L8.
- **Sinais derivados, sem novo status**: "sem contato há X dias" (último registro/atendimento), "contato atrasado" (passou o `proximo_contato_em`), "meta vencida", "piorando" (últimos 2 registros). São calculados e aparecem como selos na lista de famílias e como alertas.

### 4.4 Telas
- Lista de famílias: coluna/selo "Último contato há N dias", selo da última situação, filtro "sem contato há mais de X dias".
- Início (assistente): card "Famílias sem contato" ao lado de "Questionários finais a vencer".
- Ficha: aba Registros (lista e botão) e aba Metas.

---

## 5. (c) Indicadores de progresso por família

### 5.1 Dimensões

Quatro dimensões de **progresso**, calculadas do questionário, mais o índice geral. O bloco 5 (percepção) **não** entra: pertence à satisfação.

| Dimensão | Itens do questionário | Observações |
|---|---|---|
| Alimentação | 2a, 2b (estado) · 2c, 2d (percepção) | 2c/2d só entram no nível quando há dado e com peso reduzido (ver 5.2) |
| Renda e trabalho | 1b renda **per capita** (1b ÷ 1a) · 1c proporção com renda (1c ÷ 1a) | per capita corrige L5; níveis por faixa de salário mínimo (ver 5.2) |
| Economia e poupança | 3a, 3b, 3d · 3e (percepção) | |
| Autonomia | 4a, 4c | autopercepção; ver decisão D10 sobre acrescentar itens ao instrumento |

### 5.2 Cálculo (proposta, tudo em função pura e testável, como `compararFamilia`)

Cada resposta vira uma pontuação 0–100:
- **Escalas ordenadas**: posição na escala ÷ (nº de opções − 1) × 100 (a ordem já existe em `ESCALAS`). Ex.: acesso a in natura: NAO_TINHA 0 · 1-2x 33 · 2-3x 67 · DIARIO 100.
- **Sim/não** (onde "sim" é melhor): 0 ou 100.
- **Renda per capita**: faixas de salário mínimo, valor de referência em `configuracao` (`salario_minimo_referencia`, atualizado todo ano): até ¼ → 0 · ¼ a ½ → 33 · ½ a 1 → 67 · acima de 1 → 100. A faixa ½ SM é a linha de baixa renda do CadÚnico, que o público já conhece.
- **Nível da dimensão** = média dos itens respondidos; **só existe** se pelo menos metade dos itens da dimensão tiver resposta, senão fica vazio (nunca zero).
- **Itens de percepção de mudança** (2c, 2d, 3e): pesam metade no inicial e inteiro no final (no inicial medem "como está" sem referência de mudança).
- **Índice geral** = média simples das dimensões com nível (pesos configuráveis num passo futuro).
- **Semáforo** de uma comparação entre dois pontos: diferença de nível ≥ +tolerância → **melhorou**; ≤ −tolerância → **piorou**; entre os dois → **igual**. Tolerância inicial 5 pontos (`indice_tolerancia_pontos`), pois um degrau de escala move de 25 a 50 pontos num item e a média amortece. Sem dado nos dois pontos → "sem dados".

Cada cálculo grava `versao_regra`, para que mudar a fórmula no futuro não reescreva a história sem querer: o relatório diz com qual regra cada número foi calculado, e é possível recalcular tudo por script.

### 5.3 Mais de dois pontos no tempo

Para evitar que o gráfico tenha só 2 pontos (L1), duas fontes:

1. **Reavaliação rápida** (recomendada, D9): um terceiro tipo de questionário `REAVALIACAO` com o subconjunto de itens de **estado** (1b, 1c, 2a, 2b, 3a, 3b, 3d, 4a, 4c, ≈9 perguntas, menos de 3 minutos), na metade do prazo (`reavaliacao_dias` = 45) e opcionalmente a cada 90 dias se o prazo for estendido. Implementação proposta: reaproveitar `dbo.questionario` com `tipo = 'REAVALIACAO'` e uma coluna `ordem`, trocando `ck_questionario_tipo` e `uq_questionario_tipo` por `UNIQUE (acompanhamento_id, tipo, ordem)`; mudança idempotente, mas **toca em tabela existente e em `questionario-dados.js`** (que hoje assume 1 por tipo), então entra num script separado e com teste de regressão do que já existe. Alternativa sem tocar na tabela: `acompanhamento_reavaliacao` com as colunas do subconjunto (mais código repetido, menos risco).
2. **Série qualitativa dos registros**: a "situação" da assistente em cada contato (melhorando/igual/piorando) forma uma segunda linha, mais frequente, subjetiva, que não substitui o índice mas mostra a tendência entre os pontos.

### 5.4 Persistência

Ao concluir um questionário (inicial, reavaliação, final), o serviço calcula e grava um **instantâneo** em `acompanhamento_indice` (uma linha por dimensão + geral, com `questionario_id`, `data_ref`, `nivel`, `itens_validos`, `versao_regra`). Painel e relatórios agregam sobre esse instantâneo (rápido); a ficha também. Um script de "recalcular" cobre os questionários que já existem.

### 5.5 Tela (aba Indicadores)

- **Cartão de resumo**: índice geral atual, diferença em relação ao inicial, selo (seta SVG + "Melhorou", "Igual", "Piorou"), n de pontos.
- **Quatro linhas "inicial → atual"** (uma por dimensão), cada uma com barra de 0 a 100, marcador do inicial, marcador do atual, seta e selo. Funciona bem com 2 ou 3 pontos e com a largura do celular.
- **Gráfico de linha** do índice geral no tempo (SVG gerado em JS, como o `painel/graficos.js`), com a linha tracejada dos registros (situação da assistente).
- Abaixo, a comparação item a item que já existe, sem alteração.

### 5.6 Relatório individual
Nova seção "Evolução durante o acompanhamento": nº de contatos, metas atingidas/total, tabela das quatro dimensões (inicial → final, selo em texto) e o intervalo entre contatos. Tabela de texto, sem gráfico (o modelo .docx não renderiza o SVG).

---

## 6. (d) Pesquisa de satisfação do projeto, respondida pela família

### 6.1 O que é e o que não é
Instrumento **separado** do questionário de progresso: pergunta o que a família acha do projeto (armazém e acompanhamento social), e não como ela está. Substitui na prática o bloco 5 do questionário, que continua existindo por compatibilidade (e deixa de ser usado como "voz da família" nos relatórios quando a pesquisa estiver no ar; ver D6).

### 6.2 Instrumento (versão 1, a validar com a coordenação, D6)

Texto simples, vocabulário do dia a dia, 8 perguntas (a P8 tem duas caixas), menos de 3 minutos.

**Bloco 1 — nota geral (NPS)**

- P1. "De 0 a 10, quanto você recomendaria o Armazém Solidário e o acompanhamento da assistente social a um amigo ou vizinho?" (0 = nada provável, 10 = com certeza) + "Por quê?" (opcional).

**Bloco 2 — concordância (5 pontos: discordo totalmente · discordo · nem concordo nem discordo · concordo · concordo totalmente)**

- P2. Fui tratada(o) com respeito e atenção pela equipe.
- P3. Entendi o que o projeto oferece e como ele funciona.
- P4. Os produtos do Armazém atendem às necessidades da minha família.
- P5. O acompanhamento da assistente social me ajudou a resolver problemas ou me organizar.
- P6. Consigo ser atendida(o) quando preciso (horário, espera, acesso).
- P7. O projeto melhorou a vida da minha família.

**Bloco 3 — texto livre**

- P8. "O que o projeto faz de melhor?" e "O que precisa melhorar?" (duas caixas, ambas opcionais).

**Dados de contexto (não são perguntas à família)**

- "Quem ajudou a responder?" (a própria família sozinha · a família com ajuda de alguém da família · a assistente leu e anotou). Serve para medir o viés de aplicação.
- Opcional, com consentimento explícito: "Se quiser que a equipe entre em contato sobre algum problema, marque aqui". É a única ponte para identificação, e só por escolha da família (6.5).

Escala visual: botões grandes, 5 rostos desenhados em SVG simples (sem emojis), texto sempre junto do desenho; NPS em fileira de 11 botões numerados. Telas de uma pergunta por vez, como o questionário atual (barra de progresso, sem rolagem longa).

### 6.3 Quem aplica e quando

| Momento | Quem | Observação |
|---|---|---|
| **Ao final do acompanhamento** (junto do questionário final, mas em tela separada) | família responde; assistente só entrega o aparelho | principal fonte de "o projeto foi bom?" |
| **Semestral**, para famílias ainda em acompanhamento | idem | alimenta o relatório semestral e permite ver tendência |
| **Avulsa** (programável pela coordenação) | idem | por exemplo, após uma mudança relevante |

Regra de ouro metodológica: **a assistente que acompanha a família não deve ler a pergunta e anotar a resposta**, porque a família tende a agradar quem está na frente (hoje o bloco 5 tem esse viés). Preferência: família responde sozinha no aparelho; se não souber ler, outra pessoa da equipe (que não é a assistente da família) ou um acompanhante da família lê; o campo "quem ajudou a responder" registra isso.

Público-alvo: o **responsável adulto** de cada família em acompanhamento (D2). Membros menores de idade não respondem.

### 6.4 Canais

1. **Modo família no aparelho da unidade (fase 1).** Na ficha da família, "Aplicar pesquisa de satisfação": o sistema cria um convite de uso único e abre uma página de tela cheia, sem menu e sem nenhum dado da família na tela; ao terminar, mostra agradecimento e volta à ficha. Funciona na rede interna HTTP atual. Cuidado: a página fica sob a sessão da assistente (cookie), por isso não contém links nem chamadas além da própria pesquisa.
2. **Link ou QR no celular da família (fase 2, depende da TI — D4).** A assistente gera um link de uso único (token aleatório de 128 bits guardado como hash, validade configurável, ex.: 14 dias) e envia por WhatsApp abrindo `wa.me/55<telefone>?text=…` com o telefone de `pessoa.telefone` (já existe, T8): envio manual, sem integração com API. **Pré-requisito: publicar na internet apenas `/pesquisa.html` e `/api/publico/pesquisa/*`** via proxy reverso; o resto do sistema continua só na rede interna. É decisão de infraestrutura e de segurança, não de código.
3. **Alternativa fora do sistema:** Microsoft Forms (já usado pela INTECS) e importação de CSV. Custo menor, mas sem controle de token, sem painel e com o LGPD num terceiro; listada em D4 por completude.

A rota pública é a **única** nova superfície sem sessão: exige `PUBLICAS` em `routes/index.js` (ou um router próprio), limite de requisições por IP, tokens de uso único, nenhuma leitura de dados pessoais, e resposta que não distingue "token inexistente" de "expirado".

### 6.5 Anonimato × vínculo × LGPD

| Modelo | Como funciona | Vantagens | Problemas |
|---|---|---|---|
| A. Anônima total | resposta sem nada da família; só unidade e período | máxima sinceridade | sem controle de duplicidade nem de cobertura; sem como atender uma reclamação |
| B. Identificada | resposta ligada ao `acompanhamento_id` | permite cruzar satisfação × progresso por família e responder reclamações | viés de agradar; dado pessoal de opinião ligado a pessoa vulnerável; qualquer assistente pode ver |
| **C. Híbrida pseudonimizada (recomendada)** | duas estruturas **sem chave em comum**: o **convite** guarda "a família X recebeu/respondeu" (controle de cobertura e de duplicidade); a **resposta** guarda unidade, período, canal e as notas, mas **nem token nem acompanhamento** | sinceridade + controle de taxa de resposta + sem repetição; satisfação × progresso só em nível agregado (unidade/período) | não se corrige uma resposta individual; precisa de n mínimo para não reidentificar |

Salvaguardas da opção C:
- A resposta não guarda `criado_em` com hora; só a data do período, para o horário de resposta não permitir cruzar com o horário de uso do convite.
- **n mínimo de 5** (`pesquisa_n_minimo`) para exibir qualquer recorte (unidade × período); abaixo disso, mostra-se só o nível acima (unidade → total).
- Comentários livres podem identificar alguém sozinhos ("meu filho Pedro…"): ficam visíveis só para o COORDENADOR, com opção de ocultar um comentário; **não aparecem para ASSISTENTE nem ADMIN** (D11).
- Pedido de contato (item 5 do instrumento): só se a família marcar; cria um **alerta de acompanhamento** ligado ao convite (e portanto à família), sem copiar as notas da resposta para a ficha.
- Antes da primeira pergunta, aviso curto: para que serve, que não pede CPF nem nome, quem vê, que a resposta não pode ser apagada depois por ser anônima, que responder não muda o atendimento.
- Base legal e texto do aviso a validar com o jurídico/encarregado da INTECS (D12). Dados de renda, alimentação e saúde nutricional do questionário já são sensíveis ou quase; a pesquisa não coleta nenhum deles.

### 6.6 Apuração
- **NPS** = % promotoras(es) (9–10) − % detratoras(es) (0–6), de −100 a +100.
- **Satisfação por pergunta** = % de concordância (4 ou 5) e média 1–5; **índice de satisfação** = média das 6 perguntas convertida em 0–100.
- **Taxa de resposta** = respondidas ÷ convites emitidos (e ÷ famílias elegíveis).
- Limiares de semáforo configuráveis; valores iniciais **apenas como ponto de partida a validar com a coordenação**: verde NPS ≥ 50 e concordância ≥ 80%; amarelo NPS 0 a 49 e concordância 60–79%; vermelho abaixo disso.

### 6.7 Modelo de perguntas editável
As perguntas ficam em tabelas (`pesquisa_modelo`, `pesquisa_pergunta`, versionadas) e as respostas em `pesquisa_resposta_item`, em vez de colunas fixas como no questionário. Assim a coordenação ajusta o texto sem migração, e dá para evoluir o instrumento sem perder comparabilidade (cada resposta aponta para a versão do modelo).

---

## 7. (e) Visão do coordenador

Reorganizar `painel.html` em abas: **Operação** (o que existe hoje, intacto) · **Progresso das famílias** · **Satisfação**. Todos os recortes: período (mês, semestre, personalizado) e unidade, como hoje; ASSISTENTE continua sem acesso ao Painel (vê o resumo da própria unidade na tela Início).

### 7.1 Progresso das famílias
- **% de famílias que melhoraram / ficaram iguais / pioraram** no índice geral (e por dimensão), com **o n sempre visível**. Denominador: famílias com pelo menos 2 pontos, usando o último ponto dentro do período; quando o n for menor que 5, mostrar o número absoluto e não o percentual.
- Por unidade (tabela e barras) e evolução por semestre.
- **Conclusão do acompanhamento**: concluídos × desligados × em andamento, tempo médio de acompanhamento, **motivos de desligamento**.
- **Cobertura**: % de acompanhamentos com questionário inicial no prazo, com reavaliação feita, com pelo menos um contato nos últimos X dias, com ao menos uma meta.
- **Renda per capita** e **passou a poupar** (já calculados no consolidado), agora no painel.
- Exportar CSV de cada tabela (padrão do painel atual).

### 7.2 Satisfação
- **NPS** e **índice de satisfação** por unidade e por período, com taxa de resposta; semáforo nos limiares configurados.
- Perguntas ordenadas da pior para a melhor concordância (onde o projeto falha mais).
- Lista de comentários (só COORDENADOR; filtro por unidade/período; botão "ocultar").
- Comparação entre períodos (semestre atual × anterior) com o n.

### 7.3 Alertas (extensão de `/api/painel/alertas`)
Hoje: finais vencendo/vencidos e ações desatualizadas. Acrescentar, por unidade:
- **Famílias sem contato há mais de X dias** (`alerta_sem_contato_dias`, padrão 30) e **contato atrasado** (passou o `proximo_contato_em`).
- **Famílias piorando** (últimas duas situações "piorando", ou índice caiu além da tolerância).
- **Metas vencidas** sem fechamento.
- **Reavaliação a fazer** (se adotada).
- **Pedidos de contato da pesquisa** não tratados.
- **Taxa de resposta da pesquisa baixa** no semestre (ex.: abaixo de 30%).
O bloco de pendentes da tela Início (assistente e coordenador) passa a mostrar os mesmos itens.

### 7.4 Relatório semestral
Duas seções novas: **"Acompanhamento e evolução das famílias"** (famílias com 2+ pontos, % que melhoraram por dimensão, nº médio de contatos por família, metas atingidas, conclusões e desligamentos com motivos) e **"Satisfação das famílias"** (NPS, concordância por pergunta, taxa de resposta, até 5 trechos de comentário escolhidos pela coordenação antes de gerar, como os textos editáveis de hoje). O modelo `semestral.docx` ganha os campos correspondentes.

---

## 8. (f) Modelo de dados, telas e entregas

### 8.1 Migrações (próxima numeração: `080`)

Todas idempotentes (`IF OBJECT_ID … IS NULL`, `COL_LENGTH`, `sys.indexes`), com `criado_por/criado_em/alterado_por/alterado_em`, no estilo do `001_schema.sql`. Rascunhos das tabelas principais estão no Apêndice A.

| Script | Conteúdo | Etapa |
|---|---|---|
| `080_acompanhamento_registro.sql` | `tipo_contato` (apoio, entra em `TABELAS_APOIO`), `acompanhamento_registro`, `registro_encaminhamento`, `motivo_desligamento` (apoio) + `acompanhamento.motivo_desligamento_id`, configurações `alerta_sem_contato_dias`, `intervalo_contato_dias` | F2 |
| `081_pesquisa_satisfacao.sql` | `pesquisa_modelo`, `pesquisa_pergunta`, `pesquisa_convite`, `pesquisa_resposta`, `pesquisa_resposta_item`, `pesquisa_pedido_contato`; semente do modelo v1; configurações `pesquisa_n_minimo`, `pesquisa_validade_link_dias` | F3 |
| `082_acompanhamento_meta.sql` | `acompanhamento_meta`, `registro_meta`; opcionalmente `acao_visita_familia` | F4 |
| `083_questionario_reavaliacao.sql` | `questionario.ordem`, novo `CHECK` de tipo, nova `UNIQUE`; configuração `reavaliacao_dias` | F5 |
| `084_acompanhamento_indice.sql` | `acompanhamento_indice` (instantâneo), configurações `indice_tolerancia_pontos`, `salario_minimo_referencia` | F5 |
| `090_indices_progresso.sql` | índices de apoio para as agregações do painel | F6 |

As faixas `082`–`084` seguem a ordem das etapas; ajustar o número quando a etapa for implementada se a fila mudar. **Nota de operação:** todas as migrações novas, como a `070`, rodam primeiro só no Docker de teste; a aplicação no SQL Server real acontece de uma vez no fim da fase visual, com backup.

### 8.2 API (novas rotas, mesmo padrão de `routes/familias.js`)

| Rota | Perfis | Observação |
|---|---|---|
| `GET/POST /api/familias/acompanhamentos/:id/registros` · `PUT …/registros/:registroId` | leitura: todos da unidade; escrita: ASSISTENTE, COORDENADOR | ADMIN: ver D11 |
| `GET /api/familias/acompanhamentos/:id/linha-do-tempo?tipos=&antes=&limite=` | idem leitura | consulta `UNION ALL`, paginada |
| `GET/POST/PUT /api/familias/acompanhamentos/:id/metas` | idem | |
| `GET /api/familias/acompanhamentos/:id/indicadores` | idem leitura | pontos e dimensões, semáforo |
| `GET /api/painel/progresso?inicio=&fim=&unidadeId=` | COORDENADOR, ADMIN | % melhoraram, cobertura, desligamentos |
| `GET /api/painel/satisfacao?inicio=&fim=&unidadeId=` | COORDENADOR, ADMIN | NPS, índice, n mínimo aplicado |
| `GET /api/painel/alertas` | (existente, ampliado) | novos itens da seção 7.3 |
| `POST /api/pesquisas/convites` | ASSISTENTE, COORDENADOR | cria convite (modo aparelho ou link) |
| `GET/POST /api/pesquisas/aplicar/:token` | sessão da assistente (modo aparelho) | |
| `GET/POST /api/publico/pesquisa/:token` | **sem sessão** (fase F7) | limite de requisições, token de uso único |
| `GET/PUT /api/pesquisas/modelo` | COORDENADOR (edita), ADMIN | editor do instrumento |

Documentar em `docs/API-ACOMPANHAMENTO.md` e `docs/API-PESQUISA.md` no mesmo formato de `API-FAMILIAS.md`.

### 8.3 Telas
**Novas:** `pesquisa.html` (modo família/público, sem menu), aba "Progresso" e aba "Satisfação" no Painel, editor do instrumento em Administração, formulário "Registrar contato" (modal no desktop, folha de baixo no celular), formulário de meta.
**Alteradas:** ficha da família (abas), lista de famílias (selos e filtro de contato), Início (card de famílias sem contato), questionário (final termina com "Aplicar pesquisa de satisfação"; inicial com "Definir metas"), encerramento (motivo estruturado), Relatórios (seções novas e prévia), formulário de ações (marcar famílias presentes, opcional).

### 8.4 Entregas incrementais

Tamanho relativo tomando **T4 (módulo de Famílias completo) = 1,0**.

| Etapa | Entrega | Depende de | Tamanho | O que o usuário passa a ter |
|---|---|---|---|---|
| **F2** | Registro de acompanhamento + linha do tempo + alerta de família sem contato (+ motivo de desligamento) | decisão D8 | ≈ 0,5 | histórico de contatos, "quem está sem contato", ficha com abas |
| **F3** | Pesquisa de satisfação v1 no aparelho da unidade (modelo, convite, tela de família, apuração básica na própria tela) | D2, D3, D5, D6, D12 | ≈ 0,7 | começa a **coletar a voz da família** (o dado que mais demora a acumular) |
| **F4** | Plano de metas (+ metas nos registros e na linha do tempo; vínculo de famílias às ações, opcional) | F2 | ≈ 0,3 | acompanhamento com objetivo |
| **F5** | Índice de progresso + reavaliação rápida + aba Indicadores + seção no individual | D9, D10 | ≈ 0,8 | semáforo e gráfico por família |
| **F6** | Painel do coordenador (Progresso e Satisfação) + alertas ampliados + seções do semestral + CSV | F3 e F5 | ≈ 0,7 | "o projeto está sendo bom?" em números |
| **F7** | Link/QR público para a família (opcional) | D4 e TI | ≈ 0,3 + infra | resposta no celular da própria família |

Ordem recomendada: F2 → F3 → F4 → F5 → F6 → F7. Motivo: F2 e F3 começam a acumular dado imediatamente; F5 e F6, que dependem de volume, entram quando já há histórico. Se o usuário quiser ver resultado de progresso mais cedo, F5 pode subir antes de F4 sem prejuízo (F4 só depende de F2).

Em todas: testes de API no padrão de `tests/familias` com banco real do Docker de teste, teste de escopo de unidade (assistente da unidade A tentando ler dado da B), service worker com nova `VERSAO`, validação visual desktop e celular.

### 8.5 Riscos
- **Pouco dado** por unidade/semestre → percentuais instáveis (mitigado por n visível e n mínimo).
- **Preenchimento**: se o registro de contato for pesado, não será usado (mitigado pelo formulário curto; medir pela cobertura).
- **Questionário é o modelo oficial do Termo de Colaboração**: mudar perguntas exige aval; esta proposta **não altera o instrumento** (D10).
- **Alterar `questionario` (F5)**: único ponto que mexe em tabela e lógica existentes; isolar em script próprio e coberto por teste.
- **Superfície pública (F7)** é um risco novo de segurança; só com proxy restrito às duas rotas e rate limit.

---

## 9. (g) Lista de decisões para o usuário

Cada decisão tem opções e a recomendação (marcada).

**D1 — Ordem e escopo das entregas.**
(a) F2→F3→F4→F5→F6→F7. **(recomendada)** (b) Progresso primeiro (F2→F4→F5→F6), satisfação depois. (c) Só F2+F3 por ora e reavaliar depois do primeiro semestre de dados.

**D2 — Quem responde a pesquisa de satisfação.**
(a) **Responsável adulto de cada família em acompanhamento. (recomendada)** (b) Todo público do Armazém (inclui quem só fez atendimento). (c) (a) agora; (b) numa etapa futura.

**D3 — Anonimato.**
(a) Anônima total. (b) Identificada. (c) **Híbrida: resposta sem vínculo, controle de quem respondeu separado, n mínimo 5, pedido de contato opcional com consentimento. (recomendada)**

**D4 — Canal.**
(a) **Fase 1 no aparelho da unidade (modo família); fase 2 link/QR se a TI publicar só as rotas públicas da pesquisa. (recomendada)** (b) Só aparelho da unidade, sem link. (c) MS Forms + importação de CSV (fora do sistema). (d) Cartaz com QR fixo no armazém (anônimo e aberto; maior risco de abuso e duplicidade).
Pergunta direta à TI: é aceitável expor publicamente `/pesquisa.html` e `/api/publico/pesquisa/*` por proxy reverso, mantendo o resto interno?

**D5 — Quando aplicar.**
(a) **Ao final do acompanhamento + semestral para quem segue em andamento. (recomendada)** (b) Só no final. (c) A cada reavaliação/contato (risco de cansaço).

**D6 — Instrumento.**
(a) **NPS + 6 afirmações Likert + 2 textos (seção 6.2). (recomendada)** (b) Versão mais curta (NPS + 3 afirmações + 1 texto). (c) Versão do próprio usuário/prefeitura.
Pergunta: o Termo de Colaboração TCL/073/2023/SMDHC/SESANA ou a SMDHC exigem indicadores de satisfação ou pesquisa em formato próprio? Se exigirem, o modelo deve seguir esse formato.
E o bloco 5 do questionário: **manter e deixar de usar nos relatórios quando a pesquisa estiver no ar. (recomendada)** ou remover do formulário (mexe no instrumento oficial).

**D7 — Plano de metas.**
(a) **Opcional, com alerta se não houver meta em 30 dias. (recomendada)** (b) Obrigatório para concluir o questionário inicial. (c) Deixar de fora por ora.

**D8 — Como o projeto acompanha de fato.**
Pergunta ao usuário: as assistentes fazem **visita domiciliar** ou o contato é no Armazém, por telefone e WhatsApp? A lista de tipos de contato e o alerta dependem disso.
Intervalo mínimo entre contatos para o alerta: (a) **30 dias. (recomendada)** (b) 15 dias. (c) 45 dias. Em todos os casos o valor fica editável em Configurações.

**D9 — Reavaliação intermediária.**
(a) **Uma reavaliação rápida na metade do prazo (≈ 9 perguntas), reaproveitando a tabela de questionário. (recomendada)** (b) Mesma coisa, em tabela separada (menos risco, mais código). (c) Não ter; usar só inicial, final e a situação qualitativa dos registros.

**D10 — Cálculo do índice e instrumento.**
(a) **Aprovar a regra da seção 5.2 (4 dimensões, renda per capita por faixa de salário mínimo, tolerância de 5 pontos, itens de percepção com peso reduzido no inicial) sem alterar o questionário. (recomendada)** (b) Aprovar a regra e, em paralelo, propor uma "versão 2" do questionário que corrija L5 (perguntas de estado no lugar das de "melhorou?" e 2 a 3 itens de autonomia), com aval do Termo. (c) Usar só contagem de itens que melhoraram (sem índice).

**D11 — Quem vê o quê (privacidade).**
(a) **ASSISTENTE: registros, metas, linha do tempo e índices das famílias da própria unidade; satisfação só agregada (n ≥ 5) e sem comentários. COORDENADOR: tudo, incluindo comentários. ADMIN: configuração e dados agregados, sem texto livre de registros nem comentários. (recomendada)** (b) Como hoje: ADMIN lê tudo que lê de famílias. (c) Assistente também vê os comentários da própria unidade.

**D12 — LGPD e retenção.**
Validar com o jurídico/encarregado da INTECS: base legal (execução do Termo de Colaboração/política pública), texto do aviso na pesquisa e prazo de guarda. Sugestão de prazo: manter respostas enquanto durar o Termo e a prestação de contas dele, depois anonimizar/eliminar. Sem decisão, a F3 não deve ir para produção.

**D13 — Metas de referência dos semáforos.**
(a) **Adotar os limiares provisórios da seção 6.6 e permitir ajuste pelo COORDENADOR nas Configurações. (recomendada)** (b) A coordenação define os números antes da F6. (c) Sem semáforo na satisfação, só números.

**D14 — Unidade-piloto.**
Escolher 1 unidade-piloto (sugestão: a que tem mais famílias em acompanhamento) para F2/F3 antes de liberar nas 7. **(recomendada)** ou liberar em todas de uma vez.

---

## Apêndice A — Rascunho das tabelas principais (só ilustrativo; não é migração)

```sql
-- 080
CREATE TABLE dbo.acompanhamento_registro (
  id                  INT IDENTITY(1,1) CONSTRAINT pk_acompanhamento_registro PRIMARY KEY,
  acompanhamento_id   INT NOT NULL REFERENCES dbo.acompanhamento(id),
  usuario_id          INT NOT NULL REFERENCES dbo.usuario(id),
  data_registro       DATE NOT NULL,
  tipo_contato_id     INT NOT NULL REFERENCES dbo.tipo_contato(id),
  houve_contato       BIT NOT NULL,                       -- 0 = tentativa
  situacao            VARCHAR(12) NULL,                   -- MELHORANDO | IGUAL | PIORANDO | NAO_SEI
  resumo              NVARCHAR(1000) NULL,
  proximo_contato_em  DATE NULL,
  anulado_em          DATETIME2(0) NULL, anulado_motivo NVARCHAR(200) NULL,
  criado_por INT NULL, criado_em DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
  alterado_por INT NULL, alterado_em DATETIME2(0) NULL
);  -- índice (acompanhamento_id, data_registro DESC)

-- 082
CREATE TABLE dbo.acompanhamento_meta (
  id INT IDENTITY(1,1) PRIMARY KEY,
  acompanhamento_id INT NOT NULL REFERENCES dbo.acompanhamento(id),
  dimensao  VARCHAR(20) NOT NULL,       -- ALIMENTACAO|RENDA|ECONOMIA|AUTONOMIA|ACESSO_A_DIREITOS|OUTRA
  descricao NVARCHAR(300) NOT NULL,
  prazo DATE NULL,
  status VARCHAR(14) NOT NULL DEFAULT 'ABERTA',   -- ABERTA|EM_ANDAMENTO|ATINGIDA|NAO_ATINGIDA|CANCELADA
  concluida_em DATE NULL
  -- + colunas de auditoria
);

-- 081 (resposta sem chave para a família)
CREATE TABLE dbo.pesquisa_convite (
  id INT IDENTITY(1,1) PRIMARY KEY,
  token_hash BINARY(32) NOT NULL UNIQUE,
  modelo_id INT NOT NULL, acompanhamento_id INT NOT NULL, unidade_id INT NOT NULL,
  momento VARCHAR(10) NOT NULL,         -- FINAL | SEMESTRAL | AVULSA
  canal   VARCHAR(10) NOT NULL,         -- APARELHO | LINK
  criado_por INT NOT NULL, criado_em DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
  expira_em DATETIME2(0) NOT NULL,
  respondido_em DATE NULL
);
CREATE TABLE dbo.pesquisa_resposta (         -- NÃO tem token, convite nem acompanhamento
  id INT IDENTITY(1,1) PRIMARY KEY,
  modelo_id INT NOT NULL, unidade_id INT NOT NULL,
  periodo DATE NOT NULL,                      -- 1º dia do mês da resposta
  canal VARCHAR(10) NOT NULL,
  ajuda_resposta VARCHAR(15) NULL,            -- SOZINHA | COM_FAMILIAR | ASSISTENTE_ANOTOU
  oculta BIT NOT NULL DEFAULT 0               -- comentário oculto pelo coordenador
);
CREATE TABLE dbo.pesquisa_resposta_item (
  resposta_id INT NOT NULL REFERENCES dbo.pesquisa_resposta(id) ON DELETE CASCADE,
  pergunta_id INT NOT NULL REFERENCES dbo.pesquisa_pergunta(id),
  valor_num TINYINT NULL, valor_texto NVARCHAR(1000) NULL,
  PRIMARY KEY (resposta_id, pergunta_id)
);

-- 084 (instantâneo do índice)
CREATE TABLE dbo.acompanhamento_indice (
  id INT IDENTITY(1,1) PRIMARY KEY,
  acompanhamento_id INT NOT NULL REFERENCES dbo.acompanhamento(id),
  questionario_id INT NOT NULL REFERENCES dbo.questionario(id) ON DELETE CASCADE,
  data_ref DATE NOT NULL,
  dimensao VARCHAR(12) NOT NULL,        -- ALIMENTACAO|RENDA|ECONOMIA|AUTONOMIA|GERAL
  nivel TINYINT NULL, itens_validos TINYINT NOT NULL,
  versao_regra SMALLINT NOT NULL,
  CONSTRAINT uq_acompanhamento_indice UNIQUE (questionario_id, dimensao)
);
```

## Apêndice B — Esboço da consulta da linha do tempo

```sql
-- parâmetros: @acompanhamentoId, escopo de unidade já aplicado no acompanhamento
SELECT data, tipo, titulo, resumo, autor_id, ref_tipo, ref_id FROM (
  SELECT data_inicio AS data, 'INICIO' AS tipo, N'Início do acompanhamento' AS titulo, NULL AS resumo, usuario_id AS autor_id, 'ACOMPANHAMENTO' AS ref_tipo, id AS ref_id FROM acompanhamento WHERE id = @id
  UNION ALL SELECT data_aplicacao, 'QUESTIONARIO', tipo, NULL, criado_por, 'QUESTIONARIO', id FROM questionario WHERE acompanhamento_id = @id AND concluido = 1
  UNION ALL SELECT data_registro, 'REGISTRO', …, resumo, usuario_id, 'REGISTRO', id FROM acompanhamento_registro WHERE acompanhamento_id = @id AND anulado_em IS NULL
  UNION ALL SELECT a.data_atendimento, 'ATENDIMENTO', …, a.resumo, a.usuario_id, 'ATENDIMENTO', a.id
            FROM atendimento a JOIN familia f ON f.responsavel_pessoa_id = a.pessoa_id JOIN acompanhamento ac ON ac.familia_id = f.id
           WHERE ac.id = @id AND a.unidade_id IN (…unidades permitidas…)
  -- + META, ACAO, PESQUISA (só marcador), PRAZO (virtual), ENCERRAMENTO
) e ORDER BY data DESC, ref_id DESC;
```
