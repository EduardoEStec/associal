# ASSOCIAL — Especificação do Sistema

Sistema do Serviço Social da INTECS nos **Armazéns Solidários** (Termo de Colaboração TCL/073/2023/SMDHC/SESANA).
Substitui: MS Forms de atendimento (1 por unidade/mês), Excel de controle, questionário familiar em papel e relatórios Word montados à mão.

## Stack (decidida — não alterar)
- Front: **HTML5 + CSS3 + JavaScript puro** (ES modules, sem framework, sem build step). Mobile-first; também usado no computador da loja. PWA (manifest + service worker simples para instalação).
- Back: **Node.js 22 + Express** (JavaScript, CommonJS ou ESM — escolher um e manter). API REST em `/api/*`; páginas estáticas em `/public`.
- Banco: **SQL Server** via pacote `mssql`. Scripts versionados em `/database` (`001_schema.sql`, `002_seed.sql`, ...). Queries sempre parametrizadas.
- Config via `.env` (fornecer `.env.example`): `PORT`, `DB_SERVER=localhost`, `DB_PORT=1433`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=ASSOCIAL`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`, `SESSION_SECRET`, `UPLOAD_DIR`.
- Auth: `express-session` + `bcrypt`. Senhas nunca em texto puro.
- Uploads (fotos): `multer`, gravados em `UPLOAD_DIR` (volume Docker).
- Relatórios: `.docx` a partir dos modelos Word (docxtemplater/pizzip ou `docx`).
- Docker: `Dockerfile` (node:22-alpine) + `docker-compose.yml` com o app; SQL Server **externo** (via .env). `docker-compose.dev.yml` opcional com `mcr.microsoft.com/mssql/server:2022-latest` para teste local.

## Perfis e permissões (LGPD — dados com CPF de famílias vulneráveis)
| Perfil | Escopo |
|---|---|
| ASSISTENTE | Apenas a(s) unidade(s) vinculada(s) a ela (tabela usuario_unidade; normalmente 1, pode cobrir outra) |
| COORDENADOR | Todas as unidades (Elinaldo) |
| ADMIN | TI: gerencia usuários, unidades, tabelas de apoio e configurações |

Filtro por unidade é aplicado **no back-end** em toda query — nunca confiar no front.
Pessoa/família é única por CPF no sistema todo: assistente de outra unidade pode localizar pelo CPF e reaproveitar dados pessoais, mas **não vê atendimentos/acompanhamentos de outra unidade**.
Registrar auditoria (quem criou/alterou, quando) nas tabelas principais.

## Unidades
| Sigla | Nome |
|---|---|
| BRA | Brasilândia |
| TIR | Cidade Tiradentes |
| CTJ | City Jaraguá |
| GUA | Guaianases |
| JAR | Jaraguá |
| MBO | M'Boi Mirim |
| SMP | São Miguel Paulista |

## Módulo 1 — Atendimento Social (substitui o MS Forms)
Campos (unidade vem do usuário logado / seleção entre as unidades permitidas):
1. Data do atendimento (obrigatório)
2. Nome completo
3. Data de nascimento
4. CPF (validar dígitos)
5. Nº CadÚnico (NIS)
6. Endereço (rua e número)
7. CEP
8. Bairro
9. Trabalho atual (texto)
10. Demanda (múltipla): Atualização do CadÚnico; Novo cadastro do CadÚnico; Informações/Orientações; Saúde; Proteção Social Básica; Proteção Social Especial; Violação de Direitos - Criança/Adolescente; Violação de Direitos - Mulher; Violação de Direitos - Idoso; Outra (texto)
11. Faixa etária: Idoso (60+); Adulto (30-59); Jovem (18-29); Adolescente (12-17); Outra — calcular automaticamente pela data de nascimento quando houver
12. Gênero: Feminino; Masculino; LGBT; Outra
13. Escolaridade: Não alfabetizado; Fundamental incompleto; Fundamental completo; Médio incompleto; Médio completo; Superior; Outra
14. Raça/etnia: Branco; Preto; Pardo; Indígena; Amarelo; Outra
15. Nível de vulnerabilidade: Altíssima; Alta; Média; Baixa; Outra
16. Vulnerabilidades/riscos (múltipla): Insegurança alimentar; Desemprego ou subemprego; Moradia precária; Baixa escolaridade; Violência doméstica ou comunitária; Dependência química; Outros (texto)
17. Resumo do atendimento (texto longo)
18. Encaminhamentos (múltipla): CRAS; CREAS; UBS; CAPS Adulto; CAPS AD; CAPS IJ; Centro de Referência da Mulher; Conselho Tutelar; Unidade Descomplica; Outra (texto)

Dados pessoais (2–9, 12–14) pertencem à **Pessoa** (reaproveitados por CPF); o atendimento referencia a pessoa.
Listas de opções ficam em tabelas de apoio (editáveis pelo ADMIN), não hard-coded.

## Módulo 2 — Visitas e Ações (substitui abas CRONOGRAMA e BASE_UNICA_ACOES)
Campos: data, unidade, instituição/local, endereço, temas (até 4, da tabela de temas), status (Planejada/Realizada/Cancelada), qtd de participantes, descrição/observações, **fotos** (várias, com legenda).
Temas padronizados: Assistência Social; Saúde; Educação; Cultura; Esporte; Serviços ao Cidadão; Idoso; Mulher; Família; Associação Comunitária; Direitos Humanos e Cidadania.
Tipo: Visita institucional / Ação na unidade / Palestra / Roda de conversa / Outra.

## Módulo 3 — Acompanhamento Familiar
Família = responsável familiar (pessoa) + membros (nome, idade/nasc., gênero, parentesco, trabalha?).
Acompanhamento: unidade, assistente, data início, status (Em andamento / Concluído / Desligado).
**Questionário INICIAL e FINAL** com as mesmas perguntas (versão "hoje"); prazo entre eles configurável pelo COORDENADOR (config `prazo_questionario_final_dias`); sistema sinaliza finais vencendo/vencidos.
Perguntas (do modelo "QUESTIONÁRIO FAMILIAR ATUALIZADO"):
1. Demográficos: a) composição familiar (membros); b) renda mensal média (R$); c) nº membros com renda; d) recebe auxílio governamental? (não/sim: qual — Bolsa Família, BPC/LOAS, Tarifa Social Energia, Auxílio Gás, outro)
2. Alimentos: a) acesso a alimentos in natura (não tinha; 1-2x/sem; 2-3x/sem; diário); b) frequência consumo frutas/verduras/legumes (1-2x; 3-4x; 5+ x/sem); c) qualidade da alimentação (melhorou muito; melhorou um pouco; não melhorou; piorou); d) saúde/bem-estar nutricional (grande melhoria; pequena; nenhuma)
3. Econômico: a) consegue poupar? (sim/não); b) economia mensal no armazém (até R$100; R$101–200; R$201–300; acima de R$300 + valor); c) destino da economia (múltipla: saúde; alimentação; educação; moradia; dívidas; outras + texto); d) capacidade de poupança (regularmente; às vezes; não consegue); e) dívidas/gestão financeira (melhorou; sem mudança; piorou)
4. Empoderamento: a) mais empoderada p/ decisões? (sim/não); b) contribuição p/ autonomia financeira (texto); c) melhoria no planejamento (sim/não); d) impacto na comunidade (texto); e) o que melhorar (texto)
5. Percepção: a) avaliação do armazém (ótima; boa; regular; ruim); b) principal benefício (texto); c) recomendaria? (sim/não)

Comparação inicial × final: por família e consolidada por unidade/período (renda, frequência de consumo, poupança, economia, etc.).

## Módulo 4 — Relatórios
- **Relatório Individual Familiar** (.docx), seções: identificação; 1 Introdução; 2 Objetivo; 3 Metodologia; 4 Diagnóstico Inicial; 5 Impacto na Comunidade; 6 Feedback dos Beneficiários; 7 Considerações finais; local/data; assinatura Assistente Social + CRESS. Pré-preenchido com dados do questionário; textos editáveis antes de gerar.
- **Relatório Semestral / Prestação de Contas** (.docx): período, unidades; 1 Introdução; 2 Atividades (2.1 atendimentos — total; 2.2 encaminhamentos — total e instituições; 2.3 visitas — total e lista por unidade; 2.4 outras ações); 3 Empoderamento econômico (nº famílias acompanhadas, resultados da comparação, relatos); 4 Considerações finais; Anexos com fotos por unidade. Assinatura do Coordenador.
- Modelos originais: `C:\Users\Eduardo Oliveira\Documents\ASSOCIAL\`.

## Módulo 5 — Painel do Coordenador
Por unidade e mês (equivalente à aba BS_ATENDIMENTO): qtd atendimentos/encaminhamentos, qtd ações, qtd participantes, qtd famílias acompanhadas, total atendimento (= atendimentos + participantes), % encaminhamentos; perfil do público (faixa etária, gênero, escolaridade, raça, vulnerabilidade, demandas); filtros por período/unidade.

## Convenções
- Código e nomes de tabelas/colunas em português, snake_case no banco, camelCase no JS.
- Datas no formato BR na interface (dd/mm/aaaa); armazenar DATE/DATETIME2.
- Interface 100% em português.
- Estrutura: `/server` (rotas, middlewares, db), `/public` (html, css, js), `/database`, `/docs`.
