# T4 — Famílias e Acompanhamento (questionário inicial/final + comparação)

Leia primeiro `docs/tasks/_REGRAS-PARALELO.md`. Porta de teste: **3104**.

## Seus arquivos
`server/routes/familias.js`, `server/services/familias*.js`, `server/services/questionario*.js`, `public/familias.html`, `public/js/paginas/familias.js`, `public/js/familias/*`, `public/css/familias.css`, `database/030–039_*.sql`, `tests/familias/`.

## Dependência paralela
A API de pessoas (`/api/pessoas/buscar?cpf=`, `POST /api/pessoas`, `PUT /api/pessoas/:id`) está sendo feita AGORA pela T2 — contrato em `docs/tasks/T2-atendimentos.md` item 1. Use esse contrato no front; **não** crie rotas de pessoa. Se precisar criar/atualizar pessoa dentro de uma transação do seu módulo (ex.: criar família + responsável), faça o INSERT/UPDATE em `dbo.pessoa` no seu service, seguindo as mesmas regras (CPF único, só dígitos).

## Escopo
1. **API** `/api/familias`:
   - Listar acompanhamentos (filtros: unidade permitida, status, questionário final pendente/vencendo/vencido, texto) — familia só exposta via acompanhamento de unidade permitida (CONVENCOES §2.4).
   - Criar família + acompanhamento: responsável (pessoa por CPF; reaproveita se existir), membros (nome, nasc./idade, gênero, parentesco, trabalha), unidade, data início; `data_prevista_final = data_inicio + configuracao.prazo_questionario_final_dias`. Respeitar "1 acompanhamento EM_ANDAMENTO por família" (409 com mensagem clara se outra unidade já acompanha — sem revelar detalhes da outra unidade além de "já em acompanhamento em outra unidade").
   - Editar membros/acompanhamento; encerrar (CONCLUIDO exige questionário FINAL concluído; DESLIGADO exige motivo em observações).
   - Questionário: `GET/PUT /api/familias/acompanhamentos/:id/questionarios/:tipo` (INICIAL|FINAL) — salvar rascunho e concluir; FINAL só após INICIAL concluído. Validar códigos com `server/lib/dominios.js` (QUESTIONARIO).
   - **Comparação**: `GET /api/familias/acompanhamentos/:id/comparacao` (por família, pergunta a pergunta: inicial × final com indicação melhorou/igual/piorou para as fechadas e variação de renda/economia) e `GET /api/familias/comparacao?inicio=&fim=&unidadeId=` (consolidado: nº famílias com ambos questionários, distribuição antes/depois de cada pergunta fechada, média de renda e economia antes/depois, % que passou a poupar etc.). Documente em `docs/API-FAMILIAS.md` (T5 usará isso no relatório).
2. **Tela** `familias.html`:
   - Lista de famílias acompanhadas com selo de status do questionário final (em dia / vence em X dias / vencido).
   - Cadastro da família (responsável + membros dinâmicos).
   - **Questionário em etapas** (5 blocos = 5 passos, barra de progresso, botões grandes, salvar rascunho automático) — pensado para aplicar no celular com a família. O FINAL reaproveita as mesmas perguntas, com texto no presente ("hoje").
   - Tela de comparação inicial × final por família (lado a lado, setas/cores de melhora/piora, acessível também sem cor).

## Fora do escopo
Relatório individual .docx (T5) — mas deixe os dados prontos via API.
