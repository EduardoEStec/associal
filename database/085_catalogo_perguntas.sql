/* =====================================================================
   ASSOCIAL — 085_catalogo_perguntas.sql  (P2 — perguntas e opções configuráveis pela coordenação)

   Catálogo de perguntas dos três formulários que a coordenação pode configurar:
     QUESTIONARIO (Questionário Individual Familiar), PESQUISA (pesquisa de satisfação) e ATENDIMENTO (novo atendimento).

   1. catalogo_pergunta  — uma linha por pergunta. As OFICIAIS (semeadas aqui) têm campo fixo no banco/código e só podem
                           ser renomeadas; as EXTRAS (criadas na Administração) têm código estável "E0001"... e podem ser
                           ativadas, desativadas, reordenadas e excluídas (só sem respostas).
   2. catalogo_opcao     — opções das perguntas de escolha. Oficiais ("base") definem a ESCALA do índice de progresso e da
                           comparação inicial x final (posicao 0 = pior). Opção ACRESCENTADA a pergunta oficial diz com qual
                           opção base ela "vale" (equivale_a_id) ou não pontua (equivale_a_id NULL): o código da opção nunca muda,
                           então renomear não afeta o histórico.
   3. resposta_extra     — respostas às perguntas extras (genérica): uma linha por pergunta (texto/número/sim-não/escolha única)
                           ou uma por opção marcada (múltipla), ligada a UM dono: questionário, atendimento ou resposta de pesquisa.
   4. questionario       — as 8 colunas de escolha deixam de ter CHECK com a lista fixa (impediria opções novas): ficam VARCHAR(40)
                           com CHECK de formato; a validade do código é conferida pela API contra o catálogo.

   Nunca se apaga pergunta/opção que tenha resposta: só se desativa. Idempotente.
   Doc: docs/API-CATALOGO.md
   ===================================================================== */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------------------------------------------------------------------
   1. Perguntas
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.catalogo_pergunta', N'U') IS NULL
CREATE TABLE dbo.catalogo_pergunta (
    id          INT IDENTITY(1,1) CONSTRAINT pk_catalogo_pergunta PRIMARY KEY,
    formulario  VARCHAR(14)   NOT NULL,                 -- QUESTIONARIO | PESQUISA | ATENDIMENTO
    secao       SMALLINT      NOT NULL,                 -- questionário: 1 a 5 (blocos); pesquisa e atendimento: 1
    codigo      VARCHAR(20)   NOT NULL,                 -- oficiais: 1a, 2b, NPS, L1...; extras: E0001...
    oficial     BIT           NOT NULL CONSTRAINT df_catalogo_pergunta_oficial DEFAULT 0,
    campo       VARCHAR(60)   NULL,                     -- oficiais: nome do campo na API (questionário) ou código da pergunta (pesquisa)
    tipo        VARCHAR(10)   NOT NULL,                 -- TEXTO | NUMERO | SIM_NAO | ESCOLHA | MULTIPLA (+ MOEDA, NPS, LIKERT nas oficiais)
    texto       NVARCHAR(500) NOT NULL,                 -- questionário: texto do INICIAL; demais: texto único
    texto_final NVARCHAR(500) NULL,                     -- questionário: texto do FINAL ("hoje"); NULL = igual ao texto
    ajuda       NVARCHAR(300) NULL,
    obrigatoria BIT           NOT NULL CONSTRAINT df_catalogo_pergunta_obrigatoria DEFAULT 0,   -- extras: exigida ao concluir/salvar
    ordem       INT           NOT NULL CONSTRAINT df_catalogo_pergunta_ordem DEFAULT 0,
    ativa       BIT           NOT NULL CONSTRAINT df_catalogo_pergunta_ativa DEFAULT 1,
    criado_por   INT NULL CONSTRAINT fk_catalogo_pergunta_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_catalogo_pergunta_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_catalogo_pergunta_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL,
    CONSTRAINT uq_catalogo_pergunta UNIQUE (formulario, codigo),
    CONSTRAINT ck_catalogo_pergunta_formulario CHECK (formulario IN ('QUESTIONARIO', 'PESQUISA', 'ATENDIMENTO')),
    CONSTRAINT ck_catalogo_pergunta_tipo CHECK (tipo IN ('TEXTO', 'NUMERO', 'SIM_NAO', 'ESCOLHA', 'MULTIPLA', 'MOEDA', 'NPS', 'LIKERT')),
    CONSTRAINT ck_catalogo_pergunta_extra_tipo CHECK (oficial = 1 OR tipo IN ('TEXTO', 'NUMERO', 'SIM_NAO', 'ESCOLHA', 'MULTIPLA'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_catalogo_pergunta_formulario' AND object_id = OBJECT_ID(N'dbo.catalogo_pergunta'))
CREATE INDEX ix_catalogo_pergunta_formulario ON dbo.catalogo_pergunta (formulario, secao, ordem);
GO

/* ---------------------------------------------------------------------
   2. Opções
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.catalogo_opcao', N'U') IS NULL
CREATE TABLE dbo.catalogo_opcao (
    id            INT IDENTITY(1,1) CONSTRAINT pk_catalogo_opcao PRIMARY KEY,
    pergunta_id   INT NOT NULL CONSTRAINT fk_catalogo_opcao_pergunta REFERENCES dbo.catalogo_pergunta(id),
    codigo        VARCHAR(40)   NOT NULL,               -- estável: oficiais NAO_TINHA, DIARIO...; acrescentadas OP01, OP02...
    texto         NVARCHAR(200) NOT NULL,
    texto_final   NVARCHAR(200) NULL,                   -- questionário FINAL ("Não tem acesso" no lugar de "Não tinha acesso")
    ordem         INT           NOT NULL CONSTRAINT df_catalogo_opcao_ordem DEFAULT 0,
    ativa         BIT           NOT NULL CONSTRAINT df_catalogo_opcao_ativa DEFAULT 1,
    base          BIT           NOT NULL CONSTRAINT df_catalogo_opcao_base DEFAULT 0,      -- 1 = opção oficial: define a escala
    posicao       SMALLINT      NULL,                   -- só base: 0 = pior ... n-1 = melhor (índice de progresso e comparação)
    equivale_a_id INT           NULL CONSTRAINT fk_catalogo_opcao_equivale REFERENCES dbo.catalogo_opcao(id),  -- acrescentada: vale como esta opção base; NULL = não pontua
    criado_por   INT NULL CONSTRAINT fk_catalogo_opcao_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_catalogo_opcao_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_catalogo_opcao_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL,
    CONSTRAINT uq_catalogo_opcao UNIQUE (pergunta_id, codigo),
    CONSTRAINT ck_catalogo_opcao_base CHECK ((base = 1 AND posicao IS NOT NULL AND equivale_a_id IS NULL) OR (base = 0 AND posicao IS NULL))
);
GO

/* ---------------------------------------------------------------------
   3. Respostas às perguntas extras
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.resposta_extra', N'U') IS NULL
CREATE TABLE dbo.resposta_extra (
    id                  BIGINT IDENTITY(1,1) CONSTRAINT pk_resposta_extra PRIMARY KEY,
    pergunta_id         INT NOT NULL CONSTRAINT fk_resposta_extra_pergunta REFERENCES dbo.catalogo_pergunta(id),
    questionario_id     INT NULL CONSTRAINT fk_resposta_extra_questionario REFERENCES dbo.questionario(id) ON DELETE CASCADE,
    atendimento_id      INT NULL CONSTRAINT fk_resposta_extra_atendimento  REFERENCES dbo.atendimento(id)  ON DELETE CASCADE,
    pesquisa_resposta_id INT NULL CONSTRAINT fk_resposta_extra_pesquisa    REFERENCES dbo.pesquisa_resposta(id) ON DELETE CASCADE,
    opcao_id            INT NULL CONSTRAINT fk_resposta_extra_opcao REFERENCES dbo.catalogo_opcao(id),   -- escolha única / múltipla
    valor_texto         NVARCHAR(2000) NULL,
    valor_num           DECIMAL(18,4) NULL,                 -- número; sim/não = 1/0
    CONSTRAINT ck_resposta_extra_dono CHECK (
        (CASE WHEN questionario_id IS NULL THEN 0 ELSE 1 END
       + CASE WHEN atendimento_id IS NULL THEN 0 ELSE 1 END
       + CASE WHEN pesquisa_resposta_id IS NULL THEN 0 ELSE 1 END) = 1)
);
GO

-- um valor por pergunta e dono (várias linhas só na múltipla, uma por opção)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_resposta_extra_questionario' AND object_id = OBJECT_ID(N'dbo.resposta_extra'))
CREATE UNIQUE INDEX ux_resposta_extra_questionario ON dbo.resposta_extra (questionario_id, pergunta_id, opcao_id) WHERE questionario_id IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_resposta_extra_atendimento' AND object_id = OBJECT_ID(N'dbo.resposta_extra'))
CREATE UNIQUE INDEX ux_resposta_extra_atendimento ON dbo.resposta_extra (atendimento_id, pergunta_id, opcao_id) WHERE atendimento_id IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_resposta_extra_pesquisa' AND object_id = OBJECT_ID(N'dbo.resposta_extra'))
CREATE UNIQUE INDEX ux_resposta_extra_pesquisa ON dbo.resposta_extra (pesquisa_resposta_id, pergunta_id, opcao_id) WHERE pesquisa_resposta_id IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_resposta_extra_pergunta' AND object_id = OBJECT_ID(N'dbo.resposta_extra'))
CREATE INDEX ix_resposta_extra_pergunta ON dbo.resposta_extra (pergunta_id) INCLUDE (opcao_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_resposta_extra_opcao' AND object_id = OBJECT_ID(N'dbo.resposta_extra'))
CREATE INDEX ix_resposta_extra_opcao ON dbo.resposta_extra (opcao_id) WHERE opcao_id IS NOT NULL;
GO

/* ---------------------------------------------------------------------
   4. questionario: colunas de escolha sem a lista fixa no CHECK
   --------------------------------------------------------------------- */

-- 2a: acesso_alimentos_in_natura
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_2a' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario DROP CONSTRAINT ck_questionario_2a;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.questionario') AND name = N'acesso_alimentos_in_natura' AND max_length < 40)
    ALTER TABLE dbo.questionario ALTER COLUMN acesso_alimentos_in_natura VARCHAR(40) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_2a_formato' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario ADD CONSTRAINT ck_questionario_2a_formato
        CHECK (acesso_alimentos_in_natura IS NULL OR acesso_alimentos_in_natura COLLATE Latin1_General_BIN NOT LIKE '%[^A-Z0-9_]%');
GO

-- 2b: frequencia_frutas_verduras
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_2b' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario DROP CONSTRAINT ck_questionario_2b;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.questionario') AND name = N'frequencia_frutas_verduras' AND max_length < 40)
    ALTER TABLE dbo.questionario ALTER COLUMN frequencia_frutas_verduras VARCHAR(40) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_2b_formato' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario ADD CONSTRAINT ck_questionario_2b_formato
        CHECK (frequencia_frutas_verduras IS NULL OR frequencia_frutas_verduras COLLATE Latin1_General_BIN NOT LIKE '%[^A-Z0-9_]%');
GO

-- 2c: qualidade_alimentacao
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_2c' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario DROP CONSTRAINT ck_questionario_2c;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.questionario') AND name = N'qualidade_alimentacao' AND max_length < 40)
    ALTER TABLE dbo.questionario ALTER COLUMN qualidade_alimentacao VARCHAR(40) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_2c_formato' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario ADD CONSTRAINT ck_questionario_2c_formato
        CHECK (qualidade_alimentacao IS NULL OR qualidade_alimentacao COLLATE Latin1_General_BIN NOT LIKE '%[^A-Z0-9_]%');
GO

-- 2d: saude_nutricional
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_2d' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario DROP CONSTRAINT ck_questionario_2d;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.questionario') AND name = N'saude_nutricional' AND max_length < 40)
    ALTER TABLE dbo.questionario ALTER COLUMN saude_nutricional VARCHAR(40) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_2d_formato' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario ADD CONSTRAINT ck_questionario_2d_formato
        CHECK (saude_nutricional IS NULL OR saude_nutricional COLLATE Latin1_General_BIN NOT LIKE '%[^A-Z0-9_]%');
GO

-- 3b: economia_mensal_faixa
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_3b' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario DROP CONSTRAINT ck_questionario_3b;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.questionario') AND name = N'economia_mensal_faixa' AND max_length < 40)
    ALTER TABLE dbo.questionario ALTER COLUMN economia_mensal_faixa VARCHAR(40) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_3b_formato' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario ADD CONSTRAINT ck_questionario_3b_formato
        CHECK (economia_mensal_faixa IS NULL OR economia_mensal_faixa COLLATE Latin1_General_BIN NOT LIKE '%[^A-Z0-9_]%');
GO

-- 3d: capacidade_poupanca
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_3d' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario DROP CONSTRAINT ck_questionario_3d;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.questionario') AND name = N'capacidade_poupanca' AND max_length < 40)
    ALTER TABLE dbo.questionario ALTER COLUMN capacidade_poupanca VARCHAR(40) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_3d_formato' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario ADD CONSTRAINT ck_questionario_3d_formato
        CHECK (capacidade_poupanca IS NULL OR capacidade_poupanca COLLATE Latin1_General_BIN NOT LIKE '%[^A-Z0-9_]%');
GO

-- 3e: gestao_financeira
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_3e' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario DROP CONSTRAINT ck_questionario_3e;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.questionario') AND name = N'gestao_financeira' AND max_length < 40)
    ALTER TABLE dbo.questionario ALTER COLUMN gestao_financeira VARCHAR(40) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_3e_formato' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario ADD CONSTRAINT ck_questionario_3e_formato
        CHECK (gestao_financeira IS NULL OR gestao_financeira COLLATE Latin1_General_BIN NOT LIKE '%[^A-Z0-9_]%');
GO

-- 5a: avaliacao_armazem
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_5a' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario DROP CONSTRAINT ck_questionario_5a;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.questionario') AND name = N'avaliacao_armazem' AND max_length < 40)
    ALTER TABLE dbo.questionario ALTER COLUMN avaliacao_armazem VARCHAR(40) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_questionario_5a_formato' AND parent_object_id = OBJECT_ID(N'dbo.questionario'))
    ALTER TABLE dbo.questionario ADD CONSTRAINT ck_questionario_5a_formato
        CHECK (avaliacao_armazem IS NULL OR avaliacao_armazem COLLATE Latin1_General_BIN NOT LIKE '%[^A-Z0-9_]%');
GO


/* ---------------------------------------------------------------------
   5. Semente: perguntas e opções OFICIAIS (textos atuais; a coordenação pode renomear)
   --------------------------------------------------------------------- */

INSERT INTO dbo.catalogo_pergunta (formulario, secao, codigo, oficial, campo, tipo, texto, texto_final, ajuda, ordem)
SELECT v.formulario, v.secao, v.codigo, 1, v.campo, v.tipo, v.texto, v.texto_final, v.ajuda, v.ordem
FROM (VALUES
    ('QUESTIONARIO', 1, '1a', 'qtdMembrosFamilia', 'NUMERO', N'Quantas pessoas compõem a família (contando com o responsável)?', N'Hoje, quantas pessoas compõem a família (contando com o responsável)?', NULL, 10),
    ('QUESTIONARIO', 1, '1b', 'rendaMensalMedia', 'MOEDA', N'Qual é a renda mensal média da família (R$)?', N'Hoje, qual é a renda mensal média da família (R$)?', NULL, 20),
    ('QUESTIONARIO', 1, '1c', 'qtdMembrosComRenda', 'NUMERO', N'Quantos membros da família estão empregados ou têm outras fontes de renda?', N'Hoje, quantos membros da família estão empregados ou têm outras fontes de renda?', NULL, 30),
    ('QUESTIONARIO', 1, '1d', 'recebeAuxilio', 'SIM_NAO', N'A família recebe auxílio governamental ou benefício social?', N'Hoje, a família recebe auxílio governamental ou benefício social?', NULL, 40),
    ('QUESTIONARIO', 2, '2a', 'acessoAlimentosInNatura', 'ESCOLHA', N'Com que frequência a família tem acesso a alimentos in natura (frutas, verduras e legumes)?', N'Hoje, com que frequência a família tem acesso a alimentos in natura (frutas, verduras e legumes)?', NULL, 10),
    ('QUESTIONARIO', 2, '2b', 'frequenciaFrutasVerduras', 'ESCOLHA', N'Com que frequência a família consome frutas, verduras e legumes?', N'Hoje, com que frequência a família consome frutas, verduras e legumes?', NULL, 20),
    ('QUESTIONARIO', 2, '2c', 'qualidadeAlimentacao', 'ESCOLHA', N'Como está a qualidade da alimentação da família?', N'Como ficou a qualidade da alimentação da família?', N'No questionário inicial, registre a percepção atual da família (ex.: "Não melhorou" se está igual).', 30),
    ('QUESTIONARIO', 2, '2d', 'saudeNutricional', 'ESCOLHA', N'Como está a saúde e o bem-estar nutricional da família?', N'Houve melhoria na saúde e no bem-estar nutricional da família?', N'No questionário inicial, registre a percepção atual da família.', 40),
    ('QUESTIONARIO', 3, '3a', 'conseguePoupar', 'SIM_NAO', N'A família consegue poupar?', N'Hoje, a família consegue poupar?', NULL, 10),
    ('QUESTIONARIO', 3, '3b', 'economiaMensalFaixa', 'ESCOLHA', N'Quanto a família economiza por mês comprando no Armazém Solidário?', N'Hoje, quanto a família economiza por mês comprando no Armazém Solidário?', NULL, 20),
    ('QUESTIONARIO', 3, '3c', 'destinoEconomiaIds', 'MULTIPLA', N'Para onde vai o dinheiro economizado?', N'Hoje, para onde vai o dinheiro economizado?', NULL, 30),
    ('QUESTIONARIO', 3, '3d', 'capacidadePoupanca', 'ESCOLHA', N'Qual é a capacidade de poupança da família?', N'Hoje, qual é a capacidade de poupança da família?', NULL, 40),
    ('QUESTIONARIO', 3, '3e', 'gestaoFinanceira', 'ESCOLHA', N'Como está a situação de dívidas e a gestão financeira da família?', N'Como ficou a situação de dívidas e a gestão financeira da família?', N'No questionário inicial, registre a percepção atual (ex.: "Sem mudança" se está estável).', 50),
    ('QUESTIONARIO', 4, '4a', 'empoderadaDecisoes', 'SIM_NAO', N'Você se sente mais empoderada(o) para decidir sobre alimentação e economia?', N'Hoje, você se sente mais empoderada(o) para decidir sobre alimentação e economia?', NULL, 10),
    ('QUESTIONARIO', 4, '4b', 'contribuicaoAutonomia', 'TEXTO', N'Como o Armazém Solidário pode contribuir para a autonomia financeira da família?', N'Como o Armazém Solidário contribuiu para a autonomia financeira da família?', NULL, 20),
    ('QUESTIONARIO', 4, '4c', 'melhoriaPlanejamento', 'SIM_NAO', N'Houve melhoria na capacidade de planejamento e gestão de recursos da família?', N'Hoje, houve melhoria na capacidade de planejamento e gestão de recursos da família?', NULL, 30),
    ('QUESTIONARIO', 4, '4d', 'impactoComunidade', 'TEXTO', N'Qual impacto o Armazém Solidário pode ter na comunidade?', N'Qual impacto o Armazém Solidário teve na comunidade?', NULL, 40),
    ('QUESTIONARIO', 4, '4e', 'oQueMelhorar', 'TEXTO', N'O que poderia melhorar no Armazém Solidário?', N'O que ainda pode melhorar no Armazém Solidário?', NULL, 50),
    ('QUESTIONARIO', 5, '5a', 'avaliacaoArmazem', 'ESCOLHA', N'Como a família avalia o Armazém Solidário?', N'Hoje, como a família avalia o Armazém Solidário?', NULL, 10),
    ('QUESTIONARIO', 5, '5b', 'principalBeneficio', 'TEXTO', N'Qual é o principal benefício do Armazém Solidário para a família?', N'Qual foi o principal benefício do Armazém Solidário para a família?', NULL, 20),
    ('QUESTIONARIO', 5, '5c', 'recomendaria', 'SIM_NAO', N'A família recomendaria o Armazém Solidário?', N'A família recomendaria o Armazém Solidário?', NULL, 30),
    ('PESQUISA', 1, 'NPS', 'NPS', 'NPS', N'De 0 a 10, quanto você recomendaria o Armazém Solidário e o acompanhamento da assistente social a um amigo ou vizinho?', NULL, NULL, 10),
    ('PESQUISA', 1, 'L1', 'L1', 'LIKERT', N'Fui tratada(o) com respeito e atenção pela equipe.', NULL, NULL, 20),
    ('PESQUISA', 1, 'L2', 'L2', 'LIKERT', N'Entendi o que o projeto oferece e como ele funciona.', NULL, NULL, 30),
    ('PESQUISA', 1, 'L3', 'L3', 'LIKERT', N'Os produtos do Armazém atendem às necessidades da minha família.', NULL, NULL, 40),
    ('PESQUISA', 1, 'L4', 'L4', 'LIKERT', N'O acompanhamento da assistente social me ajudou a resolver problemas ou a me organizar.', NULL, NULL, 50),
    ('PESQUISA', 1, 'L5', 'L5', 'LIKERT', N'Consigo ser atendida(o) quando preciso (horário, espera, acesso).', NULL, NULL, 60),
    ('PESQUISA', 1, 'L6', 'L6', 'LIKERT', N'O projeto melhorou a vida da minha família.', NULL, NULL, 70),
    ('PESQUISA', 1, 'T1', 'T1', 'TEXTO', N'O que o projeto faz de melhor?', NULL, NULL, 80),
    ('PESQUISA', 1, 'T2', 'T2', 'TEXTO', N'O que precisa melhorar?', NULL, NULL, 90)
) AS v(formulario, secao, codigo, campo, tipo, texto, texto_final, ajuda, ordem)
WHERE NOT EXISTS (SELECT 1 FROM dbo.catalogo_pergunta c WHERE c.formulario = v.formulario AND c.codigo = v.codigo);
GO

INSERT INTO dbo.catalogo_opcao (pergunta_id, codigo, texto, texto_final, base, posicao, ordem)
SELECT p.id, v.codigo, v.texto, v.texto_final, 1, v.posicao, v.ordem
FROM (VALUES
    ('2a', 'NAO_TINHA', N'Não tinha acesso', N'Não tem acesso', 0, 10),
    ('2a', 'SEMANAL_1_2', N'1-2 vezes por semana', NULL, 1, 20),
    ('2a', 'SEMANAL_2_3', N'2-3 vezes por semana', NULL, 2, 30),
    ('2a', 'DIARIO', N'Diário', NULL, 3, 40),
    ('2b', 'UMA_DUAS', N'1-2 vezes por semana', NULL, 0, 10),
    ('2b', 'TRES_QUATRO', N'3-4 vezes por semana', NULL, 1, 20),
    ('2b', 'CINCO_OU_MAIS', N'5 ou mais vezes por semana', NULL, 2, 30),
    ('2c', 'PIOROU', N'Piorou', NULL, 0, 10),
    ('2c', 'NAO_MELHOROU', N'Não melhorou', NULL, 1, 20),
    ('2c', 'MELHOROU_POUCO', N'Melhorou um pouco', NULL, 2, 30),
    ('2c', 'MELHOROU_MUITO', N'Melhorou muito', NULL, 3, 40),
    ('2d', 'NENHUMA', N'Não houve melhoria', NULL, 0, 10),
    ('2d', 'PEQUENA_MELHORIA', N'Pequena melhoria', NULL, 1, 20),
    ('2d', 'GRANDE_MELHORIA', N'Grande melhoria', NULL, 2, 30),
    ('3b', 'ATE_100', N'Até R$ 100', NULL, 0, 10),
    ('3b', 'DE_101_200', N'R$ 101 a R$ 200', NULL, 1, 20),
    ('3b', 'DE_201_300', N'R$ 201 a R$ 300', NULL, 2, 30),
    ('3b', 'ACIMA_300', N'Acima de R$ 300', NULL, 3, 40),
    ('3d', 'NAO_CONSEGUE', N'Não consegue poupar', NULL, 0, 10),
    ('3d', 'AS_VEZES', N'Poupa às vezes', NULL, 1, 20),
    ('3d', 'REGULARMENTE', N'Poupa regularmente', NULL, 2, 30),
    ('3e', 'PIOROU', N'Houve piora', NULL, 0, 10),
    ('3e', 'SEM_MUDANCA', N'Não houve mudança', NULL, 1, 20),
    ('3e', 'MELHOROU', N'Sim, houve melhora', NULL, 2, 30),
    ('5a', 'RUIM', N'Ruim', NULL, 0, 10),
    ('5a', 'REGULAR', N'Regular', NULL, 1, 20),
    ('5a', 'BOA', N'Boa', NULL, 2, 30),
    ('5a', 'OTIMA', N'Ótima', NULL, 3, 40)
) AS v(pergunta, codigo, texto, texto_final, posicao, ordem)
JOIN dbo.catalogo_pergunta p ON p.formulario = 'QUESTIONARIO' AND p.codigo = v.pergunta
WHERE NOT EXISTS (SELECT 1 FROM dbo.catalogo_opcao o WHERE o.pergunta_id = p.id AND o.codigo = v.codigo);
GO
