'use strict';

// F4 — Plano de metas da família. Escopo de unidade: tudo passa por carregarAcompanhamento (outra unidade => 404).
// Quem escreve (rota `escrita`): ASSISTENTE, COORDENADOR e ADMIN — o plano é da equipe, então qualquer um deles
// com acesso à unidade pode criar e atualizar metas; a auditoria guarda quem fez. Sem exclusão: meta cancelada fica no histórico.
// Só em acompanhamento EM_ANDAMENTO (senão 409).

const { consultar, transacao, tipos } = require('../db');
const { erros } = require('../lib/erros');
const { registrarAuditoria } = require('../lib/auditoria');
const { inteiroPositivo, lancarSeErros } = require('../lib/validacao');
const familias = require('./familias');
const regras = require('./metas-regras');

const isoData = (valor) => (valor ? new Date(valor).toISOString().slice(0, 10) : null);
const paramData = (v) => [tipos.Date, v ?? null];

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const SELECT_META = `SELECT m.id, m.dimensao, m.descricao, m.prazo, m.status, m.concluida_em, m.usuario_id, u.nome AS autor_nome, m.criado_em, m.alterado_em
                       FROM ASSOCIAL_acompanhamento_meta m JOIN ASSOCIAL_usuario u ON u.id = m.usuario_id`;

const formatarMeta = (m, hoje, historico) => ({
  id: m.id,
  dimensao: m.dimensao,
  dimensaoNome: regras.DIMENSOES[m.dimensao],
  descricao: m.descricao,
  prazo: m.prazo,
  status: m.status,
  concluidaEm: m.concluidaEm,
  vencida: m.status === 'EM_ANDAMENTO' && !!m.prazo && isoData(m.prazo) < hoje,
  autor: { id: m.usuarioId, nome: m.autorNome },
  criadoEm: m.criadoEm,
  alteradoEm: m.alteradoEm,
  ultimoAvanco: historico[0] ? historico[0].avanco : null,
  historico: historico.map((h) => ({ registroId: h.registroId, data: h.dataRegistro, avanco: h.avanco })),
});

async function listar(req, acompanhamentoId) {
  const ac = await familias.carregarAcompanhamento(req, acompanhamentoId);
  const hoje = familias.hojeIso();
  const [cfg, linhas, avancos] = await Promise.all([
    regras.lerConfig(),
    consultar(`${SELECT_META} WHERE m.acompanhamento_id = @id ORDER BY CASE WHEN m.status = 'EM_ANDAMENTO' THEN 0 ELSE 1 END, m.criado_em DESC, m.id DESC`, { id: ac.id }),
    consultar(
      `SELECT rm.meta_id, rm.avanco, r.id AS registro_id, r.data_registro
         FROM ASSOCIAL_registro_meta rm
         JOIN ASSOCIAL_acompanhamento_registro r ON r.id = rm.registro_id
        WHERE r.acompanhamento_id = @id AND r.anulado_em IS NULL
        ORDER BY r.data_registro DESC, r.id DESC`, { id: ac.id }),
  ]);
  const porMeta = new Map();
  for (const a of avancos) { if (!porMeta.has(a.metaId)) porMeta.set(a.metaId, []); porMeta.get(a.metaId).push(a); }
  const metas = linhas.map((m) => formatarMeta(m, hoje, porMeta.get(m.id) || []));
  return {
    acompanhamentoId: ac.id,
    status: ac.status,
    semMetaDias: cfg.semMetaDias,
    semMeta: regras.calcularSemMeta({ status: ac.status, dataInicio: ac.dataInicio, metas: linhas, hoje, dias: cfg.semMetaDias }),
    dimensoes: Object.entries(regras.DIMENSOES).map(([codigo, nome]) => ({ codigo, nome })),
    metas,
  };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

async function carregarMeta(executor, acId, metaId) {
  const id = inteiroPositivo(metaId);
  if (!id) throw erros.naoEncontrado('Meta não encontrada.');
  const m = await executor.consultarUm(
    'SELECT id, status, concluida_em FROM ASSOCIAL_acompanhamento_meta WHERE id = @id AND acompanhamento_id = @ac', { id, ac: acId });
  if (!m) throw erros.naoEncontrado('Meta não encontrada.');
  return m;
}

async function criar(req, acompanhamentoId, corpo) {
  const hoje = familias.hojeIso();
  const id = await transacao(async (tx) => {
    const ac = await familias.carregarAcompanhamento(req, acompanhamentoId, tx, { travar: true });
    familias.exigirEmAndamento(ac);
    const { dados, erros: problemas } = regras.validarMeta(corpo, { hoje, dataInicio: isoData(ac.dataInicio) });
    lancarSeErros(problemas);
    const [nova] = await tx.consultar(
      `INSERT INTO ASSOCIAL_acompanhamento_meta (acompanhamento_id, dimensao, descricao, prazo, status, usuario_id, criado_por)
       OUTPUT INSERTED.id
       VALUES (@ac, @dimensao, @descricao, @prazo, 'EM_ANDAMENTO', @usuario, @usuario)`,
      { ac: ac.id, dimensao: dados.dimensao, descricao: dados.descricao, prazo: paramData(dados.prazo), usuario: req.usuario.id });
    await registrarAuditoria(req, 'CRIAR', 'acompanhamento_meta', nova.id, { acompanhamentoId: ac.id, dimensao: dados.dimensao }, tx);
    return nova.id;
  });
  return { id };
}

async function atualizar(req, acompanhamentoId, metaId, corpo) {
  const hoje = familias.hojeIso();
  await transacao(async (tx) => {
    const ac = await familias.carregarAcompanhamento(req, acompanhamentoId, tx, { travar: true });
    familias.exigirEmAndamento(ac);
    const meta = await carregarMeta(tx, ac.id, metaId);
    const { dados, erros: problemas } = regras.validarMeta(corpo, { hoje, dataInicio: isoData(ac.dataInicio), existente: meta });
    lancarSeErros(problemas);
    await tx.consultar(
      `UPDATE ASSOCIAL_acompanhamento_meta
          SET dimensao = @dimensao, descricao = @descricao, prazo = @prazo, status = @status, concluida_em = @concluida,
              alterado_por = @usuario, alterado_em = SYSUTCDATETIME()
        WHERE id = @id`,
      {
        id: meta.id, dimensao: dados.dimensao, descricao: dados.descricao, prazo: paramData(dados.prazo), status: dados.status,
        concluida: paramData(dados.concluidaEm), usuario: req.usuario.id,
      });
    await registrarAuditoria(req, 'ALTERAR', 'acompanhamento_meta', meta.id,
      { acompanhamentoId: ac.id, status: dados.status, statusAnterior: meta.status }, tx);
  });
}

// ---------------------------------------------------------------------------
// Vínculo com os registros de contato (usado por acompanhamento-registros.js)
// ---------------------------------------------------------------------------

// Ids das metas que um registro pode marcar: as em andamento mais as que ele já tinha marcado (na edição).
async function metasMarcaveis(executor, acId, registroId = null) {
  const abertas = await executor.consultar("SELECT id FROM ASSOCIAL_acompanhamento_meta WHERE acompanhamento_id = @ac AND status = 'EM_ANDAMENTO'", { ac: acId });
  const ids = abertas.map((m) => m.id);
  if (registroId) {
    const ja = await executor.consultar('SELECT meta_id FROM ASSOCIAL_registro_meta WHERE registro_id = @r', { r: registroId });
    for (const j of ja) if (!ids.includes(j.metaId)) ids.push(j.metaId);
  }
  return ids;
}

async function gravarMetasDoRegistro(tx, registroId, itens) {
  await tx.consultar('DELETE FROM ASSOCIAL_registro_meta WHERE registro_id = @r', { r: registroId });
  for (const it of itens) {
    await tx.consultar('INSERT INTO ASSOCIAL_registro_meta (registro_id, meta_id, avanco) VALUES (@r, @m, @a)', { r: registroId, m: it.metaId, a: it.avanco });
  }
}

// Mapa registroId -> [{ metaId, dimensao, descricao, avanco }] dos registros (não anulados) do acompanhamento.
async function metasPorRegistro(acId) {
  const linhas = await consultar(
    `SELECT rm.registro_id, rm.meta_id, rm.avanco, m.dimensao, m.descricao
       FROM ASSOCIAL_registro_meta rm
       JOIN ASSOCIAL_acompanhamento_registro r ON r.id = rm.registro_id
       JOIN ASSOCIAL_acompanhamento_meta m ON m.id = rm.meta_id
      WHERE r.acompanhamento_id = @ac AND r.anulado_em IS NULL
      ORDER BY m.id`, { ac: acId });
  const mapa = new Map();
  for (const l of linhas) {
    if (!mapa.has(l.registroId)) mapa.set(l.registroId, []);
    mapa.get(l.registroId).push({ metaId: l.metaId, dimensao: l.dimensao, descricao: l.descricao, avanco: l.avanco });
  }
  return mapa;
}

// Para a linha do tempo: metas do acompanhamento (definição e encerramento viram eventos).
async function paraLinhaDoTempo(acId) {
  return consultar(`${SELECT_META} WHERE m.acompanhamento_id = @id`, { id: acId });
}

module.exports = { listar, criar, atualizar, metasMarcaveis, gravarMetasDoRegistro, metasPorRegistro, paraLinhaDoTempo };
