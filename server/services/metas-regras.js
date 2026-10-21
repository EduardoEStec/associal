'use strict';

// Plano de metas (F4): regras puras (validação, alerta "sem meta") e leitura de pendências.
// Sem dependência de server/services/familias.js (usado por ele, para o campo `metas` da ficha).

const { consultar } = require('../db');
const { clausulaUnidades } = require('../middlewares/auth');
const { normalizarData, texto } = require('../lib/validacao');

const DIMENSOES = Object.freeze({
  ALIMENTACAO: 'Alimentação', RENDA: 'Renda', ECONOMIA: 'Economia', AUTONOMIA: 'Autonomia', OUTRA: 'Outra',
});
const STATUS_META = Object.freeze(['EM_ANDAMENTO', 'ATINGIDA', 'NAO_ATINGIDA', 'CANCELADA']);
const AVANCOS = Object.freeze(['AVANCOU', 'SEM_MUDANCA', 'RETROCEDEU']);
const SEM_META_PADRAO_DIAS = 30;
const MAX_DESCRICAO = 300;
const MAX_METAS_POR_REGISTRO = 10;

const isoData = (valor) => (valor ? new Date(valor).toISOString().slice(0, 10) : null);
const diasEntre = (deIso, ateIso) =>
  Math.round((new Date(`${ateIso}T00:00:00Z`) - new Date(`${deIso}T00:00:00Z`)) / 86400000);

// ---------------------------------------------------------------------------
// Validação da meta
// ---------------------------------------------------------------------------

// `existente`: meta atual na edição ({ status, concluidaEm }); sem ela é criação (nasce EM_ANDAMENTO).
// Devolve { erros, dados }.
function validarMeta(corpo, { hoje, dataInicio, existente = null }) {
  const problemas = {};

  const dimensao = corpo.dimensao;
  if (!Object.keys(DIMENSOES).includes(dimensao)) problemas.dimensao = 'Escolha a dimensão da meta.';

  const descricao = texto(corpo.descricao, MAX_DESCRICAO + 1);
  if (!descricao) problemas.descricao = 'Descreva a meta.';
  else if (descricao.length > MAX_DESCRICAO) problemas.descricao = `Use no máximo ${MAX_DESCRICAO} caracteres.`;

  let prazo = normalizarData(corpo.prazo);
  if (prazo === undefined) { problemas.prazo = 'Informe uma data válida.'; prazo = null; }
  else if (prazo && dataInicio && prazo < dataInicio) problemas.prazo = 'O prazo não pode ser anterior ao início do acompanhamento.';

  let status = corpo.status === undefined || corpo.status === null || corpo.status === '' ? (existente ? existente.status : 'EM_ANDAMENTO') : corpo.status;
  if (!STATUS_META.includes(status)) { problemas.status = 'Situação da meta inválida.'; status = 'EM_ANDAMENTO'; }
  if (!existente && status !== 'EM_ANDAMENTO') { problemas.status = 'A meta nova começa em andamento.'; status = 'EM_ANDAMENTO'; }

  let concluidaEm = null;
  if (status !== 'EM_ANDAMENTO') {
    const informada = normalizarData(corpo.concluidaEm);
    if (informada === undefined) problemas.concluidaEm = 'Informe uma data válida.';
    else {
      const padrao = existente && existente.status !== 'EM_ANDAMENTO' && existente.concluidaEm ? isoData(existente.concluidaEm) : hoje;
      concluidaEm = informada || padrao;
      if (concluidaEm > hoje) problemas.concluidaEm = 'A data de encerramento da meta não pode ser futura.';
      else if (dataInicio && concluidaEm < dataInicio) problemas.concluidaEm = 'A data não pode ser anterior ao início do acompanhamento.';
    }
  }

  return { erros: problemas, dados: { dimensao, descricao, prazo, status, concluidaEm } };
}

// `lista`: corpo.metas de um registro de contato. `abertas`: ids das metas que podem receber avanço.
// Devolve { erros, itens: [{ metaId, avanco }] }. Sem contato (tentativa) nenhuma meta é gravada.
function validarMetasDoRegistro(lista, { houveContato, abertas }) {
  if (lista === undefined || lista === null || !houveContato) return { erros: {}, itens: [] };
  if (!Array.isArray(lista)) return { erros: { metas: 'Lista de metas inválida.' }, itens: [] };
  if (lista.length > MAX_METAS_POR_REGISTRO) return { erros: { metas: 'Metas demais neste contato.' }, itens: [] };
  const itens = [];
  const vistos = new Set();
  for (const x of lista) {
    const metaId = Number(x?.metaId);
    if (!Number.isInteger(metaId) || !abertas.includes(metaId)) return { erros: { metas: 'Meta não encontrada ou já encerrada.' }, itens: [] };
    if (!AVANCOS.includes(x.avanco)) return { erros: { metas: 'Informe como a meta evoluiu.' }, itens: [] };
    if (vistos.has(metaId)) return { erros: { metas: 'Meta repetida.' }, itens: [] };
    vistos.add(metaId);
    itens.push({ metaId, avanco: x.avanco });
  }
  return { erros: {}, itens };
}

// ---------------------------------------------------------------------------
// Alerta "família sem meta"
// ---------------------------------------------------------------------------

// Acompanhamento em andamento SEM nenhuma meta em andamento há MAIS de `dias` dias, contados do início ou
// da última meta encerrada (a mais recente das datas). Exatamente `dias` ainda não alerta. Devolve null ou { desde, dias, limiteDias }.
function calcularSemMeta({ status, dataInicio, metas, hoje, dias = SEM_META_PADRAO_DIAS }) {
  if (status !== 'EM_ANDAMENTO') return null;
  if (metas.some((m) => m.status === 'EM_ANDAMENTO')) return null;
  const inicio = isoData(dataInicio);
  const ultima = metas.map((m) => isoData(m.concluidaEm)).filter(Boolean).sort().pop();
  const desde = ultima && ultima > inicio ? ultima : inicio;
  const passados = diasEntre(desde, hoje);
  return passados > dias ? { desde, dias: passados, limiteDias: dias } : null;
}

async function lerConfig(executor = { consultar }) {
  const linhas = await executor.consultar("SELECT valor FROM configuracao WHERE chave = 'alerta_sem_meta_dias'");
  const v = Number(linhas[0]?.valor);
  return { semMetaDias: Number.isInteger(v) && v > 0 ? v : SEM_META_PADRAO_DIAS };
}

// Resumo de UM acompanhamento já carregado (com escopo de unidade): contagens e alerta.
async function lerResumo(ac, hoje) {
  const [cfg, metas] = await Promise.all([
    lerConfig(),
    consultar('SELECT status, concluida_em, prazo FROM acompanhamento_meta WHERE acompanhamento_id = @id', { id: ac.id }),
  ]);
  const conta = (s) => metas.filter((m) => m.status === s).length;
  return {
    emAndamento: conta('EM_ANDAMENTO'), atingidas: conta('ATINGIDA'), naoAtingidas: conta('NAO_ATINGIDA'), canceladas: conta('CANCELADA'),
    vencidas: metas.filter((m) => m.status === 'EM_ANDAMENTO' && m.prazo && isoData(m.prazo) < hoje).length,
    semMeta: calcularSemMeta({ status: ac.status, dataInicio: ac.dataInicio, metas, hoje, dias: cfg.semMetaDias }),
  };
}

// Famílias sem meta nas unidades permitidas (tela Início). Mais antigas primeiro.
async function listarSemMeta(req, hoje, unidadeId = null) {
  const cfg = await lerConfig();
  const params = {};
  const filtros = [clausulaUnidades(req, 'ac.unidade_id', params)];
  if (unidadeId) { filtros.push('ac.unidade_id = @unidadeFiltro'); params.unidadeFiltro = unidadeId; }
  const acs = await consultar(
    `SELECT ac.id AS acompanhamento_id, ac.unidade_id, un.sigla AS unidade_sigla, pe.nome AS responsavel_nome, ac.data_inicio,
            (SELECT COUNT(*) FROM acompanhamento_meta m WHERE m.acompanhamento_id = ac.id AND m.status = 'EM_ANDAMENTO') AS metas_abertas,
            (SELECT MAX(m.concluida_em) FROM acompanhamento_meta m WHERE m.acompanhamento_id = ac.id) AS ultima_conclusao
       FROM acompanhamento ac
       JOIN unidade un ON un.id = ac.unidade_id
       JOIN familia f ON f.id = ac.familia_id
       JOIN pessoa pe ON pe.id = f.responsavel_pessoa_id
      WHERE ${filtros.join(' AND ')} AND ac.status = 'EM_ANDAMENTO'`,
    params);
  const saida = [];
  for (const a of acs) {
    if (a.metasAbertas > 0) continue;
    const metas = a.ultimaConclusao ? [{ status: 'CANCELADA', concluidaEm: a.ultimaConclusao }] : [];
    const r = calcularSemMeta({ status: 'EM_ANDAMENTO', dataInicio: a.dataInicio, metas, hoje, dias: cfg.semMetaDias });
    if (r) {
      saida.push({
        acompanhamentoId: a.acompanhamentoId, unidadeId: a.unidadeId, unidadeSigla: a.unidadeSigla,
        responsavelNome: a.responsavelNome, semMetaDesde: r.desde, diasSemMeta: r.dias,
      });
    }
  }
  return saida.sort((x, y) => y.diasSemMeta - x.diasSemMeta || x.responsavelNome.localeCompare(y.responsavelNome));
}

module.exports = {
  DIMENSOES, STATUS_META, AVANCOS, MAX_DESCRICAO, SEM_META_PADRAO_DIAS,
  validarMeta, validarMetasDoRegistro, calcularSemMeta, lerConfig, lerResumo, listarSemMeta,
};
