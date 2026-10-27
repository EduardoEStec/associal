/* =====================================================================
   ASSOCIAL — 086_questionarios_m1.sql  (M1 — modelos oficiais de questionário inicial e final)

   O questionário INICIAL e o FINAL passam a ter perguntas DIFERENTES (docs/modelos/1-questionario-inicial e 3-questionario-final).
   Modelagem: as perguntas oficiais novas vivem no CATÁLOGO da P2 (formulários QUESTIONARIO_INICIAL e QUESTIONARIO_FINAL) e as
   respostas ficam em dbo.resposta_extra (uma linha por pergunta; uma por opção na múltipla), ligadas ao questionário. Assim a
   coordenação continua renomeando perguntas, acrescentando opções e criando perguntas adicionais, sem mudar o banco.

   1. catalogo_pergunta.formulario passa a aceitar QUESTIONARIO_INICIAL e QUESTIONARIO_FINAL (o QUESTIONARIO antigo fica só para
      os questionários no formato anterior).
   2. catalogo_opcao ganha `pontos` (0 a 100 na regra do índice de progresso v2; NULL = não pontua) e `pede_detalhe` (a opção
      pede um texto, ex.: "Outras: ____").
   3. questionario ganha `modelo`: LEGADO (todas as linhas existentes, somente leitura quando concluídas) ou M1.
   4. Semente: 14 + 21 perguntas oficiais com as opções do papel (docs/modelos/MAPEAMENTO.md).
   5. Configuração `meta_projeto` (texto do cabeçalho dos formulários).

   Nada é apagado: os questionários antigos continuam visíveis. Idempotente.
   ===================================================================== */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------------------------------------------------------------------
   1. Formulários do catálogo
   --------------------------------------------------------------------- */

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.catalogo_pergunta') AND name = N'formulario' AND max_length < 24)
    ALTER TABLE dbo.catalogo_pergunta ALTER COLUMN formulario VARCHAR(24) NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_catalogo_pergunta_formulario' AND parent_object_id = OBJECT_ID(N'dbo.catalogo_pergunta')
           AND definition NOT LIKE N'%QUESTIONARIO_FINAL%')
    ALTER TABLE dbo.catalogo_pergunta DROP CONSTRAINT ck_catalogo_pergunta_formulario;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_catalogo_pergunta_formulario' AND parent_object_id = OBJECT_ID(N'dbo.catalogo_pergunta'))
    ALTER TABLE dbo.catalogo_pergunta ADD CONSTRAINT ck_catalogo_pergunta_formulario
        CHECK (formulario IN ('QUESTIONARIO', 'QUESTIONARIO_INICIAL', 'QUESTIONARIO_FINAL', 'PESQUISA', 'ATENDIMENTO'));
GO

/* ---------------------------------------------------------------------
   2. Pontuação e detalhe das opções
   --------------------------------------------------------------------- */

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.catalogo_opcao') AND name = N'pontos')
    ALTER TABLE dbo.catalogo_opcao ADD pontos TINYINT NULL;               -- regra v2 do índice: 0 (pior) a 100 (melhor); NULL = não pontua
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.catalogo_opcao') AND name = N'pede_detalhe')
    ALTER TABLE dbo.catalogo_opcao ADD pede_detalhe BIT NOT NULL CONSTRAINT df_catalogo_opcao_pede_detalhe DEFAULT 0;   -- "Outras: ____"
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_catalogo_opcao_pontos' AND parent_object_id = OBJECT_ID(N'dbo.catalogo_opcao'))
    ALTER TABLE dbo.catalogo_opcao ADD CONSTRAINT ck_catalogo_opcao_pontos CHECK (pontos IS NULL OR pontos <= 100);
GO

/* ---------------------------------------------------------------------
   3. Modelo do questionário (LEGADO = formato anterior à M1)
   --------------------------------------------------------------------- */

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.questionario') AND name = N'modelo')
    ALTER TABLE dbo.questionario ADD modelo VARCHAR(6) NOT NULL CONSTRAINT df_questionario_modelo DEFAULT 'LEGADO';
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_modelo' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario ADD CONSTRAINT ck_questionario_modelo CHECK (modelo IN ('LEGADO', 'M1'));
GO

/* ---------------------------------------------------------------------
   4. Semente: perguntas e opções OFICIAIS dos modelos 1 (inicial) e 3 (final)
      (gerada de server/services/modelos-m1.js — não editar a mão; a coordenação renomeia pela tela)
   --------------------------------------------------------------------- */

INSERT INTO dbo.catalogo_pergunta (formulario, secao, codigo, oficial, campo, tipo, texto, obrigatoria, ordem)
SELECT v.formulario, v.secao, v.codigo, 1, v.campo, v.tipo, v.texto, v.obrigatoria, v.ordem
FROM (VALUES
    ('QUESTIONARIO_INICIAL', 1, '1.1', 'qtdIntegrantes', 'NUMERO', N'Número de integrantes da família', 1, 10),
    ('QUESTIONARIO_INICIAL', 1, '1.2', 'faixaEtaria', 'ESCOLHA', N'Faixa etária predominante', 1, 20),
    ('QUESTIONARIO_INICIAL', 1, '1.3', 'situacaoCadUnico', 'ESCOLHA', N'Situação do CadÚnico', 1, 30),
    ('QUESTIONARIO_INICIAL', 2, '2.1', 'fonteRenda', 'ESCOLHA', N'Qual a principal fonte de renda familiar?', 1, 40),
    ('QUESTIONARIO_INICIAL', 2, '2.2', 'rendaFaixa', 'ESCOLHA', N'Renda familiar mensal aproximada:', 1, 50),
    ('QUESTIONARIO_INICIAL', 2, '2.3', 'pessoasComRenda', 'NUMERO', N'Número de pessoas que contribuem para a renda familiar:', 1, 60),
    ('QUESTIONARIO_INICIAL', 2, '2.4', 'reservaFinanceira', 'ESCOLHA', N'Atualmente, a família consegue reservar algum valor da sua renda para poupança ou para situações imprevistas?', 1, 70),
    ('QUESTIONARIO_INICIAL', 2, '2.5', 'dificuldadeDespesas', 'ESCOLHA', N'A família relata dificuldade para custear despesas básicas?', 1, 80),
    ('QUESTIONARIO_INICIAL', 3, '3.1', 'situacaoAlimentar', 'TEXTO', N'Situação alimentar antes/início do acompanhamento', 0, 90),
    ('QUESTIONARIO_INICIAL', 3, '3.2', 'alimentosSuficientes', 'ESCOLHA', N'Antes do projeto, a família teve dificuldade para adquirir alimentos suficientes para todos os integrantes?', 1, 100),
    ('QUESTIONARIO_INICIAL', 3, '3.3', 'reducaoAlimentos', 'ESCOLHA', N'Houve necessidade de reduzir a quantidade ou qualidade dos alimentos devido à falta de recursos financeiros?', 1, 110),
    ('QUESTIONARIO_INICIAL', 3, '3.4', 'deixouRefeicao', 'ESCOLHA', N'Houve situação em que algum integrante da família deixou de realizar uma refeição por falta de alimentos ou recursos financeiros?', 1, 120),
    ('QUESTIONARIO_INICIAL', 3, '3.5', 'alimentosImportantes', 'ESCOLHA', N'A família conseguia adquirir regularmente alimentos considerados importantes para uma alimentação adequada?', 1, 130),
    ('QUESTIONARIO_INICIAL', 3, '3.6', 'frutasVerduras', 'ESCOLHA', N'A família possuía acesso regular a frutas, verduras e legumes?', 1, 140),
    ('QUESTIONARIO_FINAL', 1, '1.2', 'fonteRenda', 'ESCOLHA', N'Qual a principal fonte de renda familiar?', 1, 10),
    ('QUESTIONARIO_FINAL', 1, '1.3', 'rendaFaixa', 'ESCOLHA', N'Qual a renda familiar mensal aproximada atualmente?', 1, 20),
    ('QUESTIONARIO_FINAL', 1, '1.4', 'evolucaoEconomica', 'ESCOLHA', N'Comparando com o início do acompanhamento, a situação econômica da família:', 1, 30),
    ('QUESTIONARIO_FINAL', 2, '2.1', 'frequenciaCompras', 'ESCOLHA', N'Com que frequência a família realiza compras no Armazém Solidário?', 1, 40),
    ('QUESTIONARIO_FINAL', 2, '2.2', 'armazemMelhoraAcesso', 'ESCOLHA', N'O Armazém Solidário contribui para melhorar o acesso da família aos alimentos?', 1, 50),
    ('QUESTIONARIO_FINAL', 2, '2.3', 'qualidadeAlimentacao', 'ESCOLHA', N'Qual foi o impacto na qualidade da alimentação da família após o acesso aos produtos mais baratos?', 1, 60),
    ('QUESTIONARIO_FINAL', 2, '2.4', 'frutasVerduras', 'ESCOLHA', N'Com que frequência a família consome frutas, verduras e legumes após acesso ao armazém solidário?', 1, 70),
    ('QUESTIONARIO_FINAL', 2, '2.5', 'alimentosSuficientes', 'ESCOLHA', N'Atualmente, a família consegue adquirir alimentos suficientes para atender suas necessidades?', 1, 80),
    ('QUESTIONARIO_FINAL', 2, '2.6', 'reducaoAlimentos', 'ESCOLHA', N'Atualmente, a família enfrenta redução da quantidade ou qualidade dos alimentos por falta de recursos?', 1, 90),
    ('QUESTIONARIO_FINAL', 2, '2.7', 'deixouRefeicao', 'ESCOLHA', N'Atualmente, algum integrante da família deixa de realizar refeições por falta de alimentos ou recursos?', 1, 100),
    ('QUESTIONARIO_FINAL', 2, '2.8', 'variedadeAlimentos', 'ESCOLHA', N'Houve mudança na variedade e qualidade dos alimentos consumidos pela família?', 1, 110),
    ('QUESTIONARIO_FINAL', 3, '3.1', 'precosReduziramDespesas', 'ESCOLHA', N'A família considera que os preços praticados no Armazém contribuíram para reduzir as despesas com alimentação e melhorar as condições econômicas da família?', 1, 120),
    ('QUESTIONARIO_FINAL', 3, '3.2', 'economiaMensal', 'ESCOLHA', N'Quanto a família economiza mensalmente com a compra de produtos no armazém solidário?', 1, 130),
    ('QUESTIONARIO_FINAL', 3, '3.3', 'despesasPriorizadas', 'MULTIPLA', N'Quais despesas são priorizadas com eventual economia obtida?', 1, 140),
    ('QUESTIONARIO_FINAL', 3, '3.4', 'dividasGestao', 'ESCOLHA', N'Houve redução de dívidas ou melhoria na gestão financeira familiar?', 1, 150),
    ('QUESTIONARIO_FINAL', 4, '4.1', 'mudancasAtribuidas', 'TEXTO', N'Quais as principais mudanças a família atribui após o acesso ao Armazém Solidário?', 0, 160),
    ('QUESTIONARIO_FINAL', 4, '4.2', 'impactoComunidade', 'TEXTO', N'Como a família enxerga o impacto do projeto na comunidade local?', 0, 170),
    ('QUESTIONARIO_FINAL', 4, '4.3', 'oQueMelhorar', 'TEXTO', N'O que poderia ser melhorado no projeto para aumentar seu impacto no empoderamento econômico das famílias?', 0, 180),
    ('QUESTIONARIO_FINAL', 4, '4.4', 'principalBeneficio', 'TEXTO', N'O que a família considera como o principal benefício do projeto?', 0, 190),
    ('QUESTIONARIO_FINAL', 4, '4.5', 'avaliacaoGeral', 'ESCOLHA', N'Qual é a avaliação geral da família sobre o armazém solidário?', 1, 200),
    ('QUESTIONARIO_FINAL', 4, '4.6', 'recomendaria', 'SIM_NAO', N'A família recomendaria o projeto para outras famílias ou comunidades?', 1, 210)
) AS v(formulario, secao, codigo, campo, tipo, texto, obrigatoria, ordem)
WHERE NOT EXISTS (SELECT 1 FROM dbo.catalogo_pergunta c WHERE c.formulario = v.formulario AND c.codigo = v.codigo);
GO

INSERT INTO dbo.catalogo_opcao (pergunta_id, codigo, texto, base, posicao, pontos, pede_detalhe, ordem)
SELECT p.id, v.codigo, v.texto, 1, v.posicao, v.pontos, v.pede_detalhe, v.ordem
FROM (VALUES
    ('QUESTIONARIO_INICIAL', '1.2', 'CRIANCAS_ADOLESCENTES', N'Crianças e adolescentes (até 17 anos)', 0, NULL, 0, 10),
    ('QUESTIONARIO_INICIAL', '1.2', 'ADULTOS', N'Adultos (18 a 59 anos)', 1, NULL, 0, 20),
    ('QUESTIONARIO_INICIAL', '1.2', 'IDOSOS', N'Idosos (60 anos ou mais)', 2, NULL, 0, 30),
    ('QUESTIONARIO_INICIAL', '1.3', 'ATUALIZADO', N'Atualizado', 0, NULL, 0, 10),
    ('QUESTIONARIO_INICIAL', '1.3', 'NECESSITA_ATUALIZACAO', N'Necessita atualização', 1, NULL, 0, 20),
    ('QUESTIONARIO_INICIAL', '1.3', 'EM_ATUALIZACAO', N'Em processo de atualização', 2, NULL, 0, 30),
    ('QUESTIONARIO_INICIAL', '2.1', 'TRABALHO_FORMAL', N'Trabalho formal', 0, NULL, 0, 10),
    ('QUESTIONARIO_INICIAL', '2.1', 'TRABALHO_INFORMAL', N'Trabalho informal/autônomo', 1, NULL, 0, 20),
    ('QUESTIONARIO_INICIAL', '2.1', 'APOSENTADORIA_PENSAO', N'Aposentadoria/pensão', 2, NULL, 0, 30),
    ('QUESTIONARIO_INICIAL', '2.1', 'TRANSFERENCIA_RENDA', N'Benefício de transferência de renda/assistencial', 3, NULL, 0, 40),
    ('QUESTIONARIO_INICIAL', '2.1', 'PREVIDENCIARIO', N'Benefício previdenciário', 4, NULL, 0, 50),
    ('QUESTIONARIO_INICIAL', '2.1', 'OUTRAS', N'Outras', 5, NULL, 1, 60),
    ('QUESTIONARIO_INICIAL', '2.1', 'SEM_RENDA', N'Sem renda no momento', 6, NULL, 0, 70),
    ('QUESTIONARIO_INICIAL', '2.2', 'ATE_500', N'Até R$ 500,00', 0, 0, 0, 10),
    ('QUESTIONARIO_INICIAL', '2.2', 'DE_501_1000', N'De R$ 501,00 a R$ 1.000,00', 1, 25, 0, 20),
    ('QUESTIONARIO_INICIAL', '2.2', 'DE_1001_2000', N'De R$ 1.001,00 a R$ 2.000,00', 2, 50, 0, 30),
    ('QUESTIONARIO_INICIAL', '2.2', 'DE_2001_3000', N'De R$ 2.001,00 a R$ 3.000,00', 3, 75, 0, 40),
    ('QUESTIONARIO_INICIAL', '2.2', 'ACIMA_3000', N'Acima de R$ 3.000,00', 4, 100, 0, 50),
    ('QUESTIONARIO_INICIAL', '2.2', 'NAO_INFORMADO', N'Não informado', 5, NULL, 0, 60),
    ('QUESTIONARIO_INICIAL', '2.4', 'NENHUM', N'Não consegue reservar nenhum valor', 0, 0, 0, 10),
    ('QUESTIONARIO_INICIAL', '2.4', 'RARAMENTE', N'Consegue raramente', 1, 25, 0, 20),
    ('QUESTIONARIO_INICIAL', '2.4', 'OCASIONALMENTE', N'Consegue ocasionalmente', 2, 50, 0, 30),
    ('QUESTIONARIO_INICIAL', '2.4', 'REGULARMENTE', N'Consegue regularmente', 3, 75, 0, 40),
    ('QUESTIONARIO_INICIAL', '2.4', 'TODOS_MESES', N'Consegue reservar valor todos os meses', 4, 100, 0, 50),
    ('QUESTIONARIO_INICIAL', '2.5', 'NAO', N'Não', 0, 100, 0, 10),
    ('QUESTIONARIO_INICIAL', '2.5', 'EVENTUALMENTE', N'Sim, eventualmente', 1, 67, 0, 20),
    ('QUESTIONARIO_INICIAL', '2.5', 'FREQUENTEMENTE', N'Sim, frequentemente', 2, 33, 0, 30),
    ('QUESTIONARIO_INICIAL', '2.5', 'PERMANENTE', N'Sim, de forma permanente', 3, 0, 0, 40),
    ('QUESTIONARIO_INICIAL', '3.2', 'ALGUMAS_VEZES', N'Algumas vezes', 0, 50, 0, 10),
    ('QUESTIONARIO_INICIAL', '3.2', 'FREQUENTEMENTE', N'Frequentemente', 1, 0, 0, 20),
    ('QUESTIONARIO_INICIAL', '3.2', 'RARAMENTE', N'Raramente', 2, 75, 0, 30),
    ('QUESTIONARIO_INICIAL', '3.2', 'NUNCA', N'Nunca', 3, 100, 0, 40),
    ('QUESTIONARIO_INICIAL', '3.3', 'SIM_EVENTUALMENTE', N'Sim, eventualmente', 0, 50, 0, 10),
    ('QUESTIONARIO_INICIAL', '3.3', 'SIM_FREQUENTEMENTE', N'Sim, frequentemente', 1, 0, 0, 20),
    ('QUESTIONARIO_INICIAL', '3.3', 'NAO', N'Não', 2, 100, 0, 30),
    ('QUESTIONARIO_INICIAL', '3.4', 'SIM', N'Sim', 0, 0, 0, 10),
    ('QUESTIONARIO_INICIAL', '3.4', 'NAO', N'Não', 1, 100, 0, 20),
    ('QUESTIONARIO_INICIAL', '3.4', 'ALGUMAS_VEZES', N'Algumas vezes', 2, 50, 0, 30),
    ('QUESTIONARIO_INICIAL', '3.5', 'PARCIALMENTE', N'Parcialmente', 0, 50, 0, 10),
    ('QUESTIONARIO_INICIAL', '3.5', 'RARAMENTE', N'Raramente', 1, 25, 0, 20),
    ('QUESTIONARIO_INICIAL', '3.5', 'NAO', N'Não', 2, 0, 0, 30),
    ('QUESTIONARIO_INICIAL', '3.5', 'SIM', N'Sim', 3, 100, 0, 40),
    ('QUESTIONARIO_INICIAL', '3.6', 'SIM', N'Sim', 0, 100, 0, 10),
    ('QUESTIONARIO_INICIAL', '3.6', 'PARCIALMENTE', N'Parcialmente', 1, 50, 0, 20),
    ('QUESTIONARIO_INICIAL', '3.6', 'NAO', N'Não', 2, 0, 0, 30),
    ('QUESTIONARIO_FINAL', '1.2', 'TRABALHO_FORMAL', N'Trabalho formal', 0, NULL, 0, 10),
    ('QUESTIONARIO_FINAL', '1.2', 'TRABALHO_INFORMAL', N'Trabalho informal/autônomo', 1, NULL, 0, 20),
    ('QUESTIONARIO_FINAL', '1.2', 'APOSENTADORIA_PENSAO', N'Aposentadoria/pensão', 2, NULL, 0, 30),
    ('QUESTIONARIO_FINAL', '1.2', 'TRANSFERENCIA_RENDA', N'Benefício de transferência de renda/assistencial', 3, NULL, 0, 40),
    ('QUESTIONARIO_FINAL', '1.2', 'PREVIDENCIARIO', N'Benefício previdenciário', 4, NULL, 0, 50),
    ('QUESTIONARIO_FINAL', '1.2', 'OUTRAS', N'Outras', 5, NULL, 1, 60),
    ('QUESTIONARIO_FINAL', '1.2', 'SEM_RENDA', N'Sem renda no momento', 6, NULL, 0, 70),
    ('QUESTIONARIO_FINAL', '1.3', 'ATE_500', N'Até R$ 500,00', 0, 0, 0, 10),
    ('QUESTIONARIO_FINAL', '1.3', 'DE_501_1000', N'De R$ 501,00 a R$ 1.000,00', 1, 25, 0, 20),
    ('QUESTIONARIO_FINAL', '1.3', 'DE_1001_2000', N'De R$ 1.001,00 a R$ 2.000,00', 2, 50, 0, 30),
    ('QUESTIONARIO_FINAL', '1.3', 'DE_2001_3000', N'De R$ 2.001,00 a R$ 3.000,00', 3, 75, 0, 40),
    ('QUESTIONARIO_FINAL', '1.3', 'ACIMA_3000', N'Acima de R$ 3.000,00', 4, 100, 0, 50),
    ('QUESTIONARIO_FINAL', '1.3', 'NAO_INFORMADO', N'Não informado', 5, NULL, 0, 60),
    ('QUESTIONARIO_FINAL', '1.4', 'MELHOROU', N'Melhorou', 0, 100, 0, 10),
    ('QUESTIONARIO_FINAL', '1.4', 'SEMELHANTE', N'Permaneceu semelhante', 1, 50, 0, 20),
    ('QUESTIONARIO_FINAL', '1.4', 'PIOROU', N'Piorou', 2, 0, 0, 30),
    ('QUESTIONARIO_FINAL', '1.4', 'NAO_AVALIAR', N'Não é possível avaliar', 3, NULL, 0, 40),
    ('QUESTIONARIO_FINAL', '2.1', 'SEMANALMENTE', N'Semanalmente', 0, NULL, 0, 10),
    ('QUESTIONARIO_FINAL', '2.1', 'QUINZENALMENTE', N'Quinzenalmente', 1, NULL, 0, 20),
    ('QUESTIONARIO_FINAL', '2.1', 'MENSALMENTE', N'Mensalmente', 2, NULL, 0, 30),
    ('QUESTIONARIO_FINAL', '2.1', 'EVENTUALMENTE', N'Eventualmente', 3, NULL, 0, 40),
    ('QUESTIONARIO_FINAL', '2.2', 'SIM', N'Sim', 0, 100, 0, 10),
    ('QUESTIONARIO_FINAL', '2.2', 'PARCIALMENTE', N'Parcialmente', 1, 50, 0, 20),
    ('QUESTIONARIO_FINAL', '2.2', 'NAO', N'Não', 2, 0, 0, 30),
    ('QUESTIONARIO_FINAL', '2.3', 'MELHOROU_MUITO', N'Melhorou muito', 0, 100, 0, 10),
    ('QUESTIONARIO_FINAL', '2.3', 'MELHOROU_POUCO', N'Melhorou um pouco', 1, 67, 0, 20),
    ('QUESTIONARIO_FINAL', '2.3', 'NAO_MELHOROU', N'Não melhorou', 2, 33, 0, 30),
    ('QUESTIONARIO_FINAL', '2.3', 'PIOROU', N'Piorou', 3, 0, 0, 40),
    ('QUESTIONARIO_FINAL', '2.4', 'UMA_DUAS', N'1-2 vezes por semana', 0, 33, 0, 10),
    ('QUESTIONARIO_FINAL', '2.4', 'TRES_QUATRO', N'3-4 vezes por semana', 1, 67, 0, 20),
    ('QUESTIONARIO_FINAL', '2.4', 'CINCO_OU_MAIS', N'5 ou mais vezes por semana', 2, 100, 0, 30),
    ('QUESTIONARIO_FINAL', '2.5', 'SIM', N'Sim', 0, 100, 0, 10),
    ('QUESTIONARIO_FINAL', '2.5', 'PARCIALMENTE', N'Parcialmente', 1, 50, 0, 20),
    ('QUESTIONARIO_FINAL', '2.5', 'NAO', N'Não', 2, 0, 0, 30),
    ('QUESTIONARIO_FINAL', '2.6', 'NAO', N'Não', 0, 100, 0, 10),
    ('QUESTIONARIO_FINAL', '2.6', 'RARAMENTE', N'Raramente', 1, 75, 0, 20),
    ('QUESTIONARIO_FINAL', '2.6', 'ALGUMAS_VEZES', N'Algumas vezes', 2, 50, 0, 30),
    ('QUESTIONARIO_FINAL', '2.6', 'FREQUENTEMENTE', N'Frequentemente', 3, 0, 0, 40),
    ('QUESTIONARIO_FINAL', '2.7', 'NAO', N'Não', 0, 100, 0, 10),
    ('QUESTIONARIO_FINAL', '2.7', 'SIM', N'Sim', 1, 0, 0, 20),
    ('QUESTIONARIO_FINAL', '2.8', 'MELHOROU', N'Melhorou', 0, 100, 0, 10),
    ('QUESTIONARIO_FINAL', '2.8', 'SEMELHANTE', N'Permaneceu semelhante', 1, 50, 0, 20),
    ('QUESTIONARIO_FINAL', '2.8', 'PIOROU', N'Piorou', 2, 0, 0, 30),
    ('QUESTIONARIO_FINAL', '2.8', 'NAO_AVALIAR', N'Não é possível avaliar', 3, NULL, 0, 40),
    ('QUESTIONARIO_FINAL', '3.1', 'SIM', N'Sim', 0, 100, 0, 10),
    ('QUESTIONARIO_FINAL', '3.1', 'PARCIALMENTE', N'Parcialmente', 1, 50, 0, 20),
    ('QUESTIONARIO_FINAL', '3.1', 'NAO', N'Não', 2, 0, 0, 30),
    ('QUESTIONARIO_FINAL', '3.2', 'ATE_100', N'Até R$ 100,00', 0, 0, 0, 10),
    ('QUESTIONARIO_FINAL', '3.2', 'DE_101_300', N'De R$ 101,00 a R$ 300,00', 1, 33, 0, 20),
    ('QUESTIONARIO_FINAL', '3.2', 'DE_301_400', N'De R$ 301,00 a R$ 400,00', 2, 67, 0, 30),
    ('QUESTIONARIO_FINAL', '3.2', 'ACIMA_400', N'Acima de R$ 400,00', 3, 100, 0, 40),
    ('QUESTIONARIO_FINAL', '3.2', 'OUTRO_VALOR', N'Outro valor', 4, NULL, 1, 50),
    ('QUESTIONARIO_FINAL', '3.3', 'MORADIA', N'Moradia', 0, NULL, 0, 10),
    ('QUESTIONARIO_FINAL', '3.3', 'ENERGIA_AGUA', N'Energia elétrica/Água', 1, NULL, 0, 20),
    ('QUESTIONARIO_FINAL', '3.3', 'TRANSPORTE', N'Transporte', 2, NULL, 0, 30),
    ('QUESTIONARIO_FINAL', '3.3', 'SAUDE', N'Saúde', 3, NULL, 0, 40),
    ('QUESTIONARIO_FINAL', '3.3', 'EDUCACAO', N'Educação', 4, NULL, 0, 50),
    ('QUESTIONARIO_FINAL', '3.3', 'VESTUARIO', N'Vestuário', 5, NULL, 0, 60),
    ('QUESTIONARIO_FINAL', '3.3', 'LAZER', N'Lazer', 6, NULL, 0, 70),
    ('QUESTIONARIO_FINAL', '3.3', 'OUTRAS', N'Outras', 7, NULL, 1, 80),
    ('QUESTIONARIO_FINAL', '3.4', 'MELHORA', N'Sim, houve melhora', 0, 100, 0, 10),
    ('QUESTIONARIO_FINAL', '3.4', 'NAO_MUDOU', N'Não houve mudança', 1, 50, 0, 20),
    ('QUESTIONARIO_FINAL', '3.4', 'PARCIALMENTE', N'Houve parcialmente', 2, 75, 0, 30),
    ('QUESTIONARIO_FINAL', '4.5', 'OTIMA', N'Ótima', 0, 100, 0, 10),
    ('QUESTIONARIO_FINAL', '4.5', 'BOA', N'Boa', 1, 67, 0, 20),
    ('QUESTIONARIO_FINAL', '4.5', 'REGULAR', N'Regular', 2, 33, 0, 30),
    ('QUESTIONARIO_FINAL', '4.5', 'RUIM', N'Ruim', 3, 0, 0, 40)
) AS v(formulario, pergunta, codigo, texto, posicao, pontos, pede_detalhe, ordem)
JOIN dbo.catalogo_pergunta p ON p.formulario = v.formulario AND p.codigo = v.pergunta
WHERE NOT EXISTS (SELECT 1 FROM dbo.catalogo_opcao o WHERE o.pergunta_id = p.id AND o.codigo = v.codigo);
GO

/* ---------------------------------------------------------------------
   5. Configuração
   --------------------------------------------------------------------- */

INSERT INTO dbo.configuracao (chave, valor, descricao)
SELECT v.chave, v.valor, v.descricao
FROM (VALUES
    ('meta_projeto',
        N'Contribuir para o empoderamento econômico de 10 famílias locais vinculadas ao projeto, acompanhando os impactos do Armazém Solidário na economia familiar e na segurança alimentar.',
        N'Meta do projeto impressa no cabeçalho dos questionários inicial e final e no relatório final familiar.')
) AS v(chave, valor, descricao)
WHERE NOT EXISTS (SELECT 1 FROM dbo.configuracao c WHERE c.chave = v.chave);
GO
