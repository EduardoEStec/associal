'use strict';

// F4 — plano de metas: regras puras (validação, alerta "sem meta", avanço no registro), eventos da linha do tempo e rotas com banco SIMULADO.
// Rodar: node --test tests/familias/*.test.js   (o teste contra o banco real do Docker é tests/familias/metas.e2e.js)

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mssql = require('mssql');

let handlers = [];
const chamadas = [];
async function despachar(sql, params = {}) {
  chamadas.push({ sql, params });
  for (const hd of handlers) if (hd.teste.test(sql)) return hd.resp(params, sql);
  throw new Error(`SQL não simulado: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
}
const executor = {
  consultar: async (sql, params) => despachar(sql, params),
  consultarUm: async (sql, params) => (await despachar(sql, params))[0] || null,
  executar: async (sql, params) => ({ linhas: await despachar(sql, params) }),
};
const dbFalso = { tipos: mssql, ...executor, transacao: async (fn) => fn(executor), obterPool: async () => { throw new Error('sem pool'); }, fechar: async () => {} };
const caminhoDb = require.resolve('../../server/db');
require.cache[caminhoDb] = { id: caminhoDb, filename: caminhoDb, loaded: true, exports: dbFalso };

const rotas = require('../../server/routes/familias');
const regras = require('../../server/services/metas-regras');
const registros = require('../../server/services/acompanhamento-registros');
const familiasServico = require('../../server/services/familias');
const { tratarErros, protecaoCsrf } = require('../../server/middlewares/erros');

function iniciar(usuario) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.usuario = usuario; next(); });
  app.use(protecaoCsrf);
  app.use('/api/familias', rotas);
  app.use(tratarErros);
  return new Promise((resolve) => {
    const srv = app.listen(0, () => {
      const base = `http://127.0.0.1:${srv.address().port}/api/familias`;
      const chamar = async (metodo, url, corpo) => {
        const r = await fetch(base + url, {
          method: metodo, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
          body: corpo === undefined ? undefined : JSON.stringify(corpo),
        });
        return { status: r.status, corpo: await r.json().catch(() => null) };
      };
      resolve({ chamar, fechar: () => new Promise((ok) => srv.close(ok)) });
    });
  });
}

const hoje = familiasServico.hojeIso();
const dias = (n) => familiasServico.somarDias(hoje, n);
const assistente = { id: 10, perfil: 'ASSISTENTE', unidades: [{ id: 2, sigla: 'TIR' }] };
const assistenteOutraUnidade = { id: 11, perfil: 'ASSISTENTE', unidades: [{ id: 1, sigla: 'BRA' }] };
const coordenador = { id: 20, perfil: 'COORDENADOR', unidades: [{ id: 1, sigla: 'BRA' }, { id: 2, sigla: 'TIR' }] };
const admin = { id: 30, perfil: 'ADMIN', unidades: [{ id: 1 }, { id: 2 }] };

const valida = (corpo, extra = {}) => regras.validarMeta(corpo, { hoje, dataInicio: dias(-30), ...extra });
const boa = (sobre = {}) => ({ dimensao: 'ALIMENTACAO', descricao: 'Comprar frutas e verduras 3x por semana', prazo: dias(60), ...sobre });

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

test('validarMeta: meta completa é aceita e nasce em andamento; prazo é opcional', () => {
  const { erros, dados } = valida(boa());
  assert.deepEqual(erros, {});
  assert.equal(dados.status, 'EM_ANDAMENTO');
  assert.equal(dados.concluidaEm, null);
  assert.deepEqual(valida(boa({ prazo: '' })).erros, {});
  assert.equal(valida(boa({ prazo: null })).dados.prazo, null);
});

test('validarMeta: dimensão, descrição e prazo inválidos; 300 caracteres no máximo', () => {
  assert.ok(valida(boa({ dimensao: 'SAUDE' })).erros.dimensao);
  assert.ok(valida(boa({ dimensao: undefined })).erros.dimensao);
  assert.ok(valida(boa({ descricao: '   ' })).erros.descricao);
  assert.equal(valida(boa({ descricao: 'a'.repeat(300) })).erros.descricao, undefined);
  assert.match(valida(boa({ descricao: 'a'.repeat(301) })).erros.descricao, /300/);
  assert.ok(valida(boa({ prazo: 'ontem' })).erros.prazo);
  assert.ok(valida(boa({ prazo: dias(-31) })).erros.prazo, 'prazo antes do início');
});

test('validarMeta: meta nova só nasce em andamento; encerrar pede data válida (padrão hoje, nunca futura)', () => {
  assert.ok(valida(boa({ status: 'ATINGIDA' })).erros.status);
  const existente = { status: 'EM_ANDAMENTO', concluidaEm: null };
  const atingida = valida(boa({ status: 'ATINGIDA' }), { existente });
  assert.deepEqual(atingida.erros, {});
  assert.equal(atingida.dados.concluidaEm, hoje);
  assert.equal(valida(boa({ status: 'CANCELADA', concluidaEm: dias(-3) }), { existente }).dados.concluidaEm, dias(-3));
  assert.ok(valida(boa({ status: 'ATINGIDA', concluidaEm: dias(2) }), { existente }).erros.concluidaEm);
  assert.ok(valida(boa({ status: 'ATINGIDA', concluidaEm: dias(-40) }), { existente }).erros.concluidaEm, 'antes do início');
  assert.ok(valida(boa({ status: 'TALVEZ' }), { existente }).erros.status);
  // reabrir limpa a data; sem status no corpo mantém o atual
  const reaberta = valida(boa({ status: 'EM_ANDAMENTO', concluidaEm: dias(-3) }), { existente: { status: 'ATINGIDA', concluidaEm: dias(-3) } });
  assert.equal(reaberta.dados.concluidaEm, null);
  const mantida = valida(boa({ status: undefined }), { existente: { status: 'ATINGIDA', concluidaEm: new Date(`${dias(-5)}T00:00:00Z`) } });
  assert.equal(mantida.dados.status, 'ATINGIDA');
  assert.equal(mantida.dados.concluidaEm, dias(-5), 'mantém a data de encerramento já gravada');
});

test('validarMetasDoRegistro: só metas em andamento, avanço válido, sem repetir; tentativa sem contato não grava', () => {
  const abertas = [1, 2];
  assert.deepEqual(regras.validarMetasDoRegistro(undefined, { houveContato: true, abertas }), { erros: {}, itens: [] });
  const ok = regras.validarMetasDoRegistro([{ metaId: 1, avanco: 'AVANCOU' }, { metaId: 2, avanco: 'SEM_MUDANCA' }], { houveContato: true, abertas });
  assert.deepEqual(ok.erros, {});
  assert.equal(ok.itens.length, 2);
  assert.ok(regras.validarMetasDoRegistro([{ metaId: 9, avanco: 'AVANCOU' }], { houveContato: true, abertas }).erros.metas, 'meta de outro acompanhamento ou encerrada');
  assert.ok(regras.validarMetasDoRegistro([{ metaId: 1, avanco: 'VOOU' }], { houveContato: true, abertas }).erros.metas);
  assert.ok(regras.validarMetasDoRegistro([{ metaId: 1, avanco: 'AVANCOU' }, { metaId: 1, avanco: 'IGUAL' }], { houveContato: true, abertas }).erros.metas);
  assert.ok(regras.validarMetasDoRegistro('x', { houveContato: true, abertas }).erros.metas);
  assert.deepEqual(regras.validarMetasDoRegistro([{ metaId: 9, avanco: 'X' }], { houveContato: false, abertas }), { erros: {}, itens: [] });
});

test('calcularSemMeta: mais de X dias sem meta em andamento, contados do início ou da última meta encerrada', () => {
  const base = { status: 'EM_ANDAMENTO', hoje, dias: 30 };
  assert.equal(calc({ ...base, dataInicio: dias(-30), metas: [] }), null, 'exatamente 30 dias ainda não alerta');
  const sem = calc({ ...base, dataInicio: dias(-45), metas: [] });
  assert.deepEqual(sem, { desde: dias(-45), dias: 45, limiteDias: 30 });
  assert.equal(calc({ ...base, dataInicio: dias(-45), metas: [{ status: 'EM_ANDAMENTO', concluidaEm: null }] }), null, 'meta em andamento resolve');
  // meta encerrada recomeça a contagem
  assert.equal(calc({ ...base, dataInicio: dias(-90), metas: [{ status: 'ATINGIDA', concluidaEm: dias(-10) }] }), null);
  const depois = calc({ ...base, dataInicio: dias(-90), metas: [{ status: 'CANCELADA', concluidaEm: dias(-40) }, { status: 'ATINGIDA', concluidaEm: new Date(`${dias(-35)}T00:00:00Z`) }] });
  assert.equal(depois.desde, dias(-35));
  assert.equal(depois.dias, 35);
  // encerrado nunca alerta
  assert.equal(calc({ ...base, status: 'CONCLUIDO', dataInicio: dias(-90), metas: [] }), null);
  assert.equal(calc({ ...base, status: 'DESLIGADO', dataInicio: dias(-90), metas: [] }), null);
  // limite editável
  assert.ok(calc({ ...base, dias: 7, dataInicio: dias(-8), metas: [] }));
});
function calc(args) { return regras.calcularSemMeta(args); }

test('montarEventos: meta definida e meta encerrada entram na linha do tempo; registro mostra as metas tratadas', () => {
  const ac = { id: 100, status: 'EM_ANDAMENTO', dataInicio: new Date(`${dias(-40)}T00:00:00Z`), dataPrevistaFinal: null, dataEncerramento: null, observacoes: null };
  const metas = [
    { id: 1, dimensao: 'ALIMENTACAO', descricao: 'Comprar frutas', prazo: new Date(`${dias(20)}T00:00:00Z`), status: 'ATINGIDA', concluidaEm: new Date(`${dias(-2)}T00:00:00Z`),
      criadoEm: new Date(`${dias(-30)}T12:00:00Z`), alteradoEm: new Date(`${dias(-2)}T15:00:00Z`), autorNome: 'Ana' },
    { id: 2, dimensao: 'RENDA', descricao: 'Retomar o bico', prazo: null, status: 'EM_ANDAMENTO', concluidaEm: null, criadoEm: new Date(`${dias(-10)}T12:00:00Z`), alteradoEm: null, autorNome: 'Ana' },
  ];
  const registrosEv = [{ id: 7, dataRegistro: new Date(`${dias(-5)}T00:00:00Z`), criadoEm: new Date(`${dias(-5)}T14:00:00Z`), tipoContatoNome: 'Telefone', houveContato: true,
    situacao: 'MELHORANDO', resumo: 'Conversamos', autorNome: 'Ana', metasTratadas: [{ metaId: 1, descricao: 'Comprar frutas', avanco: 'AVANCOU' }] }];
  const e = registros.montarEventos({ ac, hoje, registros: registrosEv, atendimentos: [], questionarios: [], metas });
  const metaEv = e.filter((x) => x.tipo === 'META');
  assert.equal(metaEv.length, 3, 'definida, definida e atingida');
  assert.ok(metaEv.some((x) => x.titulo === 'Meta atingida' && x.data === dias(-2)));
  const def = metaEv.find((x) => x.titulo === 'Meta definida' && x.referencia.id === 1);
  assert.match(def.detalhe, /Alimentação · prazo /);
  assert.equal(def.resumo, 'Comprar frutas');
  const reg = e.find((x) => x.tipo === 'REGISTRO');
  assert.equal(reg.detalhe, 'Metas: Comprar frutas (avançou)');
  assert.ok(registros.TIPOS_EVENTO.includes('META'));
});

// ---------------------------------------------------------------------------
// Rotas (banco simulado)
// ---------------------------------------------------------------------------

const acRow = (p, sobre = {}) => {
  const permitidas = Object.entries(p).filter(([k]) => /^un\d+$/.test(k)).map(([, v]) => v);
  const linha = { id: 100, familiaId: 7, unidadeId: 2, usuarioId: 99, dataInicio: new Date(`${dias(-30)}T00:00:00Z`),
    dataPrevistaFinal: new Date(`${dias(60)}T00:00:00Z`), dataEncerramento: null, status: 'EM_ANDAMENTO', observacoes: null, ...sobre };
  return p.id === 100 && permitidas.includes(2) ? [linha] : [];
};
const baseHandlers = (sobreAc = {}, extra = []) => [
  { teste: /FROM acompanhamento ac(\s+WITH \([^)]*\))?\s+WHERE ac\.id = @id/, resp: (p) => acRow(p, sobreAc) },
  { teste: /INSERT INTO auditoria/, resp: () => [] },
  { teste: /FROM configuracao/, resp: () => [] },
  ...extra,
];
const listaVazia = [
  { teste: /FROM acompanhamento_meta m\s+JOIN usuario/, resp: () => [] },
  { teste: /FROM registro_meta rm/, resp: () => [] },
];

test('assistente de outra unidade recebe 404 em todas as rotas de metas', async () => {
  handlers = baseHandlers();
  const srv = await iniciar(assistenteOutraUnidade);
  try {
    for (const [metodo, url, corpo] of [
      ['GET', '/acompanhamentos/100/metas'], ['POST', '/acompanhamentos/100/metas', boa()], ['PUT', '/acompanhamentos/100/metas/1', boa()],
    ]) assert.equal((await srv.chamar(metodo, url, corpo)).status, 404, `${metodo} ${url}`);
  } finally { await srv.fechar(); }
});

test('GET metas: sem metas há mais de 30 dias => alerta; traz dimensões e histórico de avanços', async () => {
  handlers = baseHandlers({}, [
    { teste: /FROM acompanhamento_meta m\s+JOIN usuario/, resp: () => [
      { id: 5, dimensao: 'RENDA', descricao: 'Retomar o bico', prazo: new Date(`${dias(-1)}T00:00:00Z`), status: 'EM_ANDAMENTO', concluidaEm: null, usuarioId: 10, autorNome: 'Ana', criadoEm: new Date(), alteradoEm: null }] },
    { teste: /FROM registro_meta rm/, resp: () => [{ metaId: 5, avanco: 'AVANCOU', registroId: 9, dataRegistro: new Date(`${dias(-3)}T00:00:00Z`) }] },
  ]);
  const srv = await iniciar(assistente);
  try {
    const r = await srv.chamar('GET', '/acompanhamentos/100/metas');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.semMeta, null, 'tem meta em andamento');
    assert.equal(r.corpo.dimensoes.length, 5);
    const m = r.corpo.metas[0];
    assert.equal(m.dimensaoNome, 'Renda');
    assert.equal(m.vencida, true, 'prazo passou');
    assert.equal(m.ultimoAvanco, 'AVANCOU');
    assert.equal(m.historico.length, 1);
  } finally { await srv.fechar(); }
  handlers = baseHandlers({ dataInicio: new Date(`${dias(-45)}T00:00:00Z`) }, listaVazia);
  const srv2 = await iniciar(assistente);
  try {
    const r = await srv2.chamar('GET', '/acompanhamentos/100/metas');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.semMeta.dias, 45);
    assert.equal(r.corpo.semMeta.limiteDias, 30);
    assert.deepEqual(r.corpo.metas, []);
  } finally { await srv2.fechar(); }
});

test('criar meta: validação 400 por campo; grava com usuário e auditoria; encerrado => 409; ADMIN também cria', async () => {
  handlers = baseHandlers({}, [{ teste: /INSERT INTO acompanhamento_meta/, resp: () => [{ id: 55 }] }]);
  chamadas.length = 0;
  let srv = await iniciar(assistente);
  try {
    let r = await srv.chamar('POST', '/acompanhamentos/100/metas', { dimensao: 'X', descricao: '' });
    assert.equal(r.status, 400);
    assert.ok(r.corpo.erro.detalhes.dimensao && r.corpo.erro.detalhes.descricao);
    r = await srv.chamar('POST', '/acompanhamentos/100/metas', boa());
    assert.equal(r.status, 201);
    assert.deepEqual(r.corpo, { id: 55 });
    const ins = chamadas.find((c) => /INSERT INTO acompanhamento_meta/.test(c.sql));
    assert.equal(ins.params.usuario, 10);
    assert.equal(ins.params.dimensao, 'ALIMENTACAO');
    const aud = chamadas.find((c) => /INSERT INTO auditoria/.test(c.sql) && c.params.tabela === 'acompanhamento_meta');
    assert.ok(aud);
    assert.equal(aud.params.acao, 'CRIAR');
  } finally { await srv.fechar(); }
  srv = await iniciar(admin);
  try { assert.equal((await srv.chamar('POST', '/acompanhamentos/100/metas', boa())).status, 201); } finally { await srv.fechar(); }
  handlers = baseHandlers({ status: 'CONCLUIDO' }, [{ teste: /INSERT INTO acompanhamento_meta/, resp: () => [{ id: 56 }] }]);
  srv = await iniciar(coordenador);
  try { assert.equal((await srv.chamar('POST', '/acompanhamentos/100/metas', boa())).status, 409); } finally { await srv.fechar(); }
});

test('atualizar meta: encerra com data, reabre, meta de outro acompanhamento => 404, encerrado => 409', async () => {
  const montar = (sobreAc = {}, meta = { id: 5, status: 'EM_ANDAMENTO', concluidaEm: null }) => baseHandlers(sobreAc, [
    { teste: /FROM acompanhamento_meta WHERE id = @id AND acompanhamento_id = @ac/, resp: (p) => (p.id === 5 ? [meta] : []) },
    { teste: /UPDATE acompanhamento_meta/, resp: () => [] },
    ...listaVazia,
  ]);
  handlers = montar();
  chamadas.length = 0;
  let srv = await iniciar(assistente);
  try {
    const r = await srv.chamar('PUT', '/acompanhamentos/100/metas/5', boa({ status: 'ATINGIDA' }));
    assert.equal(r.status, 200);
    const up = chamadas.find((c) => /UPDATE acompanhamento_meta/.test(c.sql));
    assert.equal(up.params.status, 'ATINGIDA');
    assert.ok(up.params.concluida, 'data de encerramento gravada');
    assert.equal((await srv.chamar('PUT', '/acompanhamentos/100/metas/999', boa())).status, 404);
    assert.equal((await srv.chamar('PUT', '/acompanhamentos/100/metas/5', boa({ status: 'ATINGIDA', concluidaEm: dias(3) }))).status, 400);
  } finally { await srv.fechar(); }
  handlers = montar({ status: 'DESLIGADO' });
  srv = await iniciar(assistente);
  try { assert.equal((await srv.chamar('PUT', '/acompanhamentos/100/metas/5', boa())).status, 409); } finally { await srv.fechar(); }
});

test('registro de contato: marca avanço em meta em andamento e recusa meta que não é do acompanhamento', async () => {
  handlers = baseHandlers({}, [
    { teste: /FROM tipo_contato WHERE ativo = 1/, resp: () => [{ id: 1, nome: 'Visita domiciliar', exigeTexto: false }] },
    { teste: /SELECT id FROM acompanhamento_meta WHERE acompanhamento_id = @ac AND status = 'EM_ANDAMENTO'/, resp: () => [{ id: 5 }] },
    { teste: /INSERT INTO acompanhamento_registro/, resp: () => [{ id: 70 }] },
    { teste: /DELETE FROM registro_meta/, resp: () => [] },
    { teste: /INSERT INTO registro_meta/, resp: () => [] },
  ]);
  chamadas.length = 0;
  const srv = await iniciar(assistente);
  try {
    const corpo = { dataRegistro: hoje, tipoContatoId: 1, houveContato: true, situacao: 'MELHORANDO', resumo: 'Visita' };
    let r = await srv.chamar('POST', '/acompanhamentos/100/registros', { ...corpo, metas: [{ metaId: 5, avanco: 'AVANCOU' }] });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const lig = chamadas.find((c) => /INSERT INTO registro_meta/.test(c.sql));
    assert.deepEqual([lig.params.r, lig.params.m, lig.params.a], [70, 5, 'AVANCOU']);
    r = await srv.chamar('POST', '/acompanhamentos/100/registros', { ...corpo, metas: [{ metaId: 77, avanco: 'AVANCOU' }] });
    assert.equal(r.status, 400);
    assert.ok(r.corpo.erro.detalhes.metas);
  } finally { await srv.fechar(); }
});
