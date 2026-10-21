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

IF OBJECT_ID(N'dbo.acompanhamento_meta', N'U') IS NULL
CREATE TABLE dbo.acompanhamento_meta (
    id                INT IDENTITY(1,1) CONSTRAINT pk_acompanhamento_meta PRIMARY KEY,
    acompanhamento_id INT NOT NULL CONSTRAINT fk_acomp_meta_acompanhamento REFERENCES dbo.acompanhamento(id),
    dimensao          VARCHAR(12)   NOT NULL,                 -- ALIMENTACAO | RENDA | ECONOMIA | AUTONOMIA | OUTRA
    descricao         NVARCHAR(300) NOT NULL,
    prazo             DATE NULL,
    status            VARCHAR(14)   NOT NULL CONSTRAINT df_acomp_meta_status DEFAULT 'EM_ANDAMENTO',
    concluida_em      DATE NULL,
    usuario_id        INT NOT NULL CONSTRAINT fk_acomp_meta_usuario REFERENCES dbo.usuario(id),   -- quem definiu a meta
    criado_por   INT NULL CONSTRAINT fk_acomp_meta_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_acomp_meta_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_acomp_meta_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL,
    CONSTRAINT ck_acomp_meta_dimensao CHECK (dimensao IN ('ALIMENTACAO', 'RENDA', 'ECONOMIA', 'AUTONOMIA', 'OUTRA')),
    CONSTRAINT ck_acomp_meta_status   CHECK (status IN ('EM_ANDAMENTO', 'ATINGIDA', 'NAO_ATINGIDA', 'CANCELADA')),
    CONSTRAINT ck_acomp_meta_concluida CHECK ((status = 'EM_ANDAMENTO' AND concluida_em IS NULL) OR (status <> 'EM_ANDAMENTO' AND concluida_em IS NOT NULL))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acomp_meta_acompanhamento' AND object_id = OBJECT_ID(N'dbo.acompanhamento_meta'))
CREATE INDEX ix_acomp_meta_acompanhamento ON dbo.acompanhamento_meta (acompanhamento_id, status) INCLUDE (concluida_em, prazo);
GO

/* ---------------------------------------------------------------------
   2. Metas tratadas em cada registro de contato (avanço opcional por meta)
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.registro_meta', N'U') IS NULL
CREATE TABLE dbo.registro_meta (
    registro_id INT NOT NULL CONSTRAINT fk_registro_meta_registro REFERENCES dbo.acompanhamento_registro(id) ON DELETE CASCADE,
    meta_id     INT NOT NULL CONSTRAINT fk_registro_meta_meta REFERENCES dbo.acompanhamento_meta(id),
    avanco      VARCHAR(12) NOT NULL,                         -- AVANCOU | SEM_MUDANCA | RETROCEDEU
    CONSTRAINT pk_registro_meta PRIMARY KEY (registro_id, meta_id),
    CONSTRAINT ck_registro_meta_avanco CHECK (avanco IN ('AVANCOU', 'SEM_MUDANCA', 'RETROCEDEU'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_registro_meta_meta' AND object_id = OBJECT_ID(N'dbo.registro_meta'))
CREATE INDEX ix_registro_meta_meta ON dbo.registro_meta (meta_id) INCLUDE (registro_id, avanco);
GO

/* ---------------------------------------------------------------------
   3. Configuração do alerta (Administração > Configurações; também pela coordenação)
   --------------------------------------------------------------------- */

INSERT INTO dbo.configuracao (chave, valor, descricao)
SELECT v.chave, v.valor, v.descricao
FROM (VALUES
    ('alerta_sem_meta_dias', N'30',
        N'Quantos dias uma família em acompanhamento pode ficar sem nenhuma meta em andamento (contados do início ou da última meta encerrada) até alertar "família sem meta".')
) AS v(chave, valor, descricao)
WHERE NOT EXISTS (SELECT 1 FROM dbo.configuracao c WHERE c.chave = v.chave);
GO
