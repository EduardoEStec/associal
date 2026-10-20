# T6 — Painel do Coordenador

Leia primeiro `docs/tasks/_REGRAS-PARALELO.md`. Porta de teste: **3106**.

## Seus arquivos
`server/routes/painel.js`, `server/services/painel*.js`, `public/painel.html`, `public/js/paginas/painel.js`, `public/js/painel/*`, `public/css/painel.css`, `public/js/paginas/inicio.js` **(somente o bloco de resumo da tela inicial, ver item 3)**, `database/040–049_*.sql`, `tests/painel/`.

## Dependências paralelas
T2/T3/T4 estão construindo as telas de entrada agora. Consulte o banco diretamente pelo schema `database/001_schema.sql` (estável). Sempre com filtro de unidade (`clausulaUnidades`), mesmo o painel sendo COORDENADOR/ADMIN.

## Escopo
1. **API** `/api/painel` (COORDENADOR/ADMIN):
   - `GET /api/painel/mensal?ano=&mes=` e `?inicio=&fim=` → por unidade (linhas) e total — equivalente à aba BS_ATENDIMENTO: QTD ATD/ENCAMINHAMENTO (atendimentos), QTD ENCAMINHAMENTOS (atendimentos com ≥1 encaminhamento), QTD AÇÕES (realizadas), QTDE PARTICIPANTES (soma das ações realizadas), QTD FAMÍLIAS ACOMPANHADAS (em andamento no período), TOTAL ATENDIMENTO (= atendimentos + participantes), % ENCAMINHAMENTOS (= atendimentos com encaminhamento / total atendimento, como no Excel — confirme a fórmula olhando o Excel: `CONTROLE_Assistencia Social_11032026_REVISADO.xlsx`, aba BS_ATENDIMENTO, em `C:\Users\Eduardo Oliveira\Documents\ASSOCIAL\` e documente).
   - `GET /api/painel/evolucao?inicio=&fim=&unidadeId=` → série mensal dos indicadores.
   - `GET /api/painel/perfil?inicio=&fim=&unidadeId=` → distribuição por faixa etária, gênero, escolaridade, raça, nível de vulnerabilidade, vulnerabilidades, demandas, encaminhamentos.
   - `GET /api/painel/alertas` → questionários finais vencendo/vencidos por unidade, ações planejadas sem atualização após a data.
2. **Tela** `painel.html`: filtros de período (mês, semestre, personalizado) e unidade; cartões de KPI; tabela por unidade (como o Excel); gráficos de barras/linhas desenhados com **SVG gerado em JS puro** (sem bibliotecas; cores das variáveis CSS; legível no tema claro/escuro e no celular); perfil do público; alertas. Botão exportar CSV da tabela mensal.
3. **Tela inicial** (`inicio.js`): bloco de resumo do mês por perfil — ASSISTENTE vê os números da(s) sua(s) unidade(s) (crie `GET /api/painel/resumo-inicio` acessível a TODOS os perfis, filtrado por unidade) e seus pendentes (questionários finais a vencer); COORDENADOR vê o total geral.
