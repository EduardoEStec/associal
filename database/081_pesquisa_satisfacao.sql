/* =====================================================================
   ASSOCIAL — 081_pesquisa_satisfacao.sql  (F3 — pesquisa de satisfação v1)
   Pesquisa IDENTIFICADA (ligada ao acompanhamento da família), aplicada pessoalmente pela assistente.
   Modelo de perguntas VERSIONADO: trocar o instrumento = inserir um novo modelo (versao + 1) e desativar o anterior;
   cada resposta guarda o modelo com que foi feita.
   Proposta: docs/propostas/acompanhamento-e-satisfacao.md (seções 6 e 10). Idempotente.
   ===================================================================== */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------------------------------------------------------------------
   1. Modelo e perguntas
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.pesquisa_modelo', N'U') IS NULL
CREATE TABLE dbo.pesquisa_modelo (
    id        INT IDENTITY(1,1) CONSTRAINT pk_pesquisa_modelo PRIMARY KEY,
    codigo    VARCHAR(30)   NOT NULL,                     -- ex.: SATISFACAO
    versao    SMALLINT      NOT NULL,
    titulo    NVARCHAR(150) NOT NULL,
    aviso     NVARCHAR(1500) NOT NULL,                    -- texto lido à família antes de começar (consentimento)
    ativo     BIT           NOT NULL CONSTRAINT df_pesquisa_modelo_ativo DEFAULT 1,
    criado_em DATETIME2(0)  NOT NULL CONSTRAINT df_pesquisa_modelo_criado_em DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_pesquisa_modelo UNIQUE (codigo, versao)
);
GO

IF OBJECT_ID(N'dbo.pesquisa_pergunta', N'U') IS NULL
CREATE TABLE dbo.pesquisa_pergunta (
    id        INT IDENTITY(1,1) CONSTRAINT pk_pesquisa_pergunta PRIMARY KEY,
    modelo_id INT NOT NULL CONSTRAINT fk_pesquisa_pergunta_modelo REFERENCES dbo.pesquisa_modelo(id),
    codigo    VARCHAR(20)   NOT NULL,                     -- NPS | L1..L6 | T1 | T2
    ordem     SMALLINT      NOT NULL,
    tipo      VARCHAR(8)    NOT NULL,                     -- NPS (0-10) | LIKERT (1-5) | TEXTO
    texto     NVARCHAR(500) NOT NULL,
    CONSTRAINT uq_pesquisa_pergunta UNIQUE (modelo_id, codigo),
    CONSTRAINT ck_pesquisa_pergunta_tipo CHECK (tipo IN ('NPS', 'LIKERT', 'TEXTO'))
);
GO

/* ---------------------------------------------------------------------
   2. Respostas (identificadas) e itens
      situacao: RASCUNHO -> CONCLUIDA | RECUSADA (a família preferiu não responder); ANULADA (com motivo; fora dos números).
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.pesquisa_resposta', N'U') IS NULL
CREATE TABLE dbo.pesquisa_resposta (
    id                INT IDENTITY(1,1) CONSTRAINT pk_pesquisa_resposta PRIMARY KEY,
    modelo_id         INT NOT NULL CONSTRAINT fk_pesquisa_resposta_modelo REFERENCES dbo.pesquisa_modelo(id),
    acompanhamento_id INT NOT NULL CONSTRAINT fk_pesquisa_resposta_acompanhamento REFERENCES dbo.acompanhamento(id),
    usuario_id        INT NOT NULL CONSTRAINT fk_pesquisa_resposta_usuario REFERENCES dbo.usuario(id),   -- quem aplicou
    momento           VARCHAR(10) NOT NULL,               -- FINAL | SEMESTRAL | AVULSA
    data_aplicacao    DATE NOT NULL,
    modo              VARCHAR(20) NULL,                   -- FAMILIA_FALOU | FAMILIA_PREENCHEU | COM_AJUDA
    situacao          VARCHAR(10) NOT NULL CONSTRAINT df_pesquisa_resposta_situacao DEFAULT 'RASCUNHO',
    consentimento_lido BIT NOT NULL CONSTRAINT df_pesquisa_resposta_consentimento DEFAULT 0,
    comentario_oculto BIT NOT NULL CONSTRAINT df_pesquisa_resposta_oculto DEFAULT 0,   -- coordenação oculta dos relatórios
    anulado_em        DATETIME2(0) NULL,
    anulado_por       INT NULL CONSTRAINT fk_pesquisa_resposta_anulado_por REFERENCES dbo.usuario(id),
    anulado_motivo    NVARCHAR(200) NULL,
    criado_por   INT NULL CONSTRAINT fk_pesquisa_resposta_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_pesquisa_resposta_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_pesquisa_resposta_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL,
    CONSTRAINT ck_pesquisa_resposta_momento CHECK (momento IN ('FINAL', 'SEMESTRAL', 'AVULSA')),
    CONSTRAINT ck_pesquisa_resposta_modo CHECK (modo IS NULL OR modo IN ('FAMILIA_FALOU', 'FAMILIA_PREENCHEU', 'COM_AJUDA')),
    CONSTRAINT ck_pesquisa_resposta_situacao CHECK (situacao IN ('RASCUNHO', 'CONCLUIDA', 'RECUSADA', 'ANULADA'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_pesquisa_resposta_acompanhamento' AND object_id = OBJECT_ID(N'dbo.pesquisa_resposta'))
CREATE INDEX ix_pesquisa_resposta_acompanhamento ON dbo.pesquisa_resposta (acompanhamento_id, data_aplicacao DESC)
    INCLUDE (momento, situacao);
GO

IF OBJECT_ID(N'dbo.pesquisa_resposta_item', N'U') IS NULL
CREATE TABLE dbo.pesquisa_resposta_item (
    resposta_id INT NOT NULL CONSTRAINT fk_pesquisa_item_resposta REFERENCES dbo.pesquisa_resposta(id) ON DELETE CASCADE,
    pergunta_id INT NOT NULL CONSTRAINT fk_pesquisa_item_pergunta REFERENCES dbo.pesquisa_pergunta(id),
    valor_num   TINYINT NULL,
    valor_texto NVARCHAR(1000) NULL,
    prefere_nao_responder BIT NOT NULL CONSTRAINT df_pesquisa_item_recusa DEFAULT 0,
    CONSTRAINT pk_pesquisa_resposta_item PRIMARY KEY (resposta_id, pergunta_id),
    CONSTRAINT ck_pesquisa_item_valor CHECK (valor_num IS NULL OR valor_num <= 10)
);
GO

/* ---------------------------------------------------------------------
   3. Modelo v1 (texto provisório: o formato do Termo de Colaboração, D6, e o aviso, D12, ainda serão definidos)
   --------------------------------------------------------------------- */

IF NOT EXISTS (SELECT 1 FROM dbo.pesquisa_modelo WHERE codigo = 'SATISFACAO' AND versao = 1)
INSERT INTO dbo.pesquisa_modelo (codigo, versao, titulo, aviso)
VALUES ('SATISFACAO', 1, N'Pesquisa de satisfação do Armazém Solidário',
    N'Vamos fazer algumas perguntas sobre o que a família acha do Armazém Solidário e do acompanhamento da assistente social. '
  + N'Não existe resposta certa ou errada: a opinião de vocês ajuda a melhorar o projeto, e podem dizer também o que não gostaram. '
  + N'As respostas ficam registradas junto da ficha da família e só podem ser vistas pela equipe do Serviço Social e pela coordenação. '
  + N'Responder ou não responder não muda em nada o atendimento nem o acompanhamento, e a família pode pedir para apagar a resposta depois. '
  + N'A família quer responder agora?');
GO

DECLARE @modelo INT = (SELECT id FROM dbo.pesquisa_modelo WHERE codigo = 'SATISFACAO' AND versao = 1);
INSERT INTO dbo.pesquisa_pergunta (modelo_id, codigo, ordem, tipo, texto)
SELECT @modelo, v.codigo, v.ordem, v.tipo, v.texto
FROM (VALUES
    ('NPS', 1, 'NPS',    N'De 0 a 10, quanto você recomendaria o Armazém Solidário e o acompanhamento da assistente social a um amigo ou vizinho?'),
    ('L1',  2, 'LIKERT', N'Fui tratada(o) com respeito e atenção pela equipe.'),
    ('L2',  3, 'LIKERT', N'Entendi o que o projeto oferece e como ele funciona.'),
    ('L3',  4, 'LIKERT', N'Os produtos do Armazém atendem às necessidades da minha família.'),
    ('L4',  5, 'LIKERT', N'O acompanhamento da assistente social me ajudou a resolver problemas ou a me organizar.'),
    ('L5',  6, 'LIKERT', N'Consigo ser atendida(o) quando preciso (horário, espera, acesso).'),
    ('L6',  7, 'LIKERT', N'O projeto melhorou a vida da minha família.'),
    ('T1',  8, 'TEXTO',  N'O que o projeto faz de melhor?'),
    ('T2',  9, 'TEXTO',  N'O que precisa melhorar?')
) AS v(codigo, ordem, tipo, texto)
WHERE @modelo IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.pesquisa_pergunta p WHERE p.modelo_id = @modelo AND p.codigo = v.codigo);
GO

/* ---------------------------------------------------------------------
   4. Configurações (Administração > Configurações)
   --------------------------------------------------------------------- */

INSERT INTO dbo.configuracao (chave, valor, descricao)
SELECT v.chave, v.valor, v.descricao
FROM (VALUES
    ('pesquisa_intervalo_dias', N'180',
        N'De quantos em quantos dias a pesquisa de satisfação é pedida às famílias em acompanhamento (semestral = 180).'),
    ('pesquisa_prazo_final_dias', N'60',
        N'Por quantos dias, depois de concluir o acompanhamento, a pesquisa de satisfação final continua como pendência.'),
    ('pesquisa_n_minimo', N'5',
        N'Número mínimo de respostas para exibir percentuais e NPS nos números agregados (painel e relatórios).')
) AS v(chave, valor, descricao)
WHERE NOT EXISTS (SELECT 1 FROM dbo.configuracao c WHERE c.chave = v.chave);
GO
