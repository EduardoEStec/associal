/* =====================================================================
   ASSOCIAL — 030_familias_indices.sql  (T4 — Famílias e Acompanhamento)
   Índices de apoio às listagens de acompanhamento e à comparação inicial × final.
   Idempotente. O schema das tabelas (familia, familia_membro, acompanhamento,
   questionario*) já está em 001_schema.sql.
   ===================================================================== */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

-- Alerta de questionário final vencendo/vencido (acompanhamentos em andamento por prazo)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acompanhamento_prevista_final' AND object_id = OBJECT_ID(N'dbo.ASSOCIAL_acompanhamento'))
CREATE INDEX ix_acompanhamento_prevista_final ON dbo.ASSOCIAL_acompanhamento (data_prevista_final) WHERE status = 'EM_ANDAMENTO';
GO

-- Comparação consolidada: questionários concluídos por tipo e data de aplicação
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_questionario_tipo_data' AND object_id = OBJECT_ID(N'dbo.ASSOCIAL_questionario'))
CREATE INDEX ix_questionario_tipo_data ON dbo.ASSOCIAL_questionario (tipo, data_aplicacao) INCLUDE (acompanhamento_id, concluido);
GO
