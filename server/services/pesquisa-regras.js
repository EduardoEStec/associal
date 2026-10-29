'use strict';

// Pesquisa de satisfação (F3): regras puras (validação, resumo/NPS, pendência) e leitura de pendências.
// Sem dependência de server/services/familias.js (usado por ele, para o campo `pesquisa` da ficha).

const { consultar, consultarUm, tipos } = require('../db');
const { clausulaUnidades } = require('../middlewares/auth');
const { normalizarData, texto } = require('../lib/validacao');

const MOMENTOS = Object.freeze(['FINAL', 'SEMESTRAL', 'AVULSA']);
const MODOS = Object.freeze(['FAMILIA_FALOU', 'FAMILIA_PREENCHEU', 'COM_AJUDA']);
const SITUACOES_ESCRITA = Object.freeze(['RASCUNHO', 'CONCLUIDA', 'RECUSADA']);
const INTERVALO_PADRAO_DIAS = 180;
const PRAZO_FINAL_PADRAO_DIAS = 60;
const MAX_TEXTO = 1000;

const isoData = (valor) => (valor ? new Date(valor).toISOString().slice(0, 10) : null);
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (deIso, ateIso) =>
  Math.round((new Date(`${ateIso}T00:00:00Z`) - new Date(`${deIso}T00:00:00Z`)) / 86400000);

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

// `perguntas`: [{ id, codigo, tipo }] do modelo da resposta. Devolve { erros, dados }.
//   RASCUNHO: salva o que houver (o consentimento já precisa ter sido lido);
//   CONCLUIDA: nota geral e as 6 afirmações precisam de resposta ou de "prefere não responder"; os textos são opcionais;
//   RECUSADA: a família preferiu não responder (nenhum item é guardado).
function validarPesquisa(corpo, { hoje, dataInicio, perguntas }) {
  const problemas = {};

  const situacao = corpo.situacao;
  if (!SITUACOES_ESCRITA.includes(situacao)) problemas.situacao = 'Situação da pesquisa inválida.';

  const momento = corpo.momento;
  if (!MOMENTOS.includes(momento)) problemas.momento = 'Momento da pesquisa inválido.';

  let dataAplicacao = normalizarData(corpo.dataAplicacao || hoje);
  if (dataAplicacao === undefined) problemas.dataAplicacao = 'Informe uma data válida.';
  else if (dataAplicacao > hoje) problemas.dataAplicacao = 'A data da aplicação não pode ser futura.';
  else if (dataInicio && dataAplicacao < dataInicio) problemas.dataAplicacao = 'A data não pode ser anterior ao início do acompanhamento.';
  dataAplicacao = dataAplicacao || hoje;

  const recusada = situacao === 'RECUSADA';
  const consentimentoLido = recusada ? false : corpo.consentimentoLido === true;
  if (!recusada && SITUACOES_ESCRITA.includes(situacao) && !consentimentoLido) {
    problemas.consentimentoLido = 'Leia o aviso à família e confirme que ela concordou em responder.';
  }

  let modo = corpo.modo || null;
  if (recusada) modo = null;
  else if (modo !== null && !MODOS.includes(modo)) { problemas.modo = 'Escolha como a pesquisa foi respondida.'; modo = null; }
  if (situacao === 'CONCLUIDA' && !modo && !problemas.modo) problemas.modo = 'Informe como a pesquisa foi respondida.';

  // itens
  const porCodigo = new Map(perguntas.map((p) => [p.codigo, p]));
  const itens = new Map();
  if (!recusada) {
    if (corpo.itens !== undefined && !Array.isArray(corpo.itens)) problemas.itens = 'Itens inválidos.';
    for (const it of Array.isArray(corpo.itens) ? corpo.itens : []) {
      const p = porCodigo.get(it?.codigo);
      if (!p) { problemas.itens = `Pergunta desconhecida: ${String(it?.codigo).slice(0, 20)}.`; continue; }
      const chave = `itens.${p.codigo}`;
      if (it.preferNaoResponder === true) {
        itens.set(p.codigo, { perguntaId: p.id, valorNum: null, valorTexto: null, preferNaoResponder: true });
        continue;
      }
      if (p.tipo === 'TEXTO') {
        const t = texto(it.valorTexto, MAX_TEXTO + 1);
        if (t && t.length > MAX_TEXTO) problemas[chave] = `Use no máximo ${MAX_TEXTO} caracteres.`;
        itens.set(p.codigo, { perguntaId: p.id, valorNum: null, valorTexto: t ? t.slice(0, MAX_TEXTO) : null, preferNaoResponder: false });
      } else {
        const [min, max] = p.tipo === 'NPS' ? [0, 10] : [1, 5];
        const n = it.valorNum === null || it.valorNum === undefined || it.valorNum === '' ? null : Number(it.valorNum);
        if (n === null) itens.set(p.codigo, { perguntaId: p.id, valorNum: null, valorTexto: null, preferNaoResponder: false });
        else if (!Number.isInteger(n) || n < min || n > max) problemas[chave] = `Escolha um valor de ${min} a ${max}.`;
        else itens.set(p.codigo, { perguntaId: p.id, valorNum: n, valorTexto: null, preferNaoResponder: false });
      }
    }
    if (situacao === 'CONCLUIDA') {
      for (const p of perguntas.filter((x) => x.tipo !== 'TEXTO')) {
        const it = itens.get(p.codigo);
        if (!it || (it.valorNum === null && !it.preferNaoResponder)) problemas[`itens.${p.codigo}`] = 'Responda ou marque "prefere não responder".';
      }
    }
  }

  return { erros: problemas, dados: { situacao, momento, dataAplicacao, modo, consentimentoLido, itens: [...itens.values()] } };
}

// ---------------------------------------------------------------------------
// Resumo (NPS e satisfação) de UMA resposta
// ---------------------------------------------------------------------------

// `itens`: [{ codigo, tipo, valorNum, preferNaoResponder }]
//   nps = nota 0–10; categoria: PROMOTORA (9–10), NEUTRA (7–8), DETRATORA (0–6)
//   concordancia = % das afirmações respondidas com 4 ou 5; indice = média das afirmações em 0–100
function resumoPesquisa(itens) {
  const nps = itens.find((i) => i.tipo === 'NPS');
  const nota = nps && Number.isInteger(nps.valorNum) ? nps.valorNum : null;
  const likert = itens.filter((i) => i.tipo === 'LIKERT');
  const respondidas = likert.filter((i) => Number.isInteger(i.valorNum));
  const concordam = respondidas.filter((i) => i.valorNum >= 4).length;
  const soma = respondidas.reduce((s, i) => s + ((i.valorNum - 1) / 4) * 100, 0);
  return {
    nps: nota,
    categoriaNps: nota === null ? null : nota >= 9 ? 'PROMOTORA' : nota >= 7 ? 'NEUTRA' : 'DETRATORA',
    afirmacoesRespondidas: respondidas.length,
    afirmacoesTotal: likert.length,
    concordancia: respondidas.length ? Math.round((concordam / respondidas.length) * 100) : null,
    indice: respondidas.length ? Math.round(soma / respondidas.length) : null,
    recusas: itens.filter((i) => i.preferNaoResponder).length,
  };
}

// ---------------------------------------------------------------------------
// Pendência
// ---------------------------------------------------------------------------

// Quando a pesquisa de satisfação é devida. Só contam respostas CONCLUIDA ou RECUSADA (a recusa também "resolve" a pendência).
//   FINAL: acompanhamento com questionário final concluído (ainda em andamento) ou CONCLUIDO há até `prazoFinalDias`,
//          sem pesquisa FINAL. Desligamento não gera pendência (a família saiu; a pesquisa ainda pode ser aplicada à mão).
//   SEMESTRAL: acompanhamento em andamento sem pesquisa há `intervaloDias` (contados do início ou da última pesquisa).
// Devolve null ou { momento, devidaEm, diasAtraso }.
function calcularPendencia({
  status, dataInicio, dataEncerramento, dataQuestionarioFinal, pesquisas, hoje,
  intervaloDias = INTERVALO_PADRAO_DIAS, prazoFinalDias = PRAZO_FINAL_PADRAO_DIAS,
}) {
  const validas = pesquisas.filter((p) => p.situacao === 'CONCLUIDA' || p.situacao === 'RECUSADA');
  const inicio = isoData(dataInicio);
  const final = isoData(dataQuestionarioFinal);

  const jaTemFinal = validas.some((p) => p.momento === 'FINAL');
  if (!jaTemFinal) {
    if (status === 'CONCLUIDO') {
      const enc = isoData(dataEncerramento);
      if (enc && hoje <= somarDias(enc, prazoFinalDias)) return { momento: 'FINAL', devidaEm: enc, diasAtraso: Math.max(0, diasEntre(enc, hoje)) };
    }
    if (status === 'EM_ANDAMENTO' && final) return { momento: 'FINAL', devidaEm: final, diasAtraso: Math.max(0, diasEntre(final, hoje)) };
  }

  if (status === 'EM_ANDAMENTO' && !final) {
    const ultima = validas.map((p) => isoData(p.dataAplicacao)).filter(Boolean).sort().pop();
    const referencia = ultima && ultima > inicio ? ultima : inicio;
    const devida = somarDias(referencia, intervaloDias);
    if (devida <= hoje) return { momento: 'SEMESTRAL', devidaEm: devida, diasAtraso: diasEntre(devida, hoje) };
  }
  return null;
}

async function lerConfig(executor = { consultar }) {
  const linhas = await executor.consultar(
    "SELECT chave, valor FROM ASSOCIAL_configuracao WHERE chave IN ('pesquisa_intervalo_dias', 'pesquisa_prazo_final_dias')");
  const mapa = Object.fromEntries(linhas.map((l) => [l.chave, Number(l.valor)]));
  const inteiro = (v, padrao) => (Number.isInteger(v) && v > 0 ? v : padrao);
  return {
    intervaloDias: inteiro(mapa.pesquisa_intervalo_dias, INTERVALO_PADRAO_DIAS),
    prazoFinalDias: inteiro(mapa.pesquisa_prazo_final_dias, PRAZO_FINAL_PADRAO_DIAS),
  };
}

// Pendência de UM acompanhamento já carregado (com escopo de unidade).
async function lerPendencia(ac, hoje) {
  const [cfg, pesquisas, final] = await Promise.all([
    lerConfig(),
    consultar(
      `SELECT momento, situacao, data_aplicacao FROM ASSOCIAL_pesquisa_resposta
        WHERE acompanhamento_id = @id AND situacao IN ('CONCLUIDA', 'RECUSADA')`, { id: ac.id }),
    consultarUm(
      "SELECT data_aplicacao FROM ASSOCIAL_questionario WHERE acompanhamento_id = @id AND tipo = 'FINAL' AND concluido = 1", { id: ac.id }),
  ]);
  return calcularPendencia({
    status: ac.status, dataInicio: ac.dataInicio, dataEncerramento: ac.dataEncerramento,
    dataQuestionarioFinal: final?.dataAplicacao, pesquisas, hoje, ...cfg,
  });
}

// Pendências de todos os acompanhamentos das unidades permitidas (tela Início). Mais atrasadas primeiro.
async function listarPendencias(req, hoje, unidadeId = null) {
  const cfg = await lerConfig();
  const params = {};
  const filtros = [clausulaUnidades(req, 'ac.unidade_id', params)];
  if (unidadeId) { filtros.push('ac.unidade_id = @unidadeFiltro'); params.unidadeFiltro = unidadeId; }
  params.hoje = [tipos.Date, hoje];
  params.limite = [tipos.Date, somarDias(hoje, -cfg.prazoFinalDias)];
  const acs = await consultar(
    `SELECT ac.id AS acompanhamento_id, ac.unidade_id, un.sigla AS unidade_sigla, pe.nome AS responsavel_nome,
            ac.status, ac.data_inicio, ac.data_encerramento,
            (SELECT q.data_aplicacao FROM ASSOCIAL_questionario q WHERE q.acompanhamento_id = ac.id AND q.tipo = 'FINAL' AND q.concluido = 1) AS data_questionario_final
       FROM ASSOCIAL_acompanhamento ac
       JOIN ASSOCIAL_unidade un ON un.id = ac.unidade_id
       JOIN ASSOCIAL_familia f ON f.id = ac.familia_id
       JOIN ASSOCIAL_pessoa pe ON pe.id = f.responsavel_pessoa_id
      WHERE ${filtros.join(' AND ')}
        AND (ac.status = 'EM_ANDAMENTO' OR (ac.status = 'CONCLUIDO' AND ac.data_encerramento >= @limite))`,
    params);
  if (!acs.length) return [];
  const ids = acs.map((a) => a.acompanhamentoId);
  // o filtro de unidade vale também aqui (defesa em profundidade: a lista de ids já veio filtrada)
  const pesq = await consultar(
    `SELECT pr.acompanhamento_id, pr.momento, pr.situacao, pr.data_aplicacao
       FROM ASSOCIAL_pesquisa_resposta pr JOIN ASSOCIAL_acompanhamento ac ON ac.id = pr.acompanhamento_id
      WHERE pr.situacao IN ('CONCLUIDA', 'RECUSADA') AND ${filtros.join(' AND ')}
        AND pr.acompanhamento_id IN (${ids.map((_, i) => `@a${i}`).join(', ')})`,
    { ...params, ...Object.fromEntries(ids.map((id, i) => [`a${i}`, id])) });
  const porAc = new Map();
  for (const p of pesq) { if (!porAc.has(p.acompanhamentoId)) porAc.set(p.acompanhamentoId, []); porAc.get(p.acompanhamentoId).push(p); }
  const saida = [];
  for (const a of acs) {
    const pend = calcularPendencia({
      status: a.status, dataInicio: a.dataInicio, dataEncerramento: a.dataEncerramento, dataQuestionarioFinal: a.dataQuestionarioFinal,
      pesquisas: porAc.get(a.acompanhamentoId) || [], hoje, ...cfg,
    });
    if (pend) {
      saida.push({
        acompanhamentoId: a.acompanhamentoId, unidadeId: a.unidadeId, unidadeSigla: a.unidadeSigla, responsavelNome: a.responsavelNome, ...pend,
      });
    }
  }
  return saida.sort((x, y) => y.diasAtraso - x.diasAtraso || x.unidadeSigla.localeCompare(y.unidadeSigla) || x.responsavelNome.localeCompare(y.responsavelNome));
}

module.exports = {
  MOMENTOS, MODOS, SITUACOES_ESCRITA, MAX_TEXTO,
  validarPesquisa, resumoPesquisa, calcularPendencia, lerPendencia, listarPendencias, lerConfig,
};
