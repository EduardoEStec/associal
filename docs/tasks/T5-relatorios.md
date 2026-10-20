# T5 — Relatórios (.docx): Individual Familiar e Semestral/Prestação de Contas

Leia primeiro `docs/tasks/_REGRAS-PARALELO.md`. Porta de teste: **3105**.

## Seus arquivos
`server/routes/relatorios.js`, `server/services/relatorios*.js`, `server/templates/*.docx` (novo diretório), `public/relatorios.html`, `public/js/paginas/relatorios.js`, `public/js/relatorios/*`, `public/css/relatorios.css`, `database/050–059_*.sql`, `tests/relatorios/`.

## Dependências paralelas
T2 (atendimentos), T3 (ações/fotos) e T4 (famílias/questionários/comparação) estão sendo feitas AGORA. **Não chame as rotas deles**: consulte o banco diretamente no seu service, pelo schema `database/001_schema.sql` (estável), sempre com filtro de unidade. Códigos/rótulos do questionário em `server/lib/dominios.js`. Fotos: arquivos em `config.uploadDir` + `acao_visita_foto.arquivo` (T3 grava em subpasta `acoes/`).

## Escopo
1. **Templates**: crie templates docxtemplater em `server/templates/` a partir dos modelos originais em `C:\Users\Eduardo Oliveira\Documents\ASSOCIAL\` (`4.Modelo RELATÓRIO INDIVIDUAL FAMILIAR empoderamento economico.docx`; a estrutura do semestral está descrita na especificação — o PDF `Relatório_Semestral_Asistencia Social.pdf` é escaneado, use a descrição). Preserve o visual (cabeçalho/rodapé INTECS) copiando o .docx original e substituindo o conteúdo por tags. Imagens das fotos: use um módulo de imagem compatível SEM adicionar dependência npm (se não for viável, gere o docx das fotos com a lib `docx` NÃO — liste como pendência e insira lista de legendas como fallback).
2. **Relatório Individual Familiar** — `POST /api/relatorios/individual/:acompanhamentoId`: busca família, membros, questionários INICIAL e FINAL, monta textos padrão (Introdução/Objetivo/Metodologia fixos do modelo; Diagnóstico Inicial gerado a partir do questionário inicial — composição, renda, trabalho, auxílios; Impacto a partir da comparação; Feedback a partir das respostas abertas) → a tela mostra os textos para a assistente **editar antes de gerar** → retorna .docx. Assinatura com nome e CRESS do usuário.
3. **Relatório Semestral / Prestação de Contas** — período (padrão: semestre atual), unidades (COORDENADOR: todas ou seleção): totais de atendimentos e encaminhamentos (e por instituição de encaminhamento), visitas realizadas por unidade com nomes das instituições, outras ações, nº famílias acompanhadas + consolidado inicial×final (médias de renda/economia antes e depois, distribuições), relatos selecionáveis (respostas abertas dos questionários, escolhidos pelo coordenador na tela), considerações finais editáveis, anexos de fotos por unidade (selecionáveis). Textos introdutórios editáveis com padrão do modelo.
4. **Tela** `relatorios.html`: escolher tipo, filtros, pré-visualização dos números e textos editáveis, botão "Gerar .docx" (download). ASSISTENTE só gera da(s) sua(s) unidade(s); semestral consolidado de todas só COORDENADOR/ADMIN.
5. Também um export **Excel/CSV** simples (CSV com `;` e BOM UTF-8) dos atendimentos e ações do período — formato equivalente às abas BS_ATENDIMENTO e BASE_UNICA_ACOES — para transição.
