'use strict';

// Regras e consultas do módulo Visitas e Ações (rotas em routes/acoes.js).

const { consultar, consultarUm, tipos } = require('../db');
const { clausulaUnidades, unidadesPermitidas, exigirUnidade } = require('../middlewares/auth');
const { erros } = require('../lib/erros');
const { STATUS_ACAO, PERFIS } = require('../lib/dominios');
const { texto, normalizarData, inteiroPositivo, lancarSeErros } = require('../lib/validacao');

const MAX_TEMAS = 4;
const LIMITE_LISTAGEM = 1000;

function escaparLike(valor) {
  return String(valor).replace(/[\\%_[]/g, (c) => `\\${c}`);
}

// ---------- Validação do corpo (criação/edição) ----------

// `atual` = registro existente (edição): aceita tipo/tema já vinculados e hoje inativos.
async function validarCorpo(req, corpo, { atual, temasAtuais = [] } = {}) {
  const problemas = {};
  const dados = {};

  dados.dataAcao = normalizarData(corpo.dataAcao);
  if (!dados.dataAcao) problemas.dataAcao = 'Informe uma data válida.';

  dados.tipoAcaoId = inteiroPositivo(corpo.tipoAcaoId);
  if (!dados.tipoAcaoId) problemas.tipoAcaoId = 'Selecione o tipo.';
  else {
    const tipo = await consultarUm('SELECT id, ativo FROM tipo_acao WHERE id = @id', { id: dados.tipoAcaoId });
    if (!tipo || (!tipo.ativo && dados.tipoAcaoId !== atual?.tipoAcaoId)) problemas.tipoAcaoId = 'Tipo inválido.';
  }

  dados.instituicaoLocal = texto(corpo.instituicaoLocal, 200);
  dados.endereco = texto(corpo.endereco, 200);
  dados.descricao = texto(corpo.descricao);

  dados.status = String(corpo.status ?? 'PLANEJADA').toUpperCase();
  if (!STATUS_ACAO.includes(dados.status)) problemas.status = 'Status inválido.';

  const qtdBruta = corpo.qtdParticipantes;
  if (qtdBruta === undefined || qtdBruta === null || String(qtdBruta).trim() === '') dados.qtdParticipantes = null;
  else {
    const n = Number(qtdBruta);
    if (!Number.isInteger(n) || n < 0 || n > 100000) problemas.qtdParticipantes = 'Informe um número inteiro maior ou igual a zero.';
    else dados.qtdParticipantes = n;
  }
  if (dados.status === 'REALIZADA' && dados.qtdParticipantes === null && !problemas.qtdParticipantes) {
    problemas.qtdParticipantes = 'Informe a quantidade de participantes para marcar como realizada.';
  }

  const brutos = corpo.temaIds === undefined || corpo.temaIds === null ? [] : corpo.temaIds;
  if (!Array.isArray(brutos)) problemas.temaIds = 'Lista de temas inválida.';
  else {
    const ids = brutos.map(inteiroPositivo);
    if (ids.some((i) => !i)) problemas.temaIds = 'Tema inválido.';
    else if (new Set(ids).size !== ids.length) problemas.temaIds = 'Há temas repetidos.';
    else if (ids.length > MAX_TEMAS) problemas.temaIds = `Selecione no máximo ${MAX_TEMAS} temas.`;
    else if (ids.length) {
      const params = {};
      const nomes = ids.map((id, i) => { params[`t${i}`] = id; return `@t${i}`; });
      const validos = await consultar(`SELECT id, ativo FROM tema WHERE id IN (${nomes.join(', ')})`, params);
      const aceitos = validos.filter((t) => t.ativo || temasAtuais.includes(t.id));
      if (aceitos.length !== ids.length) problemas.temaIds = 'Tema inválido.';
      else dados.temaIds = ids;
    } else dados.temaIds = [];
  }

  // Unidade: na criação é resolvida pela rota; na edição só muda se informada e permitida.
  if (atual) {
    if (corpo.unidadeId !== undefined && corpo.unidadeId !== null && corpo.unidadeId !== '') {
      dados.unidadeId = exigirUnidade(req, corpo.unidadeId);
    } else dados.unidadeId = atual.unidadeId;
  }

  lancarSeErros(problemas);
  return dados;
}

// ---------- Consultas ----------

const COLUNAS_ACAO = `
  a.id, a.unidade_id, un.sigla AS unidade_sigla, un.nome AS unidade_nome,
  a.tipo_acao_id, ta.nome AS tipo_acao_nome, a.data_acao, a.instituicao_local, a.endereco,
  a.status, a.qtd_participantes, a.descricao, a.criado_por, a.criado_em, a.alterado_em`;
const JUNCOES_ACAO = `
  FROM acao_visita a
  JOIN unidade un ON un.id = a.unidade_id
  JOIN tipo_acao ta ON ta.id = a.tipo_acao_id`;

function filtroUnidadeOpcional(req, valor, params, filtros) {
  if (!valor) return;
  const unidadeId = inteiroPositivo(valor);
  if (!unidadeId || !unidadesPermitidas(req).includes(unidadeId)) throw erros.proibido('Você não tem acesso a esta unidade.');
  filtros.push('a.unidade_id = @filtroUnidade');
  params.filtroUnidade = unidadeId;
}

function filtroData(valor, campo, operador, params, filtros) {
  if (!valor) return;
  const d = normalizarData(valor);
  if (!d) throw erros.validacao({ [campo]: 'Data inválida.' });
  filtros.push(`a.data_acao ${operador} @${campo}`);
  params[campo] = [tipos.Date, d];
}

function montarFiltros(req, query, params) {
  const filtros = [clausulaUnidades(req, 'a.unidade_id', params)];
  filtroUnidadeOpcional(req, query.unidadeId, params, filtros);
  filtroData(query.inicio, 'inicio', '>=', params, filtros);
  filtroData(query.fim, 'fim', '<=', params, filtros);

  if (query.status) {
    const s = String(query.status).toUpperCase();
    if (!STATUS_ACAO.includes(s)) throw erros.validacao({ status: 'Status inválido.' });
    filtros.push('a.status = @filtroStatus');
    params.filtroStatus = s;
  }
  if (query.tipoAcaoId) {
    const id = inteiroPositivo(query.tipoAcaoId);
    if (!id) throw erros.validacao({ tipoAcaoId: 'Tipo inválido.' });
    filtros.push('a.tipo_acao_id = @filtroTipo');
    params.filtroTipo = id;
  }
  if (query.temaId) {
    const id = inteiroPositivo(query.temaId);
    if (!id) throw erros.validacao({ temaId: 'Tema inválido.' });
    filtros.push('EXISTS (SELECT 1 FROM acao_visita_tema avt WHERE avt.acao_visita_id = a.id AND avt.tema_id = @filtroTema)');
    params.filtroTema = id;
  }
  const busca = texto(query.q, 100);
  if (busca) {
    filtros.push("(a.instituicao_local LIKE @busca ESCAPE '\\' OR a.endereco LIKE @busca ESCAPE '\\' OR a.descricao LIKE @busca ESCAPE '\\')");
    params.busca = `%${escaparLike(busca)}%`;
  }
  return filtros;
}

async function listar(req) {
  const params = {};
  const where = montarFiltros(req, req.query, params).join(' AND ');
  const direcao = String(req.query.ordem).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const acoes = await consultar(
    `SELECT TOP (${LIMITE_LISTAGEM}) ${COLUNAS_ACAO},
            (SELECT COUNT(*) FROM acao_visita_foto f WHERE f.acao_visita_id = a.id) AS qtd_fotos
       ${JUNCOES_ACAO}
      WHERE ${where}
      ORDER BY a.data_acao ${direcao}, a.id ${direcao}`,
    params,
  );
  if (!acoes.length) return [];

  const temas = await consultar(
    `SELECT avt.acao_visita_id, avt.ordem, tm.id AS tema_id, tm.nome
       FROM acao_visita_tema avt
       JOIN tema tm ON tm.id = avt.tema_id
       JOIN acao_visita a ON a.id = avt.acao_visita_id
      WHERE ${where}
      ORDER BY avt.acao_visita_id, avt.ordem`,
    params,
  );
  const porAcao = new Map();
  for (const t of temas) {
    if (!porAcao.has(t.acaoVisitaId)) porAcao.set(t.acaoVisitaId, []);
    porAcao.get(t.acaoVisitaId).push({ id: t.temaId, nome: t.nome, ordem: t.ordem });
  }
  return acoes.map((a) => ({ ...a, temas: porAcao.get(a.id) || [] }));
}

// Carrega uma ação de unidade permitida; outra unidade => 404.
async function carregarAcao(req, id) {
  const acaoId = inteiroPositivo(id);
  if (!acaoId) throw erros.naoEncontrado();
  const params = { id: acaoId };
  const where = clausulaUnidades(req, 'a.unidade_id', params);
  const acao = await consultarUm(
    `SELECT ${COLUNAS_ACAO}, u.nome AS criado_por_nome ${JUNCOES_ACAO}
       LEFT JOIN usuario u ON u.id = a.criado_por
      WHERE a.id = @id AND ${where}`,
    params,
  );
  if (!acao) throw erros.naoEncontrado();
  return acao;
}

function podeExcluir(req, acao) {
  return [PERFIS.COORDENADOR, PERFIS.ADMIN].includes(req.usuario.perfil) || acao.criadoPor === req.usuario.id;
}

async function detalhar(req, id) {
  const acao = await carregarAcao(req, id);
  const [temas, fotos] = await Promise.all([
    consultar(
      `SELECT tm.id, tm.nome, avt.ordem FROM acao_visita_tema avt JOIN tema tm ON tm.id = avt.tema_id
        WHERE avt.acao_visita_id = @id ORDER BY avt.ordem`, { id: acao.id }),
    consultar(
      `SELECT id, legenda, ordem, nome_original, criado_em FROM acao_visita_foto
        WHERE acao_visita_id = @id ORDER BY ordem, id`, { id: acao.id }),
  ]);
  return {
    ...acao,
    temas,
    fotos: fotos.map((f) => ({ ...f, url: `/api/acoes/${acao.id}/fotos/${f.id}` })),
    podeExcluir: podeExcluir(req, acao),
  };
}

async function gravarTemas(tx, acaoId, temaIds) {
  await tx.consultar('DELETE FROM acao_visita_tema WHERE acao_visita_id = @id', { id: acaoId });
  for (let i = 0; i < temaIds.length; i++) {
    await tx.consultar(
      'INSERT INTO acao_visita_tema (acao_visita_id, ordem, tema_id) VALUES (@id, @ordem, @temaId)',
      { id: acaoId, ordem: i + 1, temaId: temaIds[i] },
    );
  }
}

// Resumo por unidade (ações REALIZADAS no período) para relatórios e painel.
async function resumo(req) {
  const params = {};
  const filtros = [clausulaUnidades(req, 'a.unidade_id', params), "a.status = 'REALIZADA'"];
  filtroData(req.query.inicio, 'inicio', '>=', params, filtros);
  filtroData(req.query.fim, 'fim', '<=', params, filtros);
  filtroUnidadeOpcional(req, req.query.unidadeId, params, filtros);
  const where = filtros.join(' AND ');

  const [totais, locais] = await Promise.all([
    consultar(
      `SELECT a.unidade_id, COUNT(*) AS qtd_acoes, COALESCE(SUM(a.qtd_participantes), 0) AS qtd_participantes
         FROM acao_visita a WHERE ${where} GROUP BY a.unidade_id`, params),
    consultar(
      `SELECT DISTINCT a.unidade_id, a.instituicao_local
         FROM acao_visita a WHERE ${where} AND a.instituicao_local IS NOT NULL
        ORDER BY a.unidade_id, a.instituicao_local`, params),
  ]);
  const unidades = params.filtroUnidade
    ? req.usuario.unidades.filter((u) => u.id === params.filtroUnidade)
    : req.usuario.unidades;
  return unidades.map((u) => {
    const t = totais.find((x) => x.unidadeId === u.id);
    return {
      unidadeId: u.id,
      sigla: u.sigla,
      nome: u.nome,
      qtdAcoes: t ? t.qtdAcoes : 0,
      qtdParticipantes: t ? t.qtdParticipantes : 0,
      instituicoes: locais.filter((l) => l.unidadeId === u.id).map((l) => l.instituicaoLocal),
    };
  });
}

module.exports = {
  MAX_TEMAS, validarCorpo, listar, carregarAcao, detalhar, podeExcluir, gravarTemas, resumo,
};
