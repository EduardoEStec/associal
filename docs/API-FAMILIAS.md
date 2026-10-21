# API Famílias (`/api/familias`)

Módulo 3 — Acompanhamento Familiar. Exige sessão. **LGPD:** família só é exposta através de um *acompanhamento* de unidade
permitida ao usuário (outra unidade ⇒ `404`). Erros no formato padrão (CONVENCOES §4). Escritas exigem `X-Requested-With: fetch`
e perfil `ASSISTENTE`, `COORDENADOR` ou `ADMIN` (V12: o ADMIN opera como a coordenação). Datas `AAAA-MM-DD`; colunas DATE chegam como `…T00:00:00.000Z`.

Complementos: registros e linha do tempo em `docs/API-ACOMPANHAMENTO.md`, pesquisa de satisfação em `docs/API-PESQUISA.md`, plano de metas em `docs/API-METAS.md`.

Conceitos: **família** = responsável (pessoa por CPF) + membros; **acompanhamento** = família numa unidade, com `status`
`EM_ANDAMENTO | CONCLUIDO | DESLIGADO`. Um acompanhamento tem no máximo um questionário `INICIAL` e um `FINAL`. Todos os `:id`
abaixo são o **`acompanhamentoId`**.

## Situação do questionário final (`finalSituacao`)

Só para acompanhamentos `EM_ANDAMENTO` (senão `null`). `prazo = dataPrevistaFinal` (= `dataInicio` + config `prazo_questionario_final_dias`);
`alerta` = config `alerta_questionario_final_dias_antes`.

| Valor | Regra | `diasParaFinal` |
|---|---|---|
| `CONCLUIDO` | questionário FINAL concluído | `null` |
| `VENCIDO` | prazo anterior a hoje | negativo |
| `VENCENDO` | faltam ≤ `alerta` dias (inclui hoje) | ≥ 0 |
| `EM_DIA` | demais | positivo (ou `null` sem prazo) |

## Lista e cadastro

### `GET /api/familias`
Query: `unidadeId` (403 se não permitida), `status`, `finalSituacao` (`PENDENTE` = não concluído, qualquer prazo · `EM_DIA` · `VENCENDO` · `VENCIDO` · `CONCLUIDO`),
`q` (nome ou início do CPF), `pagina` (1), `tamanho` (20, máx 100). Ordem: em andamento primeiro, vencidos primeiro, prazo.

```json
{ "itens": [ { "acompanhamentoId": 3, "familiaId": 2, "unidadeId": 1, "unidadeSigla": "BRA", "status": "EM_ANDAMENTO",
    "dataInicio": "…", "dataPrevistaFinal": "…", "dataEncerramento": null,
    "responsavel": { "id": 9, "nome": "Maria", "cpf": "52998224725" }, "qtdMembros": 4,
    "inicialConcluido": true, "finalConcluido": false, "finalSituacao": "VENCENDO", "diasParaFinal": 6 } ],
  "total": 1, "pagina": 1, "tamanho": 20 }
```
`qtdMembros` conta o responsável + demais membros.

### `POST /api/familias` → `201 { acompanhamentoId, familiaId, dataPrevistaFinal }`
```json
{ "unidadeId": 1, "dataInicio": "2026-03-01", "observacoes": null,
  "responsavel": { "cpf": "52998224725", "nome": "Maria", "dataNascimento": null, "nis": null, "endereco": null,
                   "cep": null, "bairro": null, "trabalhoAtual": null, "generoId": null, "escolaridadeId": null, "racaId": null },
  "membros": [ { "nome": "Pedro", "dataNascimento": null, "idade": 8, "generoId": 2, "parentesco": "Filho", "trabalha": false } ] }
```
- `unidadeId` opcional se o usuário só tem uma unidade; `dataInicio` padrão hoje (não futura); CPF obrigatório e válido.
- Pessoa reaproveitada por CPF (campos enviados atualizam; campos omitidos **não** apagam). Família reaproveitada se a pessoa já era responsável de uma família anterior (membros são substituídos pelos enviados).
- `membros[]` são os demais moradores (o responsável não entra). Se há `dataNascimento`, `idade` é descartada.
- Erros: `400` (`detalhes` com chaves `responsavel.cpf`, `membros.0.nome`, `dataInicio`…); `403` unidade não permitida;
  `409` já em acompanhamento — na **mesma** unidade vem `detalhes.acompanhamentoId`; em **outra** unidade a mensagem é só
  "Esta família já está em acompanhamento em outra unidade." (sem detalhes).

### `GET /api/familias/acompanhamentos/:id`
Ficha: `{ acompanhamentoId, familiaId, status, dataInicio, dataPrevistaFinal, dataEncerramento, observacoes, unidade, assistente,
responsavel{pessoaId,cpf,nome,…}, membros[], questionarios:{inicial,final}, finalSituacao, diasParaFinal, comparacaoDisponivel }`
onde cada questionário é `{ existe, id, concluido, dataAplicacao }`.

### `PUT /api/familias/acompanhamentos/:id` (só `EM_ANDAMENTO`, senão 409)
Parcial: `membros` (substitui a lista), `responsavel` (dados pessoais; CPF não muda; campos omitidos não apagam),
`dataInicio` (recalcula o prazo), `dataPrevistaFinal` (**só COORDENADOR**), `observacoes`. Devolve a ficha.

### `POST /api/familias/acompanhamentos/:id/encerrar`
`{ "status": "CONCLUIDO"|"DESLIGADO", "dataEncerramento"?, "observacoes"? }`.
`CONCLUIDO` exige questionário FINAL concluído (409); `DESLIGADO` exige `observacoes` com o motivo (400). Devolve a ficha.
Encerrado ⇒ acompanhamento e questionários ficam somente leitura.

## Questionário

### `GET /api/familias/questionario/modelo?tipo=INICIAL|FINAL`
Perguntas (5 blocos), textos (FINAL no presente, "hoje"), opções e dicas — fonte única para a tela.
`tipo` de pergunta: `numero | moeda | booleano | escolha | multipla | texto`.

### `GET /api/familias/acompanhamentos/:id/questionarios/:tipo`
```json
{ "acompanhamentoId": 3, "tipo": "INICIAL", "existe": true, "id": 12, "concluido": false, "dataAplicacao": "…",
  "respostas": { "qtdMembrosFamilia": 4, "rendaMensalMedia": 1500, "qtdMembrosComRenda": 1, "recebeAuxilio": true,
    "beneficioIds": [1], "auxilioOutro": null, "acessoAlimentosInNatura": "SEMANAL_1_2", "frequenciaFrutasVerduras": null,
    "qualidadeAlimentacao": null, "saudeNutricional": null, "conseguePoupar": false, "economiaMensalFaixa": "ATE_100",
    "economiaMensalValor": 80, "destinoEconomiaIds": [2], "destinoEconomiaOutro": null, "capacidadePoupanca": null,
    "gestaoFinanceira": null, "empoderadaDecisoes": null, "contribuicaoAutonomia": null, "melhoriaPlanejamento": null,
    "impactoComunidade": null, "oQueMelhorar": null, "avaliacaoArmazem": null, "principalBeneficio": null, "recomendaria": null },
  "sugestoes": { "dataAplicacao": "2026-06-10", "qtdMembrosFamilia": 3 }, "podeEditar": true, "bloqueio": null }
```
Códigos das respostas fechadas: `server/lib/dominios.js` (`QUESTIONARIO`). `bloqueio` ≠ null ⇒ leitura apenas
(acompanhamento encerrado, ou FINAL antes do INICIAL concluído).

### `PUT /api/familias/acompanhamentos/:id/questionarios/:tipo`
Corpo: as chaves de `respostas` no **nível raiz** + `dataAplicacao` + `concluir` (boolean). Devolve o mesmo formato do GET.
- `concluir:false` ⇒ **rascunho**: aceita qualquer subconjunto (valida só tipos/códigos).
- `concluir:true` ⇒ exige todas as respostas fechadas e sim/não; se `recebeAuxilio` = sim ⇒ ao menos um `beneficioIds`;
  `destinoEconomiaIds` ao menos um; `economiaMensalFaixa = ACIMA_300` ⇒ `economiaMensalValor`; opção "Outro/Outras" exige o texto.
  Textos abertos (4b, 4d, 4e, 5b) são opcionais.
- Coerências: `economiaMensalValor` deve cair na faixa (≤100 · 100–200 · 200–300 · >300); `qtdMembrosComRenda ≤ qtdMembrosFamilia`; data não futura; data do FINAL ≥ data do INICIAL.
- Questionário já concluído continua sendo validado por inteiro a cada gravação (não volta a rascunho).
- `409` se o acompanhamento está encerrado ou se o INICIAL ainda não foi concluído (ao gravar o FINAL).
- `400` com `detalhes` por campo (`avaliacaoArmazem`, `beneficioIds`…).

## Comparação inicial × final

Direção de "melhora" por pergunta: escalas ordenadas do pior ao melhor (`ESCALAS` em `server/services/questionario.js`);
sim/não: "sim" é melhor em 3a, 4a, 4c, 5c; renda (1b), nº de membros com renda (1c) e valor de economia: maior é melhor;
nº de pessoas (1a) e recebe auxílio (1d) são **neutros** (`neutro`); textos e múltiplas (3c) são `neutro`.

### `GET /api/familias/acompanhamentos/:id/comparacao`
Se faltar um questionário concluído: `{ completo: false, motivo, inicial, final, … }`. Senão:
```json
{ "acompanhamentoId": 3, "status": "CONCLUIDO", "responsavel": { "nome": "Maria" },
  "inicial": { "existe": true, "concluido": true, "dataAplicacao": "…" }, "final": { … }, "completo": true,
  "itens": [ { "campo": "rendaMensalMedia", "codigo": "1b", "bloco": 1, "tipo": "moeda", "pergunta": "Hoje, qual é a renda…",
               "inicial": 1500, "final": 1800, "tendencia": "melhorou", "variacao": 300, "variacaoPercentual": 20 },
             { "campo": "acessoAlimentosInNatura", "tipo": "escolha", "inicial": "SEMANAL_1_2", "inicialRotulo": "1-2 vezes por semana",
               "final": "DIARIO", "finalRotulo": "Diário", "tendencia": "melhorou", … },
             { "campo": "destinoEconomiaIds", "tipo": "multipla", "inicial": ["Alimentação"], "final": ["Alimentação","Saúde"], "tendencia": "neutro" } ],
  "resumo": { "melhorou": 8, "igual": 4, "piorou": 1, "neutro": 6, "semDados": 0, "comparaveis": 13 },
  "renda":    { "antes": 1500, "depois": 1800, "variacao": 300, "variacaoPercentual": 20 },
  "economia": { "antes": 80, "depois": 150, "variacao": 70, "variacaoPercentual": 87.5 },
  "passouAPoupar": true }
```
`tendencia`: `melhorou | igual | piorou | neutro | sem_dados`. Itens com `recebeAuxilio` trazem `detalheInicial/detalheFinal` (nomes) e
`inicialOutro/finalOutro`; `economiaMensalFaixa` traz `inicialValor/finalValor`. Respostas abertas (4b, 4d, 4e, 5b) vêm em `inicial`/`final` como texto.

### `GET /api/familias/comparacao?inicio=&fim=&unidadeId=` — consolidado (usado pelo relatório semestral)
Considera acompanhamentos (qualquer `status`) das unidades permitidas com **ambos** os questionários concluídos; o período
filtra a `dataAplicacao` do **FINAL** (`inicio`/`fim` opcionais, inclusivos). `unidadeId` fora do escopo ⇒ 403.

```json
{ "periodo": { "inicio": "2026-01-01", "fim": "2026-06-30" }, "unidadeId": null, "totalFamilias": 12,
  "perguntas": [
    { "campo": "acessoAlimentosInNatura", "codigo": "2a", "tipo": "escolha", "pergunta": "…",
      "antes":  { "opcoes": [ { "valor": "NAO_TINHA", "rotulo": "Não tinha acesso", "familias": 3, "percentual": 25 }, … ], "semResposta": 0 },
      "depois": { "opcoes": [ … ], "semResposta": 0 },
      "melhoraram": 7, "iguais": 4, "pioraram": 1, "semDados": 0 },
    { "campo": "conseguePoupar", "tipo": "booleano", "antes": { "sim": 3, "nao": 9, "semResposta": 0, "percentualSim": 25 },
      "depois": { "sim": 8, "nao": 4, "semResposta": 0, "percentualSim": 66.67 }, "melhoraram": 5, "iguais": 7, "pioraram": 0, "semDados": 0 },
    { "campo": "rendaMensalMedia", "tipo": "moeda", "antes": { "media": 1450.5 }, "depois": { "media": 1620 },
      "variacaoMedia": 169.5, "variacaoPercentual": 11.69, "melhoraram": 7, "iguais": 3, "pioraram": 2, "semDados": 0 },
    { "campo": "destinoEconomiaIds", "tipo": "multipla", "antes": [ { "id": 2, "nome": "Alimentação", "familias": 9 } ], "depois": [ … ] } ],
  "destaques": {
    "rendaMedia":    { "antes": 1450.5, "depois": 1620, "variacao": 169.5, "variacaoPercentual": 11.69 },
    "economiaMedia": { "antes": 90, "depois": 160, "variacao": 70, "variacaoPercentual": 77.78 },
    "poupanca": { "antes": 3, "depois": 8, "percentualAntes": 25, "percentualDepois": 66.67,
                  "naoPoupavamAntes": 9, "passaramAPoupar": 5, "percentualPassaramAPoupar": 55.56 } },
  "porUnidade": [ { "unidadeId": 1, "sigla": "BRA", "nome": "Brasilândia", "totalFamilias": 5, "destaques": { … } } ] }
```
Percentuais sobre `totalFamilias`, 2 casas. Perguntas abertas (texto) ficam fora do consolidado. `percentualPassaramAPoupar` é `null` quando ninguém
"não poupava" antes. Médias ignoram famílias sem resposta naquela pergunta.

## Índice de progresso e reavaliação rápida (F5)

Regra em `server/services/indice-progresso.js` (funções puras, testadas em `tests/familias/indice.test.js`); proposta, seção 5.

**Cálculo.** Cada resposta vira 0–100 (posição na escala ordenada; sim = 100/não = 0; renda **per capita** = 1b ÷ 1a por faixa do salário mínimo de referência:
até ¼ → 0 · ¼–½ → 33 · ½–1 → 67 · acima de 1 → 100; proporção com renda = 1c ÷ 1a). Quatro dimensões: `ALIMENTACAO` (2a, 2b, 2c, 2d), `RENDA` (1b, 1c),
`ECONOMIA` (3a, 3b, 3d, 3e), `AUTONOMIA` (4a, 4c); o bloco 5 não entra. Nível da dimensão = média dos itens respondidos, **só existe com pelo menos metade
dos itens respondidos** (senão `null`, nunca zero). Itens de percepção (2c, 2d, 3e) pesam metade no INICIAL. `GERAL` = média das dimensões com nível.
Semáforo entre dois pontos: diferença ≥ +tolerância → `melhorou`, ≤ −tolerância → `piorou`, senão `igual`; sem nível nos dois lados → `sem_dados`.
O geral da comparação usa só as dimensões com nível nos dois pontos.

**Instantâneo.** Ao concluir (ou corrigir) um questionário, o serviço grava 5 linhas em `acompanhamento_indice` (GERAL + 4 dimensões) com `versao_regra` e
`parametros` (salário mínimo usado, renda per capita). `node scripts/recalcular-indices.js` refaz todos (trava: só no Docker de teste; `--banco-real` para o real).

**Reavaliação rápida (D9a).** Questionário `REAVALIACAO` (mesma tabela `questionario`, uma por acompanhamento) com 10 campos de estado: 1a (confirma o nº de pessoas), 1b, 1c, 2a, 2b, 3a, 3b (+ valor), 3d, 4a, 4c.
Textos no presente; as perguntas oficiais do INICIAL e do FINAL não mudam. Só depois do INICIAL concluído; não é criada depois do FINAL concluído (`409`); data entre as dos demais. As rotas de questionário aceitam `:tipo` = `INICIAL | REAVALIACAO | FINAL`
e `GET /api/familias/questionario/modelo?tipo=REAVALIACAO` devolve 4 blocos. Concluir exige só as 10 perguntas; o resto nunca é gravado.

### `GET /api/familias/acompanhamentos/:id/indicadores`
Leitura para quem acessa a unidade (ADMIN e COORDENADOR: todas).
```json
{ "acompanhamentoId": 3, "status": "EM_ANDAMENTO", "versaoRegra": 1, "tolerancia": 5, "salarioMinimo": 1621,
  "rotulos": { "GERAL": "Índice geral", "ALIMENTACAO": "Alimentação", "RENDA": "Renda e trabalho", "ECONOMIA": "Economia e poupança", "AUTONOMIA": "Autonomia" },
  "pontos": [ { "questionarioId": 12, "tipo": "INICIAL", "dataRef": "2026-08-22", "versaoRegra": 1, "desatualizado": false,
                "dimensoes": { "ALIMENTACAO": { "nivel": 5.56, "itensValidos": 4, "itensTotal": 4 }, "RENDA": { … }, "ECONOMIA": { … }, "AUTONOMIA": { … } },
                "geral": { "nivel": 6.3, "dimensoes": 4 }, "parametros": { "salarioMinimo": 1621, "rendaPerCapita": 300 } } ],
  "comparacao": { "de": "INICIAL", "para": "FINAL", "geral": { "antes": 6.3, "depois": 67.7, "diferenca": 61.4, "selo": "melhorou", "dimensoesComparadas": 4 },
                  "dimensoes": { "ALIMENTACAO": { "antes": 5.56, "depois": 87.5, "diferenca": 81.9, "selo": "melhorou" } } },
  "passos": [ { "de": "INICIAL", "para": "REAVALIACAO", "geral": { … }, "dimensoes": { … } } ],
  "reavaliacao": { "situacao": "PENDENTE", "dataPrevista": "2026-10-06", "existe": false, "concluida": false },
  "situacoesRegistros": [ { "data": "2026-09-02", "situacao": "MELHORANDO" } ] }
```
`pontos` em ordem do tempo; `comparacao` = primeiro × último ponto (`null` com menos de 2). `reavaliacao.situacao`: `NAO_SE_APLICA` · `AGENDADA` · `PENDENTE` (passou de `dataInicio + reavaliacao_dias`) · `CONCLUIDA` · `DISPENSADA` (final já concluído).
Pontos de questionários concluídos antes da F5 são calculados na hora (`calculadoAgora`) até rodar o script de recálculo.

**Configurações** (Administração > Configurações, COORDENADOR e ADMIN): `indice_tolerancia_pontos` (5), `salario_minimo_referencia` (R$ 1621, atualizar todo ano), `reavaliacao_dias` (45).

**Relatório individual.** Subseção "Evolução durante o acompanhamento" (texto editável `textos.evolucao` + tabela das dimensões inicial → reavaliação → final com o selo escrito); só aparece com 2 ou mais pontos.
