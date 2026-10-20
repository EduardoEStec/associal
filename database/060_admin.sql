-- T7 Administração: índice para a consulta de auditoria por período. Idempotente.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_auditoria_criado_em' AND object_id = OBJECT_ID(N'dbo.auditoria'))
CREATE INDEX ix_auditoria_criado_em ON dbo.auditoria (criado_em DESC);
GO
