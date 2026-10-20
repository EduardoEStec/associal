/* =====================================================================
   ASSOCIAL — 001_schema.sql
   Schema completo (SQL Server 2019+/2022) para todos os módulos.

   - Idempotente: pode ser executado várias vezes (IF OBJECT_ID ... IS NULL).
   - Lotes separados por GO (o runner database/migrate.js entende GO).
   - Nomes em português, snake_case. Colunas de auditoria padrão:
       criado_por, criado_em, alterado_por, alterado_em  (datas em UTC)
   - Tabelas de apoio (opções) são editáveis pelo ADMIN; nada é hard-coded.
   - Novos scripts: 003_*.sql, 004_*.sql ... sempre idempotentes.
   ===================================================================== */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;   -- necessário para índices filtrados
GO

/* ---------------------------------------------------------------------
   1. ACESSO: perfil, unidade, usuario, usuario_unidade, sessao
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.perfil', N'U') IS NULL
CREATE TABLE dbo.perfil (
    id      INT IDENTITY(1,1) CONSTRAINT pk_perfil PRIMARY KEY,
    codigo  VARCHAR(20)   NOT NULL CONSTRAINT uq_perfil_codigo UNIQUE,   -- ASSISTENTE | COORDENADOR | ADMIN
    nome    NVARCHAR(60)  NOT NULL,
    descricao NVARCHAR(255) NULL
);
GO

IF OBJECT_ID(N'dbo.unidade', N'U') IS NULL
CREATE TABLE dbo.unidade (
    id      INT IDENTITY(1,1) CONSTRAINT pk_unidade PRIMARY KEY,
    sigla   VARCHAR(5)    NOT NULL CONSTRAINT uq_unidade_sigla UNIQUE,
    nome    NVARCHAR(100) NOT NULL,
    endereco NVARCHAR(200) NULL,
    ativo   BIT NOT NULL CONSTRAINT df_unidade_ativo DEFAULT 1,
    ordem   INT NOT NULL CONSTRAINT df_unidade_ordem DEFAULT 0,
    criado_por   INT NULL,
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_unidade_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL,
    alterado_em  DATETIME2(0) NULL
);
GO

IF OBJECT_ID(N'dbo.usuario', N'U') IS NULL
CREATE TABLE dbo.usuario (
    id           INT IDENTITY(1,1) CONSTRAINT pk_usuario PRIMARY KEY,
    login        VARCHAR(60)   NOT NULL CONSTRAINT uq_usuario_login UNIQUE,
    nome         NVARCHAR(150) NOT NULL,
    email        NVARCHAR(150) NULL,
    senha_hash   VARCHAR(100)  NOT NULL,            -- bcrypt; '!' = sem senha definida (login bloqueado)
    perfil_id    INT NOT NULL CONSTRAINT fk_usuario_perfil REFERENCES dbo.perfil(id),
    cress        VARCHAR(30)   NULL,                -- registro profissional (assinatura dos relatórios)
    deve_trocar_senha BIT NOT NULL CONSTRAINT df_usuario_trocar DEFAULT 0,
    ativo        BIT NOT NULL CONSTRAINT df_usuario_ativo DEFAULT 1,
    ultimo_login_em DATETIME2(0) NULL,
    criado_por   INT NULL CONSTRAINT fk_usuario_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_usuario_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_usuario_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL
);
GO

-- Unidades às quais o usuário tem acesso (ASSISTENTE: 1+; COORDENADOR/ADMIN: ignorado, veem todas)
IF OBJECT_ID(N'dbo.usuario_unidade', N'U') IS NULL
CREATE TABLE dbo.usuario_unidade (
    usuario_id INT NOT NULL CONSTRAINT fk_usuario_unidade_usuario REFERENCES dbo.usuario(id) ON DELETE CASCADE,
    unidade_id INT NOT NULL CONSTRAINT fk_usuario_unidade_unidade REFERENCES dbo.unidade(id),
    CONSTRAINT pk_usuario_unidade PRIMARY KEY (usuario_id, unidade_id)
);
GO

-- Armazenamento das sessões do express-session
IF OBJECT_ID(N'dbo.sessao', N'U') IS NULL
CREATE TABLE dbo.sessao (
    sid       VARCHAR(128)  NOT NULL CONSTRAINT pk_sessao PRIMARY KEY,
    dados     NVARCHAR(MAX) NOT NULL,
    expira_em DATETIME2(0)  NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_sessao_expira_em' AND object_id = OBJECT_ID(N'dbo.sessao'))
CREATE INDEX ix_sessao_expira_em ON dbo.sessao (expira_em);
GO

/* ---------------------------------------------------------------------
   2. TABELAS DE APOIO (opções editáveis pelo ADMIN)
      Estrutura comum: id, nome, ordem, ativo, exige_texto
      exige_texto = 1 → opção "Outra/Outros": o formulário pede um texto livre.
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.demanda', N'U') IS NULL
CREATE TABLE dbo.demanda (
    id INT IDENTITY(1,1) CONSTRAINT pk_demanda PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_demanda_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT df_demanda_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_demanda_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_demanda_exige_texto DEFAULT 0
);
GO
IF OBJECT_ID(N'dbo.encaminhamento', N'U') IS NULL
CREATE TABLE dbo.encaminhamento (
    id INT IDENTITY(1,1) CONSTRAINT pk_encaminhamento PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_encaminhamento_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT df_encaminhamento_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_encaminhamento_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_encaminhamento_exige_texto DEFAULT 0
);
GO
IF OBJECT_ID(N'dbo.vulnerabilidade', N'U') IS NULL
CREATE TABLE dbo.vulnerabilidade (
    id INT IDENTITY(1,1) CONSTRAINT pk_vulnerabilidade PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_vulnerabilidade_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT df_vulnerabilidade_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_vulnerabilidade_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_vulnerabilidade_exige_texto DEFAULT 0
);
GO
IF OBJECT_ID(N'dbo.escolaridade', N'U') IS NULL
CREATE TABLE dbo.escolaridade (
    id INT IDENTITY(1,1) CONSTRAINT pk_escolaridade PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_escolaridade_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT df_escolaridade_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_escolaridade_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_escolaridade_exige_texto DEFAULT 0
);
GO
IF OBJECT_ID(N'dbo.raca', N'U') IS NULL
CREATE TABLE dbo.raca (
    id INT IDENTITY(1,1) CONSTRAINT pk_raca PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_raca_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT df_raca_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_raca_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_raca_exige_texto DEFAULT 0
);
GO
IF OBJECT_ID(N'dbo.genero', N'U') IS NULL
CREATE TABLE dbo.genero (
    id INT IDENTITY(1,1) CONSTRAINT pk_genero PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_genero_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT df_genero_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_genero_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_genero_exige_texto DEFAULT 0
);
GO
-- Faixa etária: idade_min/idade_max permitem o cálculo automático pela data de nascimento
-- (ambos NULL = "Outra", escolhida manualmente quando não há data de nascimento).
IF OBJECT_ID(N'dbo.faixa_etaria', N'U') IS NULL
CREATE TABLE dbo.faixa_etaria (
    id INT IDENTITY(1,1) CONSTRAINT pk_faixa_etaria PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_faixa_etaria_nome UNIQUE,
    idade_min SMALLINT NULL,
    idade_max SMALLINT NULL,
    ordem INT NOT NULL CONSTRAINT df_faixa_etaria_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_faixa_etaria_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_faixa_etaria_exige_texto DEFAULT 0
);
GO
IF OBJECT_ID(N'dbo.nivel_vulnerabilidade', N'U') IS NULL
CREATE TABLE dbo.nivel_vulnerabilidade (
    id INT IDENTITY(1,1) CONSTRAINT pk_nivel_vulnerabilidade PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_nivel_vulnerabilidade_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT df_nivel_vulnerabilidade_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_nivel_vulnerabilidade_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_nivel_vulnerabilidade_exige_texto DEFAULT 0
);
GO
IF OBJECT_ID(N'dbo.tema', N'U') IS NULL
CREATE TABLE dbo.tema (
    id INT IDENTITY(1,1) CONSTRAINT pk_tema PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_tema_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT df_tema_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_tema_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_tema_exige_texto DEFAULT 0
);
GO
IF OBJECT_ID(N'dbo.tipo_acao', N'U') IS NULL
CREATE TABLE dbo.tipo_acao (
    id INT IDENTITY(1,1) CONSTRAINT pk_tipo_acao PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_tipo_acao_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT df_tipo_acao_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_tipo_acao_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_tipo_acao_exige_texto DEFAULT 0
);
GO
-- Auxílios governamentais (questionário familiar, pergunta 1d)
IF OBJECT_ID(N'dbo.beneficio', N'U') IS NULL
CREATE TABLE dbo.beneficio (
    id INT IDENTITY(1,1) CONSTRAINT pk_beneficio PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_beneficio_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT df_beneficio_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_beneficio_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_beneficio_exige_texto DEFAULT 0
);
GO
-- Destino da economia mensal (questionário familiar, pergunta 3c)
IF OBJECT_ID(N'dbo.destino_economia', N'U') IS NULL
CREATE TABLE dbo.destino_economia (
    id INT IDENTITY(1,1) CONSTRAINT pk_destino_economia PRIMARY KEY,
    nome NVARCHAR(150) NOT NULL CONSTRAINT uq_destino_economia_nome UNIQUE,
    ordem INT NOT NULL CONSTRAINT df_destino_economia_ordem DEFAULT 0,
    ativo BIT NOT NULL CONSTRAINT df_destino_economia_ativo DEFAULT 1,
    exige_texto BIT NOT NULL CONSTRAINT df_destino_economia_exige_texto DEFAULT 0
);
GO

/* ---------------------------------------------------------------------
   3. PESSOA (única por CPF no sistema todo)
      Dados pessoais reaproveitados entre unidades. NÃO guarda nada de
      atendimento: quem vê o quê é decidido pelas tabelas que referenciam
      pessoa (atendimento, familia...), sempre filtradas por unidade.
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.pessoa', N'U') IS NULL
CREATE TABLE dbo.pessoa (
    id              INT IDENTITY(1,1) CONSTRAINT pk_pessoa PRIMARY KEY,
    cpf             CHAR(11) NULL,                      -- somente dígitos, validado na API
    nome            NVARCHAR(150) NOT NULL,
    data_nascimento DATE NULL,
    nis             VARCHAR(11) NULL,                   -- Nº CadÚnico
    endereco        NVARCHAR(200) NULL,                 -- rua e número
    cep             CHAR(8) NULL,
    bairro          NVARCHAR(100) NULL,
    trabalho_atual  NVARCHAR(200) NULL,
    genero_id       INT NULL CONSTRAINT fk_pessoa_genero       REFERENCES dbo.genero(id),
    escolaridade_id INT NULL CONSTRAINT fk_pessoa_escolaridade REFERENCES dbo.escolaridade(id),
    raca_id         INT NULL CONSTRAINT fk_pessoa_raca         REFERENCES dbo.raca(id),
    criado_por   INT NULL CONSTRAINT fk_pessoa_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_pessoa_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_pessoa_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL,
    CONSTRAINT ck_pessoa_cpf CHECK (cpf IS NULL OR (LEN(cpf) = 11 AND cpf NOT LIKE '%[^0-9]%')),
    CONSTRAINT ck_pessoa_cep CHECK (cep IS NULL OR (LEN(cep) = 8 AND cep NOT LIKE '%[^0-9]%')),
    CONSTRAINT ck_pessoa_nis CHECK (nis IS NULL OR nis NOT LIKE '%[^0-9]%')
);
GO
-- CPF único (pessoas sem CPF informado podem coexistir)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_pessoa_cpf' AND object_id = OBJECT_ID(N'dbo.pessoa'))
CREATE UNIQUE INDEX ux_pessoa_cpf ON dbo.pessoa (cpf) WHERE cpf IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_pessoa_nome' AND object_id = OBJECT_ID(N'dbo.pessoa'))
CREATE INDEX ix_pessoa_nome ON dbo.pessoa (nome);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_pessoa_nis' AND object_id = OBJECT_ID(N'dbo.pessoa'))
CREATE INDEX ix_pessoa_nis ON dbo.pessoa (nis) WHERE nis IS NOT NULL;
GO

/* ---------------------------------------------------------------------
   4. MÓDULO 1 — ATENDIMENTO SOCIAL
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.atendimento', N'U') IS NULL
CREATE TABLE dbo.atendimento (
    id              INT IDENTITY(1,1) CONSTRAINT pk_atendimento PRIMARY KEY,
    unidade_id      INT NOT NULL CONSTRAINT fk_atendimento_unidade REFERENCES dbo.unidade(id),
    pessoa_id       INT NOT NULL CONSTRAINT fk_atendimento_pessoa  REFERENCES dbo.pessoa(id),
    usuario_id      INT NOT NULL CONSTRAINT fk_atendimento_usuario REFERENCES dbo.usuario(id),  -- assistente que atendeu
    data_atendimento DATE NOT NULL,
    faixa_etaria_id INT NULL CONSTRAINT fk_atendimento_faixa_etaria REFERENCES dbo.faixa_etaria(id), -- calculada na data do atendimento
    nivel_vulnerabilidade_id INT NULL CONSTRAINT fk_atendimento_nivel_vuln REFERENCES dbo.nivel_vulnerabilidade(id),
    demanda_outra         NVARCHAR(300) NULL,       -- texto da demanda "Outra"
    vulnerabilidade_outra NVARCHAR(300) NULL,       -- texto de "Outros"
    encaminhamento_outro  NVARCHAR(300) NULL,       -- texto do encaminhamento "Outra"
    resumo          NVARCHAR(MAX) NULL,
    criado_por   INT NULL CONSTRAINT fk_atendimento_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_atendimento_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_atendimento_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_atendimento_unidade_data' AND object_id = OBJECT_ID(N'dbo.atendimento'))
CREATE INDEX ix_atendimento_unidade_data ON dbo.atendimento (unidade_id, data_atendimento);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_atendimento_pessoa' AND object_id = OBJECT_ID(N'dbo.atendimento'))
CREATE INDEX ix_atendimento_pessoa ON dbo.atendimento (pessoa_id);
GO

IF OBJECT_ID(N'dbo.atendimento_demanda', N'U') IS NULL
CREATE TABLE dbo.atendimento_demanda (
    atendimento_id INT NOT NULL CONSTRAINT fk_atend_demanda_atendimento REFERENCES dbo.atendimento(id) ON DELETE CASCADE,
    demanda_id     INT NOT NULL CONSTRAINT fk_atend_demanda_demanda     REFERENCES dbo.demanda(id),
    CONSTRAINT pk_atendimento_demanda PRIMARY KEY (atendimento_id, demanda_id)
);
GO
IF OBJECT_ID(N'dbo.atendimento_vulnerabilidade', N'U') IS NULL
CREATE TABLE dbo.atendimento_vulnerabilidade (
    atendimento_id     INT NOT NULL CONSTRAINT fk_atend_vuln_atendimento     REFERENCES dbo.atendimento(id) ON DELETE CASCADE,
    vulnerabilidade_id INT NOT NULL CONSTRAINT fk_atend_vuln_vulnerabilidade REFERENCES dbo.vulnerabilidade(id),
    CONSTRAINT pk_atendimento_vulnerabilidade PRIMARY KEY (atendimento_id, vulnerabilidade_id)
);
GO
IF OBJECT_ID(N'dbo.atendimento_encaminhamento', N'U') IS NULL
CREATE TABLE dbo.atendimento_encaminhamento (
    atendimento_id    INT NOT NULL CONSTRAINT fk_atend_enc_atendimento    REFERENCES dbo.atendimento(id) ON DELETE CASCADE,
    encaminhamento_id INT NOT NULL CONSTRAINT fk_atend_enc_encaminhamento REFERENCES dbo.encaminhamento(id),
    CONSTRAINT pk_atendimento_encaminhamento PRIMARY KEY (atendimento_id, encaminhamento_id)
);
GO

/* ---------------------------------------------------------------------
   5. MÓDULO 2 — VISITAS E AÇÕES
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.acao_visita', N'U') IS NULL
CREATE TABLE dbo.acao_visita (
    id              INT IDENTITY(1,1) CONSTRAINT pk_acao_visita PRIMARY KEY,
    unidade_id      INT NOT NULL CONSTRAINT fk_acao_visita_unidade REFERENCES dbo.unidade(id),
    tipo_acao_id    INT NOT NULL CONSTRAINT fk_acao_visita_tipo    REFERENCES dbo.tipo_acao(id),
    data_acao       DATE NOT NULL,
    instituicao_local NVARCHAR(200) NULL,
    endereco        NVARCHAR(200) NULL,
    status          VARCHAR(12) NOT NULL CONSTRAINT df_acao_visita_status DEFAULT 'PLANEJADA',
    qtd_participantes INT NULL,
    descricao       NVARCHAR(MAX) NULL,
    criado_por   INT NULL CONSTRAINT fk_acao_visita_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_acao_visita_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_acao_visita_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL,
    CONSTRAINT ck_acao_visita_status CHECK (status IN ('PLANEJADA', 'REALIZADA', 'CANCELADA')),
    CONSTRAINT ck_acao_visita_participantes CHECK (qtd_participantes IS NULL OR qtd_participantes >= 0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acao_visita_unidade_data' AND object_id = OBJECT_ID(N'dbo.acao_visita'))
CREATE INDEX ix_acao_visita_unidade_data ON dbo.acao_visita (unidade_id, data_acao);
GO

-- Até 4 temas por ação: "ordem" 1..4 faz parte da PK, então o banco impede o 5º tema.
IF OBJECT_ID(N'dbo.acao_visita_tema', N'U') IS NULL
CREATE TABLE dbo.acao_visita_tema (
    acao_visita_id INT NOT NULL CONSTRAINT fk_acao_tema_acao REFERENCES dbo.acao_visita(id) ON DELETE CASCADE,
    ordem          TINYINT NOT NULL,
    tema_id        INT NOT NULL CONSTRAINT fk_acao_tema_tema REFERENCES dbo.tema(id),
    CONSTRAINT pk_acao_visita_tema PRIMARY KEY (acao_visita_id, ordem),
    CONSTRAINT uq_acao_visita_tema UNIQUE (acao_visita_id, tema_id),
    CONSTRAINT ck_acao_visita_tema_ordem CHECK (ordem BETWEEN 1 AND 4)
);
GO

IF OBJECT_ID(N'dbo.acao_visita_foto', N'U') IS NULL
CREATE TABLE dbo.acao_visita_foto (
    id             INT IDENTITY(1,1) CONSTRAINT pk_acao_visita_foto PRIMARY KEY,
    acao_visita_id INT NOT NULL CONSTRAINT fk_acao_foto_acao REFERENCES dbo.acao_visita(id) ON DELETE CASCADE,
    arquivo        VARCHAR(200)  NOT NULL,           -- nome gravado em UPLOAD_DIR
    nome_original  NVARCHAR(255) NULL,
    mime_type      VARCHAR(100)  NULL,
    tamanho_bytes  INT NULL,
    legenda        NVARCHAR(300) NULL,
    ordem          INT NOT NULL CONSTRAINT df_acao_foto_ordem DEFAULT 0,
    criado_por     INT NULL CONSTRAINT fk_acao_foto_criado_por REFERENCES dbo.usuario(id),
    criado_em      DATETIME2(0) NOT NULL CONSTRAINT df_acao_foto_criado_em DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acao_visita_foto_acao' AND object_id = OBJECT_ID(N'dbo.acao_visita_foto'))
CREATE INDEX ix_acao_visita_foto_acao ON dbo.acao_visita_foto (acao_visita_id);
GO

/* ---------------------------------------------------------------------
   6. MÓDULO 3 — ACOMPANHAMENTO FAMILIAR
      familia/familia_membro NÃO têm unidade: só são expostos através de um
      acompanhamento de unidade permitida (ver docs/CONVENCOES.md).
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.familia', N'U') IS NULL
CREATE TABLE dbo.familia (
    id                    INT IDENTITY(1,1) CONSTRAINT pk_familia PRIMARY KEY,
    responsavel_pessoa_id INT NOT NULL CONSTRAINT fk_familia_responsavel REFERENCES dbo.pessoa(id),
    criado_por   INT NULL CONSTRAINT fk_familia_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_familia_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_familia_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL,
    CONSTRAINT uq_familia_responsavel UNIQUE (responsavel_pessoa_id)   -- 1 família por responsável (= por CPF)
);
GO

IF OBJECT_ID(N'dbo.familia_membro', N'U') IS NULL
CREATE TABLE dbo.familia_membro (
    id              INT IDENTITY(1,1) CONSTRAINT pk_familia_membro PRIMARY KEY,
    familia_id      INT NOT NULL CONSTRAINT fk_familia_membro_familia REFERENCES dbo.familia(id) ON DELETE CASCADE,
    nome            NVARCHAR(150) NOT NULL,
    data_nascimento DATE NULL,
    idade           SMALLINT NULL,                  -- usada quando só se conhece a idade
    genero_id       INT NULL CONSTRAINT fk_familia_membro_genero REFERENCES dbo.genero(id),
    parentesco      NVARCHAR(60) NULL,
    trabalha        BIT NULL,
    criado_por   INT NULL CONSTRAINT fk_familia_membro_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_familia_membro_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_familia_membro_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_familia_membro_familia' AND object_id = OBJECT_ID(N'dbo.familia_membro'))
CREATE INDEX ix_familia_membro_familia ON dbo.familia_membro (familia_id);
GO

IF OBJECT_ID(N'dbo.acompanhamento', N'U') IS NULL
CREATE TABLE dbo.acompanhamento (
    id           INT IDENTITY(1,1) CONSTRAINT pk_acompanhamento PRIMARY KEY,
    familia_id   INT NOT NULL CONSTRAINT fk_acompanhamento_familia  REFERENCES dbo.familia(id),
    unidade_id   INT NOT NULL CONSTRAINT fk_acompanhamento_unidade  REFERENCES dbo.unidade(id),
    usuario_id   INT NOT NULL CONSTRAINT fk_acompanhamento_usuario  REFERENCES dbo.usuario(id),   -- assistente responsável
    data_inicio  DATE NOT NULL,
    data_prevista_final DATE NULL,                  -- data_inicio + configuracao.prazo_questionario_final_dias
    data_encerramento   DATE NULL,
    status       VARCHAR(15) NOT NULL CONSTRAINT df_acompanhamento_status DEFAULT 'EM_ANDAMENTO',
    observacoes  NVARCHAR(MAX) NULL,
    criado_por   INT NULL CONSTRAINT fk_acompanhamento_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_acompanhamento_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_acompanhamento_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL,
    CONSTRAINT ck_acompanhamento_status CHECK (status IN ('EM_ANDAMENTO', 'CONCLUIDO', 'DESLIGADO'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acompanhamento_unidade_status' AND object_id = OBJECT_ID(N'dbo.acompanhamento'))
CREATE INDEX ix_acompanhamento_unidade_status ON dbo.acompanhamento (unidade_id, status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_acompanhamento_familia' AND object_id = OBJECT_ID(N'dbo.acompanhamento'))
CREATE INDEX ix_acompanhamento_familia ON dbo.acompanhamento (familia_id);
GO
-- No máximo um acompanhamento em andamento por família
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_acompanhamento_familia_ativo' AND object_id = OBJECT_ID(N'dbo.acompanhamento'))
CREATE UNIQUE INDEX ux_acompanhamento_familia_ativo ON dbo.acompanhamento (familia_id) WHERE status = 'EM_ANDAMENTO';
GO

/* Questionário familiar (modelo "QUESTIONÁRIO FAMILIAR ATUALIZADO").
   Um INICIAL e um FINAL por acompanhamento, mesmas colunas.
   Tudo anulável: permite salvar rascunho (concluido = 0).
   Códigos das respostas fechadas: ver docs/CONVENCOES.md e server/lib/dominios.js */
IF OBJECT_ID(N'dbo.questionario', N'U') IS NULL
CREATE TABLE dbo.questionario (
    id                INT IDENTITY(1,1) CONSTRAINT pk_questionario PRIMARY KEY,
    acompanhamento_id INT NOT NULL CONSTRAINT fk_questionario_acompanhamento REFERENCES dbo.acompanhamento(id) ON DELETE CASCADE,
    tipo              VARCHAR(7) NOT NULL,                   -- INICIAL | FINAL
    data_aplicacao    DATE NOT NULL,
    concluido         BIT NOT NULL CONSTRAINT df_questionario_concluido DEFAULT 0,

    -- 1. Demográficos (1a, composição, vem de familia_membro; aqui o "retrato" do momento)
    qtd_membros_familia    TINYINT NULL,
    renda_mensal_media     DECIMAL(10,2) NULL,               -- 1b
    qtd_membros_com_renda  TINYINT NULL,                     -- 1c
    recebe_auxilio         BIT NULL,                         -- 1d (quais: questionario_beneficio)
    auxilio_outro          NVARCHAR(200) NULL,

    -- 2. Alimentos
    acesso_alimentos_in_natura VARCHAR(15) NULL,             -- 2a
    frequencia_frutas_verduras VARCHAR(15) NULL,             -- 2b
    qualidade_alimentacao      VARCHAR(15) NULL,             -- 2c
    saude_nutricional          VARCHAR(20) NULL,             -- 2d

    -- 3. Econômico
    consegue_poupar        BIT NULL,                         -- 3a
    economia_mensal_faixa  VARCHAR(12) NULL,                 -- 3b
    economia_mensal_valor  DECIMAL(10,2) NULL,               -- 3b (valor informado)
    destino_economia_outro NVARCHAR(200) NULL,               -- 3c (quais: questionario_destino_economia)
    capacidade_poupanca    VARCHAR(15) NULL,                 -- 3d
    gestao_financeira      VARCHAR(12) NULL,                 -- 3e (dívidas/gestão)

    -- 4. Empoderamento
    empoderada_decisoes        BIT NULL,                     -- 4a
    contribuicao_autonomia     NVARCHAR(MAX) NULL,           -- 4b
    melhoria_planejamento      BIT NULL,                     -- 4c
    impacto_comunidade         NVARCHAR(MAX) NULL,           -- 4d
    o_que_melhorar             NVARCHAR(MAX) NULL,           -- 4e

    -- 5. Percepção
    avaliacao_armazem      VARCHAR(10) NULL,                 -- 5a
    principal_beneficio    NVARCHAR(MAX) NULL,               -- 5b
    recomendaria           BIT NULL,                         -- 5c

    criado_por   INT NULL CONSTRAINT fk_questionario_criado_por   REFERENCES dbo.usuario(id),
    criado_em    DATETIME2(0) NOT NULL CONSTRAINT df_questionario_criado_em DEFAULT SYSUTCDATETIME(),
    alterado_por INT NULL CONSTRAINT fk_questionario_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL,

    CONSTRAINT uq_questionario_tipo UNIQUE (acompanhamento_id, tipo),
    CONSTRAINT ck_questionario_tipo CHECK (tipo IN ('INICIAL', 'FINAL')),
    CONSTRAINT ck_questionario_renda CHECK (renda_mensal_media IS NULL OR renda_mensal_media >= 0),
    CONSTRAINT ck_questionario_economia_valor CHECK (economia_mensal_valor IS NULL OR economia_mensal_valor >= 0),
    CONSTRAINT ck_questionario_2a CHECK (acesso_alimentos_in_natura IS NULL OR acesso_alimentos_in_natura IN ('NAO_TINHA', 'SEMANAL_1_2', 'SEMANAL_2_3', 'DIARIO')),
    CONSTRAINT ck_questionario_2b CHECK (frequencia_frutas_verduras IS NULL OR frequencia_frutas_verduras IN ('UMA_DUAS', 'TRES_QUATRO', 'CINCO_OU_MAIS')),
    CONSTRAINT ck_questionario_2c CHECK (qualidade_alimentacao IS NULL OR qualidade_alimentacao IN ('MELHOROU_MUITO', 'MELHOROU_POUCO', 'NAO_MELHOROU', 'PIOROU')),
    CONSTRAINT ck_questionario_2d CHECK (saude_nutricional IS NULL OR saude_nutricional IN ('GRANDE_MELHORIA', 'PEQUENA_MELHORIA', 'NENHUMA')),
    CONSTRAINT ck_questionario_3b CHECK (economia_mensal_faixa IS NULL OR economia_mensal_faixa IN ('ATE_100', 'DE_101_200', 'DE_201_300', 'ACIMA_300')),
    CONSTRAINT ck_questionario_3d CHECK (capacidade_poupanca IS NULL OR capacidade_poupanca IN ('REGULARMENTE', 'AS_VEZES', 'NAO_CONSEGUE')),
    CONSTRAINT ck_questionario_3e CHECK (gestao_financeira IS NULL OR gestao_financeira IN ('MELHOROU', 'SEM_MUDANCA', 'PIOROU')),
    CONSTRAINT ck_questionario_5a CHECK (avaliacao_armazem IS NULL OR avaliacao_armazem IN ('OTIMA', 'BOA', 'REGULAR', 'RUIM'))
);
GO

-- 1d: auxílios recebidos (múltipla)
IF OBJECT_ID(N'dbo.questionario_beneficio', N'U') IS NULL
CREATE TABLE dbo.questionario_beneficio (
    questionario_id INT NOT NULL CONSTRAINT fk_quest_beneficio_questionario REFERENCES dbo.questionario(id) ON DELETE CASCADE,
    beneficio_id    INT NOT NULL CONSTRAINT fk_quest_beneficio_beneficio    REFERENCES dbo.beneficio(id),
    CONSTRAINT pk_questionario_beneficio PRIMARY KEY (questionario_id, beneficio_id)
);
GO
-- 3c: destino da economia (múltipla)
IF OBJECT_ID(N'dbo.questionario_destino_economia', N'U') IS NULL
CREATE TABLE dbo.questionario_destino_economia (
    questionario_id     INT NOT NULL CONSTRAINT fk_quest_destino_questionario REFERENCES dbo.questionario(id) ON DELETE CASCADE,
    destino_economia_id INT NOT NULL CONSTRAINT fk_quest_destino_destino      REFERENCES dbo.destino_economia(id),
    CONSTRAINT pk_questionario_destino_economia PRIMARY KEY (questionario_id, destino_economia_id)
);
GO

/* ---------------------------------------------------------------------
   7. CONFIGURAÇÃO e AUDITORIA
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.configuracao', N'U') IS NULL
CREATE TABLE dbo.configuracao (
    chave        VARCHAR(80)   NOT NULL CONSTRAINT pk_configuracao PRIMARY KEY,
    valor        NVARCHAR(500) NOT NULL,
    descricao    NVARCHAR(255) NULL,
    alterado_por INT NULL CONSTRAINT fk_configuracao_alterado_por REFERENCES dbo.usuario(id),
    alterado_em  DATETIME2(0) NULL
);
GO

-- Trilha de auditoria (quem fez o quê). Complementa as colunas criado_*/alterado_* das tabelas.
IF OBJECT_ID(N'dbo.auditoria', N'U') IS NULL
CREATE TABLE dbo.auditoria (
    id          BIGINT IDENTITY(1,1) CONSTRAINT pk_auditoria PRIMARY KEY,
    usuario_id  INT NULL,                     -- sem FK de propósito: o log sobrevive a qualquer alteração
    acao        VARCHAR(20)  NOT NULL,        -- CRIAR | ALTERAR | EXCLUIR | LOGIN | LOGOUT | LOGIN_FALHA | CONSULTAR
    tabela      VARCHAR(60)  NULL,
    registro_id VARCHAR(40)  NULL,
    detalhes    NVARCHAR(MAX) NULL,           -- JSON livre (valores antes/depois)
    ip          VARCHAR(45)  NULL,
    criado_em   DATETIME2(0) NOT NULL CONSTRAINT df_auditoria_criado_em DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_auditoria_tabela_registro' AND object_id = OBJECT_ID(N'dbo.auditoria'))
CREATE INDEX ix_auditoria_tabela_registro ON dbo.auditoria (tabela, registro_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_auditoria_usuario_data' AND object_id = OBJECT_ID(N'dbo.auditoria'))
CREATE INDEX ix_auditoria_usuario_data ON dbo.auditoria (usuario_id, criado_em);
GO
