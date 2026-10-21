'use strict';

// F6 — Painel do coordenador: progresso das famílias (índice da F5), metas (F4), satisfação (F3) e as pendências consolidadas.
// Funções PURAS de agregação (testáveis sem banco) + as consultas, que passam SEMPRE por clausulaUnidades (escopo do usuário)
// e pelo filtro de unidades escolhido. Usadas pelo painel (/api/painel/progresso e /satisfacao) e pelo relatório semestral.
//
// Regras (proposta, seções 7 e 10.5):
//  - Progresso: famílias com 2 ou mais pontos do índice até o fim do período e cujo ÚLTIMO ponto caiu dentro do período;
//    compara o primeiro (inicial) com o último ponto, com a tolerância do índice (indice_tolerancia_pontos).
//  - N mínimo (pesquisa_n_minimo, padrão 5): abaixo disso só o número absoluto aparece; percentuais, NPS e semáforo ficam nulos.
//  - Semáforos (D13): limiares provisórios, editáveis em Configurações (migração 084), a validar com a coordenação.

const { consultar, tipos } = require('../db');
const { clausulaUnidades, unidadesPermitidas } = require('../middlewares/auth');
const { erros } = require('../lib/erros');
const indice = require('./indice-progresso');
const indiceDados = require('./indice-dados');
const metasRegras = require('./metas-regras');
const pesquisaRegras = require('./pesquisa-regras');

const N_MINIMO_PADRAO = 5;
const LIMIARES_PADRAO = Object.freeze({
  progressoVerde: 50, progressoAmarelo: 30, npsVerde: 50, npsAmarelo: 0, concordanciaVerde: 80, concordanciaAmarelo: 60,
});
const SELOS = Object.freeze({ VERDE: 'Bom', AMARELO: 'Atenção', VERMELHO: 'Crítico' });
const FAIXAS_INDICE = Object.freeze([
  { de: 0, ate: 20, rotulo: '0 a 19' }, { de: 20, ate: 40, rotulo: '20 a 39' }, { de: 40, ate: 60, rotulo: '40 a 59' },
  { de: 60, ate: 80, rotulo: '60 a 79' }, { de: 80, ate: 100.001, rotulo: '80 a 100' },
]);
const ROTULO_AFIRMACAO_PADRAO = Object.freeze({});

const iso = (v) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const arred = (n, casas = 1) => { const f = 10 ** casas; return Math.round(n * f) / f; };
const pct = (parte, total) => (total > 0 ? arred((parte / total) * 100) : null);
const somarDias = (dia, n) => { const d = new Date(`${dia}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diasEntre = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const media = (lista) => (lista.length ? arred(lista.reduce((s, x) => s + x, 0) / lista.length) : null);

// ---------------------------------------------------------------------------
// Semáforos (puros)
// ---------------------------------------------------------------------------

// % que melhoraram: ≥ verde → VERDE; ≥ amarelo → AMARELO; senão VERMELHO. Sem n suficiente → null.
function semaforoProgresso(pctMelhoraram, limiares = LIMIARES_PADRAO) {
  if (pctMelhoraram === null || pctMelhoraram === undefined) return null;
  if (pctMelhoraram >= limiares.progressoVerde) return 'VERDE';
  if (pctMelhoraram >= limiares.progressoAmarelo) return 'AMARELO';
  return 'VERMELHO';
}

// Verde: NPS ≥ verde E concordância ≥ verde. Vermelho: NPS < amarelo OU concordância < amarelo. Senão amarelo.
// Se um dos dois não existe, decide pelo que existe.
function semaforoSatisfacao({ nps, concordancia }, limiares = LIMIARES_PADRAO) {
  const temNps = nps !== null && nps !== undefined;
  const temConc = concordancia !== null && concordancia !== undefined;
  if (!temNps && !temConc) return null;
  if ((temNps && nps < limiares.npsAmarelo) || (temConc && concordancia < limiares.concordanciaAmarelo)) return 'VERMELHO';
  if ((!temNps || nps >= limiares.npsVerde) && (!temConc || concordancia >= limiares.concordanciaVerde)) return 'VERDE';
  return 'AMARELO';
}

function lerLimiares(mapa) {
  const n = (chave, padrao) => (Number.isFinite(Number(mapa[chave])) && mapa[chave] !== undefined ? Number(mapa[chave]) : padrao);
  return {
    progressoVerde: n('semaforo_progresso_verde_pct', LIMIARES_PADRAO.progressoVerde),
    progressoAmarelo: n('semaforo_progresso_amarelo_pct', LIMIARES_PADRAO.progressoAmarelo),
    npsVerde: n('semaforo_nps_verde', LIMIARES_PADRAO.npsVerde),
    npsAmarelo: n('semaforo_nps_amarelo', LIMIARES_PADRAO.npsAmarelo),
    concordanciaVerde: n('semaforo_concordancia_verde', LIMIARES_PADRAO.concordanciaVerde),
    concordanciaAmarelo: n('semaforo_concordancia_amarelo', LIMIARES_PADRAO.concordanciaAmarelo),
  };
}

async function lerConfig(executor = { consultar }) {
  const linhas = await executor.consultar(
    `SELECT chave, valor FROM configuracao WHERE chave IN ('pesquisa_n_minimo', 'semaforo_progresso_verde_pct', 'semaforo_progresso_amarelo_pct',
       'semaforo_nps_verde', 'semaforo_nps_amarelo', 'semaforo_concordancia_verde', 'semaforo_concordancia_amarelo')`);
  const mapa = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
  const nMin = Number(mapa.pesquisa_n_minimo);
  const params = await indiceDados.lerParametros(executor);
  return {
    nMinimo: Number.isInteger(nMin) && nMin > 0 ? nMin : N_MINIMO_PADRAO,
    limiares: lerLimiares(mapa),
    tolerancia: params.tolerancia,
    reavaliacaoDias: params.reavaliacaoDias,
  };
}

// ---------------------------------------------------------------------------
// Progresso (puro)
// ---------------------------------------------------------------------------

const contarSelos = (itens) => ({
  n: itens.length,
  melhoraram: itens.filter((s) => s === 'melhorou').length,
  iguais: itens.filter((s) => s === 'igual').length,
  pioraram: itens.filter((s) => s === 'piorou').length,
});

function resumirSelos(selos, { nMinimo, limiares }) {
  const c = contarSelos(selos);
  const suficiente = c.n >= nMinimo;
  const pctMelhoraram = suficiente ? pct(c.melhoraram, c.n) : null;
  return {
    ...c,
    suficiente,
    pctMelhoraram,
    pctIguais: suficiente ? pct(c.iguais, c.n) : null,
    pctPioraram: suficiente ? pct(c.pioraram, c.n) : null,
    semaforo: semaforoProgresso(pctMelhoraram, limiares),
  };
}

// `acompanhamentos`: [{ id, unidadeId }]; `pontos`: Map acId -> [{ tipo, dataRef, geral:{nivel}, dimensoes:{DIM:{nivel}} }] (qualquer ordem).
// Devolve { geral, dimensoes[], unidades[], distribuicao, comparaveis[] } — `comparaveis` guarda os dados por família para o CSV.
function agregarProgresso({ acompanhamentos, pontos, periodo, tolerancia = indice.TOLERANCIA_PADRAO, nMinimo = N_MINIMO_PADRAO, limiares = LIMIARES_PADRAO, unidades = [] }) {
  const ctx = { nMinimo, limiares };
  const comparaveis = [];
  const ultimos = [];
  for (const ac of acompanhamentos) {
    const lista = (pontos.get(ac.id) || []).filter((p) => iso(p.dataRef) <= periodo.fim)
      .sort((a, b) => iso(a.dataRef).localeCompare(iso(b.dataRef)) || indice.ORDEM_TIPO[a.tipo] - indice.ORDEM_TIPO[b.tipo]);
    if (!lista.length) continue;
    const ultimo = lista[lista.length - 1];
    if (ultimo.geral.nivel !== null && iso(ultimo.dataRef) >= periodo.inicio) ultimos.push({ unidadeId: ac.unidadeId, nivel: ultimo.geral.nivel });
    if (lista.length < 2 || iso(ultimo.dataRef) < periodo.inicio) continue;
    const comp = indice.compararPontos(lista[0], ultimo, tolerancia);
    comparaveis.push({ acompanhamentoId: ac.id, unidadeId: ac.unidadeId, comparacao: comp, dePara: [lista[0].tipo, ultimo.tipo] });
  }

  const comGeral = comparaveis.filter((c) => c.comparacao.geral.selo !== 'sem_dados');
  const geral = {
    ...resumirSelos(comGeral.map((c) => c.comparacao.geral.selo), ctx),
    indiceMedioInicial: media(comGeral.map((c) => c.comparacao.geral.antes)),
    indiceMedioAtual: media(comGeral.map((c) => c.comparacao.geral.depois)),
  };
  geral.variacaoMedia = geral.indiceMedioInicial !== null ? arred(geral.indiceMedioAtual - geral.indiceMedioInicial) : null;

  const dimensoes = indice.DIMENSOES.map((codigo) => {
    const selos = comparaveis.map((c) => c.comparacao.dimensoes[codigo].selo).filter((s) => s !== 'sem_dados');
    return { codigo, nome: indice.ROTULO_DIMENSAO[codigo], ...resumirSelos(selos, ctx) };
  });

  const porUnidade = unidades.map((u) => {
    const dela = comGeral.filter((c) => c.unidadeId === u.id);
    return {
      unidadeId: u.id, sigla: u.sigla, nome: u.nome,
      ...resumirSelos(dela.map((c) => c.comparacao.geral.selo), ctx),
      indiceMedioInicial: media(dela.map((c) => c.comparacao.geral.antes)),
      indiceMedioAtual: media(dela.map((c) => c.comparacao.geral.depois)),
      porDimensao: indice.DIMENSOES.map((codigo) => ({
        codigo, nome: indice.ROTULO_DIMENSAO[codigo],
        ...resumirSelos(comparaveis.filter((c) => c.unidadeId === u.id).map((c) => c.comparacao.dimensoes[codigo].selo).filter((s) => s !== 'sem_dados'), ctx),
      })),
    };
  });

  const faixas = FAIXAS_INDICE.map((f) => ({ faixa: f.rotulo, n: ultimos.filter((u) => u.nivel >= f.de && u.nivel < f.ate).length }));
  return {
    nMinimo, tolerancia, geral, dimensoes, unidades: porUnidade,
    distribuicao: { n: ultimos.length, faixas },
    comparaveis,
  };
}

// Metas na "fotografia" do fim do período: meta encerrada depois do fim ainda contava como em andamento.
function agregarMetas({ metas, fim, unidades = [], nMinimo = N_MINIMO_PADRAO }) {
  const naData = metas.filter((m) => iso(m.criadoEm) <= fim).map((m) => ({
    ...m,
    situacao: m.status !== 'EM_ANDAMENTO' && m.concluidaEm && iso(m.concluidaEm) > fim ? 'EM_ANDAMENTO' : m.status,
  }));
  const conta = (lista) => {
    const c = (s) => lista.filter((m) => m.situacao === s).length;
    const atingidas = c('ATINGIDA');
    const naoAtingidas = c('NAO_ATINGIDA');
    const encerradas = atingidas + naoAtingidas;
    return {
      total: lista.length, emAndamento: c('EM_ANDAMENTO'), atingidas, naoAtingidas, canceladas: c('CANCELADA'),
      pctAtingidas: encerradas >= nMinimo ? pct(atingidas, encerradas) : null,
      familiasComMeta: new Set(lista.map((m) => m.acompanhamentoId)).size,
    };
  };
  return {
    ...conta(naData),
    porDimensao: Object.entries(metasRegras.DIMENSOES).map(([codigo, nome]) => ({ codigo, nome, ...conta(naData.filter((m) => m.dimensao === codigo)) })),
    porUnidade: unidades.map((u) => ({ unidadeId: u.id, sigla: u.sigla, nome: u.nome, ...conta(naData.filter((m) => m.unidadeId === u.id)) })),
  };
}

// Situação dos acompanhamentos no período: em andamento ao fim, iniciados, concluídos e desligados dentro do período e tempo médio.
function agregarAcompanhamentos({ acompanhamentos, periodo }) {
  const noPeriodo = (d) => d && iso(d) >= periodo.inicio && iso(d) <= periodo.fim;
  const encerrados = acompanhamentos.filter((a) => a.status !== 'EM_ANDAMENTO' && noPeriodo(a.dataEncerramento));
  const duracoes = encerrados.map((a) => diasEntre(iso(a.dataInicio), iso(a.dataEncerramento)));
  return {
    emAndamento: acompanhamentos.filter((a) => iso(a.dataInicio) <= periodo.fim && (!a.dataEncerramento || a.status === 'EM_ANDAMENTO' || iso(a.dataEncerramento) > periodo.fim)).length,
    iniciados: acompanhamentos.filter((a) => noPeriodo(a.dataInicio)).length,
    concluidos: encerrados.filter((a) => a.status === 'CONCLUIDO').length,
    desligados: encerrados.filter((a) => a.status === 'DESLIGADO').length,
    tempoMedioDias: duracoes.length ? Math.round(duracoes.reduce((s, d) => s + d, 0) / duracoes.length) : null,
  };
}

// ---------------------------------------------------------------------------
// Satisfação (pura)
// ---------------------------------------------------------------------------

// `respostas`: [{ id, acompanhamentoId, unidadeId, situacao: CONCLUIDA|RECUSADA }]; `itens`: Map respostaId -> [{ codigo, tipo, valorNum, preferNaoResponder }];
// `elegiveis`: Map unidadeId -> nº de famílias em acompanhamento no período; `textos`: Map codigo -> texto da afirmação.
function resumirSatisfacao(respostas, itens, elegiveisN, { nMinimo, limiares }) {
  const concluidas = respostas.filter((r) => r.situacao === 'CONCLUIDA');
  const recusadas = respostas.filter((r) => r.situacao === 'RECUSADA');
  const resumos = concluidas.map((r) => pesquisaRegras.resumoPesquisa(itens.get(r.id) || []));
  const notas = resumos.map((r) => r.nps).filter((n) => n !== null);
  const promotoras = notas.filter((n) => n >= 9).length;
  const detratoras = notas.filter((n) => n <= 6).length;
  const neutras = notas.length - promotoras - detratoras;
  const likert = concluidas.flatMap((r) => (itens.get(r.id) || []).filter((i) => i.tipo === 'LIKERT' && Number.isInteger(i.valorNum)));
  const suficiente = concluidas.length >= nMinimo;
  const nps = suficiente && notas.length ? Math.round(((promotoras - detratoras) / notas.length) * 100) : null;
  const concordancia = suficiente && likert.length ? Math.round((likert.filter((i) => i.valorNum >= 4).length / likert.length) * 100) : null;
  const familiasComPesquisa = new Set(respostas.map((r) => r.acompanhamentoId)).size;
  return {
    respostas: concluidas.length,
    recusas: recusadas.length,
    suficiente,
    nps,
    promotoras, neutras, detratoras,
    indice: suficiente ? media(resumos.map((r) => r.indice).filter((v) => v !== null)) : null,
    concordancia,
    taxaRecusa: suficiente || respostas.length >= nMinimo ? pct(recusadas.length, respostas.length) : null,
    elegiveis: elegiveisN,
    familiasComPesquisa,
    taxaCobertura: elegiveisN >= nMinimo ? pct(familiasComPesquisa, elegiveisN) : null,
    semaforo: suficiente ? semaforoSatisfacao({ nps, concordancia }, limiares) : null,
  };
}

function agregarSatisfacao({ respostas, itens, elegiveis, textos = new Map(), unidades = [], nMinimo = N_MINIMO_PADRAO, limiares = LIMIARES_PADRAO }) {
  const ctx = { nMinimo, limiares };
  const totalElegiveis = [...elegiveis.values()].reduce((s, n) => s + n, 0);
  const geral = resumirSatisfacao(respostas, itens, totalElegiveis, ctx);
  const concluidas = respostas.filter((r) => r.situacao === 'CONCLUIDA');

  const codigos = new Set();
  for (const r of concluidas) for (const i of itens.get(r.id) || []) if (i.tipo === 'LIKERT') codigos.add(i.codigo);
  const perguntas = [...codigos].sort().map((codigo) => {
    const valores = concluidas.flatMap((r) => (itens.get(r.id) || []).filter((i) => i.codigo === codigo && Number.isInteger(i.valorNum)).map((i) => i.valorNum));
    const ok = valores.length >= nMinimo;
    return {
      codigo, texto: textos.get(codigo) || codigo, n: valores.length, suficiente: ok,
      concordancia: ok ? Math.round((valores.filter((v) => v >= 4).length / valores.length) * 100) : null,
      media: ok ? arred(valores.reduce((s, v) => s + v, 0) / valores.length, 1) : null,
    };
  });
  // da pior para a melhor concordância (onde o projeto falha mais); as sem n suficiente vão para o fim
  perguntas.sort((a, b) => (a.concordancia === null) - (b.concordancia === null) || (a.concordancia ?? 0) - (b.concordancia ?? 0) || a.codigo.localeCompare(b.codigo));

  const porUnidade = unidades.map((u) => ({
    unidadeId: u.id, sigla: u.sigla, nome: u.nome,
    ...resumirSatisfacao(respostas.filter((r) => r.unidadeId === u.id), itens, elegiveis.get(u.id) || 0, ctx),
  }));
  return { nMinimo, geral, perguntas, unidades: porUnidade };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

// "coluna IN (permitidas) [AND coluna IN (selecionadas)]". `selecionadas`: ids ou null (= todas as permitidas).
function filtroEscopo(req, coluna, selecionadas, params) {
  const base = clausulaUnidades(req, coluna, params);
  if (!selecionadas || !selecionadas.length) return base;
  const nomes = selecionadas.map((id, i) => { params[`sel${i}`] = id; return `@sel${i}`; });
  return `${base} AND ${coluna} IN (${nomes.join(', ')})`;
}

// Unidades do recorte: as selecionadas (todas precisam estar entre as permitidas) ou todas as permitidas.
function resolverUnidades(req, ids) {
  const permitidas = unidadesPermitidas(req);
  const lista = ids && ids.length ? ids : permitidas;
  if (lista.some((id) => !permitidas.includes(id))) throw erros.proibido('Você não tem acesso a uma das unidades selecionadas.');
  return lista;
}

async function carregarUnidades(ids) {
  if (!ids.length) return [];
  const params = {};
  const nomes = ids.map((id, i) => { params[`u${i}`] = id; return `@u${i}`; });
  return consultar(`SELECT id, sigla, nome FROM unidade WHERE id IN (${nomes.join(', ')}) ORDER BY ordem, nome`, params);
}

const dataParam = (v) => [tipos.Date, v];

// Período imediatamente anterior, de mesma duração. Meses e semestres fechados (dia 1 até o último dia de um mês) voltam
// o mesmo número de meses (o semestre anterior é o semestre anterior de verdade); os demais voltam o mesmo número de dias.
function periodoAnterior(periodo) {
  const fim = somarDias(periodo.inicio, -1);
  const ultimoDia = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
  const [ai, mi, di] = periodo.inicio.split('-').map(Number);
  const [af, mf, df] = periodo.fim.split('-').map(Number);
  if (di === 1 && df === ultimoDia(af, mf)) {
    const meses = (af - ai) * 12 + (mf - mi) + 1;
    const total = ai * 12 + (mi - 1) - meses;
    const a = Math.floor(total / 12);
    const m = (total % 12) + 1;
    return { inicio: `${a}-${String(m).padStart(2, '0')}-01`, fim };
  }
  const dias = diasEntre(periodo.inicio, periodo.fim) + 1;
  return { inicio: somarDias(fim, -(dias - 1)), fim };
}

async function carregarProgresso(req, periodo, ids, cfg, unidades) {
  const p1 = {};
  const w1 = filtroEscopo(req, 'ac.unidade_id', ids, p1);
  p1.fim = dataParam(periodo.fim);
  const acompanhamentos = await consultar(
    `SELECT ac.id, ac.unidade_id, ac.status, ac.data_inicio, ac.data_encerramento
       FROM acompanhamento ac WHERE ${w1} AND ac.data_inicio <= @fim`, p1);

  const p2 = {};
  const w2 = filtroEscopo(req, 'ac.unidade_id', ids, p2);
  p2.fim = dataParam(periodo.fim);
  const linhas = await consultar(
    `SELECT ai.acompanhamento_id, ai.questionario_id, ai.tipo, ai.data_ref, ai.dimensao, ai.nivel
       FROM acompanhamento_indice ai JOIN acompanhamento ac ON ac.id = ai.acompanhamento_id
      WHERE ${w2} AND ai.data_ref <= @fim`, p2);
  const porQ = new Map();
  for (const l of linhas) {
    if (!porQ.has(l.questionarioId)) porQ.set(l.questionarioId, { acompanhamentoId: l.acompanhamentoId, tipo: l.tipo, dataRef: l.dataRef, geral: { nivel: null }, dimensoes: {} });
    const q = porQ.get(l.questionarioId);
    const nivel = l.nivel === null || l.nivel === undefined ? null : Number(l.nivel);
    if (l.dimensao === 'GERAL') q.geral = { nivel }; else q.dimensoes[l.dimensao] = { nivel };
  }
  const pontos = new Map();
  for (const q of porQ.values()) {
    for (const d of indice.DIMENSOES) if (!q.dimensoes[d]) q.dimensoes[d] = { nivel: null };
    if (!pontos.has(q.acompanhamentoId)) pontos.set(q.acompanhamentoId, []);
    pontos.get(q.acompanhamentoId).push(q);
  }
  const lista = acompanhamentos.map((a) => ({ ...a, unidadeId: a.unidadeId }));
  return { acompanhamentos: lista, pontos };
}

// Contatos com a família (registros com contato, não anulados) no período: total e média por família em acompanhamento.
async function carregarContatos(req, periodo, ids) {
  const p = {};
  const w = filtroEscopo(req, 'ac.unidade_id', ids, p);
  p.ini = dataParam(periodo.inicio); p.fim = dataParam(periodo.fim);
  const [c] = await consultar(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT r.acompanhamento_id) AS familias
       FROM acompanhamento_registro r JOIN acompanhamento ac ON ac.id = r.acompanhamento_id
      WHERE ${w} AND r.houve_contato = 1 AND r.anulado_em IS NULL AND r.data_registro BETWEEN @ini AND @fim`, p);
  return { total: Number(c?.total || 0), familiasComContato: Number(c?.familias || 0) };
}

async function carregarMetas(req, ids, fim) {
  const p = {};
  const w = filtroEscopo(req, 'ac.unidade_id', ids, p);
  p.fim = dataParam(fim);
  return consultar(
    `SELECT m.acompanhamento_id, ac.unidade_id, m.dimensao, m.status, m.concluida_em, m.criado_em
       FROM acompanhamento_meta m JOIN acompanhamento ac ON ac.id = m.acompanhamento_id
      WHERE ${w} AND CAST(m.criado_em AS DATE) <= @fim`, p);
}

// GET /api/painel/progresso — recorte por unidades (ids) e período; inclui metas, situação dos acompanhamentos, período anterior e pendências.
async function progresso(req, periodo, unidadeIds = null, { comAnterior = true } = {}) {
  const ids = resolverUnidades(req, unidadeIds);
  const [cfg, unidades] = await Promise.all([lerConfig(), carregarUnidades(ids)]);
  const base = { tolerancia: cfg.tolerancia, nMinimo: cfg.nMinimo, limiares: cfg.limiares, unidades };

  const { acompanhamentos, pontos } = await carregarProgresso(req, periodo, ids, cfg, unidades);
  const prog = agregarProgresso({ acompanhamentos, pontos, periodo, ...base });
  const metas = agregarMetas({ metas: await carregarMetas(req, ids, periodo.fim), fim: periodo.fim, unidades, nMinimo: cfg.nMinimo });
  const acomp = agregarAcompanhamentos({ acompanhamentos, periodo });
  const contatos = await carregarContatos(req, periodo, ids);
  acomp.contatos = { ...contatos, mediaPorFamilia: contatos.familiasComContato ? arred(contatos.total / contatos.familiasComContato) : null };

  let anterior = null;
  if (comAnterior) {
    const pa = periodoAnterior(periodo);
    const antes = await carregarProgresso(req, pa, ids, cfg, unidades);
    const a = agregarProgresso({ acompanhamentos: antes.acompanhamentos, pontos: antes.pontos, periodo: pa, ...base });
    anterior = { periodo: pa, geral: a.geral };
  }
  const { comparaveis, ...resto } = prog;
  return {
    periodo, unidades: unidades.map((u) => ({ id: u.id, sigla: u.sigla, nome: u.nome })),
    semaforos: { limiares: cfg.limiares, rotulos: SELOS },
    ...resto, metas, acompanhamentos: acomp, anterior,
  };
}

async function carregarSatisfacao(req, periodo, ids, comComentarios) {
  const p1 = {};
  const w1 = filtroEscopo(req, 'ac.unidade_id', ids, p1);
  p1.ini = dataParam(periodo.inicio); p1.fim = dataParam(periodo.fim);
  const respostas = await consultar(
    `SELECT r.id, r.acompanhamento_id, ac.unidade_id, r.situacao, r.momento, r.data_aplicacao, r.comentario_oculto
       FROM pesquisa_resposta r JOIN acompanhamento ac ON ac.id = r.acompanhamento_id
      WHERE ${w1} AND r.situacao IN ('CONCLUIDA', 'RECUSADA') AND r.data_aplicacao BETWEEN @ini AND @fim`, p1);

  const p2 = {};
  const w2 = filtroEscopo(req, 'ac.unidade_id', ids, p2);
  p2.ini = dataParam(periodo.inicio); p2.fim = dataParam(periodo.fim);
  const linhas = await consultar(
    `SELECT i.resposta_id, p.codigo, p.tipo, p.texto AS pergunta, i.valor_num, i.valor_texto, i.prefere_nao_responder
       FROM pesquisa_resposta_item i
       JOIN pesquisa_pergunta p ON p.id = i.pergunta_id
       JOIN pesquisa_resposta r ON r.id = i.resposta_id
       JOIN acompanhamento ac ON ac.id = r.acompanhamento_id
      WHERE ${w2} AND r.situacao = 'CONCLUIDA' AND r.data_aplicacao BETWEEN @ini AND @fim`, p2);
  const itens = new Map();
  const textos = new Map();
  for (const l of linhas) {
    if (!itens.has(l.respostaId)) itens.set(l.respostaId, []);
    itens.get(l.respostaId).push({ codigo: l.codigo, tipo: l.tipo, valorNum: l.valorNum, valorTexto: l.valorTexto, preferNaoResponder: !!l.prefereNaoResponder });
    if (l.tipo === 'LIKERT') textos.set(l.codigo, l.pergunta);
  }

  const p3 = {};
  const w3 = filtroEscopo(req, 'ac.unidade_id', ids, p3);
  p3.ini = dataParam(periodo.inicio); p3.fim = dataParam(periodo.fim);
  const elegiveisLinhas = await consultar(
    `SELECT ac.unidade_id, COUNT(*) AS familias FROM acompanhamento ac
      WHERE ${w3} AND ac.data_inicio <= @fim AND (ac.data_encerramento IS NULL OR ac.data_encerramento >= @ini)
      GROUP BY ac.unidade_id`, p3);
  const elegiveis = new Map(elegiveisLinhas.map((l) => [l.unidadeId, Number(l.familias)]));

  let comentarios = [];
  if (comComentarios) {
    comentarios = respostas.filter((r) => r.situacao === 'CONCLUIDA' && !r.comentarioOculto).flatMap((r) => (itens.get(r.id) || [])
      .filter((i) => i.tipo === 'TEXTO' && i.valorTexto && i.valorTexto.trim())
      .map((i) => ({
        id: `${r.id}.${i.codigo}`, pesquisaId: r.id, acompanhamentoId: r.acompanhamentoId, unidadeId: r.unidadeId, data: iso(r.dataAplicacao),
        codigo: i.codigo, pergunta: i.codigo === 'T1' ? 'O que faz de melhor' : 'O que precisa melhorar', texto: i.valorTexto.trim(),
      })));
    comentarios.sort((a, b) => b.data.localeCompare(a.data) || b.pesquisaId - a.pesquisaId);
  }
  return { respostas: respostas.map((r) => ({ ...r, unidadeId: r.unidadeId })), itens, textos, elegiveis, comentarios };
}

// GET /api/painel/satisfacao — NPS, concordância por afirmação, taxas, semáforo, período anterior e (só coordenação/ADMIN) comentários.
async function satisfacao(req, periodo, unidadeIds = null, { comComentarios = false, comAnterior = true } = {}) {
  const ids = resolverUnidades(req, unidadeIds);
  const [cfg, unidades] = await Promise.all([lerConfig(), carregarUnidades(ids)]);
  const ctx = { unidades, nMinimo: cfg.nMinimo, limiares: cfg.limiares };
  const c = await carregarSatisfacao(req, periodo, ids, comComentarios);
  const agregado = agregarSatisfacao({ respostas: c.respostas, itens: c.itens, elegiveis: c.elegiveis, textos: c.textos, ...ctx });

  let anterior = null;
  if (comAnterior) {
    const pa = periodoAnterior(periodo);
    const a = await carregarSatisfacao(req, pa, ids, false);
    anterior = { periodo: pa, geral: agregarSatisfacao({ respostas: a.respostas, itens: a.itens, elegiveis: a.elegiveis, textos: a.textos, ...ctx }).geral };
  }
  return {
    periodo, unidades: unidades.map((u) => ({ id: u.id, sigla: u.sigla, nome: u.nome })),
    semaforos: { limiares: cfg.limiares, rotulos: SELOS },
    ...agregado, anterior,
    comentarios: comComentarios ? c.comentarios.slice(0, 200).map((x) => ({ ...x, sigla: unidades.find((u) => u.id === x.unidadeId)?.sigla || '' })) : undefined,
  };
}

// Reavaliações rápidas pendentes (acompanhamento em andamento, inicial concluído, sem reavaliação nem final, passou da data prevista).
async function listarReavaliacoesPendentes(req, hoje, unidadeId = null) {
  const cfg = await indiceDados.lerParametros();
  const params = {};
  const w = filtroEscopo(req, 'ac.unidade_id', unidadeId ? [unidadeId] : null, params);
  const linhas = await consultar(
    `SELECT ac.id AS acompanhamento_id, ac.unidade_id, un.sigla AS unidade_sigla, pe.nome AS responsavel_nome, ac.data_inicio
       FROM acompanhamento ac
       JOIN unidade un ON un.id = ac.unidade_id
       JOIN familia f ON f.id = ac.familia_id
       JOIN pessoa pe ON pe.id = f.responsavel_pessoa_id
      WHERE ${w} AND ac.status = 'EM_ANDAMENTO'
        AND EXISTS (SELECT 1 FROM questionario q WHERE q.acompanhamento_id = ac.id AND q.tipo = 'INICIAL' AND q.concluido = 1)
        AND NOT EXISTS (SELECT 1 FROM questionario q WHERE q.acompanhamento_id = ac.id AND q.tipo IN ('REAVALIACAO', 'FINAL') AND q.concluido = 1)`, params);
  const saida = [];
  for (const l of linhas) {
    const r = indice.situacaoReavaliacao({
      status: 'EM_ANDAMENTO', inicialConcluido: true, reavaliacaoConcluida: false, finalConcluido: false,
      dataInicio: l.dataInicio, reavaliacaoDias: cfg.reavaliacaoDias, hoje,
    });
    if (r.situacao !== 'PENDENTE') continue;
    saida.push({
      acompanhamentoId: l.acompanhamentoId, unidadeId: l.unidadeId, unidadeSigla: l.unidadeSigla, responsavelNome: l.responsavelNome,
      devidaEm: r.dataPrevista, diasAtraso: diasEntre(r.dataPrevista, hoje),
    });
  }
  return saida.sort((a, b) => b.diasAtraso - a.diasAtraso || a.responsavelNome.localeCompare(b.responsavelNome));
}

module.exports = {
  N_MINIMO_PADRAO, LIMIARES_PADRAO, SELOS, FAIXAS_INDICE, ROTULO_AFIRMACAO_PADRAO,
  semaforoProgresso, semaforoSatisfacao, lerLimiares, lerConfig,
  agregarProgresso, agregarMetas, agregarAcompanhamentos, agregarSatisfacao, resumirSatisfacao, periodoAnterior,
  resolverUnidades, filtroEscopo,
  progresso, satisfacao, listarReavaliacoesPendentes,
};
