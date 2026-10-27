/* 088 — "Outro/Outra" com texto obrigatório (V21).
   Onde a lista já tinha "Outra" mas o formulário não coletava o texto, ganha a coluna do texto e a marca exige_texto:
     acao_visita.tipo_acao_outro  (tipo_acao "Outra" já exigia texto, sem onde guardar)
     pessoa.genero_outro / escolaridade_outro / raca_outro, familia_membro.genero_outro
   Idempotente: a marca exige_texto só é aplicada quando a coluna é criada (depois disso a coordenação decide na aba Listas). */

IF COL_LENGTH(N'dbo.acao_visita', N'tipo_acao_outro') IS NULL
    ALTER TABLE dbo.acao_visita ADD tipo_acao_outro NVARCHAR(200) NULL;
GO

IF COL_LENGTH(N'dbo.pessoa', N'genero_outro') IS NULL
BEGIN
    ALTER TABLE dbo.pessoa ADD genero_outro NVARCHAR(200) NULL;
    UPDATE dbo.genero SET exige_texto = 1 WHERE nome = N'Outra';
END
GO

IF COL_LENGTH(N'dbo.pessoa', N'escolaridade_outro') IS NULL
BEGIN
    ALTER TABLE dbo.pessoa ADD escolaridade_outro NVARCHAR(200) NULL;
    UPDATE dbo.escolaridade SET exige_texto = 1 WHERE nome = N'Outra';
END
GO

IF COL_LENGTH(N'dbo.pessoa', N'raca_outro') IS NULL
BEGIN
    ALTER TABLE dbo.pessoa ADD raca_outro NVARCHAR(200) NULL;
    UPDATE dbo.raca SET exige_texto = 1 WHERE nome = N'Outra';
END
GO

IF COL_LENGTH(N'dbo.familia_membro', N'genero_outro') IS NULL
    ALTER TABLE dbo.familia_membro ADD genero_outro NVARCHAR(200) NULL;
GO
