/* ---------------------------------------------------------------------
   020 — Visitas e Ações: índices de apoio às listagens e ao resumo (T3)
   Idempotente.
   --------------------------------------------------------------------- */

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acao_visita_data_status' AND object_id = OBJECT_ID(N'dbo.acao_visita'))
CREATE INDEX ix_acao_visita_data_status ON dbo.acao_visita (data_acao, status) INCLUDE (unidade_id, qtd_participantes);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acao_visita_tema_tema' AND object_id = OBJECT_ID(N'dbo.acao_visita_tema'))
CREATE INDEX ix_acao_visita_tema_tema ON dbo.acao_visita_tema (tema_id);
GO
