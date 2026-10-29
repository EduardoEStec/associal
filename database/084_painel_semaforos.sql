/* =====================================================================
   ASSOCIAL — 084_painel_semaforos.sql  (F6 — painel do coordenador e relatórios)
   Só configurações (sem tabela nova): limiares PROVISÓRIOS dos semáforos do Painel (decisão D13),
   editáveis em Administração > Configurações (também pela coordenação) e a validar com a coordenação.
   Proposta: docs/propostas/acompanhamento-e-satisfacao.md (seções 6.6, 7 e 10.5). Idempotente.
   ===================================================================== */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

INSERT INTO dbo.ASSOCIAL_configuracao (chave, valor, descricao)
SELECT v.chave, v.valor, v.descricao
FROM (VALUES
    ('semaforo_progresso_verde_pct', N'50',
        N'Semáforo do progresso: % de famílias que melhoraram a partir do qual o resultado é "bom" (verde). Valor provisório, a validar com a coordenação.'),
    ('semaforo_progresso_amarelo_pct', N'30',
        N'Semáforo do progresso: % de famílias que melhoraram a partir do qual o resultado é "atenção" (amarelo); abaixo disso é "crítico" (vermelho). Valor provisório.'),
    ('semaforo_nps_verde', N'50',
        N'Semáforo da satisfação: nota geral (NPS, de -100 a 100) a partir da qual o resultado pode ser "bom" (verde). Valor provisório.'),
    ('semaforo_nps_amarelo', N'0',
        N'Semáforo da satisfação: nota geral (NPS) a partir da qual o resultado é "atenção" (amarelo); abaixo disso é "crítico" (vermelho). Valor provisório.'),
    ('semaforo_concordancia_verde', N'80',
        N'Semáforo da satisfação: % de concordância (respostas 4 ou 5) a partir do qual o resultado pode ser "bom" (verde). Valor provisório.'),
    ('semaforo_concordancia_amarelo', N'60',
        N'Semáforo da satisfação: % de concordância a partir do qual o resultado é "atenção" (amarelo); abaixo disso é "crítico" (vermelho). Valor provisório.')
) AS v(chave, valor, descricao)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ASSOCIAL_configuracao c WHERE c.chave = v.chave);
GO
