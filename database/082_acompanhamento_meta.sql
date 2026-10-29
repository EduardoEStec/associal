/* =====================================================================
   ASSOCIAL — 082_acompanhamento_meta.sql  (F4 — plano de metas da família)
   Metas por dimensão (alimentação, renda, economia, autonomia, outra) com prazo e status,
   avanço registrado nos contatos (um registro pode marcar avanço em uma ou mais metas) e
   o alerta "família sem meta há X dias" (D7: metas opcionais, alerta em 30 dias, editável).
   Proposta: docs/propostas/acompanhamento-e-satisfacao.md (seções 4.2 e 10.4). Idempotente.
   ===================================================================== */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------------------------------------------------------------------
   1. Metas do acompanhamento
      Sem exclusão física: a meta que deixou de fazer sentido vira CANCELADA (fica no histórico).
      concluida_em = data em que saiu de EM_ANDAMENTO (ATINGIDA, NAO_ATINGIDA ou CANCELADA).
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.ASSOCIAL_acompanhamento_meta', N'U') IS NULL
CREATE TABLE dbo.ASSOCIAL_acompanhamento_meta (
    id                INT IDENTITY(1,1) CONSTRAINT ASSOCIAL_pk_acompanhamento_meta PRIMARY KEY,
    acompanhamento_id INT NOT NULL CONSTRAINT ASSOCIAL_fk_acomp_meta_acompanhamento REFERENCES dbo.ASSOCIAL_acompanhamento(id),
    dimensao          VARCHAR(12) COLLATE Latin1_General_100_CI_AI   NOT NULL,                 -- ALIMENTACAO | RENDA | ECONOMIA | AUTONOMIA | OUTRA
    descricao         NVARCHAR(300) COLLATE Latin1_General_100_CI_AI NOT NULL,
    prazo             DATE NULL,
    status            VARCHAR(14) COLLATE Latin1_General_100_CI_AI   NOT NULL CONSTRAINT ASSOCIAL_df_acomp_meta_status DEFAULT 'EM_ANDAMENTO',
    concluida_em      DATE NULL,
    usuario_id        INT NOT NULL CONSTRAINT ASSOCIAL_fk_acomp_meta_usuario REFERENCES dbo.ASSOCIAL_usuario(id),   -- quem definiu a meta
    criado_por   INT NULL CONSTRAINT ASSOCIAL_fk_acomp_meta_criado_por   REFERENCES dbo.ASSOCIAL_usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT ASSOCIAL_df_acomp_meta_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT ASSOCIAL_fk_acomp_meta_alterado_por REFERENCES dbo.ASSOCIAL_usuario(id),
    alterado_em  DATETIME2(0) NULL,
    CONSTRAINT ASSOCIAL_ck_acomp_meta_dimensao CHECK (dimensao IN ('ALIMENTACAO', 'RENDA', 'ECONOMIA', 'AUTONOMIA', 'OUTRA')),
    CONSTRAINT ASSOCIAL_ck_acomp_meta_status   CHECK (status IN ('EM_ANDAMENTO', 'ATINGIDA', 'NAO_ATINGIDA', 'CANCELADA')),
    CONSTRAINT ASSOCIAL_ck_acomp_meta_concluida CHECK ((status = 'EM_ANDAMENTO' AND concluida_em IS NULL) OR (status <> 'EM_ANDAMENTO' AND concluida_em IS NOT NULL))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acomp_meta_acompanhamento' AND object_id = OBJECT_ID(N'dbo.ASSOCIAL_acompanhamento_meta'))
CREATE INDEX ix_acomp_meta_acompanhamento ON dbo.ASSOCIAL_acompanhamento_meta (acompanhamento_id, status) INCLUDE (concluida_em, prazo);
GO

/* ---------------------------------------------------------------------
   2. Metas tratadas em cada registro de contato (avanço opcional por meta)
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.ASSOCIAL_registro_meta', N'U') IS NULL
CREATE TABLE dbo.ASSOCIAL_registro_meta (
    registro_id INT NOT NULL CONSTRAINT ASSOCIAL_fk_registro_meta_registro REFERENCES dbo.ASSOCIAL_acompanhamento_registro(id) ON DELETE CASCADE,
    meta_id     INT NOT NULL CONSTRAINT ASSOCIAL_fk_registro_meta_meta REFERENCES dbo.ASSOCIAL_acompanhamento_meta(id),
    avanco      VARCHAR(12) COLLATE Latin1_General_100_CI_AI NOT NULL,                         -- AVANCOU | SEM_MUDANCA | RETROCEDEU
    CONSTRAINT ASSOCIAL_pk_registro_meta PRIMARY KEY (registro_id, meta_id),
    CONSTRAINT ASSOCIAL_ck_registro_meta_avanco CHECK (avanco IN ('AVANCOU', 'SEM_MUDANCA', 'RETROCEDEU'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_registro_meta_meta' AND object_id = OBJECT_ID(N'dbo.ASSOCIAL_registro_meta'))
CREATE INDEX ix_registro_meta_meta ON dbo.ASSOCIAL_registro_meta (meta_id) INCLUDE (registro_id, avanco);
GO

/* ---------------------------------------------------------------------
   3. Configuração do alerta (Administração > Configurações; também pela coordenação)
   --------------------------------------------------------------------- */

INSERT INTO dbo.ASSOCIAL_configuracao (chave, valor, descricao)
SELECT v.chave, v.valor, v.descricao
FROM (VALUES
    ('alerta_sem_meta_dias', N'30',
        N'Quantos dias uma família em acompanhamento pode ficar sem nenhuma meta em andamento (contados do início ou da última meta encerrada) até alertar "família sem meta".')
) AS v(chave, valor, descricao)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ASSOCIAL_configuracao c WHERE c.chave = v.chave);
GO
