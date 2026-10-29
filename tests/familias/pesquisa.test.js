'use strict';

// F3 — pesquisa de satisfação identificada: regras puras (validação, NPS/satisfação, pendência) e rotas com banco SIMULADO.
// Rodar: node --test tests/familias/*.test.js   (o teste contra o banco real do Docker é tests/familias/pesquisa.e2e.js)

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
const regras = require('../../server/services/pesquisa-regras');
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
const outraAssistenteMesmaUnidade = { id: 12, perfil: 'ASSISTENTE', unidades: [{ id: 2, sigla: 'TIR' }] };
const coordenador = { id: 20, perfil: 'COORDENADOR', unidades: [{ id: 1, sigla: 'BRA' }, { id: 2, sigla: 'TIR' }] };
const admin = { id: 30, perfil: 'ADMIN', unidades: [{ id: 1 }, { id: 2 }] };

const perguntas = [
  { id: 1, codigo: 'NPS', tipo: 'NPS' },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: 1 + n, codigo: `L${n}`, tipo: 'LIKERT' })),
  { id: 8, codigo: 'T1', tipo: 'TEXTO' }, { id: 9, codigo: 'T2', tipo: 'TEXTO' },
];
const completa = (sobre = {}) => ({
  situacao: 'CONCLUIDA', momento: 'AVULSA', dataAplicacao: hoje, modo: 'FAMILIA_FALOU', consentimentoLido: true,
  itens: [{ codigo: 'NPS', valorNum: 9 }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ codigo: `L${n}`, valorNum: 4 })), { codigo: 'T1', valorTexto: 'Preço bom' }],
  ...sobre,
});
const valida = (corpo, extra = {}) => regras.validarPesquisa(corpo, { hoje, dataInicio: dias(-30), perguntas, ...extra });

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

test('validarPesquisa: pesquisa completa é aceita; textos são opcionais', () => {
  const { erros, dados } = valida(completa());
  assert.deepEqual(erros, {});
  assert.equal(dados.itens.length, 8);
  assert.equal(dados.itens.find((i) => i.perguntaId === 1).valorNum, 9);
  assert.equal(valida(completa({ itens: completa().itens.slice(0, 7) })).erros.itens, undefined, 'sem os textos continua válida');
});

test('validarPesquisa: concluir exige nota e as 6 afirmações (ou "prefere não responder")', () => {
  const sem = completa({ itens: [{ codigo: 'NPS', valorNum: 9 }] });
  const r = valida(sem);
  assert.ok(r.erros['itens.L1'] && r.erros['itens.L6']);
  const recusas = completa({ itens: ['NPS', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((c) => ({ codigo: c, preferNaoResponder: true })) });
  const ok = valida(recusas);
  assert.deepEqual(ok.erros, {});
  assert.ok(ok.dados.itens.every((i) => i.preferNaoResponder && i.valorNum === null));
});

test('validarPesquisa: faixas (NPS 0–10, afirmações 1–5), pergunta desconhecida e texto longo', () => {
  assert.ok(valida(completa({ itens: [{ codigo: 'NPS', valorNum: 11 }] })).erros['itens.NPS']);
  assert.ok(valida(completa({ itens: [{ codigo: 'NPS', valorNum: -1 }] })).erros['itens.NPS']);
  assert.ok(valida(completa({ itens: [{ codigo: 'L1', valorNum: 0 }] })).erros['itens.L1']);
  assert.ok(valida(completa({ itens: [{ codigo: 'L1', valorNum: 6 }] })).erros['itens.L1']);
  assert.ok(valida(completa({ itens: [{ codigo: 'L1', valorNum: 2.5 }] })).erros['itens.L1']);
  assert.ok(valida(completa({ itens: [{ codigo: 'XYZ', valorNum: 1 }] })).erros.itens);
  assert.ok(valida(completa({ itens: [{ codigo: 'T1', valorTexto: 'x'.repeat(1001) }] })).erros['itens.T1']);
});

test('validarPesquisa: rascunho aceita parcial; consentimento é obrigatório; modo só ao concluir', () => {
  const rasc = { situacao: 'RASCUNHO', momento: 'SEMESTRAL', consentimentoLido: true, itens: [{ codigo: 'NPS', valorNum: 7 }] };
  assert.deepEqual(valida(rasc).erros, {});
  assert.ok(valida({ ...rasc, consentimentoLido: false }).erros.consentimentoLido);
  assert.ok(valida(completa({ consentimentoLido: false })).erros.consentimentoLido);
  assert.ok(valida(completa({ modo: undefined })).erros.modo);
  assert.ok(valida(completa({ modo: 'POR_TELEPATIA' })).erros.modo);
});

test('validarPesquisa: recusada descarta itens, modo e consentimento; momento, situação e data inválidos', () => {
  const r = valida({ situacao: 'RECUSADA', momento: 'FINAL', itens: [{ codigo: 'NPS', valorNum: 9 }], modo: 'FAMILIA_FALOU' });
  assert.deepEqual(r.erros, {});
  assert.deepEqual(r.dados.itens, []);
  assert.equal(r.dados.modo, null);
  assert.ok(valida(completa({ momento: 'ANUAL' })).erros.momento);
  assert.ok(valida(completa({ situacao: 'ANULADA' })).erros.situacao);
  assert.ok(valida(completa({ dataAplicacao: dias(1) })).erros.dataAplicacao);
  assert.ok(valida(completa({ dataAplicacao: dias(-31) })).erros.dataAplicacao);
  assert.ok(valida(completa({ dataAplicacao: 'hoje' })).erros.dataAplicacao);
});

// ---------------------------------------------------------------------------
// Resultado (NPS e satisfação de uma resposta)
// ---------------------------------------------------------------------------

test('resumoPesquisa: categorias do NPS e índice de satisfação', () => {
  const itens = (nps, ...likert) => [{ tipo: 'NPS', valorNum: nps }, ...likert.map((v) => ({ tipo: 'LIKERT', valorNum: v, preferNaoResponder: v === null }))];
  assert.equal(regras.resumoPesquisa(itens(10, 5)).categoriaNps, 'PROMOTORA');
  assert.equal(regras.resumoPesquisa(itens(9, 5)).categoriaNps, 'PROMOTORA');
  assert.equal(regras.resumoPesquisa(itens(8, 5)).categoriaNps, 'NEUTRA');
  assert.equal(regras.resumoPesquisa(itens(7, 5)).categoriaNps, 'NEUTRA');
  assert.equal(regras.resumoPesquisa(itens(6, 5)).categoriaNps, 'DETRATORA');
  assert.equal(regras.resumoPesquisa(itens(0, 5)).categoriaNps, 'DETRATORA');
  const r = regras.resumoPesquisa(itens(9, 5, 5, 4, 3, 2, 1));
  assert.equal(r.afirmacoesRespondidas, 6);
  assert.equal(r.concordancia, 50); // 5,5,4 concordam
  assert.equal(r.indice, 58); // (100+100+75+50+25+0)/6 = 58,3
  const parcial = regras.resumoPesquisa(itens(null, 5, null, 1));
  assert.equal(parcial.nps, null);
  assert.equal(parcial.categoriaNps, null);
  assert.equal(parcial.afirmacoesRespondidas, 2);
  assert.equal(parcial.indice, 50);
  assert.equal(parcial.recusas, 1);
  assert.equal(regras.resumoPesquisa([]).indice, null);
});

// ---------------------------------------------------------------------------
// Pendência
// ---------------------------------------------------------------------------

const base = { status: 'EM_ANDAMENTO', dataInicio: dias(-100), dataEncerramento: null, dataQuestionarioFinal: null, pesquisas: [], hoje, intervaloDias: 180, prazoFinalDias: 60 };

test('calcularPendencia: semestral só depois do intervalo, contado do início ou da última pesquisa', () => {
  assert.equal(regras.calcularPendencia(base), null);
  const velha = regras.calcularPendencia({ ...base, dataInicio: dias(-200) });
  assert.equal(velha.momento, 'SEMESTRAL');
  assert.equal(velha.devidaEm, dias(-20));
  assert.equal(velha.diasAtraso, 20);
  assert.equal(regras.calcularPendencia({ ...base, dataInicio: dias(-200), pesquisas: [{ momento: 'SEMESTRAL', situacao: 'CONCLUIDA', dataAplicacao: dias(-30) }] }), null, 'a última pesquisa reinicia a contagem');
  assert.equal(regras.calcularPendencia({ ...base, dataInicio: dias(-200), pesquisas: [{ momento: 'SEMESTRAL', situacao: 'RECUSADA', dataAplicacao: dias(-30) }] }), null, 'recusa também resolve');
  assert.equal(regras.calcularPendencia({ ...base, dataInicio: dias(-200), pesquisas: [{ momento: 'SEMESTRAL', situacao: 'RASCUNHO', dataAplicacao: dias(-30) }] }).momento, 'SEMESTRAL', 'rascunho não resolve');
  assert.equal(regras.calcularPendencia({ ...base, dataInicio: dias(-200), pesquisas: [{ momento: 'SEMESTRAL', situacao: 'ANULADA', dataAplicacao: dias(-30) }] }).momento, 'SEMESTRAL', 'anulada não resolve');
  assert.equal(regras.calcularPendencia({ ...base, dataInicio: dias(-180) }).diasAtraso, 0, 'vence no dia');
});

test('calcularPendencia: final com questionário final concluído, ou concluído há até 60 dias; desligado não', () => {
  const f = regras.calcularPendencia({ ...base, dataQuestionarioFinal: dias(-3) });
  assert.equal(f.momento, 'FINAL');
  assert.equal(f.devidaEm, dias(-3));
  const concl = { ...base, status: 'CONCLUIDO', dataEncerramento: dias(-10), dataQuestionarioFinal: dias(-12) };
  assert.equal(regras.calcularPendencia(concl).momento, 'FINAL');
  assert.equal(regras.calcularPendencia({ ...concl, dataEncerramento: dias(-61) }), null, 'passou o prazo');
  assert.equal(regras.calcularPendencia({ ...concl, pesquisas: [{ momento: 'FINAL', situacao: 'CONCLUIDA', dataAplicacao: dias(-5) }] }), null, 'já tem a final');
  assert.equal(regras.calcularPendencia({ ...base, status: 'DESLIGADO', dataEncerramento: dias(-5) }), null);
  // final concluída em andamento: a pesquisa semestral não aparece junto
  assert.equal(regras.calcularPendencia({ ...base, dataInicio: dias(-300), dataQuestionarioFinal: dias(-3), pesquisas: [{ momento: 'FINAL', situacao: 'CONCLUIDA', dataAplicacao: dias(-1) }] }), null);
});

// ---------------------------------------------------------------------------
// Linha do tempo
// ---------------------------------------------------------------------------

test('montarEventos: pesquisa concluída aparece com nota e comentários; recusada sem conteúdo', () => {
  const ac = { id: 100, status: 'EM_ANDAMENTO', dataInicio: new Date(`${dias(-40)}T00:00:00Z`), dataPrevistaFinal: null, dataEncerramento: null, observacoes: null };
  const pesquisas = [
    { id: 1, momento: 'SEMESTRAL', dataAplicacao: new Date(`${dias(-5)}T00:00:00Z`), situacao: 'CONCLUIDA', criadoEm: new Date(), autorNome: 'Ana',
      resumo: { nps: 9, categoriaNps: 'PROMOTORA', indice: 83 }, comentarios: [{ codigo: 'T1', texto: 'Preço bom' }, { codigo: 'T2', texto: 'Mais horários' }] },
    { id: 2, momento: 'FINAL', dataAplicacao: new Date(`${dias(-2)}T00:00:00Z`), situacao: 'RECUSADA', criadoEm: new Date(), autorNome: 'Ana', resumo: null, comentarios: [] },
  ];
  const e = registros.montarEventos({ ac, hoje, registros: [], atendimentos: [], questionarios: [], pesquisas });
  const concl = e.find((x) => x.referencia.id === 1);
  assert.equal(concl.tipo, 'PESQUISA');
  assert.match(concl.detalhe, /Nota geral: 9 de 10/);
  assert.match(concl.detalhe, /Satisfação: 83%/);
  assert.match(concl.resumo, /Faz de melhor: Preço bom/);
  assert.equal(concl.nps, 9);
  const rec = e.find((x) => x.referencia.id === 2);
  assert.match(rec.titulo, /preferiu não responder/);
  assert.equal(rec.resumo, null);
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
const modeloRow = { id: 1, codigo: 'SATISFACAO', versao: 1, titulo: 'Pesquisa', aviso: 'Aviso provisório.' };
const baseHandlers = (sobreAc = {}, extra = []) => [
  { teste: /FROM ASSOCIAL_acompanhamento ac(\s+WITH \([^)]*\))?\s+WHERE ac\.id = @id/, resp: (p) => acRow(p, sobreAc) },
  { teste: /INSERT INTO ASSOCIAL_auditoria/, resp: () => [] },
  { teste: /FROM ASSOCIAL_configuracao/, resp: () => [] },
  { teste: /FROM ASSOCIAL_pesquisa_modelo WHERE/, resp: () => [modeloRow] },
  { teste: /FROM ASSOCIAL_pesquisa_pergunta WHERE modelo_id/, resp: () => perguntas.map((p, i) => ({ ...p, ordem: i + 1, texto: `Pergunta ${p.codigo}` })) },
  { teste: /^\s*SELECT momento, situacao, data_aplicacao FROM ASSOCIAL_pesquisa_resposta/, resp: () => [] },
  { teste: /FROM ASSOCIAL_questionario WHERE acompanhamento_id = @id AND tipo = 'FINAL'/, resp: () => [] },
  ...extra,
];

test('assistente de outra unidade recebe 404 em todas as rotas da pesquisa', async () => {
  handlers = baseHandlers();
  const srv = await iniciar(assistenteOutraUnidade);
  try {
    for (const [metodo, url, corpo] of [
      ['GET', '/acompanhamentos/100/pesquisas'], ['POST', '/acompanhamentos/100/pesquisas', completa()],
      ['GET', '/acompanhamentos/100/pesquisas/1'], ['PUT', '/acompanhamentos/100/pesquisas/1', completa()],
      ['POST', '/acompanhamentos/100/pesquisas/1/anular', { motivo: 'x' }],
    ]) assert.equal((await srv.chamar(metodo, url, corpo)).status, 404, `${metodo} ${url}`);
  } finally { await srv.fechar(); }
});

test('ADMIN opera como a coordenação: lê a lista, aplica a pesquisa e a auditoria registra quem foi (V12)', async () => {
  handlers = baseHandlers({}, [
    { teste: /FROM ASSOCIAL_pesquisa_resposta WHERE acompanhamento_id = @ac AND momento = @m AND situacao = 'RASCUNHO'/, resp: () => [] },
    { teste: /FROM ASSOCIAL_pesquisa_resposta r\s+JOIN ASSOCIAL_pesquisa_modelo/, resp: () => [] },
    { teste: /INSERT INTO ASSOCIAL_pesquisa_resposta \(/, resp: () => [{ id: 56 }] },
    { teste: /DELETE FROM ASSOCIAL_pesquisa_resposta_item/, resp: () => [] },
    { teste: /INSERT INTO ASSOCIAL_pesquisa_resposta_item/, resp: () => [] },
  ]);
  chamadas.length = 0;
  const srv = await iniciar(admin);
  try {
    const r = await srv.chamar('GET', '/acompanhamentos/100/pesquisas');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.textoRestrito, undefined);
    assert.ok(chamadas.some((c) => /FROM ASSOCIAL_pesquisa_resposta r/.test(c.sql)), 'consulta as respostas');
    const c = await srv.chamar('POST', '/acompanhamentos/100/pesquisas', completa());
    assert.equal(c.status, 201);
    const ins = chamadas.find((x) => /INSERT INTO ASSOCIAL_pesquisa_resposta \(/.test(x.sql));
    assert.equal(ins.params.usuario, 30, 'a resposta fica no nome de quem aplicou');
    const aud = chamadas.find((x) => /INSERT INTO ASSOCIAL_auditoria/.test(x.sql) && x.params.tabela === 'pesquisa_resposta');
    assert.ok(aud, 'auditoria registrada');
    assert.equal(aud.params.usuarioId, 30);
  } finally { await srv.fechar(); }
});

test('criar: validação 400 por item; momento FINAL exige questionário final; SEMESTRAL só em andamento', async () => {
  handlers = baseHandlers();
  let srv = await iniciar(assistente);
  try {
    let r = await srv.chamar('POST', '/acompanhamentos/100/pesquisas', completa({ itens: [{ codigo: 'NPS', valorNum: 9 }], consentimentoLido: false }));
    assert.equal(r.status, 400);
    assert.ok(r.corpo.erro.detalhes['itens.L1'] && r.corpo.erro.detalhes.consentimentoLido);
    r = await srv.chamar('POST', '/acompanhamentos/100/pesquisas', completa({ momento: 'FINAL' }));
    assert.equal(r.status, 409, 'final antes do questionário final concluído');
    assert.match(r.corpo.erro.mensagem, /questionário final/);
  } finally { await srv.fechar(); }
  handlers = baseHandlers({ status: 'CONCLUIDO', dataEncerramento: new Date(`${dias(-3)}T00:00:00Z`) });
  srv = await iniciar(assistente);
  try {
    const r = await srv.chamar('POST', '/acompanhamentos/100/pesquisas', completa({ momento: 'SEMESTRAL' }));
    assert.equal(r.status, 409, 'semestral em acompanhamento encerrado');
  } finally { await srv.fechar(); }
});

test('criar: grava resposta e itens, sem texto na auditoria; rascunho aberto bloqueia nova pesquisa do mesmo momento', async () => {
  handlers = baseHandlers({}, [
    { teste: /FROM ASSOCIAL_pesquisa_resposta WHERE acompanhamento_id = @ac AND momento = @m AND situacao = 'RASCUNHO'/, resp: () => [] },
    { teste: /INSERT INTO ASSOCIAL_pesquisa_resposta \(/, resp: () => [{ id: 55 }] },
    { teste: /DELETE FROM ASSOCIAL_pesquisa_resposta_item/, resp: () => [] },
    { teste: /INSERT INTO ASSOCIAL_pesquisa_resposta_item/, resp: () => [] },
  ]);
  chamadas.length = 0;
  let srv = await iniciar(assistente);
  try {
    const r = await srv.chamar('POST', '/acompanhamentos/100/pesquisas', completa());
    assert.equal(r.status, 201);
    assert.deepEqual(r.corpo, { id: 55, situacao: 'CONCLUIDA' });
    assert.equal(chamadas.filter((c) => /INSERT INTO ASSOCIAL_pesquisa_resposta_item/.test(c.sql)).length, 8);
    const ins = chamadas.find((c) => /INSERT INTO ASSOCIAL_pesquisa_resposta \(/.test(c.sql));
    assert.equal(ins.params.usuario, 10);
    assert.equal(ins.params.situacao, 'CONCLUIDA');
    assert.equal(ins.params.consent, true);
    const aud = chamadas.find((c) => /INSERT INTO ASSOCIAL_auditoria/.test(c.sql) && c.params.tabela === 'pesquisa_resposta');
    assert.ok(aud);
    assert.ok(!/Preço bom/.test(aud.params.detalhes), 'sem comentário na auditoria');
  } finally { await srv.fechar(); }
  handlers = baseHandlers({}, [{ teste: /FROM ASSOCIAL_pesquisa_resposta WHERE acompanhamento_id = @ac AND momento = @m AND situacao = 'RASCUNHO'/, resp: () => [{ id: 7 }] }]);
  srv = await iniciar(assistente);
  try {
    const r = await srv.chamar('POST', '/acompanhamentos/100/pesquisas', completa());
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.detalhes.respostaId, 7);
  } finally { await srv.fechar(); }
});

test('editar e anular: só o autor ou a coordenação; concluída não é editável; motivo obrigatório', async () => {
  const resp = (usuarioId, situacao) => [{ id: 9, modeloId: 1, usuarioId, situacao, momento: 'AVULSA' }];
  const montar = (usuarioId, situacao) => baseHandlers({}, [
    { teste: /FROM ASSOCIAL_pesquisa_resposta\s+WHERE id = @id AND acompanhamento_id = @ac AND situacao <> 'ANULADA'/, resp: () => resp(usuarioId, situacao) },
    { teste: /FROM ASSOCIAL_pesquisa_resposta WHERE id = @id AND acompanhamento_id = @ac AND situacao <> 'ANULADA'/, resp: () => [{ id: 9, usuarioId }] },
    { teste: /UPDATE ASSOCIAL_pesquisa_resposta/, resp: () => [] },
    { teste: /DELETE FROM ASSOCIAL_pesquisa_resposta_item/, resp: () => [] },
    { teste: /INSERT INTO ASSOCIAL_pesquisa_resposta_item/, resp: () => [] },
    { teste: /FROM ASSOCIAL_pesquisa_resposta r\s+JOIN ASSOCIAL_pesquisa_modelo/, resp: () => [] },
  ]);
  handlers = montar(10, 'RASCUNHO');
  let srv = await iniciar(outraAssistenteMesmaUnidade);
  try {
    assert.equal((await srv.chamar('PUT', '/acompanhamentos/100/pesquisas/9', completa())).status, 403);
    assert.equal((await srv.chamar('POST', '/acompanhamentos/100/pesquisas/9/anular', { motivo: 'x' })).status, 403);
  } finally { await srv.fechar(); }
  srv = await iniciar(assistente); // é a autora
  try {
    assert.equal((await srv.chamar('PUT', '/acompanhamentos/100/pesquisas/9', completa())).status, 200);
    let r = await srv.chamar('POST', '/acompanhamentos/100/pesquisas/9/anular', {});
    assert.equal(r.status, 400);
    assert.ok(r.corpo.erro.detalhes.motivo);
    assert.equal((await srv.chamar('POST', '/acompanhamentos/100/pesquisas/9/anular', { motivo: 'Aplicada na família errada' })).status, 200);
  } finally { await srv.fechar(); }
  handlers = montar(10, 'CONCLUIDA');
  srv = await iniciar(assistente);
  try {
    const r = await srv.chamar('PUT', '/acompanhamentos/100/pesquisas/9', completa());
    assert.equal(r.status, 409, 'pesquisa concluída não se edita');
  } finally { await srv.fechar(); }
  handlers = montar(10, 'CONCLUIDA');
  srv = await iniciar(coordenador);
  try {
    assert.equal((await srv.chamar('POST', '/acompanhamentos/100/pesquisas/9/anular', { motivo: 'Pedido da família' })).status, 200, 'coordenação anula a de outra pessoa');
  } finally { await srv.fechar(); }
});

test('ocultar comentário: só COORDENADOR e ADMIN', async () => {
  handlers = baseHandlers({}, [
    { teste: /FROM ASSOCIAL_pesquisa_resposta WHERE id = @id AND acompanhamento_id = @ac AND situacao = 'CONCLUIDA'/, resp: () => [{ id: 9 }] },
    { teste: /UPDATE ASSOCIAL_pesquisa_resposta/, resp: () => [] },
    { teste: /FROM ASSOCIAL_pesquisa_resposta r\s+JOIN ASSOCIAL_pesquisa_modelo/, resp: () => [] },
  ]);
  let srv = await iniciar(assistente);
  try {
    assert.equal((await srv.chamar('PUT', '/acompanhamentos/100/pesquisas/9/comentario-oculto', { oculto: true })).status, 403);
  } finally { await srv.fechar(); }
  srv = await iniciar(coordenador);
  try {
    assert.equal((await srv.chamar('PUT', '/acompanhamentos/100/pesquisas/9/comentario-oculto', { oculto: 'sim' })).status, 400);
    assert.equal((await srv.chamar('PUT', '/acompanhamentos/100/pesquisas/9/comentario-oculto', { oculto: true })).status, 200);
  } finally { await srv.fechar(); }
  srv = await iniciar(admin);
  try {
    assert.equal((await srv.chamar('PUT', '/acompanhamentos/100/pesquisas/9/comentario-oculto', { oculto: true })).status, 200);
  } finally { await srv.fechar(); }
});
