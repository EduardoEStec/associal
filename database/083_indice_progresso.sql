/* =====================================================================
   ASSOCIAL — 083_indice_progresso.sql  (F5 — índice de progresso e reavaliação rápida)
   1. questionario passa a aceitar o tipo REAVALIACAO (decisão D9a: reaproveita a tabela de questionário;
      uma reavaliação por acompanhamento — a UNIQUE (acompanhamento_id, tipo) continua valendo).
   2. acompanhamento_indice: instantâneo versionado do cálculo do índice (uma linha por dimensão + geral).
   3. Configurações editáveis (Administração > Configurações).
   Proposta: docs/propostas/acompanhamento-e-satisfacao.md (seções 5 e 10). Idempotente.
   ===================================================================== */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------------------------------------------------------------------
   1. Tipo REAVALIACAO no questionário (a coluna era VARCHAR(7): 'REAVALIACAO' tem 11 caracteres)
   --------------------------------------------------------------------- */

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ASSOCIAL_ck_questionario_tipo' AND parent_object_id = OBJECT_ID(N'dbo.ASSOCIAL_questionario')
           AND definition NOT LIKE N'%REAVALIACAO%')
    ALTER TABLE dbo.ASSOCIAL_questionario DROP CONSTRAINT ASSOCIAL_ck_questionario_tipo;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.ASSOCIAL_questionario') AND name = N'tipo' AND max_length < 11)
    ALTER TABLE dbo.ASSOCIAL_questionario ALTER COLUMN tipo VARCHAR(11) COLLATE Latin1_General_100_CI_AI NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ASSOCIAL_ck_questionario_tipo' AND parent_object_id = OBJECT_ID(N'dbo.ASSOCIAL_questionario'))
    ALTER TABLE dbo.ASSOCIAL_questionario ADD CONSTRAINT ASSOCIAL_ck_questionario_tipo CHECK (tipo IN ('INICIAL', 'REAVALIACAO', 'FINAL'));
GO

/* ---------------------------------------------------------------------
   2. Instantâneo do índice
   Gravado ao concluir (ou corrigir) um questionário. `versao_regra` diz com qual fórmula o número foi calculado;
   `parametros` guarda o que a fórmula usou (salário mínimo de referência, renda per capita) para reproduzir o cálculo.
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.ASSOCIAL_acompanhamento_indice', N'U') IS NULL
CREATE TABLE dbo.ASSOCIAL_acompanhamento_indice (
    id                INT IDENTITY(1,1) CONSTRAINT ASSOCIAL_pk_acompanhamento_indice PRIMARY KEY,
    acompanhamento_id INT NOT NULL CONSTRAINT ASSOCIAL_fk_acomp_indice_acompanhamento REFERENCES dbo.ASSOCIAL_acompanhamento(id),
    questionario_id   INT NOT NULL CONSTRAINT ASSOCIAL_fk_acomp_indice_questionario   REFERENCES dbo.ASSOCIAL_questionario(id) ON DELETE CASCADE,
    tipo              VARCHAR(11) COLLATE Latin1_General_100_CI_AI NOT NULL,                  -- INICIAL | REAVALIACAO | FINAL (do questionário)
    data_ref          DATE NOT NULL,                         -- data de aplicação do questionário
    dimensao          VARCHAR(12) COLLATE Latin1_General_100_CI_AI NOT NULL,                  -- GERAL | ALIMENTACAO | RENDA | ECONOMIA | AUTONOMIA
    nivel             DECIMAL(5,2) NULL,                     -- 0 a 100; NULL = sem dados suficientes (nunca zero)
    itens_validos     TINYINT NOT NULL,
    itens_total       TINYINT NOT NULL,
    versao_regra      SMALLINT NOT NULL,
    parametros        NVARCHAR(400) COLLATE Latin1_General_100_CI_AI NULL,
    calculado_em      DATETIME2(0) NOT NULL CONSTRAINT ASSOCIAL_df_acomp_indice_calculado_em DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ASSOCIAL_uq_acomp_indice UNIQUE (questionario_id, dimensao),
    CONSTRAINT ASSOCIAL_ck_acomp_indice_tipo CHECK (tipo IN ('INICIAL', 'REAVALIACAO', 'FINAL')),
    CONSTRAINT ASSOCIAL_ck_acomp_indice_dimensao CHECK (dimensao IN ('GERAL', 'ALIMENTACAO', 'RENDA', 'ECONOMIA', 'AUTONOMIA')),
    CONSTRAINT ASSOCIAL_ck_acomp_indice_nivel CHECK (nivel IS NULL OR (nivel >= 0 AND nivel <= 100))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acomp_indice_acompanhamento' AND object_id = OBJECT_ID(N'dbo.ASSOCIAL_acompanhamento_indice'))
    CREATE INDEX ix_acomp_indice_acompanhamento ON dbo.ASSOCIAL_acompanhamento_indice (acompanhamento_id, data_ref);
GO

/* ---------------------------------------------------------------------
   3. Configurações (o COORDENADOR/ADMIN edita)
   --------------------------------------------------------------------- */

INSERT INTO dbo.ASSOCIAL_configuracao (chave, valor, descricao)
SELECT v.chave, v.valor, v.descricao
FROM (VALUES
    ('indice_tolerancia_pontos', N'5',
        N'Tolerância (em pontos de 0 a 100) do semáforo do índice de progresso: diferença de pelo menos esse valor = melhorou/piorou; abaixo = igual.'),
    ('salario_minimo_referencia', N'1621',
        N'Salário mínimo (R$) usado para classificar a renda per capita das famílias no índice de progresso. Atualizar todo ano.'),
    ('reavaliacao_dias', N'45',
        N'Dias após o início do acompanhamento em que a reavaliação rápida (cerca de 9 perguntas) passa a ser sugerida.')
) AS v(chave, valor, descricao)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ASSOCIAL_configuracao c WHERE c.chave = v.chave);
GO
