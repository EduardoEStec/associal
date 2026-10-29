/* ---------------------------------------------------------------------
   070 — Pessoa: telefone de contato e telefone de recado.
   Só dígitos (DDD + número = 10 ou 11). Idempotente.
   --------------------------------------------------------------------- */

IF COL_LENGTH('dbo.ASSOCIAL_pessoa', 'telefone') IS NULL
ALTER TABLE dbo.ASSOCIAL_pessoa ADD telefone VARCHAR(11) COLLATE Latin1_General_100_CI_AI NULL;
GO

IF COL_LENGTH('dbo.ASSOCIAL_pessoa', 'telefone2') IS NULL
ALTER TABLE dbo.ASSOCIAL_pessoa ADD telefone2 VARCHAR(11) COLLATE Latin1_General_100_CI_AI NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ASSOCIAL_ck_pessoa_telefone' AND parent_object_id = OBJECT_ID(N'dbo.ASSOCIAL_pessoa'))
ALTER TABLE dbo.ASSOCIAL_pessoa ADD CONSTRAINT ASSOCIAL_ck_pessoa_telefone
    CHECK (telefone IS NULL OR (LEN(telefone) IN (10, 11) AND telefone NOT LIKE '%[^0-9]%'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ASSOCIAL_ck_pessoa_telefone2' AND parent_object_id = OBJECT_ID(N'dbo.ASSOCIAL_pessoa'))
ALTER TABLE dbo.ASSOCIAL_pessoa ADD CONSTRAINT ASSOCIAL_ck_pessoa_telefone2
    CHECK (telefone2 IS NULL OR (LEN(telefone2) IN (10, 11) AND telefone2 NOT LIKE '%[^0-9]%'));
GO
