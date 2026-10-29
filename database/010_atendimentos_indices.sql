/* ---------------------------------------------------------------------
   010 — Módulo Atendimentos: índices de apoio aos filtros da listagem.
   Idempotente.
   --------------------------------------------------------------------- */

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_atendimento_demanda_demanda' AND object_id = OBJECT_ID(N'dbo.ASSOCIAL_atendimento_demanda'))
CREATE INDEX ix_atendimento_demanda_demanda ON dbo.ASSOCIAL_atendimento_demanda (demanda_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_atendimento_encaminhamento_enc' AND object_id = OBJECT_ID(N'dbo.ASSOCIAL_atendimento_encaminhamento'))
CREATE INDEX ix_atendimento_encaminhamento_enc ON dbo.ASSOCIAL_atendimento_encaminhamento (encaminhamento_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_atendimento_data' AND object_id = OBJECT_ID(N'dbo.ASSOCIAL_atendimento'))
CREATE INDEX ix_atendimento_data ON dbo.ASSOCIAL_atendimento (data_atendimento);
GO
