# Questionário Individual Familiar — texto oficial e conferência com o sistema

Texto enviado pelo usuário (fonte da verdade para perguntas e opções). A coluna "No sistema" mostra como cada item aparece hoje em
`server/services/questionario.js` (perguntas), `server/lib/dominios.js` (opções fechadas) e `database/002_seed.sql` (auxílios e destinos).
O sistema aplica o roteiro em dois momentos (INICIAL e FINAL, "hoje"), por isso algumas perguntas "antes/depois do projeto" aparecem
reescritas no presente; isso é intencional (proposta F1) e não conta como divergência.

**Cabeçalho:** Nome · Responsável familiar · CPF · CadÚnico · Contato · Endereço — vem do cadastro da família (responsável).

## 1. Dados demográficos e socioeconômicos
| Item | Texto oficial | No sistema |
|---|---|---|
| 1a | Composição familiar (número de membros, idade, gênero) — texto | Nº de pessoas (campo numérico, sugerido do cadastro) + membros com idade e gênero no cadastro da família. **Estrutura diferente** (ver pendências) |
| 1b | Renda mensal média da família — texto | Valor em R$ (numérico) |
| 1c | Quantos membros estão empregados ou têm fontes de renda — texto | Nº de pessoas (numérico). Texto ajustado nesta entrega |
| 1d | Recebe auxílio governamental ou benefício social? ( ) não ( ) sim: ____ | Sim/Não + lista (Bolsa Família, BPC/LOAS, Tarifa Social, Auxílio Gás, Outro + texto). Texto ajustado |

## 2. Acesso e consumo de alimentos
| Item | Texto oficial | Opções oficiais | No sistema |
|---|---|---|---|
| 2a | Antes do projeto, acesso a alimentos in natura | Não tinha acesso · 1–2 vezes por semana · 2–3 vezes por semana | Mesmas 3 + **"Diário"** (extra) |
| 2b | Frequência de frutas, verduras e legumes após acesso ao armazém | 1–2 · 3–4 · 5 ou mais vezes por semana | Igual |
| 2c | Impacto na qualidade da alimentação | Melhorou muito · Melhorou um pouco · Não melhorou · Piorou | Igual |
| 2d | Melhoria na saúde ou bem-estar nutricional | Grande melhoria · Pequena melhoria · Não houve melhoria | Igual (rótulo "Nenhuma melhoria" → **"Não houve melhoria"**, ajustado) |

## 3. Impacto econômico
| Item | Texto oficial | Opções oficiais | No sistema |
|---|---|---|---|
| 3a | Antes do projeto conseguia poupar? | Não · Sim | Sim/Não |
| 3b | Quanto economiza por mês no armazém | Até R$ 100 · R$ 101 a R$ 200 · acima de R$ 300 · R$ ____ | Faixas até 100 / 101–200 / **201–300 (extra)** / acima de 300 + valor em R$ |
| 3c | Destino da economia | Saúde · Alimentação · Educação · Moradia · Pagamento de dívidas · Outras: ____ | Saúde, Alimentação, Educação, Moradia, **"Dívidas"**, Outras + texto |
| 3d | Aumentou a capacidade de poupança | Poupa regularmente · Poupa às vezes · Não consegue poupar | Igual (rótulos ajustados: antes "Regularmente / Às vezes / Não consegue") |
| 3e | Redução de dívidas ou melhoria na gestão financeira | Sim, houve melhora · Não houve mudança · Houve piora | Igual (rótulos ajustados: antes "Melhorou / Sem mudança / Piorou") |

## 4. Empoderamento e autonomia
| Item | Texto oficial | No sistema |
|---|---|---|
| 4a | Mais empoderada para decidir sobre alimentação e economia? sim / não | Sim/Não; texto ajustado (antes "para tomar decisões") |
| 4b | Como o projeto contribuiu para a autonomia financeira — texto | Texto livre |
| 4c | Melhoria na capacidade de planejamento e gestão de recursos: sim, houve melhoria / não houve melhoria | Sim/Não; texto ajustado (antes "planejar melhor os gastos") |
| 4d | Como enxerga o impacto do projeto na comunidade local — texto | Texto livre |
| 4e | O que poderia ser melhorado no projeto — texto | Texto livre |

## 5. Percepção geral
| Item | Texto oficial | No sistema |
|---|---|---|
| 5a | Avaliação geral do armazém solidário: ótima / boa / regular / ruim | Igual |
| 5b | Principal benefício do projeto — texto | Texto livre |
| 5c | Recomendaria o projeto? sim / não | Sim/Não |

## Divergências de estrutura (NÃO alteradas — dependem de decisão; afetam banco, relatórios e comparação)
1. **1a** — o texto oficial pede composição em texto livre (membros, idade, gênero); o sistema guarda só o número e detalha os membros no cadastro da família.
2. **2a** — o sistema tem a opção extra "Diário" (não existe no texto oficial).
3. **3b** — o sistema tem a faixa extra "R$ 201 a R$ 300"; o texto oficial salta de R$ 200 para "acima de R$ 300" (provável lacuna do papel).
4. **3c** — o destino "Dívidas" tem o nome curto; o oficial é "Pagamento de dívidas". É dado de tabela (`destino_economia`): exige atualização de dados, não só de código.
5. **1d** — o oficial tem "sim: ____" em texto livre; o sistema usa lista de auxílios + "Outro".
6. **4c** — o oficial tem duas respostas ("sim, houve melhoria" / "não houve melhoria"); o sistema guarda sim/não (equivalente), apenas o texto da pergunta foi alinhado.
