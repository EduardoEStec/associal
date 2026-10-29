'use strict';

// F6 — painel do coordenador: agregações puras (progresso, metas, satisfação, semáforos, n mínimo) e rotas com banco SIMULADO.
// Rodar: node --test tests/familias/*.test.js   (o teste contra o banco real do Docker é tests/familias/painel-familias.e2e.js)

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mssql = require('mssql');

const chamadas = [];
let respostas = [];
async function despachar(sql, params = {}) {
  chamadas.push({ sql, params });
  for (const hd of respostas) if (hd.teste.test(sql)) return hd.resp(params, sql);
  return [];
}
const executor = {
  consultar: async (sql, params) => despachar(sql, params),
  consultarUm: async (sql, params) => (await despachar(sql, params))[0] || null,
  executar: async (sql, params) => ({ linhas: await despachar(sql, params) }),
};
const dbFalso = { tipos: mssql, ...executor, transacao: async (fn) => fn(executor), obterPool: async () => { throw new Error('sem pool'); }, fechar: async () => {} };
const caminhoDb = require.resolve('../../server/db');
require.cache[caminhoDb] = { id: caminhoDb, filename: caminhoDb, loaded: true, exports: dbFalso };

const rotas = require('../../server/routes/painel');
const pf = require('../../server/services/painel-familias');
const { tratarErros } = require('../../server/middlewares/erros');

function iniciar(usuario) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.usuario = usuario; next(); });
  app.use('/api/painel', rotas);
  app.use(tratarErros);
  return new Promise((resolve) => {
    const srv = app.listen(0, () => {
      const base = `http://127.0.0.1:${srv.address().port}/api/painel`;
      const chamar = async (url) => {
        const r = await fetch(base + url, { headers: { 'X-Requested-With': 'fetch' } });
        return { status: r.status, corpo: await r.json().catch(() => null) };
      };
      resolve({ chamar, fechar: () => new Promise((ok) => srv.close(ok)) });
    });
  });
}

const assistente = { id: 10, perfil: 'ASSISTENTE', unidades: [{ id: 1, sigla: 'BRA' }] };
const coordenador = { id: 20, perfil: 'COORDENADOR', unidades: [{ id: 1, sigla: 'BRA' }, { id: 2, sigla: 'TIR' }] };
const admin = { id: 30, perfil: 'ADMIN', unidades: [{ id: 1, sigla: 'BRA' }, { id: 2, sigla: 'TIR' }] };

// ---------------------------------------------------------------------------
// Semáforos
// ---------------------------------------------------------------------------

test('semáforo do progresso: limiares provisórios 50 e 30 (verde, amarelo, vermelho)', () => {
  assert.equal(pf.semaforoProgresso(60), 'VERDE');
  assert.equal(pf.semaforoProgresso(50), 'VERDE');
  assert.equal(pf.semaforoProgresso(49.9), 'AMARELO');
  assert.equal(pf.semaforoProgresso(30), 'AMARELO');
  assert.equal(pf.semaforoProgresso(29), 'VERMELHO');
  assert.equal(pf.semaforoProgresso(null), null);
  assert.equal(pf.semaforoProgresso(40, { ...pf.LIMIARES_PADRAO, progressoVerde: 40 }), 'VERDE', 'limiar editável');
});

test('semáforo da satisfação: verde exige NPS e concordância; vermelho se qualquer um cair abaixo do amarelo', () => {
  assert.equal(pf.semaforoSatisfacao({ nps: 60, concordancia: 85 }), 'VERDE');
  assert.equal(pf.semaforoSatisfacao({ nps: 60, concordancia: 70 }), 'AMARELO');
  assert.equal(pf.semaforoSatisfacao({ nps: 20, concordancia: 90 }), 'AMARELO');
  assert.equal(pf.semaforoSatisfacao({ nps: -5, concordancia: 90 }), 'VERMELHO');
  assert.equal(pf.semaforoSatisfacao({ nps: 80, concordancia: 59 }), 'VERMELHO');
  assert.equal(pf.semaforoSatisfacao({ nps: 80, concordancia: null }), 'VERDE', 'decide pelo que existe');
  assert.equal(pf.semaforoSatisfacao({ nps: null, concordancia: null }), null);
});

test('lerLimiares: usa a configuração e cai no padrão quando falta ou é inválida', () => {
  assert.deepEqual(pf.lerLimiares({}), pf.LIMIARES_PADRAO);
  const l = pf.lerLimiares({ semaforo_nps_verde: '40', semaforo_progresso_amarelo_pct: 'x' });
  assert.equal(l.npsVerde, 40);
  assert.equal(l.progressoAmarelo, pf.LIMIARES_PADRAO.progressoAmarelo);
});

// ---------------------------------------------------------------------------
// Progresso
// ---------------------------------------------------------------------------

const ponto = (tipo, dataRef, geral, dims = {}) => ({
  tipo, dataRef, geral: { nivel: geral },
  dimensoes: { ALIMENTACAO: { nivel: dims.A ?? geral }, RENDA: { nivel: dims.R ?? geral }, ECONOMIA: { nivel: dims.E ?? geral }, AUTONOMIA: { nivel: dims.U ?? geral } },
});
const periodo = { inicio: '2026-07-01', fim: '2026-12-31' };
const unidades = [{ id: 1, sigla: 'BRA', nome: 'Brasilândia' }, { id: 2, sigla: 'TIR', nome: 'Cidade Tiradentes' }];

test('agregarProgresso: compara primeiro e último ponto; só conta quem tem 2+ pontos e o último dentro do período', () => {
  const acompanhamentos = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, unidadeId: id <= 4 ? 1 : 2 }));
  const pontos = new Map([
    [1, [ponto('INICIAL', '2026-03-01', 40), ponto('FINAL', '2026-09-01', 70)]],                              // melhorou
    [2, [ponto('INICIAL', '2026-03-01', 50), ponto('REAVALIACAO', '2026-05-01', 60), ponto('FINAL', '2026-10-01', 52)]], // igual (+2)
    [3, [ponto('INICIAL', '2026-03-01', 60), ponto('FINAL', '2026-11-01', 40)]],                              // piorou
    [4, [ponto('INICIAL', '2026-08-01', 30)]],                                                                  // 1 ponto: fora da comparação
    [5, [ponto('INICIAL', '2026-01-01', 30), ponto('FINAL', '2026-04-01', 80)]],                              // último ponto antes do período
    [6, [ponto('INICIAL', '2026-03-01', 20, { A: 20 }), ponto('FINAL', '2027-02-01', 90)]],                   // último ponto depois do fim: ignora o ponto futuro
    [7, [ponto('INICIAL', '2026-03-01', 30), ponto('FINAL', '2026-08-01', 60)]],                              // melhorou
  ]);
  const r = pf.agregarProgresso({ acompanhamentos, pontos, periodo, unidades, nMinimo: 2, tolerancia: 5 });
  assert.equal(r.geral.n, 4, 'famílias 1, 2, 3 e 7');
  assert.deepEqual([r.geral.melhoraram, r.geral.iguais, r.geral.pioraram], [2, 1, 1]);
  assert.equal(r.geral.pctMelhoraram, 50);
  assert.equal(r.geral.semaforo, 'VERDE');
  assert.equal(r.geral.indiceMedioInicial, 45);
  assert.equal(r.geral.indiceMedioAtual, 55.5);
  assert.equal(r.geral.variacaoMedia, 10.5);
  const bra = r.unidades.find((u) => u.sigla === 'BRA');
  const tir = r.unidades.find((u) => u.sigla === 'TIR');
  assert.equal(bra.n, 3);
  assert.equal(tir.n, 1);
  assert.equal(tir.pctMelhoraram, null, 'n abaixo do mínimo: sem percentual');
  assert.equal(tir.semaforo, null);
  assert.equal(tir.melhoraram, 1, 'mas o número absoluto aparece');
  assert.equal(r.dimensoes.length, 4);
  assert.equal(r.dimensoes[0].nome, 'Alimentação');
  // distribuição: último ponto no período de cada família (1:70, 2:52, 3:40, 4:30, 7:60)
  assert.equal(r.distribuicao.n, 5);
  assert.deepEqual(r.distribuicao.faixas.map((f) => f.n), [0, 1, 2, 2, 0]);
});

test('agregarProgresso: n mínimo esconde percentuais e semáforo; dimensão sem dados não conta', () => {
  const acompanhamentos = [{ id: 1, unidadeId: 1 }, { id: 2, unidadeId: 1 }];
  const comRenda = (n) => ({ ...ponto('INICIAL', '2026-03-01', n), dimensoes: { ...ponto('X', 'x', n).dimensoes, RENDA: { nivel: null } } });
  const pontos = new Map([
    [1, [comRenda(40), ponto('FINAL', '2026-09-01', 70)]],
    [2, [ponto('INICIAL', '2026-03-01', 50), ponto('FINAL', '2026-09-01', 80)]],
  ]);
  const r = pf.agregarProgresso({ acompanhamentos, pontos, periodo, unidades, nMinimo: 5 });
  assert.equal(r.geral.n, 2);
  assert.equal(r.geral.suficiente, false);
  assert.equal(r.geral.pctMelhoraram, null);
  assert.equal(r.geral.semaforo, null);
  assert.equal(r.geral.melhoraram, 2);
  const renda = r.dimensoes.find((d) => d.codigo === 'RENDA');
  assert.equal(renda.n, 1, 'a família sem nível de renda no ponto inicial fica fora da dimensão');
});

test('agregarMetas: fotografia do fim do período e % atingidas só com n mínimo de metas encerradas', () => {
  const m = (id, ac, un, dim, status, concluidaEm, criadoEm = '2026-08-01T10:00:00Z') => ({ id, acompanhamentoId: ac, unidadeId: un, dimensao: dim, status, concluidaEm, criadoEm });
  const metas = [
    m(1, 1, 1, 'ALIMENTACAO', 'ATINGIDA', '2026-09-01'), m(2, 1, 1, 'RENDA', 'EM_ANDAMENTO', null), m(3, 2, 1, 'RENDA', 'NAO_ATINGIDA', '2026-10-10'),
    m(4, 2, 2, 'OUTRA', 'CANCELADA', '2026-10-11'), m(5, 3, 2, 'ECONOMIA', 'ATINGIDA', '2027-01-15'), // encerrada depois do fim: ainda em andamento
    m(6, 3, 2, 'ECONOMIA', 'ATINGIDA', '2026-11-01', '2027-01-02T10:00:00Z'),                          // criada depois do fim: não entra
  ];
  const r = pf.agregarMetas({ metas, fim: '2026-12-31', unidades, nMinimo: 2 });
  assert.equal(r.total, 5);
  assert.deepEqual([r.emAndamento, r.atingidas, r.naoAtingidas, r.canceladas], [2, 1, 1, 1]);
  assert.equal(r.pctAtingidas, 50, '1 atingida em 2 encerradas (n mínimo 2)');
  assert.equal(r.familiasComMeta, 3);
  assert.equal(r.porDimensao.find((d) => d.codigo === 'RENDA').total, 2);
  assert.equal(r.porUnidade.find((u) => u.sigla === 'TIR').total, 2);
  assert.equal(pf.agregarMetas({ metas, fim: '2026-12-31', unidades, nMinimo: 5 }).pctAtingidas, null);
});

test('agregarAcompanhamentos: concluídos, desligados, tempo médio e em andamento ao fim do período', () => {
  const a = (id, status, ini, enc) => ({ id, status, dataInicio: ini, dataEncerramento: enc });
  const r = pf.agregarAcompanhamentos({
    periodo,
    acompanhamentos: [
      a(1, 'CONCLUIDO', '2026-04-01', '2026-07-10'), a(2, 'DESLIGADO', '2026-06-01', '2026-08-01'), a(3, 'EM_ANDAMENTO', '2026-08-10', null),
      a(4, 'CONCLUIDO', '2026-01-01', '2026-03-01'), a(5, 'EM_ANDAMENTO', '2026-02-01', null),
    ],
  });
  assert.equal(r.concluidos, 1);
  assert.equal(r.desligados, 1);
  assert.equal(r.iniciados, 1);
  assert.equal(r.tempoMedioDias, Math.round((100 + 61) / 2));
  assert.equal(r.emAndamento, 2, 'ao fim do período só 3 e 5 seguem em andamento (1 e 2 encerraram dentro do período, 4 antes)');
});

// ---------------------------------------------------------------------------
// Satisfação
// ---------------------------------------------------------------------------

const itensDe = (nps, likert, extra = []) => [
  { codigo: 'NPS', tipo: 'NPS', valorNum: nps }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ codigo: `L${n}`, tipo: 'LIKERT', valorNum: Array.isArray(likert) ? likert[n - 1] : likert })), ...extra,
];

test('agregarSatisfacao: NPS = % promotoras − % detratoras, concordância, taxa de recusa e cobertura; abaixo do n mínimo não exibe', () => {
  const respostas = [];
  const itens = new Map();
  const add = (id, un, sit, nps, likert) => {
    respostas.push({ id, acompanhamentoId: id, unidadeId: un, situacao: sit });
    if (sit === 'CONCLUIDA') itens.set(id, itensDe(nps, likert));
  };
  add(1, 1, 'CONCLUIDA', 10, 5); add(2, 1, 'CONCLUIDA', 9, 4); add(3, 1, 'CONCLUIDA', 8, 4); add(4, 1, 'CONCLUIDA', 5, 2);
  add(5, 1, 'CONCLUIDA', 10, [5, 5, 5, 5, 5, 1]); add(6, 1, 'RECUSADA'); add(7, 2, 'CONCLUIDA', 3, 2);
  const textos = new Map([['L1', 'Fui tratada com respeito.'], ['L6', 'Resolvi meus problemas.']]);
  const r = pf.agregarSatisfacao({ respostas, itens, elegiveis: new Map([[1, 10], [2, 4]]), textos, unidades, nMinimo: 5 });
  const g = r.geral;
  assert.equal(g.respostas, 6);
  assert.equal(g.recusas, 1);
  assert.equal(g.suficiente, true);
  assert.equal(g.promotoras, 3);
  assert.equal(g.detratoras, 2);
  assert.equal(g.nps, Math.round(((3 - 2) / 6) * 100), 'NPS = (3 − 2) ÷ 6');
  assert.equal(g.taxaRecusa, Math.round((1 / 7) * 1000) / 10);
  assert.equal(g.elegiveis, 14);
  assert.equal(g.familiasComPesquisa, 7);
  assert.equal(g.taxaCobertura, 50);
  // concordância: afirmações com 4 ou 5 em 36 respostas (6 respostas × 6)
  assert.equal(g.concordancia, Math.round((6 + 6 + 6 + 0 + 5 + 0) / 36 * 100));
  assert.equal(g.semaforo, 'AMARELO', 'NPS 17 (≥ 0) e concordância 64% (≥ 60) mas abaixo do verde');
  // unidades: BRA tem 5 concluídas (n mínimo), TIR só 1
  const bra = r.unidades.find((u) => u.sigla === 'BRA');
  const tir = r.unidades.find((u) => u.sigla === 'TIR');
  assert.equal(bra.suficiente, true);
  assert.equal(tir.suficiente, false);
  assert.equal(tir.nps, null);
  assert.equal(tir.concordancia, null);
  assert.equal(tir.semaforo, null);
  assert.equal(tir.respostas, 1, 'o número absoluto aparece');
  // perguntas: da pior para a melhor concordância
  assert.equal(r.perguntas.length, 6);
  const conc = r.perguntas.map((p) => p.concordancia);
  assert.deepEqual(conc, [...conc].sort((a, b) => a - b));
  assert.equal(r.perguntas[0].codigo, 'L6');
  assert.equal(r.perguntas[0].texto, 'Resolvi meus problemas.');
});

test('agregarSatisfacao: sem respostas ou abaixo do mínimo => tudo nulo, sem semáforo', () => {
  const vazio = pf.agregarSatisfacao({ respostas: [], itens: new Map(), elegiveis: new Map(), unidades, nMinimo: 5 });
  assert.equal(vazio.geral.nps, null);
  assert.equal(vazio.geral.semaforo, null);
  assert.deepEqual(vazio.perguntas, []);
  const poucas = pf.agregarSatisfacao({
    respostas: [{ id: 1, acompanhamentoId: 1, unidadeId: 1, situacao: 'CONCLUIDA' }], itens: new Map([[1, itensDe(10, 5)]]), elegiveis: new Map([[1, 3]]), unidades, nMinimo: 5,
  });
  assert.equal(poucas.geral.respostas, 1);
  assert.equal(poucas.geral.nps, null);
  assert.equal(poucas.geral.taxaCobertura, null, 'elegíveis abaixo do mínimo');
  assert.equal(poucas.perguntas[0].concordancia, null);
});

test('periodoAnterior: mesma duração, colado no início do período', () => {
  assert.deepEqual(pf.periodoAnterior({ inicio: '2026-07-01', fim: '2026-12-31' }), { inicio: '2026-01-01', fim: '2026-06-30' });
  assert.deepEqual(pf.periodoAnterior({ inicio: '2026-03-01', fim: '2026-03-31' }), { inicio: '2026-02-01', fim: '2026-02-28' });
  assert.deepEqual(pf.periodoAnterior({ inicio: '2026-01-01', fim: '2026-06-30' }), { inicio: '2025-07-01', fim: '2025-12-31' });
  assert.deepEqual(pf.periodoAnterior({ inicio: '2026-03-10', fim: '2026-03-19' }), { inicio: '2026-02-28', fim: '2026-03-09' }, 'período livre: mesma quantidade de dias');
});

// ---------------------------------------------------------------------------
// Rotas (banco simulado)
// ---------------------------------------------------------------------------

test('progresso e satisfação: ASSISTENTE recebe 403; unidade fora do escopo 403', async () => {
  respostas = [];
  let srv = await iniciar(assistente);
  try {
    assert.equal((await srv.chamar('/progresso?inicio=2026-07-01&fim=2026-12-31')).status, 403);
    assert.equal((await srv.chamar('/satisfacao?inicio=2026-07-01&fim=2026-12-31')).status, 403);
  } finally { await srv.fechar(); }
  srv = await iniciar(coordenador);
  try {
    assert.equal((await srv.chamar('/progresso?inicio=2026-07-01&fim=2026-12-31&unidadeId=9')).status, 403);
    assert.equal((await srv.chamar('/satisfacao?inicio=2026-07-01&fim=2026-12-31&unidadeId=9')).status, 403);
    assert.equal((await srv.chamar('/progresso?inicio=2026-12-31&fim=2026-07-01')).status, 400);
  } finally { await srv.fechar(); }
});

test('progresso e satisfação: todas as consultas passam pelo filtro de unidade; vazio devolve estrutura completa', async () => {
  respostas = [];
  chamadas.length = 0;
  const srv = await iniciar(coordenador);
  try {
    let r = await srv.chamar('/progresso?inicio=2026-07-01&fim=2026-12-31&unidadeId=2');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.geral.n, 0);
    assert.equal(r.corpo.nMinimo, 5);
    assert.equal(r.corpo.dimensoes.length, 4);
    assert.equal(r.corpo.distribuicao.faixas.length, 5);
    assert.equal(r.corpo.metas.total, 0);
    assert.equal(r.corpo.anterior.periodo.fim, '2026-06-30');
    r = await srv.chamar('/satisfacao?inicio=2026-07-01&fim=2026-12-31');
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.comentarios, []);
    assert.equal(r.corpo.geral.semaforo, null);
    const deDados = chamadas.filter((c) => /FROM ASSOCIAL_(acompanhamento|pesquisa_resposta|acompanhamento_indice|acompanhamento_meta)\b/.test(c.sql) && !/FROM ASSOCIAL_configuracao/.test(c.sql));
    assert.ok(deDados.length >= 6);
    assert.ok(deDados.every((c) => /unidade_id IN \(@un0/.test(c.sql)), `consulta sem filtro de unidade: ${deDados.find((c) => !/unidade_id IN \(@un0/.test(c.sql))?.sql.slice(0, 120)}`);
    const comFiltro = chamadas.find((c) => /FROM ASSOCIAL_acompanhamento ac\s+WHERE/.test(c.sql) && c.params.sel0 === 2);
    assert.ok(comFiltro, 'o filtro de unidade escolhido também vai para a consulta');
  } finally { await srv.fechar(); }
});

test('satisfação: ADMIN lê os comentários como a coordenação; comentário oculto não aparece', async () => {
  respostas = [
    { teste: /FROM ASSOCIAL_unidade WHERE id IN/, resp: () => [{ id: 1, sigla: 'BRA', nome: 'Brasilândia' }, { id: 2, sigla: 'TIR', nome: 'Cidade Tiradentes' }] },
    { teste: /FROM ASSOCIAL_pesquisa_resposta r JOIN ASSOCIAL_acompanhamento ac/, resp: () => [
      { id: 1, acompanhamentoId: 11, unidadeId: 1, situacao: 'CONCLUIDA', momento: 'AVULSA', dataAplicacao: new Date('2026-09-01'), comentarioOculto: false },
      { id: 2, acompanhamentoId: 12, unidadeId: 1, situacao: 'CONCLUIDA', momento: 'AVULSA', dataAplicacao: new Date('2026-09-02'), comentarioOculto: true }] },
    { teste: /FROM ASSOCIAL_pesquisa_resposta_item i/, resp: () => [
      { respostaId: 1, codigo: 'T1', tipo: 'TEXTO', pergunta: 'x', valorNum: null, valorTexto: 'Preço justo', prefereNaoResponder: false },
      { respostaId: 2, codigo: 'T2', tipo: 'TEXTO', pergunta: 'x', valorNum: null, valorTexto: 'Texto ocultado', prefereNaoResponder: false }] },
  ];
  const srv = await iniciar(admin);
  try {
    const r = await srv.chamar('/satisfacao?inicio=2026-07-01&fim=2026-12-31');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.comentarios.length, 1);
    assert.equal(r.corpo.comentarios[0].texto, 'Preço justo');
    assert.equal(r.corpo.comentarios[0].sigla, 'BRA');
    assert.ok(!JSON.stringify(r.corpo).includes('ocultado'));
  } finally { await srv.fechar(); }
  respostas = [];
});
