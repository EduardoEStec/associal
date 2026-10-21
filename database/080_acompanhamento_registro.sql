/* =====================================================================
   ASSOCIAL — 080_acompanhamento_registro.sql  (F2 — registros de acompanhamento)
   Registro curto de cada contato/visita com a família acompanhada, tipos de contato
   (tabela de apoio editável pelo ADMIN) e o alerta "família sem contato há X dias".
   Proposta: docs/propostas/acompanhamento-e-satisfacao.md (seções 3, 4 e 10).
   Idempotente.
   ===================================================================== */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------------------------------------------------------------------
   1. Tipos de contato (apoio: id, nome, ordem, ativo, exige_texto)
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.tipo_contato', N'U') IS NULL
CREATE TABLE dbo.tipo_contato (
    id INT IDENTITY(1,1) CONSTRAINT pk_tipo_contato PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_tipo_contato_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT df_tipo_contato_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_tipo_contato_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_tipo_contato_exige_texto DEFAULT 0
);
GO

-- Decisão D8: todas as opções; o ADMIN desativa as que a prática descartar.
INSERT INTO dbo.tipo_contato (nome, ordem, exige_texto)
SELECT v.nome, v.ordem, v.exige_texto
FROM (VALUES
    (N'Visita domiciliar',        1, 0),
    (N'Atendimento no Armazém',   2, 0),
    (N'Telefone',                 3, 0),
    (N'WhatsApp',                 4, 0),
    (N'Outro',                    5, 1)
) AS v(nome, ordem, exige_texto)
WHERE NOT EXISTS (SELECT 1 FROM dbo.tipo_contato t WHERE t.nome = v.nome);
GO

/* ---------------------------------------------------------------------
   2. Registro de acompanhamento
      houve_contato = 0 → tentativa sem sucesso (não conta como contato no alerta).
      Anulação em vez de exclusão: o registro some das telas e dos números,
      mas a linha e o motivo ficam (auditoria).
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.acompanhamento_registro', N'U') IS NULL
CREATE TABLE dbo.acompanhamento_registro (
    id                 INT IDENTITY(1,1) CONSTRAINT pk_acompanhamento_registro PRIMARY KEY,
    acompanhamento_id  INT NOT NULL CONSTRAINT fk_acomp_registro_acompanhamento REFERENCES dbo.acompanhamento(id),
    usuario_id         INT NOT NULL CONSTRAINT fk_acomp_registro_usuario REFERENCES dbo.usuario(id),   -- quem registrou
    data_registro      DATE NOT NULL,
    tipo_contato_id    INT NOT NULL CONSTRAINT fk_acomp_registro_tipo REFERENCES dbo.tipo_contato(id),
    tipo_contato_outro NVARCHAR(200) NULL,                  -- texto do tipo "Outro"
    houve_contato      BIT NOT NULL,
    situacao           VARCHAR(12) NULL,                    -- MELHORANDO | IGUAL | PIORANDO | NAO_SEI (só quando houve contato)
    resumo             NVARCHAR(1000) NULL,
    proximo_contato_em DATE NULL,
    anulado_em         DATETIME2(0) NULL,
    anulado_por        INT NULL CONSTRAINT fk_acomp_registro_anulado_por REFERENCES dbo.usuario(id),
    anulado_motivo     NVARCHAR(200) NULL,
    criado_por   INT NULL CONSTRAINT fk_acomp_registro_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_acomp_registro_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_acomp_registro_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL,
    CONSTRAINT ck_acomp_registro_situacao CHECK (situacao IS NULL OR situacao IN ('MELHORANDO', 'IGUAL', 'PIORANDO', 'NAO_SEI')),
    CONSTRAINT ck_acomp_registro_situacao_contato CHECK (houve_contato = 1 OR situacao IS NULL)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acomp_registro_acompanhamento_data' AND object_id = OBJECT_ID(N'dbo.acompanhamento_registro'))
CREATE INDEX ix_acomp_registro_acompanhamento_data ON dbo.acompanhamento_registro (acompanhamento_id, data_registro DESC)
    INCLUDE (houve_contato, situacao, proximo_contato_em, anulado_em);
GO

/* ---------------------------------------------------------------------
   3. Configuração do alerta (editável em Administração > Configurações)
   --------------------------------------------------------------------- */

INSERT INTO dbo.configuracao (chave, valor, descricao)
SELECT v.chave, v.valor, v.descricao
FROM (VALUES
    ('alerta_sem_contato_dias', N'30',
        N'Quantos dias sem contato com a família (registro de contato, atendimento ou questionário) até alertar "família sem contato".')
) AS v(chave, valor, descricao)
WHERE NOT EXISTS (SELECT 1 FROM dbo.configuracao c WHERE c.chave = v.chave);
GO

/* Apoio à busca do último atendimento do responsável na unidade do acompanhamento */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_atendimento_pessoa_unidade_data' AND object_id = OBJECT_ID(N'dbo.atendimento'))
CREATE INDEX ix_atendimento_pessoa_unidade_data ON dbo.atendimento (pessoa_id, unidade_id, data_atendimento);
GO
