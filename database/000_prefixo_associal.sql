/* =====================================================================
   ASSOCIAL — 000_prefixo_associal.sql
   Converte o layout ANTIGO (tabelas dbo.<nome>, sem prefixo, constraints pk_/fk_/...) para o padrão atual:
   tabelas dbo.ASSOCIAL_<nome> e constraints ASSOCIAL_<nome-antigo> (a convenção da casa: cada sistema prefixa o que cria,
   porque o banco INTERNO é compartilhado e nomes de constraints são únicos por schema).

   - Roda ANTES da 001 (ordem numérica). Em banco novo, ou já convertido, não faz nada.
   - Só age quando reconhece a assinatura do ASSOCIAL antigo: a FK fk_familia_membro_familia sobre dbo.familia_membro
     e a PK pk_sessao sobre dbo.sessao. Num banco compartilhado, tabelas de outros sistemas com nomes parecidos
     (ex.: dbo.usuario) NÃO são tocadas se essa assinatura não existir.
   - Tudo numa transação: ou converte as 50 tabelas e suas constraints, ou nada. Os dados ficam onde estão (sp_rename).
   - Índices (ix_/ux_) mantêm o nome: são únicos só dentro da tabela.
   - Constraints com nome gerado pelo SQL Server (DF__..., contém "__") não são renomeadas.
   ===================================================================== */

SET NOCOUNT ON;
GO

IF EXISTS (SELECT 1 FROM sys.foreign_keys f
            WHERE f.name = N'fk_familia_membro_familia' AND f.schema_id = SCHEMA_ID(N'dbo')
              AND OBJECT_NAME(f.parent_object_id) = N'familia_membro' AND OBJECT_NAME(f.referenced_object_id) = N'familia')
   AND EXISTS (SELECT 1 FROM sys.key_constraints k
                WHERE k.name = N'pk_sessao' AND k.schema_id = SCHEMA_ID(N'dbo') AND OBJECT_NAME(k.parent_object_id) = N'sessao')
BEGIN
    DECLARE @lista NVARCHAR(MAX) =
        N'acao_visita,acao_visita_foto,acao_visita_tema,acompanhamento,acompanhamento_indice,acompanhamento_meta,'
+        N'acompanhamento_registro,acompanhamento_registro_foto,acompanhamento_registro_orientacao,atendimento,'
+        N'atendimento_demanda,atendimento_encaminhamento,atendimento_vulnerabilidade,auditoria,beneficio,catalogo_opcao,'
+        N'catalogo_pergunta,configuracao,demanda,destino_economia,encaminhamento,escolaridade,faixa_etaria,familia,'
+        N'familia_membro,frase_registro,genero,nivel_vulnerabilidade,orientacao_registro,perfil,pesquisa_modelo,'
+        N'pesquisa_pergunta,pesquisa_resposta,pesquisa_resposta_item,pessoa,questionario,questionario_beneficio,'
+        N'questionario_destino_economia,raca,registro_meta,resposta_extra,sessao,tema,tipo_acao,tipo_contato,unidade,'
+        N'uso_armazem,usuario,usuario_unidade,vulnerabilidade';
    DECLARE @nome SYSNAME, @antigo NVARCHAR(300), @novo SYSNAME, @conflitos NVARCHAR(MAX), @total INT = 0;

    -- Nome antigo e novo ao mesmo tempo no banco: não adivinha qual vale.
    SELECT @conflitos = STRING_AGG(CAST(s.value AS NVARCHAR(MAX)), N', ')
      FROM STRING_SPLIT(@lista, N',') s
     WHERE OBJECT_ID(N'dbo.' + s.value, N'U') IS NOT NULL AND OBJECT_ID(N'dbo.ASSOCIAL_' + s.value, N'U') IS NOT NULL;
    IF @conflitos IS NOT NULL
    BEGIN
        DECLARE @msg NVARCHAR(2000) = N'000_prefixo_associal: existem dbo.<nome> e dbo.ASSOCIAL_<nome> ao mesmo tempo: ' + LEFT(@conflitos, 1500);
        THROW 50000, @msg, 1;
    END;

    BEGIN TRY
        BEGIN TRAN;

        -- 1. tabelas
        DECLARE ct CURSOR LOCAL STATIC FOR SELECT s.value FROM STRING_SPLIT(@lista, N',') s;
        OPEN ct;
        FETCH NEXT FROM ct INTO @nome;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            IF OBJECT_ID(N'dbo.' + @nome, N'U') IS NOT NULL
            BEGIN
                SET @antigo = N'dbo.' + @nome;
                SET @novo = N'ASSOCIAL_' + @nome;
                EXEC sp_rename @objname = @antigo, @newname = @novo, @objtype = N'OBJECT';
                SET @total += 1;
            END;
            FETCH NEXT FROM ct INTO @nome;
        END;
        CLOSE ct;
        DEALLOCATE ct;

        -- 2. constraints nomeadas (PK, UQ, FK, DEFAULT, CHECK) das tabelas ASSOCIAL_*
        DECLARE cc CURSOR LOCAL STATIC FOR
            SELECT o.name
              FROM sys.objects o
              JOIN sys.objects p ON p.object_id = o.parent_object_id
             WHERE o.type IN ('PK', 'UQ', 'F', 'D', 'C')
               AND o.schema_id = SCHEMA_ID(N'dbo')
               AND p.type = 'U' AND p.name LIKE N'ASSOCIAL[_]%'
               AND o.name NOT LIKE N'ASSOCIAL[_]%'
               AND o.name NOT LIKE N'%[_][_]%';
        OPEN cc;
        FETCH NEXT FROM cc INTO @nome;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @antigo = N'dbo.' + @nome;
            SET @novo = N'ASSOCIAL_' + @nome;
            EXEC sp_rename @objname = @antigo, @newname = @novo, @objtype = N'OBJECT';
            FETCH NEXT FROM cc INTO @nome;
        END;
        CLOSE cc;
        DEALLOCATE cc;

        COMMIT TRAN;
        PRINT N'000_prefixo_associal: ' + CAST(@total AS NVARCHAR(10)) + N' tabelas renomeadas para ASSOCIAL_*.';
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        THROW;
    END CATCH;
END;
GO
