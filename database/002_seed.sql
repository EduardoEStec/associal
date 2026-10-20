/* =====================================================================
   ASSOCIAL — 002_seed.sql
   Dados iniciais. Idempotente: só insere o que ainda não existe
   (nunca sobrescreve edições feitas pelo ADMIN).

   USUÁRIO ADMIN: este script cria o usuário "admin" SEM senha utilizável
   (senha_hash = '!'). A senha é definida pelo runner (npm run db:migrate)
   a partir de ADMIN_SENHA_INICIAL no .env — ou gerada aleatoriamente e
   impressa uma única vez no console — sempre em hash bcrypt.
   Para redefinir depois: npm run admin:senha
   ===================================================================== */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---- Perfis ---- */
INSERT INTO dbo.perfil (codigo, nome, descricao)
SELECT v.codigo, v.nome, v.descricao
FROM (VALUES
    ('ASSISTENTE',  N'Assistente Social', N'Acesso apenas à(s) unidade(s) vinculada(s)'),
    ('COORDENADOR', N'Coordenador',       N'Acesso a todas as unidades'),
    ('ADMIN',       N'Administrador (TI)', N'Gerencia usuários, unidades, tabelas de apoio e configurações')
) v(codigo, nome, descricao)
WHERE NOT EXISTS (SELECT 1 FROM dbo.perfil p WHERE p.codigo = v.codigo);
GO

/* ---- Unidades ---- */
INSERT INTO dbo.unidade (sigla, nome, ordem)
SELECT v.sigla, v.nome, v.ordem
FROM (VALUES
    ('BRA', N'Brasilândia',         1),
    ('TIR', N'Cidade Tiradentes',   2),
    ('CTJ', N'City Jaraguá',        3),
    ('GUA', N'Guaianases',          4),
    ('JAR', N'Jaraguá',             5),
    ('MBO', N'M''Boi Mirim',        6),
    ('SMP', N'São Miguel Paulista', 7)
) v(sigla, nome, ordem)
WHERE NOT EXISTS (SELECT 1 FROM dbo.unidade u WHERE u.sigla = v.sigla);
GO

/* ---- Usuário ADMIN inicial (sem senha utilizável; ver cabeçalho) ---- */
INSERT INTO dbo.usuario (login, nome, senha_hash, perfil_id, deve_trocar_senha)
SELECT 'admin', N'Administrador', '!', p.id, 1
FROM dbo.perfil p
WHERE p.codigo = 'ADMIN'
  AND NOT EXISTS (SELECT 1 FROM dbo.usuario WHERE login = 'admin');
GO

/* ---- Tabelas de apoio ---- */

-- Demandas (Módulo 1, campo 10)
INSERT INTO dbo.demanda (nome, ordem, exige_texto)
SELECT v.nome, v.ordem, v.exige_texto
FROM (VALUES
    (N'Atualização do CadÚnico',                          1, 0),
    (N'Novo cadastro do CadÚnico',                        2, 0),
    (N'Informações/Orientações',                          3, 0),
    (N'Saúde',                                            4, 0),
    (N'Proteção Social Básica',                           5, 0),
    (N'Proteção Social Especial',                         6, 0),
    (N'Violação de Direitos - Criança/Adolescente',       7, 0),
    (N'Violação de Direitos - Mulher',                    8, 0),
    (N'Violação de Direitos - Idoso',                     9, 0),
    (N'Outra',                                           10, 1)
) v(nome, ordem, exige_texto)
WHERE NOT EXISTS (SELECT 1 FROM dbo.demanda t WHERE t.nome = v.nome);
GO

-- Faixa etária (campo 11) — idade_min/idade_max alimentam o cálculo automático
INSERT INTO dbo.faixa_etaria (nome, idade_min, idade_max, ordem)
SELECT v.nome, v.idade_min, v.idade_max, v.ordem
FROM (VALUES
    (N'Idoso (60+)',       60,   NULL, 1),
    (N'Adulto (30-59)',    30,   59,   2),
    (N'Jovem (18-29)',     18,   29,   3),
    (N'Adolescente (12-17)', 12, 17,   4),
    (N'Outra',             NULL, NULL, 5)
) v(nome, idade_min, idade_max, ordem)
WHERE NOT EXISTS (SELECT 1 FROM dbo.faixa_etaria t WHERE t.nome = v.nome);
GO

-- Gênero (campo 12)
INSERT INTO dbo.genero (nome, ordem)
SELECT v.nome, v.ordem
FROM (VALUES (N'Feminino', 1), (N'Masculino', 2), (N'LGBT', 3), (N'Outra', 4)) v(nome, ordem)
WHERE NOT EXISTS (SELECT 1 FROM dbo.genero t WHERE t.nome = v.nome);
GO

-- Escolaridade (campo 13)
INSERT INTO dbo.escolaridade (nome, ordem)
SELECT v.nome, v.ordem
FROM (VALUES
    (N'Não alfabetizado',       1),
    (N'Fundamental incompleto', 2),
    (N'Fundamental completo',   3),
    (N'Médio incompleto',       4),
    (N'Médio completo',         5),
    (N'Superior',               6),
    (N'Outra',                  7)
) v(nome, ordem)
WHERE NOT EXISTS (SELECT 1 FROM dbo.escolaridade t WHERE t.nome = v.nome);
GO

-- Raça/etnia (campo 14)
INSERT INTO dbo.raca (nome, ordem)
SELECT v.nome, v.ordem
FROM (VALUES
    (N'Branco', 1), (N'Preto', 2), (N'Pardo', 3), (N'Indígena', 4), (N'Amarelo', 5), (N'Outra', 6)
) v(nome, ordem)
WHERE NOT EXISTS (SELECT 1 FROM dbo.raca t WHERE t.nome = v.nome);
GO

-- Nível de vulnerabilidade (campo 15)
INSERT INTO dbo.nivel_vulnerabilidade (nome, ordem)
SELECT v.nome, v.ordem
FROM (VALUES
    (N'Altíssima', 1), (N'Alta', 2), (N'Média', 3), (N'Baixa', 4), (N'Outra', 5)
) v(nome, ordem)
WHERE NOT EXISTS (SELECT 1 FROM dbo.nivel_vulnerabilidade t WHERE t.nome = v.nome);
GO

-- Vulnerabilidades/riscos (campo 16)
INSERT INTO dbo.vulnerabilidade (nome, ordem, exige_texto)
SELECT v.nome, v.ordem, v.exige_texto
FROM (VALUES
    (N'Insegurança alimentar',                    1, 0),
    (N'Desemprego ou subemprego',                 2, 0),
    (N'Moradia precária',                         3, 0),
    (N'Baixa escolaridade',                       4, 0),
    (N'Violência doméstica ou comunitária',       5, 0),
    (N'Dependência química',                      6, 0),
    (N'Outros',                                   7, 1)
) v(nome, ordem, exige_texto)
WHERE NOT EXISTS (SELECT 1 FROM dbo.vulnerabilidade t WHERE t.nome = v.nome);
GO

-- Encaminhamentos (campo 18)
INSERT INTO dbo.encaminhamento (nome, ordem, exige_texto)
SELECT v.nome, v.ordem, v.exige_texto
FROM (VALUES
    (N'CRAS',                            1, 0),
    (N'CREAS',                           2, 0),
    (N'UBS',                             3, 0),
    (N'CAPS Adulto',                     4, 0),
    (N'CAPS AD',                         5, 0),
    (N'CAPS IJ',                         6, 0),
    (N'Centro de Referência da Mulher',  7, 0),
    (N'Conselho Tutelar',                8, 0),
    (N'Unidade Descomplica',             9, 0),
    (N'Outra',                          10, 1)
) v(nome, ordem, exige_texto)
WHERE NOT EXISTS (SELECT 1 FROM dbo.encaminhamento t WHERE t.nome = v.nome);
GO

-- Temas das ações (Módulo 2)
INSERT INTO dbo.tema (nome, ordem)
SELECT v.nome, v.ordem
FROM (VALUES
    (N'Assistência Social',            1),
    (N'Saúde',                         2),
    (N'Educação',                      3),
    (N'Cultura',                       4),
    (N'Esporte',                       5),
    (N'Serviços ao Cidadão',           6),
    (N'Idoso',                         7),
    (N'Mulher',                        8),
    (N'Família',                       9),
    (N'Associação Comunitária',       10),
    (N'Direitos Humanos e Cidadania', 11)
) v(nome, ordem)
WHERE NOT EXISTS (SELECT 1 FROM dbo.tema t WHERE t.nome = v.nome);
GO

-- Tipos de ação (Módulo 2)
INSERT INTO dbo.tipo_acao (nome, ordem, exige_texto)
SELECT v.nome, v.ordem, v.exige_texto
FROM (VALUES
    (N'Visita institucional', 1, 0),
    (N'Ação na unidade',      2, 0),
    (N'Palestra',             3, 0),
    (N'Roda de conversa',     4, 0),
    (N'Outra',                5, 1)
) v(nome, ordem, exige_texto)
WHERE NOT EXISTS (SELECT 1 FROM dbo.tipo_acao t WHERE t.nome = v.nome);
GO

-- Auxílios governamentais (questionário 1d)
INSERT INTO dbo.beneficio (nome, ordem, exige_texto)
SELECT v.nome, v.ordem, v.exige_texto
FROM (VALUES
    (N'Bolsa Família',                 1, 0),
    (N'BPC/LOAS',                      2, 0),
    (N'Tarifa Social de Energia',      3, 0),
    (N'Auxílio Gás',                   4, 0),
    (N'Outro',                         5, 1)
) v(nome, ordem, exige_texto)
WHERE NOT EXISTS (SELECT 1 FROM dbo.beneficio t WHERE t.nome = v.nome);
GO

-- Destino da economia (questionário 3c)
INSERT INTO dbo.destino_economia (nome, ordem, exige_texto)
SELECT v.nome, v.ordem, v.exige_texto
FROM (VALUES
    (N'Saúde',        1, 0),
    (N'Alimentação',  2, 0),
    (N'Educação',     3, 0),
    (N'Moradia',      4, 0),
    (N'Dívidas',      5, 0),
    (N'Outras',       6, 1)
) v(nome, ordem, exige_texto)
WHERE NOT EXISTS (SELECT 1 FROM dbo.destino_economia t WHERE t.nome = v.nome);
GO

/* ---- Configurações padrão ---- */
INSERT INTO dbo.configuracao (chave, valor, descricao)
SELECT v.chave, v.valor, v.descricao
FROM (VALUES
    ('prazo_questionario_final_dias', N'90',
        N'Prazo (em dias) entre o questionário inicial e o final. Definido pelo Coordenador.'),
    ('alerta_questionario_final_dias_antes', N'15',
        N'Quantos dias antes do vencimento o questionário final passa a ser sinalizado como "vencendo".'),
    ('upload_max_mb', N'10',
        N'Tamanho máximo (MB) de cada foto enviada nas ações/visitas.'),
    ('nome_entidade', N'INTECS',
        N'Nome da entidade exibido nos relatórios.'),
    ('termo_colaboracao', N'TCL/073/2023/SMDHC/SESANA',
        N'Termo de Colaboração citado nos relatórios.')
) v(chave, valor, descricao)
WHERE NOT EXISTS (SELECT 1 FROM dbo.configuracao c WHERE c.chave = v.chave);
GO
