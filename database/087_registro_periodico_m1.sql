/* =====================================================================
   ASSOCIAL — 087_registro_periodico_m1.sql  (M1 — registro periódico = modelo oficial 2)
   Ajusta os registros de acompanhamento (F2) ao "Registro periódico de acompanhamento" oficial
   (docs/modelos/2-registro-periodico.docx):
     mês de referência · data · profissional · contato/atendimento realizado · uso do Armazém ·
     orientações/encaminhamentos (múltiplos) · observações do profissional · fotos com data (só se a família aceitar).

   1. Listas de apoio (editáveis pela coordenação em Administração > Listas):
        uso_armazem        (regularmente / eventualmente / não utilizou no período)
        orientacao_registro (CadÚnico · CRAS/Descomplica · serviço da rede · alimentação/nutrição · Outros)
        frase_registro     (frases-sugestão do modelo: atalhos que inserem o texto na observação)
        tipo_contato       ganha "Atendimento presencial" e "Contato telefônico" (os antigos "Atendimento no Armazém"
                           e "Telefone" são desativados, nunca apagados: registros antigos continuam válidos)
   2. acompanhamento_registro: mes_referencia, uso_armazem_id, orientacao_outro, familia_aceita_foto; resumo até 2000 caracteres.
   3. acompanhamento_registro_orientacao (N:N) e acompanhamento_registro_foto (fotos com data; arquivo em UPLOAD_DIR/acoes).
   Idempotente. Doc: docs/modelos/MAPEAMENTO.md (seção Registro periódico).
   ===================================================================== */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------------------------------------------------------------------
   1. Listas de apoio
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.ASSOCIAL_uso_armazem', N'U') IS NULL
CREATE TABLE dbo.ASSOCIAL_uso_armazem (
    id INT IDENTITY(1,1) CONSTRAINT ASSOCIAL_pk_uso_armazem PRIMARY KEY,
    nome NVARCHAR(150) COLLATE Latin1_General_100_CI_AI NOT NULL CONSTRAINT ASSOCIAL_uq_uso_armazem_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT ASSOCIAL_df_uso_armazem_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT ASSOCIAL_df_uso_armazem_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT ASSOCIAL_df_uso_armazem_exige_texto DEFAULT 0
);
GO

INSERT INTO dbo.ASSOCIAL_uso_armazem (nome, ordem, exige_texto)
SELECT v.nome, v.ordem, 0
FROM (VALUES
    (N'Utilizou regularmente',       1),
    (N'Utilizou eventualmente',      2),
    (N'Não utilizou no período',     3)
) AS v(nome, ordem)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ASSOCIAL_uso_armazem t WHERE t.nome = v.nome);
GO

IF OBJECT_ID(N'dbo.ASSOCIAL_orientacao_registro', N'U') IS NULL
CREATE TABLE dbo.ASSOCIAL_orientacao_registro (
    id INT IDENTITY(1,1) CONSTRAINT ASSOCIAL_pk_orientacao_registro PRIMARY KEY,
    nome NVARCHAR(150) COLLATE Latin1_General_100_CI_AI NOT NULL CONSTRAINT ASSOCIAL_uq_orientacao_registro_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT ASSOCIAL_df_orientacao_registro_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT ASSOCIAL_df_orientacao_registro_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT ASSOCIAL_df_orientacao_registro_exige_texto DEFAULT 0
);
GO

INSERT INTO dbo.ASSOCIAL_orientacao_registro (nome, ordem, exige_texto)
SELECT v.nome, v.ordem, v.exige_texto
FROM (VALUES
    (N'Orientação sobre CadÚnico',                  1, 0),
    (N'Encaminhamento para CRAS/Descomplica',       2, 0),
    (N'Encaminhamento para serviço da rede',        3, 0),
    (N'Orientação sobre alimentação/nutrição',      4, 0),
    (N'Outros',                                     5, 1)
) AS v(nome, ordem, exige_texto)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ASSOCIAL_orientacao_registro t WHERE t.nome = v.nome);
GO

-- frases-sugestão do modelo 2 (texto exato): o `nome` é a própria frase
IF OBJECT_ID(N'dbo.ASSOCIAL_frase_registro', N'U') IS NULL
CREATE TABLE dbo.ASSOCIAL_frase_registro (
    id INT IDENTITY(1,1) CONSTRAINT ASSOCIAL_pk_frase_registro PRIMARY KEY,
    nome NVARCHAR(300) COLLATE Latin1_General_100_CI_AI NOT NULL CONSTRAINT ASSOCIAL_uq_frase_registro_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT ASSOCIAL_df_frase_registro_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT ASSOCIAL_df_frase_registro_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT ASSOCIAL_df_frase_registro_exige_texto DEFAULT 0
);
GO

INSERT INTO dbo.ASSOCIAL_frase_registro (nome, ordem, exige_texto)
SELECT v.nome, v.ordem, 0
FROM (VALUES
    (N'Família realizou atendimento; relatou dificuldade para aquisição de alimentos; recebeu orientação.',                 1),
    (N'Família informou que continua utilizando o Armazém; não houve alteração significativa na renda.',                   2),
    (N'Família relatou redução das despesas com alimentação.',                                                              3),
    (N'Atendimento realizado; situação familiar mantida.',                                                                  4)
) AS v(nome, ordem)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ASSOCIAL_frase_registro t WHERE t.nome = v.nome);
GO

-- tipos de contato do modelo: só na primeira execução (depois a coordenação é quem manda na lista)
IF NOT EXISTS (SELECT 1 FROM dbo.ASSOCIAL_tipo_contato WHERE nome = N'Atendimento presencial')
BEGIN
    INSERT INTO dbo.ASSOCIAL_tipo_contato (nome, ordem, exige_texto) VALUES (N'Atendimento presencial', 1, 0);
    INSERT INTO dbo.ASSOCIAL_tipo_contato (nome, ordem, exige_texto)
    SELECT N'Contato telefônico', 3, 0 WHERE NOT EXISTS (SELECT 1 FROM dbo.ASSOCIAL_tipo_contato WHERE nome = N'Contato telefônico');
    UPDATE dbo.ASSOCIAL_tipo_contato SET ordem = 2 WHERE nome = N'Visita domiciliar';
    UPDATE dbo.ASSOCIAL_tipo_contato SET ordem = 4 WHERE nome = N'WhatsApp';
    UPDATE dbo.ASSOCIAL_tipo_contato SET ordem = 5 WHERE nome = N'Outro';
    UPDATE dbo.ASSOCIAL_tipo_contato SET ativo = 0, ordem = 90 WHERE nome = N'Atendimento no Armazém';
    UPDATE dbo.ASSOCIAL_tipo_contato SET ativo = 0, ordem = 91 WHERE nome = N'Telefone';
END
GO

/* ---------------------------------------------------------------------
   2. Registro de acompanhamento: campos do modelo
   --------------------------------------------------------------------- */

IF COL_LENGTH(N'dbo.ASSOCIAL_acompanhamento_registro', N'mes_referencia') IS NULL
    ALTER TABLE dbo.ASSOCIAL_acompanhamento_registro ADD mes_referencia DATE NULL;          -- sempre o dia 1 do mês de referência
GO
IF COL_LENGTH(N'dbo.ASSOCIAL_acompanhamento_registro', N'uso_armazem_id') IS NULL
    ALTER TABLE dbo.ASSOCIAL_acompanhamento_registro ADD uso_armazem_id INT NULL
        CONSTRAINT ASSOCIAL_fk_acomp_registro_uso_armazem REFERENCES dbo.ASSOCIAL_uso_armazem(id);
GO
IF COL_LENGTH(N'dbo.ASSOCIAL_acompanhamento_registro', N'orientacao_outro') IS NULL
    ALTER TABLE dbo.ASSOCIAL_acompanhamento_registro ADD orientacao_outro NVARCHAR(200) COLLATE Latin1_General_100_CI_AI NULL;
GO
IF COL_LENGTH(N'dbo.ASSOCIAL_acompanhamento_registro', N'familia_aceita_foto') IS NULL
    ALTER TABLE dbo.ASSOCIAL_acompanhamento_registro ADD familia_aceita_foto BIT NOT NULL
        CONSTRAINT ASSOCIAL_df_acomp_registro_aceita_foto DEFAULT 0;
GO

-- observações do profissional: até 2000 caracteres (eram 1000)
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.ASSOCIAL_acompanhamento_registro') AND name = N'resumo' AND max_length < 4000)
    ALTER TABLE dbo.ASSOCIAL_acompanhamento_registro ALTER COLUMN resumo NVARCHAR(2000) COLLATE Latin1_General_100_CI_AI NULL;
GO

-- registros antigos: o mês de referência é o mês da data do registro
UPDATE dbo.ASSOCIAL_acompanhamento_registro
   SET mes_referencia = DATEFROMPARTS(YEAR(data_registro), MONTH(data_registro), 1)
 WHERE mes_referencia IS NULL;
GO

/* ---------------------------------------------------------------------
   3. Orientações (N:N) e fotos
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.ASSOCIAL_acompanhamento_registro_orientacao', N'U') IS NULL
CREATE TABLE dbo.ASSOCIAL_acompanhamento_registro_orientacao (
    registro_id   INT NOT NULL CONSTRAINT ASSOCIAL_fk_acomp_reg_orient_registro REFERENCES dbo.ASSOCIAL_acompanhamento_registro(id) ON DELETE CASCADE,
    orientacao_id INT NOT NULL CONSTRAINT ASSOCIAL_fk_acomp_reg_orient_orientacao REFERENCES dbo.ASSOCIAL_orientacao_registro(id),
    CONSTRAINT ASSOCIAL_pk_acomp_registro_orientacao PRIMARY KEY (registro_id, orientacao_id)
);
GO

-- Fotos do acompanhamento (modelo 2, ANEXOS): só com o aceite da família (familia_aceita_foto = 1) e sempre com a DATA
-- do dia do acompanhamento. O arquivo fica em UPLOAD_DIR/acoes (mesmo armazenamento das fotos das ações).
IF OBJECT_ID(N'dbo.ASSOCIAL_acompanhamento_registro_foto', N'U') IS NULL
CREATE TABLE dbo.ASSOCIAL_acompanhamento_registro_foto (
    id            INT IDENTITY(1,1) CONSTRAINT ASSOCIAL_pk_acomp_registro_foto PRIMARY KEY,
    registro_id   INT NOT NULL CONSTRAINT ASSOCIAL_fk_acomp_reg_foto_registro REFERENCES dbo.ASSOCIAL_acompanhamento_registro(id) ON DELETE CASCADE,
    arquivo       VARCHAR(200) COLLATE Latin1_General_100_CI_AI  NOT NULL,
    nome_original NVARCHAR(255) COLLATE Latin1_General_100_CI_AI NULL,
    mime_type     VARCHAR(100) COLLATE Latin1_General_100_CI_AI  NULL,
    tamanho_bytes INT NULL,
    legenda       NVARCHAR(300) COLLATE Latin1_General_100_CI_AI NULL,
    data_foto     DATE NOT NULL,                       -- data do acompanhamento a que a foto se refere
    ordem         INT NOT NULL CONSTRAINT ASSOCIAL_df_acomp_reg_foto_ordem DEFAULT 0,
    criado_por    INT NULL CONSTRAINT ASSOCIAL_fk_acomp_reg_foto_criado_por REFERENCES dbo.ASSOCIAL_usuario(id),
    criado_em     DATETIME2(0) NOT NULL CONSTRAINT ASSOCIAL_df_acomp_reg_foto_criado_em DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acomp_registro_foto_registro' AND object_id = OBJECT_ID(N'dbo.ASSOCIAL_acompanhamento_registro_foto'))
CREATE INDEX ix_acomp_registro_foto_registro ON dbo.ASSOCIAL_acompanhamento_registro_foto (registro_id);
GO
