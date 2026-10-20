/* =====================================================================
   ASSOCIAL — 040_painel_indices.sql
   Índices de apoio às agregações do Painel (T6). Idempotente.
   ===================================================================== */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

-- Ações realizadas/planejadas por status e data (indicadores e alertas)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acao_visita_status_data' AND object_id = OBJECT_ID(N'dbo.acao_visita'))
CREATE INDEX ix_acao_visita_status_data ON dbo.acao_visita (status, data_acao) INCLUDE (unidade_id, qtd_participantes);
GO

-- Acompanhamentos ativos no período
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acompanhamento_periodo' AND object_id = OBJECT_ID(N'dbo.acompanhamento'))
CREATE INDEX ix_acompanhamento_periodo ON dbo.acompanhamento (data_inicio, data_encerramento) INCLUDE (unidade_id, familia_id, status);
GO

-- Questionário FINAL concluído por acompanhamento (alerta de vencimento)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_questionario_tipo_concluido' AND object_id = OBJECT_ID(N'dbo.questionario'))
CREATE INDEX ix_questionario_tipo_concluido ON dbo.questionario (tipo, concluido) INCLUDE (acompanhamento_id);
GO

-- Configuração padrão do alerta (caso o seed não a tenha criado)
IF NOT EXISTS (SELECT 1 FROM dbo.configuracao WHERE chave = 'alerta_questionario_final_dias_antes')
INSERT INTO dbo.configuracao (chave, valor, descricao)
VALUES ('alerta_questionario_final_dias_antes', N'15', N'Dias de antecedência para alertar questionário final a vencer');
GO
