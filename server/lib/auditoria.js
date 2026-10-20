'use strict';

// Trilha de auditoria (tabela dbo.auditoria). Complementa criado_por/alterado_por das tabelas.
// Nunca derruba a requisição: falha de auditoria é apenas registrada no console.

const { consultar } = require('../db');

async function registrarAuditoria(req, acao, tabela, registroId, detalhes, executor = { consultar }) {
  try {
    await executor.consultar(
      `INSERT INTO auditoria (usuario_id, acao, tabela, registro_id, detalhes, ip)
       VALUES (@usuarioId, @acao, @tabela, @registroId, @detalhes, @ip)`,
      {
        usuarioId: req?.usuario?.id ?? null,
        acao,
        tabela: tabela ?? null,
        registroId: registroId === undefined || registroId === null ? null : String(registroId),
        detalhes: detalhes === undefined ? null : JSON.stringify(detalhes),
        ip: req?.ip ? String(req.ip).slice(0, 45) : null,
      },
    );
  } catch (err) {
    console.error('[auditoria] falha ao registrar:', err.message);
  }
}

module.exports = { registrarAuditoria };
