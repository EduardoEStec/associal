'use strict';

// F3 — Pesquisa de satisfação do projeto, IDENTIFICADA (ligada ao acompanhamento da família) e aplicada pessoalmente
// pela assistente. Escopo de unidade: tudo passa por carregarAcompanhamento (outra unidade => 404).
// Privacidade (D11, revista em 21/10/2026): ASSISTENTE vê as pesquisas das famílias das suas unidades; COORDENADOR e ADMIN
// (que opera como a coordenação) veem tudo e podem ocultar o comentário dos relatórios.
// Respostas concluídas não são editáveis: corrigir = anular (com motivo) e aplicar de novo.

const { consultar, consultarUm, transacao, tipos } = require('../db');
const { erros } = require('../lib/erros');
const { ehCoordenacao } = require('../lib/dominios');
const { registrarAuditoria } = require('../lib/auditoria');
const { texto, inteiroPositivo, lancarSeErros } = require('../lib/validacao');
const familias = require('./familias');
const regras = require('./pesquisa-regras');

const isoData = (valor) => (valor ? new Date(valor).toISOString().slice(0, 10) : null);
const paramData = (v) => [tipos.Date, v ?? null];
function exigirAutorOuCoordenacao(req, resposta) {
  if (resposta.usuarioId !== req.usuario.id && !ehCoordenacao(req.usuario)) {
    throw erros.proibido('Somente quem aplicou a pesquisa ou a coordenação pode alterá-la.');
  }
}

// ---------------------------------------------------------------------------
// Modelo (versionado)
// ---------------------------------------------------------------------------

async function carregarModelo(executor, { id = null } = {}) {
  const modelo = id
    ? await executor.consultarUm('SELECT id, codigo, versao, titulo, aviso FROM pesquisa_modelo WHERE id = @id', { id })
    : await executor.consultarUm(
      "SELECT TOP 1 id, codigo, versao, titulo, aviso FROM pesquisa_modelo WHERE codigo = 'SATISFACAO' AND ativo = 1 ORDER BY versao DESC");
  if (!modelo) throw erros.indisponivel('O modelo da pesquisa de satisfação não está configurado.');
  const perguntas = await executor.consultar(
    'SELECT id, codigo, ordem, tipo, texto FROM pesquisa_pergunta WHERE modelo_id = @id ORDER BY ordem', { id: modelo.id });
  return { ...modelo, perguntas };
}

const modeloPublico = (m) => ({
  id: m.id, codigo: m.codigo, versao: m.versao, titulo: m.titulo, aviso: m.aviso,
  perguntas: m.perguntas.map((p) => ({ codigo: p.codigo, ordem: p.ordem, tipo: p.tipo, texto: p.texto })),
});

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

async function itensDe(executor, respostaIds) {
  if (!respostaIds.length) return new Map();
  const linhas = await executor.consultar(
    `SELECT i.resposta_id, p.codigo, p.tipo, p.ordem, i.valor_num, i.valor_texto, i.prefere_nao_responder
       FROM pesquisa_resposta_item i JOIN pesquisa_pergunta p ON p.id = i.pergunta_id
      WHERE i.resposta_id IN (${respostaIds.map((_, k) => `@r${k}`).join(', ')}) ORDER BY p.ordem`,
    Object.fromEntries(respostaIds.map((id, k) => [`r${k}`, id])));
  const mapa = new Map();
  for (const l of linhas) {
    if (!mapa.has(l.respostaId)) mapa.set(l.respostaId, []);
    mapa.get(l.respostaId).push({
      codigo: l.codigo, tipo: l.tipo, valorNum: l.valorNum, valorTexto: l.valorTexto, preferNaoResponder: !!l.prefereNaoResponder, // coluna prefere_nao_responder
    });
  }
  return mapa;
}

const formatarResposta = (r, itens, { comItens = false } = {}) => ({
  id: r.id,
  momento: r.momento,
  dataAplicacao: r.dataAplicacao,
  situacao: r.situacao,
  modo: r.modo,
  consentimentoLido: !!r.consentimentoLido,
  comentarioOculto: !!r.comentarioOculto,
  modeloId: r.modeloId,
  modeloVersao: r.modeloVersao,
  autor: { id: r.usuarioId, nome: r.autorNome },
  criadoEm: r.criadoEm,
  resumo: r.situacao === 'CONCLUIDA' ? regras.resumoPesquisa(itens) : null,
  ...(comItens ? { itens } : {}),
});

const SELECT_RESPOSTA = `SELECT r.id, r.modelo_id, m.versao AS modelo_versao, r.momento, r.data_aplicacao, r.modo, r.situacao,
       r.consentimento_lido, r.comentario_oculto, r.usuario_id, u.nome AS autor_nome, r.criado_em
  FROM pesquisa_resposta r
  JOIN pesquisa_modelo m ON m.id = r.modelo_id
  JOIN usuario u ON u.id = r.usuario_id`;

async function listar(req, acompanhamentoId) {
  const ac = await familias.carregarAcompanhamento(req, acompanhamentoId);
  const hoje = familias.hojeIso();
  const [modelo, pendencia, cfg] = await Promise.all([carregarModelo({ consultar, consultarUm }), regras.lerPendencia(ac, hoje), regras.lerConfig()]);
  const base = {
    acompanhamentoId: ac.id, status: ac.status,
    modelo: modeloPublico(modelo), pendencia, intervaloDias: cfg.intervaloDias, pesquisas: [],
  };
  const linhas = await consultar(
    `${SELECT_RESPOSTA} WHERE r.acompanhamento_id = @id AND r.situacao <> 'ANULADA' ORDER BY r.data_aplicacao DESC, r.id DESC`, { id: ac.id });
  const itens = await itensDe({ consultar }, linhas.filter((l) => l.situacao === 'CONCLUIDA').map((l) => l.id));
  return {
    ...base,
    pesquisas: linhas.map((l) => formatarResposta(l, itens.get(l.id) || [])).map((p, i) => ({
      ...p, podeAlterar: linhas[i].usuarioId === req.usuario.id || ehCoordenacao(req.usuario),
    })),
  };
}

async function obter(req, acompanhamentoId, respostaId) {
  const ac = await familias.carregarAcompanhamento(req, acompanhamentoId);
  const id = inteiroPositivo(respostaId);
  const r = id && await consultarUm(`${SELECT_RESPOSTA} WHERE r.id = @id AND r.acompanhamento_id = @ac AND r.situacao <> 'ANULADA'`, { id, ac: ac.id });
  if (!r) throw erros.naoEncontrado('Pesquisa não encontrada.');
  const [modelo, mapa] = await Promise.all([carregarModelo({ consultar, consultarUm }, { id: r.modeloId }), itensDe({ consultar }, [r.id])]);
  const itens = mapa.get(r.id) || [];
  return {
    ...formatarResposta(r, itens, { comItens: true }),
    modelo: modeloPublico(modelo),
    podeAlterar: r.usuarioId === req.usuario.id || ehCoordenacao(req.usuario),
  };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

// Regras de momento: FINAL ao encerrar (final concluído ou acompanhamento encerrado); SEMESTRAL só em andamento; AVULSA livre.
async function exigirMomentoPermitido(tx, ac, momento) {
  if (momento === 'SEMESTRAL' && ac.status !== 'EM_ANDAMENTO') {
    throw erros.conflito('A pesquisa semestral só se aplica a acompanhamentos em andamento.');
  }
  if (momento === 'FINAL' && ac.status === 'EM_ANDAMENTO') {
    const q = await tx.consultarUm(
      "SELECT 1 AS ok FROM questionario WHERE acompanhamento_id = @id AND tipo = 'FINAL' AND concluido = 1", { id: ac.id });
    if (!q) throw erros.conflito('A pesquisa final é aplicada ao encerrar: conclua antes o questionário final (ou use a pesquisa avulsa).');
  }
}

async function gravarItens(tx, respostaId, itens) {
  await tx.consultar('DELETE FROM pesquisa_resposta_item WHERE resposta_id = @id', { id: respostaId });
  for (const it of itens) {
    await tx.consultar(
      `INSERT INTO pesquisa_resposta_item (resposta_id, pergunta_id, valor_num, valor_texto, prefere_nao_responder)
       VALUES (@r, @p, @n, @t, @x)`,
      { r: respostaId, p: it.perguntaId, n: it.valorNum, t: it.valorTexto, x: it.preferNaoResponder });
  }
}

// Cria (respostaId = null) ou atualiza um RASCUNHO. Devolve { id, situacao }.
async function salvar(req, acompanhamentoId, respostaId, corpo) {
  const hoje = familias.hojeIso();
  return transacao(async (tx) => {
    const ac = await familias.carregarAcompanhamento(req, acompanhamentoId, tx, { travar: true });

    let existente = null;
    if (respostaId !== null) {
      const id = inteiroPositivo(respostaId);
      existente = id && await tx.consultarUm(
        `SELECT id, modelo_id, usuario_id, situacao, momento FROM pesquisa_resposta
          WHERE id = @id AND acompanhamento_id = @ac AND situacao <> 'ANULADA'`, { id, ac: ac.id });
      if (!existente) throw erros.naoEncontrado('Pesquisa não encontrada.');
      if (existente.situacao !== 'RASCUNHO') throw erros.conflito('Esta pesquisa já foi concluída. Para corrigir, anule e aplique novamente.');
      exigirAutorOuCoordenacao(req, existente);
    }
    const modelo = await carregarModelo(tx, { id: existente?.modeloId ?? null });
    const { dados, erros: problemas } = regras.validarPesquisa(
      { ...corpo, momento: existente ? existente.momento : corpo.momento },
      { hoje, dataInicio: isoData(ac.dataInicio), perguntas: modelo.perguntas });
    lancarSeErros(problemas);

    if (!existente) {
      await exigirMomentoPermitido(tx, ac, dados.momento);
      const aberta = await tx.consultarUm(
        "SELECT id FROM pesquisa_resposta WHERE acompanhamento_id = @ac AND momento = @m AND situacao = 'RASCUNHO'", { ac: ac.id, m: dados.momento });
      if (aberta) throw erros.conflito('Já existe uma pesquisa em andamento (rascunho) para este momento. Continue ou descarte o rascunho.', { respostaId: aberta.id });
      if (dados.momento === 'FINAL') {
        const feita = await tx.consultarUm(
          "SELECT id FROM pesquisa_resposta WHERE acompanhamento_id = @ac AND momento = 'FINAL' AND situacao IN ('CONCLUIDA', 'RECUSADA')", { ac: ac.id });
        if (feita) throw erros.conflito('A pesquisa final desta família já foi registrada. Para refazer, anule a anterior.');
      }
    }

    let id = existente?.id;
    if (!existente) {
      const [novo] = await tx.consultar(
        `INSERT INTO pesquisa_resposta (modelo_id, acompanhamento_id, usuario_id, momento, data_aplicacao, modo, situacao, consentimento_lido, criado_por)
         OUTPUT INSERTED.id
         VALUES (@modelo, @ac, @usuario, @momento, @data, @modo, @situacao, @consent, @usuario)`,
        {
          modelo: modelo.id, ac: ac.id, usuario: req.usuario.id, momento: dados.momento, data: paramData(dados.dataAplicacao),
          modo: dados.modo, situacao: dados.situacao, consent: dados.consentimentoLido,
        });
      id = novo.id;
    } else {
      await tx.consultar(
        `UPDATE pesquisa_resposta SET data_aplicacao = @data, modo = @modo, situacao = @situacao, consentimento_lido = @consent,
                alterado_por = @usuario, alterado_em = SYSUTCDATETIME()
          WHERE id = @id`,
        { id, usuario: req.usuario.id, data: paramData(dados.dataAplicacao), modo: dados.modo, situacao: dados.situacao, consent: dados.consentimentoLido });
    }
    await gravarItens(tx, id, dados.situacao === 'RECUSADA' ? [] : dados.itens);
    // sem respostas nem comentários na auditoria (dado pessoal): só o fato
    await registrarAuditoria(req, existente ? 'ALTERAR' : 'CRIAR', 'pesquisa_resposta', id,
      { acompanhamentoId: ac.id, momento: dados.momento, situacao: dados.situacao }, tx);
    return { id, situacao: dados.situacao };
  });
}

async function anular(req, acompanhamentoId, respostaId, corpo) {
  const motivo = texto(corpo.motivo, 200);
  if (!motivo) throw erros.validacao({ motivo: 'Informe o motivo da anulação.' });
  await transacao(async (tx) => {
    const ac = await familias.carregarAcompanhamento(req, acompanhamentoId, tx, { travar: true });
    const id = inteiroPositivo(respostaId);
    const r = id && await tx.consultarUm(
      "SELECT id, usuario_id FROM pesquisa_resposta WHERE id = @id AND acompanhamento_id = @ac AND situacao <> 'ANULADA'", { id, ac: ac.id });
    if (!r) throw erros.naoEncontrado('Pesquisa não encontrada.');
    exigirAutorOuCoordenacao(req, r);
    await tx.consultar(
      `UPDATE pesquisa_resposta SET situacao = 'ANULADA', anulado_em = SYSUTCDATETIME(), anulado_por = @usuario, anulado_motivo = @motivo,
              alterado_por = @usuario, alterado_em = SYSUTCDATETIME()
        WHERE id = @id`,
      { id: r.id, usuario: req.usuario.id, motivo });
    await registrarAuditoria(req, 'EXCLUIR', 'pesquisa_resposta', r.id, { acompanhamentoId: ac.id, anulada: true }, tx);
  });
}

// Coordenação oculta (ou volta a mostrar) o comentário da pesquisa nos relatórios.
async function definirComentarioOculto(req, acompanhamentoId, respostaId, oculto) {
  if (typeof oculto !== 'boolean') throw erros.validacao({ oculto: 'Informe true ou false.' });
  await transacao(async (tx) => {
    const ac = await familias.carregarAcompanhamento(req, acompanhamentoId, tx);
    const id = inteiroPositivo(respostaId);
    const r = id && await tx.consultarUm(
      "SELECT id FROM pesquisa_resposta WHERE id = @id AND acompanhamento_id = @ac AND situacao = 'CONCLUIDA'", { id, ac: ac.id });
    if (!r) throw erros.naoEncontrado('Pesquisa não encontrada.');
    await tx.consultar(
      'UPDATE pesquisa_resposta SET comentario_oculto = @o, alterado_por = @usuario, alterado_em = SYSUTCDATETIME() WHERE id = @id',
      { id: r.id, o: oculto, usuario: req.usuario.id });
    await registrarAuditoria(req, 'ALTERAR', 'pesquisa_resposta', r.id, { comentarioOculto: oculto }, tx);
  });
}

// ---------------------------------------------------------------------------
// Para a linha do tempo: pesquisas CONCLUIDA/RECUSADA com o resumo (todos os perfis com acesso ao acompanhamento)
// ---------------------------------------------------------------------------

async function paraLinhaDoTempo(req, acId) {
  const linhas = await consultar(
    `${SELECT_RESPOSTA} WHERE r.acompanhamento_id = @id AND r.situacao IN ('CONCLUIDA', 'RECUSADA')`, { id: acId });
  const itens = await itensDe({ consultar }, linhas.filter((l) => l.situacao === 'CONCLUIDA').map((l) => l.id));
  return linhas.map((l) => ({
    id: l.id, momento: l.momento, dataAplicacao: l.dataAplicacao, situacao: l.situacao, criadoEm: l.criadoEm, autorNome: l.autorNome,
    resumo: l.situacao === 'CONCLUIDA' ? regras.resumoPesquisa(itens.get(l.id) || []) : null,
    comentarios: (itens.get(l.id) || []).filter((i) => i.tipo === 'TEXTO' && i.valorTexto).map((i) => ({ codigo: i.codigo, texto: i.valorTexto })),
  }));
}

module.exports = {
  listar, obter, salvar, anular, definirComentarioOculto, paraLinhaDoTempo,
};
