# Mapeamento dos modelos oficiais (M1)

Os quatro modelos oficiais em papel (`docs/modelos/*.docx`, texto extraído em `*.txt`) viraram formulários, regras e documentos do sistema.
Este arquivo liga **cada pergunta do papel → código → onde é guardada → onde é usada** (índice de progresso, comparação, relatórios) e lista as divergências e decisões.

| Modelo em papel | No sistema | Migração |
|---|---|---|
| 1. Questionário inicial de acompanhamento familiar | Questionário **INICIAL** (formulário `QUESTIONARIO_INICIAL`) | 086 |
| 2. Registro periódico de acompanhamento | Registro de acompanhamento (F2) com mês, uso do Armazém, orientações, fotos | 087 |
| 3. Questionário final familiar | Questionário **FINAL** (formulário `QUESTIONARIO_FINAL`) e reavaliação rápida | 086 |
| 4. Relatório final familiar | Relatório individual oficial (`individual.docx`) | — |

As migrações 086 e 087 foram aplicadas **só no Docker de teste**; no SQL Server real ficam na fila do fim (junto de 070 e 080–085), com backup.

## 1. Modelagem (decisão)

**Perguntas oficiais novas no catálogo da P2; respostas numa tabela genérica tipada.**

- Cada pergunta do papel é uma linha de `catalogo_pergunta` (`oficial = 1`) com **código estável** igual ao número do papel (`"2.1"`), `campo` semântico (`fonteRenda`) e as opções em `catalogo_opcao` (código estável de texto, ex.: `TRABALHO_INFORMAL`).
- As respostas ficam em `dbo.resposta_extra` (uma linha por pergunta; uma por opção na múltipla; o complemento "Outras: ____" fica em `valor_texto`), ligadas ao `questionario`. **Não há colunas novas por pergunta**: a coordenação continua renomeando textos, acrescentando opções e criando perguntas adicionais em *Administração > Perguntas e opções* sem mexer no banco.
- `dbo.questionario` ganhou `modelo` (`LEGADO` | `M1`). Uma família tem no máximo um questionário de cada tipo (INICIAL, REAVALIACAO, FINAL), como antes.
- `catalogo_opcao` ganhou `pontos` (0 a 100 na regra do índice; vazio = não pontua) e `pede_detalhe` ("Outras: ____").
- Por que não colunas fixas novas: o inicial e o final têm perguntas **diferentes**, a comparação é por *pares* e a coordenação precisa acrescentar opções; colunas fixas exigiriam migração a cada mudança e dobrariam as CHECKs da P2.
- A API trafega por código de pergunta: `respostas: { "2.1": "TRABALHO_INFORMAL", "2.3": 1, "3.3": ["MORADIA","OUTRAS"] }` e `detalhes: { "3.3": "Dívida do gás" }` (ver `docs/API-CATALOGO.md`).

### Pontuação das opções (regra do índice v2)

Cada opção oficial que entra no índice ou na comparação tem **pontos de 0 a 100** (100 = melhor situação). Opções que descrevem apenas *o que a família é* (fonte de renda, faixa etária, situação do CadÚnico, frequência de compras, despesas priorizadas) **não pontuam**. A equivalência entre escalas diferentes (4 opções × 3 opções) foi definida assim:

- *Alimentos suficientes*: inicial Nunca 100 · Raramente 75 · Algumas vezes 50 · Frequentemente 0 ↔ final Sim 100 · Parcialmente 50 · Não 0 (Algumas vezes ≡ Parcialmente; Frequentemente ≡ Não).
- *Redução da quantidade/qualidade*: inicial Não 100 · Sim, eventualmente 50 · Sim, frequentemente 0 ↔ final Não 100 · Raramente 75 · Algumas vezes 50 · Frequentemente 0.
- *Refeição deixada*: inicial Não 100 · Algumas vezes 50 · Sim 0 ↔ final Não 100 · Sim 0.
- *Renda*: as seis faixas são iguais nos dois modelos (0, 25, 50, 75, 100; "Não informado" não pontua).
- *Frutas, verduras e legumes*: **par aproximado** (decisão do usuário: o inicial pergunta se o acesso era regular — Sim/Parcialmente/Não —, o final a frequência por semana). Inicial Sim 100 · Parcialmente 50 · Não 0 ↔ final 5 ou mais 100 · 3-4 vezes 67 · 1-2 vezes 33. A comparação mostra o selo "equivalência aproximada".

Opção **acrescentada** pela coordenação a pergunta que pontua: precisa dizer com qual opção oficial ela **vale** (usa os mesmos pontos) ou que **não pontua** (fica fora do índice e da comparação, como não respondida). Em pergunta que não pontua (ex.: fonte de renda) a pergunta de "vale como" não aparece. Depois de usada, o "vale como" não muda (409).

## 2. Questionário INICIAL (modelo 1)

Cabeçalho do papel (unidade, assistente social responsável, data de início, data prevista para conclusão, meta) e a identificação (responsável familiar, CPF/CadÚnico, endereço/território, contato) **vêm do cadastro da família e do acompanhamento**; não são respostas. A meta é a configuração `meta_projeto` (editável em *Configurações*).

| Papel | Código | Campo | Tipo | Opções (pontos no índice) | Uso |
|---|---|---|---|---|---|
| 1.1. Número de integrantes da família | `1.1` | `qtdIntegrantes` | número, obrigatória | — | cabeçalho do relatório (composição) |
| 1.2. Faixa etária predominante | `1.2` | `faixaEtaria` | escolha única, obrigatória | Crianças e adolescentes (até 17 anos); Adultos (18 a 59 anos); Idosos (60 anos ou mais) | diagnóstico |
| 1.3. Situação do CadÚnico | `1.3` | `situacaoCadUnico` | escolha única, obrigatória | Atualizado; Necessita atualização; Em processo de atualização | diagnóstico |
| 2.1. Qual a principal fonte de renda familiar? | `2.1` | `fonteRenda` | escolha única, obrigatória | Trabalho formal; Trabalho informal/autônomo; Aposentadoria/pensão; Benefício de transferência de renda/assistencial; Benefício previdenciário; Outras + detalhe; Sem renda no momento | par 2.1↔1.2 (só "mudou"); diagnóstico |
| 2.2. Renda familiar mensal aproximada: | `2.2` | `rendaFaixa` | escolha única, obrigatória | Até R$ 500,00 (0); De R$ 501,00 a R$ 1.000,00 (25); De R$ 1.001,00 a R$ 2.000,00 (50); De R$ 2.001,00 a R$ 3.000,00 (75); Acima de R$ 3.000,00 (100); Não informado | par 2.2↔1.3; índice Renda |
| 2.3. Número de pessoas que contribuem para a renda familiar: | `2.3` | `pessoasComRenda` | número, obrigatória | — | diagnóstico |
| 2.4. Atualmente, a família consegue reservar algum valor da sua renda para poupança ou para situações imprevistas? | `2.4` | `reservaFinanceira` | escolha única, obrigatória | Não consegue reservar nenhum valor (0); Consegue raramente (25); Consegue ocasionalmente (50); Consegue regularmente (75); Consegue reservar valor todos os meses (100) | diagnóstico (sem par no final) |
| 2.5. A família relata dificuldade para custear despesas básicas? | `2.5` | `dificuldadeDespesas` | escolha única, obrigatória | Não (100); Sim, eventualmente (67); Sim, frequentemente (33); Sim, de forma permanente (0) | diagnóstico (sem par no final) |
| 3.1. Situação alimentar antes/início do acompanhamento | `3.1` | `situacaoAlimentar` | texto livre | — | diagnóstico (texto livre) |
| 3.2. Antes do projeto, a família teve dificuldade para adquirir alimentos suficientes para todos os integrantes? | `3.2` | `alimentosSuficientes` | escolha única, obrigatória | Algumas vezes (50); Frequentemente (0); Raramente (75); Nunca (100) | par 3.2↔2.5; índice Alimentação |
| 3.3. Houve necessidade de reduzir a quantidade ou qualidade dos alimentos devido à falta de recursos financeiros? | `3.3` | `reducaoAlimentos` | escolha única, obrigatória | Sim, eventualmente (50); Sim, frequentemente (0); Não (100) | par 3.3↔2.6; índice Alimentação |
| 3.4. Houve situação em que algum integrante da família deixou de realizar uma refeição por falta de alimentos ou recursos financeiros? | `3.4` | `deixouRefeicao` | escolha única, obrigatória | Sim (0); Não (100); Algumas vezes (50) | par 3.4↔2.7; índice Alimentação |
| 3.5. A família conseguia adquirir regularmente alimentos considerados importantes para uma alimentação adequada? | `3.5` | `alimentosImportantes` | escolha única, obrigatória | Parcialmente (50); Raramente (25); Não (0); Sim (100) | diagnóstico (sem par no final) |
| 3.6. A família possuía acesso regular a frutas, verduras e legumes? | `3.6` | `frutasVerduras` | escolha única, obrigatória | Sim (100); Parcialmente (50); Não (0) | par 3.6↔2.4 (aproximado); índice Alimentação |

## 3. Questionário FINAL (modelo 3)

O papel numera a primeira seção a partir de 1.2; a numeração foi mantida.

| Papel | Código | Campo | Tipo | Opções (pontos no índice) | Uso |
|---|---|---|---|---|---|
| 1.2. Qual a principal fonte de renda familiar? | `1.2` | `fonteRenda` | escolha única, obrigatória | Trabalho formal; Trabalho informal/autônomo; Aposentadoria/pensão; Benefício de transferência de renda/assistencial; Benefício previdenciário; Outras + detalhe; Sem renda no momento | par 1.2↔2.1 (só "mudou") |
| 1.3. Qual a renda familiar mensal aproximada atualmente? | `1.3` | `rendaFaixa` | escolha única, obrigatória | Até R$ 500,00 (0); De R$ 501,00 a R$ 1.000,00 (25); De R$ 1.001,00 a R$ 2.000,00 (50); De R$ 2.001,00 a R$ 3.000,00 (75); Acima de R$ 3.000,00 (100); Não informado | par 1.3↔2.2; índice Renda; reavaliação |
| 1.4. Comparando com o início do acompanhamento, a situação econômica da família: | `1.4` | `evolucaoEconomica` | escolha única, obrigatória | Melhorou (100); Permaneceu semelhante (50); Piorou (0); Não é possível avaliar | comparativa (melhorou/igual/piorou); impacto econômico |
| 2.1. Com que frequência a família realiza compras no Armazém Solidário? | `2.1` | `frequenciaCompras` | escolha única, obrigatória | Semanalmente; Quinzenalmente; Mensalmente; Eventualmente | impacto alimentar (frequência no Armazém) |
| 2.2. O Armazém Solidário contribui para melhorar o acesso da família aos alimentos? | `2.2` | `armazemMelhoraAcesso` | escolha única, obrigatória | Sim (100); Parcialmente (50); Não (0) | impacto alimentar |
| 2.3. Qual foi o impacto na qualidade da alimentação da família após o acesso aos produtos mais baratos? | `2.3` | `qualidadeAlimentacao` | escolha única, obrigatória | Melhorou muito (100); Melhorou um pouco (67); Não melhorou (33); Piorou (0) | impacto alimentar (percepção) |
| 2.4. Com que frequência a família consome frutas, verduras e legumes após acesso ao armazém solidário? | `2.4` | `frutasVerduras` | escolha única, obrigatória | 1-2 vezes por semana (33); 3-4 vezes por semana (67); 5 ou mais vezes por semana (100) | par 2.4↔3.6 (aproximado); índice Alimentação; reavaliação |
| 2.5. Atualmente, a família consegue adquirir alimentos suficientes para atender suas necessidades? | `2.5` | `alimentosSuficientes` | escolha única, obrigatória | Sim (100); Parcialmente (50); Não (0) | par 2.5↔3.2; índice Alimentação; reavaliação |
| 2.6. Atualmente, a família enfrenta redução da quantidade ou qualidade dos alimentos por falta de recursos? | `2.6` | `reducaoAlimentos` | escolha única, obrigatória | Não (100); Raramente (75); Algumas vezes (50); Frequentemente (0) | par 2.6↔3.3; índice Alimentação; reavaliação |
| 2.7. Atualmente, algum integrante da família deixa de realizar refeições por falta de alimentos ou recursos? | `2.7` | `deixouRefeicao` | escolha única, obrigatória | Não (100); Sim (0) | par 2.7↔3.4; índice Alimentação; reavaliação |
| 2.8. Houve mudança na variedade e qualidade dos alimentos consumidos pela família? | `2.8` | `variedadeAlimentos` | escolha única, obrigatória | Melhorou (100); Permaneceu semelhante (50); Piorou (0); Não é possível avaliar | comparativa; impacto alimentar |
| 3.1. A família considera que os preços praticados no Armazém contribuíram para reduzir as despesas com alimentação e melhorar as condições econômicas da família? | `3.1` | `precosReduziramDespesas` | escolha única, obrigatória | Sim (100); Parcialmente (50); Não (0) | impacto econômico |
| 3.2. Quanto a família economiza mensalmente com a compra de produtos no armazém solidário? | `3.2` | `economiaMensal` | escolha única, obrigatória | Até R$ 100,00 (0); De R$ 101,00 a R$ 300,00 (33); De R$ 301,00 a R$ 400,00 (67); Acima de R$ 400,00 (100); Outro valor + detalhe | impacto econômico; distribuição no semestral |
| 3.3. Quais despesas são priorizadas com eventual economia obtida? | `3.3` | `despesasPriorizadas` | várias opções, obrigatória | Moradia; Energia elétrica/Água; Transporte; Saúde; Educação; Vestuário; Lazer; Outras + detalhe | impacto econômico; distribuição no semestral |
| 3.4. Houve redução de dívidas ou melhoria na gestão financeira familiar? | `3.4` | `dividasGestao` | escolha única, obrigatória | Sim, houve melhora (100); Não houve mudança (50); Houve parcialmente (75) | comparativa; impacto econômico |
| 4.1. Quais as principais mudanças a família atribui após o acesso ao Armazém Solidário? | `4.1` | `mudancasAtribuidas` | texto livre | — | feedback (6) |
| 4.2. Como a família enxerga o impacto do projeto na comunidade local? | `4.2` | `impactoComunidade` | texto livre | — | feedback; desafios (5) |
| 4.3. O que poderia ser melhorado no projeto para aumentar seu impacto no empoderamento econômico das famílias? | `4.3` | `oQueMelhorar` | texto livre | — | feedback; desafios (5) |
| 4.4. O que a família considera como o principal benefício do projeto? | `4.4` | `principalBeneficio` | texto livre | — | feedback; relatos do semestral |
| 4.5. Qual é a avaliação geral da família sobre o armazém solidário? | `4.5` | `avaliacaoGeral` | escolha única, obrigatória | Ótima (100); Boa (67); Regular (33); Ruim (0) | feedback; distribuição no semestral |
| 4.6. A família recomendaria o projeto para outras famílias ou comunidades? | `4.6` | `recomendaria` | sim/não, obrigatória | — | feedback; % no semestral |

## 4. Pares equivalentes inicial × final (comparação)

| Par | Inicial | Final | Resultado | Índice |
|---|---|---|---|---|
| Principal fonte de renda | 2.1 | 1.2 | só "mudou" (a ordem das fontes não é boa ou ruim) | — |
| Renda familiar mensal | 2.2 | 1.3 | pontos finais − iniciais (≥ 1 melhorou, ≤ −1 piorou) | Renda |
| Alimentos suficientes | 3.2 | 2.5 | idem | Alimentação |
| Redução da quantidade/qualidade | 3.3 | 2.6 | idem | Alimentação |
| Alguém deixou de fazer refeição | 3.4 | 2.7 | idem | Alimentação |
| Frutas, verduras e legumes | 3.6 | 2.4 | idem, **aproximado** | Alimentação |

Perguntas do final que **já comparam com o início** (não têm par): **1.4** (situação econômica), **2.8** (variedade e qualidade dos alimentos) e **3.4** (dívidas e gestão financeira). Resultado pelos pontos da resposta: acima de 50 melhorou, 50 igual, abaixo piorou, "Não é possível avaliar" = sem dados.

As demais respostas (inicial: 1.1–1.3, 2.3–2.5, 3.1, 3.5; final: 2.1–2.3, 3.1–3.3, 4.x) aparecem na tela de comparação como "Outras respostas" e alimentam os textos do relatório.

## 5. Índice de progresso (F5) — regra versão 2

- `VERSAO_REGRA = 2` para questionários M1; os de formato anterior seguem na versão 1 (cada instantâneo guarda a versão com que foi calculado; `scripts/recalcular-indices.js` refaz).
- Só entram **itens com par** nos dois questionários, para o nível ser comparável: **Alimentação** (4 pares) e **Renda** (faixa). **Economia** e **Autonomia** não têm pergunta com par nos modelos oficiais: ficam **sem nível** (vazio, nunca zero), não aparecem nas telas dos modelos oficiais e não entram na média geral.
- Dimensão só existe com pelo menos metade dos itens respondidos; índice geral = média das dimensões com nível; semáforo igual ao anterior (tolerância configurável).
- Reavaliação rápida = 5 perguntas do final com par no inicial (1.3, 2.4, 2.5, 2.6, 2.7), tipo `REAVALIACAO`.
- Painel de famílias (F6) e relatório semestral continuam lendo `acompanhamento_indice`; Economia e Autonomia aparecem com n = 0.

## 6. Dados antigos (formato anterior)

- Todas as linhas existentes de `questionario` ficaram `modelo = 'LEGADO'`. **Nada foi apagado ou convertido.**
- Questionário legado **concluído** é só leitura: continua visível (respostas, comparação antiga, índice versão 1) com a etiqueta "Formato anterior"; gravar devolve 409.
- Legado ainda em **rascunho** pode ser terminado no formato antigo (tela `questionario-legado.js`); depois de concluído fica só leitura.
- Tipo novo numa família com inicial legado: o **final novo** é aplicado no modelo M1 e a comparação por pares não existe (a tela avisa e mostra cada questionário); o relatório final descreve só a situação final.
- Banco real: a migração 086 só acrescenta colunas/linhas; as linhas atuais viram LEGADO. Não foi tocado.

## 7. Saídas .docx (formato dos modelos, Times New Roman 12, papel timbrado dos modelos)

| Saída | Rota | Template | Observações |
|---|---|---|---|
| Questionário inicial preenchido ou em branco (modelo 1) | `GET /api/relatorios/formulario/:acompanhamentoId/INICIAL` | `questionario-inicial.docx` | "( X )" nas escolhidas; "Outras: ____"; linhas para texto; Assistente Social, CRESS/SP e assinatura do responsável |
| Questionário final preenchido ou em branco (modelo 3) | `.../FINAL` | `questionario-final.docx` | idem |
| Registro periódico (modelo 2) | `GET /api/relatorios/registro-periodico/:id` e `POST .../docx` | `registro-periodico.docx` | tabela por mês, observações editáveis, anexos com foto e data |
| **Relatório final familiar** (modelo 4) | `GET /api/relatorios/individual/:id/previa` e `POST /api/relatorios/individual/:id` | `individual.docx` | 1 Introdução · 2 Objetivo (texto do modelo) · 3 Metodologia · 4 Diagnóstico Inicial (do inicial) · 5 Impacto (alimentar, desafios, econômico + evolução e registros) · 6 Feedback (4.1–4.6 do final) · 7 Considerações finais · local/data · assinatura |

**Recomendação adotada:** o modelo 4 **substitui** o relatório individual antigo (mesmo endpoint, mesmo fluxo de edição). Todos os textos gerados aparecem na tela *Relatórios > Relatório final familiar* para a assistente **editar antes de baixar**; as seções sem dados trazem uma frase-guia para completar. O semestral não mudou de modelo (continua com seus templates), mas a comparação consolidada lê os dois formatos.

## 8. Divergências e correções em relação ao papel

**Resolvidas por decisão do usuário**

- **Final 3.2** (economia mensal): o papel não tinha a faixa 301–400. Foi **acrescentada** "De R$ 301,00 a R$ 400,00" entre "De R$ 101,00 a R$ 300,00" e "Acima de R$ 400,00". Ordem final: Até R$ 100,00 · 101–300 · **301–400** · Acima de R$ 400,00 · Outro valor.
- **Inicial 3.6** (frutas, verduras e legumes): o papel misturava "Não/Sim/Parcialmente" com "De 1 – 2 vezes por semana". Ficou só **Sim · Parcialmente · Não**. A equivalência com a 2.4 do final foi documentada como **par aproximado** (seção 1 e 4).

**Correções de digitação**

- Final 4.1: "a família **atribuem**" → "a família **atribui**".
- Relatório (introdução): mantido o texto já corrigido no sistema ("contribuir **para** o acesso a alimentos de qualidade, mas também **para** a autonomia…"); o modelo 4 traz "contribuir não apenas o acesso…" e "munícipes visando, portanto,".
- Registro periódico: "Resistencia" → "Resistência"; "Resistência da família em querer responder o questionário ou tirar foto" (ver registro).
- Espaços e quebras do papel (opções coladas na mesma linha) foram normalizados: uma opção por linha, na ordem escrita.

**Decisões do sistema onde o papel deixa em branco ou é ambíguo**

- **Inicial 1.2 Faixa etária predominante**: o papel é uma linha em branco. Virou escolha única com *Crianças e adolescentes (até 17 anos)*, *Adultos (18 a 59 anos)* e *Idosos (60 anos ou mais)*, **sugerida** pela idade dos membros cadastrados e editável; a coordenação pode acrescentar opções. **A confirmar com o usuário.**
- **Inicial 1.1 Número de integrantes** vem sugerido pelo cadastro (membros + responsável).
- **Inicial 2.1 e final 1.2/3.3/3.2** têm "Outras"/"Outro valor": ganharam um campo de complemento (o papel só traz a linha em 3.3).
- **Inicial 3.1 Situação alimentar** é texto livre (o papel não mostra linhas).
- A fonte de renda (2.1↔1.2) é **comparada só como "mudou"**: não há ordem de melhor/pior entre as fontes.
- **Economia e Autonomia** deixam de ter nível no índice nos modelos oficiais (não há pergunta com par). Se a coordenação quiser medir poupança/despesas no índice, é preciso repetir no final as perguntas 2.4/2.5 do inicial (uma nova versão da regra).
- Os **pontos** da seção 1 são a proposta do sistema (equivalência entre escalas); mudá-los exige nova `VERSAO_REGRA`.

## 9. Registro periódico (modelo 2)

Migração `087_registro_periodico_m1.sql`. O registro de acompanhamento (F2) ganhou os campos do papel; as opções viram listas configuráveis pela coordenação (*Administração > Listas*).

| Papel (modelo 2) | Campo da API | Coluna / tabela | Uso |
|---|---|---|---|
| Responsável familiar, CPF/CadÚnico, contato, endereço | vêm do cadastro da família | `pessoa` | cabeçalho do .docx (editável na prévia) |
| Mês de referência | `mesReferencia` (AAAA-MM) | `acompanhamento_registro.mes_referencia` (dia 1; padrão = mês da data) | coluna "Mês" do .docx |
| Data do acompanhamento | `dataRegistro` | `data_registro` | já existia |
| Profissional responsável | automático (autor) | `usuario_id` | cabeçalho do .docx |
| Contato/atendimento realizado | `tipoContatoId` | `tipo_contato` (acrescidos "Atendimento presencial" e "Contato telefônico"; "Atendimento no Armazém" e "Telefone" desativados, não apagados) | coluna do .docx |
| Uso do Armazém | `usoArmazemId` | `uso_armazem_id` → lista `uso_armazem` (regularmente, eventualmente, não utilizou no período) | coluna do .docx; linha do tempo |
| Orientações/encaminhamentos/outros (várias) | `orientacaoIds[]`, `orientacaoOutro` | N:N `acompanhamento_registro_orientacao` + `orientacao_outro`; lista `orientacao_registro` (CadÚnico, CRAS/Descomplica, serviço da rede, alimentação/nutrição, Outros: pede texto) | coluna do .docx; linha do tempo |
| Frases-sugestão | — | lista `frase_registro` (texto exato do modelo; a coordenação edita em Listas) | atalhos clicáveis que inserem o texto em Observações |
| Observações do profissional | `resumo` | `resumo` NVARCHAR(2000) (era 1000) | bloco "Observações do profissional" do .docx (editável) |
| Pontos a observar | — | texto fixo na tela (ajuda recolhível) e na seção OBSERVAÇÕES do .docx | ajuda |
| Fotos (só se a família aceitar) | `familiaAceitaFoto`; upload em `/registros/:id/fotos` | `familia_aceita_foto`; `acompanhamento_registro_foto` (`data_foto` obrigatória) | ANEXOS do .docx, com data |
| Assinatura/família | — | coluna em branco no .docx | impressão e assinatura |

Regras: campo ausente no corpo não altera o gravado; tentativa sem contato limpa uso e orientações; "Outros" exige texto; o aceite de foto não pode ser desmarcado com fotos anexadas; registro anulado esconde as fotos e as mantém no banco; até 20 fotos por registro.

Decisões e divergências do registro:

- O modelo traz as opções como legenda dentro da tabela; no sistema viram listas configuráveis pela coordenação.
- Uso do Armazém e orientações são opcionais na API (para registros antigos); a tela os oferece sempre.
- A prévia do .docx edita identificação, observações e fotos; as colunas da tabela (mês, contato, uso, orientações) vêm do registro — corrigir a tabela é corrigir o registro.
- "Resistencia" (papel) → "Resistência da família em querer responder o questionário ou tirar foto".
- O template é construído do próprio `docs/modelos/2-registro-periodico.docx` (A4 paisagem, Times New Roman 12) por `tests/relatorios/construir-template-registro.js`.

## 10. Onde está no código

- Definições oficiais e seed: `server/services/modelos-m1.js` (a migração `086` foi gerada dele).
- Catálogo em memória: `catalogo-estado.js`, `catalogo.js`; edição: `catalogo-admin.js`; respostas: `extras.js`.
- Regras (modelo, validação, pares, consolidação): `questionario-m1.js`; gravação e comparação: `questionario-dados.js`; índice: `indice-progresso.js` (`calcularIndiceM1`), `indice-dados.js`.
- Documentos: `relatorios-formularios.js`, `relatorios-textos-m1.js`, `relatorios-textos.js`, templates em `server/templates/`, construtor `tests/relatorios/construir-templates-m1.js`.
- Telas: `public/js/familias/questionario.js` (M1), `questionario-legado.js`, `comparacao-m1.js`, `indicadores.js`, `public/js/admin/perguntas.js`, `public/js/relatorios/individual.js`.
- Testes: `tests/familias/m1.test.js` (unitário), `tests/familias/m1.e2e.js`, `tests/admin/catalogo.e2e.js`, `tests/familias/indice.e2e.js`, `tests/familias/painel-familias.e2e.js`.

## 11. Limites

- Perguntas adicionais da coordenação **não entram** no índice, no painel nem no NPS (informação complementar), como na P2.
- Nova família com inicial legado e final novo não tem comparação por pares nem comparação de índice confiável (regras 1 e 2 diferentes): a tela avisa.
- Os `.docx` foram verificados no XML e por testes; não foram abertos no Word (não instalado no ambiente de desenvolvimento).
- Migrações 086 e 087: aplicadas só no Docker de teste.
