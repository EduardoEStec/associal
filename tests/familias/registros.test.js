'use strict';

// F2 — registros de acompanhamento, linha do tempo e alerta de contato.
// Parte pura (validação, eventos, regra de "sem contato") + rotas com banco SIMULADO. Rodar: node --test tests/familias/*.test.js
// O teste contra o banco real do Docker está em tests/familias/registros.e2e.js.

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
const registros = require('../../server/services/acompanhamento-registros');
const contato = require('../../server/services/acompanhamento-contato');
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

const assistenteA = { id: 10, perfil: 'ASSISTENTE', unidades: [{ id: 1, sigla: 'BRA' }] };
const outraAssistente = { id: 11, perfil: 'ASSISTENTE', unidades: [{ id: 1, sigla: 'BRA' }] };
const coordenador = { id: 20, perfil: 'COORDENADOR', unidades: [{ id: 1, sigla: 'BRA' }, { id: 2, sigla: 'TIR' }] };
const admin = { id: 30, perfil: 'ADMIN', unidades: [{ id: 1 }, { id: 2 }] };

const familiasServico = require('../../server/services/familias');
const hoje = familiasServico.hojeIso(); // mesmo "hoje" (data local) usado pelo serviço
const diasAtras = (n) => familiasServico.somarDias(hoje, -n);
const tiposAtivos = [{ id: 1, nome: 'Visita domiciliar', exigeTexto: false }, { id: 5, nome: 'Outro', exigeTexto: true }];
const valido = { dataRegistro: hoje, tipoContatoId: 1, houveContato: true, situacao: 'MELHORANDO', resumo: 'Conversamos sobre as compras.', proximoContatoEm: null };

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

test('validarRegistro: registro completo é aceito e normalizado', () => {
  const { erros, dados } = registros.validarRegistro({ ...valido, resumo: '  Texto  ' }, { hoje, dataInicio: diasAtras(10), tiposAtivos });
  assert.deepEqual(erros, {});
  assert.equal(dados.resumo, 'Texto');
  assert.equal(dados.houveContato, true);
  assert.equal(dados.situacao, 'MELHORANDO');
});

test('validarRegistro: com contato exige situação e resumo; sem contato dispensa e zera a situação', () => {
  const base = { hoje, dataInicio: diasAtras(10), tiposAtivos };
  let r = registros.validarRegistro({ ...valido, situacao: undefined, resumo: '' }, base);
  assert.ok(r.erros.situacao && r.erros.resumo);
  r = registros.validarRegistro({ ...valido, houveContato: false, situacao: 'PIORANDO', resumo: '' }, base);
  assert.deepEqual(r.erros, {});
  assert.equal(r.dados.situacao, null);
  assert.equal(r.dados.houveContato, false);
  r = registros.validarRegistro({ ...valido, houveContato: undefined }, base);
  assert.ok(r.erros.houveContato);
});

test('validarRegistro: datas (futura, antes do início, próximo contato antes do contato) e tipo', () => {
  const base = { hoje, dataInicio: diasAtras(10), tiposAtivos };
  assert.ok(registros.validarRegistro({ ...valido, dataRegistro: '2999-01-01' }, base).erros.dataRegistro);
  assert.ok(registros.validarRegistro({ ...valido, dataRegistro: diasAtras(20) }, base).erros.dataRegistro);
  assert.ok(registros.validarRegistro({ ...valido, dataRegistro: 'ontem' }, base).erros.dataRegistro);
  assert.ok(registros.validarRegistro({ ...valido, dataRegistro: diasAtras(2), proximoContatoEm: diasAtras(3) }, base).erros.proximoContatoEm);
  assert.ok(registros.validarRegistro({ ...valido, proximoContatoEm: '31/12/2026' }, base).erros.proximoContatoEm);
  assert.ok(registros.validarRegistro({ ...valido, tipoContatoId: 99 }, base).erros.tipoContatoId);
  assert.ok(registros.validarRegistro({ ...valido, tipoContatoId: null }, base).erros.tipoContatoId);
});

test('validarRegistro: tipo "Outro" exige descrição; descrição é descartada nos demais tipos', () => {
  const base = { hoje, dataInicio: diasAtras(10), tiposAtivos };
  assert.ok(registros.validarRegistro({ ...valido, tipoContatoId: 5 }, base).erros.tipoContatoOutro);
  const ok = registros.validarRegistro({ ...valido, tipoContatoId: 5, tipoContatoOutro: ' Escola ' }, base);
  assert.deepEqual(ok.erros, {});
  assert.equal(ok.dados.tipoContatoOutro, 'Escola');
  assert.equal(registros.validarRegistro({ ...valido, tipoContatoOutro: 'lixo' }, base).dados.tipoContatoOutro, null);
});

test('validarRegistro: resumo acima de 1000 caracteres é recusado', () => {
  const r = registros.validarRegistro({ ...valido, resumo: 'x'.repeat(1001) }, { hoje, dataInicio: diasAtras(10), tiposAtivos });
  assert.ok(r.erros.resumo);
});

// ---------------------------------------------------------------------------
// Regra do alerta "sem contato"
// ---------------------------------------------------------------------------

test('resumoContato: mais de X dias => semContato; exatamente X não; encerrado nunca', () => {
  const r = (status, dias, limite = 30) => contato.resumoContato({ status, ultimoContato: new Date(`${diasAtras(dias)}T00:00:00Z`), hoje, limiteDias: limite });
  assert.equal(r('EM_ANDAMENTO', 31).semContato, true);
  assert.equal(r('EM_ANDAMENTO', 30).semContato, false);
  assert.equal(r('EM_ANDAMENTO', 0).diasSemContato, 0);
  assert.equal(r('EM_ANDAMENTO', 10, 7).semContato, true);
  const enc = r('DESLIGADO', 90);
  assert.equal(enc.semContato, false);
  assert.equal(enc.diasSemContato, null);
});

test('sqlUltimoContato: ignora tentativa sem sucesso e registro anulado; usa a unidade do acompanhamento', () => {
  const sql = contato.sqlUltimoContato('ac', 'f');
  assert.match(sql, /r\.houve_contato = 1 AND r\.anulado_em IS NULL/);
  assert.match(sql, /a\.unidade_id = ac\.unidade_id/);
  assert.match(sql, /q\.concluido = 1/);
});

// ---------------------------------------------------------------------------
// Linha do tempo (montagem dos eventos)
// ---------------------------------------------------------------------------

const acBase = { id: 100, status: 'EM_ANDAMENTO', dataInicio: new Date('2026-03-01'), dataPrevistaFinal: new Date('2026-05-30'), dataEncerramento: null, observacoes: null, assistenteNome: 'Ana' };

test('montarEventos: ordem do mais novo ao mais antigo, com todos os tipos', () => {
  const eventos = registros.montarEventos({
    ac: acBase, hoje: '2026-04-20', familiaNome: 'Maria',
    registros: [{ id: 1, dataRegistro: new Date('2026-04-10'), criadoEm: new Date('2026-04-10T15:00:00Z'), tipoContatoNome: 'Telefone', houveContato: true, situacao: 'IGUAL', resumo: 'Tudo certo', proximoContatoEm: new Date('2026-05-10'), autorNome: 'Ana' },
      { id: 2, dataRegistro: new Date('2026-04-15'), criadoEm: new Date('2026-04-15T15:00:00Z'), tipoContatoNome: 'Visita domiciliar', houveContato: false, situacao: null, resumo: null, autorNome: 'Ana' }],
    atendimentos: [{ id: 7, dataAtendimento: new Date('2026-04-12'), criadoEm: new Date('2026-04-12T12:00:00Z'), unidadeSigla: 'BRA', resumo: 'Orientação', demandas: 'Saúde', encaminhamentos: 'CRAS, UBS', autorNome: 'Bia' },
      { id: 6, dataAtendimento: new Date('2026-02-01'), criadoEm: new Date('2026-02-01T12:00:00Z'), unidadeSigla: 'BRA', resumo: null, demandas: 'CadÚnico', encaminhamentos: null, autorNome: 'Bia' }],
    questionarios: [{ id: 3, tipo: 'INICIAL', dataAplicacao: new Date('2026-03-02'), criadoEm: new Date('2026-03-02T10:00:00Z'), alteradoEm: null, autorNome: 'Ana' }],
  });
  assert.deepEqual(eventos.map((e) => `${e.data}:${e.tipo}`), [
    '2026-05-30:PRAZO',
    '2026-04-15:REGISTRO',
    '2026-04-12:ENCAMINHAMENTO',
    '2026-04-12:ATENDIMENTO',
    '2026-04-10:REGISTRO',
    '2026-03-02:QUESTIONARIO',
    '2026-03-01:INICIO',
    '2026-02-01:ATENDIMENTO',
  ]);
  const antes = eventos.find((e) => e.data === '2026-02-01');
  assert.equal(antes.antesDoInicio, true);
  assert.equal(eventos.find((e) => e.tipo === 'PRAZO').futuro, true);
  assert.match(eventos.find((e) => e.id === undefined && e.tipo === 'ENCAMINHAMENTO').detalhe, /CRAS, UBS/);
  const tentativa = eventos.find((e) => e.referencia.id === 2);
  assert.match(tentativa.titulo, /Tentativa sem sucesso/);
  assert.equal(tentativa.situacao, null);
});

test('montarEventos: encerramento aparece, prazo some; textos livres aparecem para todos os perfis com acesso (V12)', () => {
  const encerrado = { ...acBase, status: 'CONCLUIDO', dataEncerramento: new Date('2026-05-20'), observacoes: 'Motivo sigiloso' };
  const comTudo = registros.montarEventos({ ac: encerrado, hoje: '2026-06-01', registros: [], atendimentos: [], questionarios: [{ id: 4, tipo: 'FINAL', dataAplicacao: new Date('2026-05-19'), criadoEm: new Date('2026-05-19T10:00:00Z'), autorNome: 'Ana' }] });
  assert.equal(comTudo[0].tipo, 'ENCERRAMENTO');
  assert.equal(comTudo[0].resumo, 'Motivo sigiloso');
  assert.ok(!comTudo.some((e) => e.tipo === 'PRAZO'));
  const abertos = registros.montarEventos({
    ac: encerrado, hoje: '2026-06-01',
    registros: [{ id: 1, dataRegistro: new Date('2026-04-10'), criadoEm: new Date('2026-04-10T15:00:00Z'), tipoContatoNome: 'Telefone', houveContato: true, situacao: 'IGUAL', resumo: 'Segredo', autorNome: 'Ana' }],
    atendimentos: [{ id: 7, dataAtendimento: new Date('2026-04-12'), criadoEm: new Date('2026-04-12T12:00:00Z'), unidadeSigla: 'BRA', resumo: 'Segredo 2', demandas: 'Saúde', encaminhamentos: null, autorNome: 'Bia' }],
    questionarios: [],
  });
  assert.ok(JSON.stringify(abertos).includes('Segredo'));
  assert.ok(JSON.stringify(abertos).includes('Segredo 2'));
});

// ---------------------------------------------------------------------------
// Rotas (banco simulado): escopo de unidade, perfis, regras de negócio
// ---------------------------------------------------------------------------

const acRow = (p, sobre = {}) => {
  const permitidas = Object.entries(p).filter(([k]) => /^un\d+$/.test(k)).map(([, v]) => v);
  const linha = { id: 100, familiaId: 7, unidadeId: 2, usuarioId: 99, dataInicio: new Date('2026-03-01'),
    dataPrevistaFinal: new Date('2026-05-30'), dataEncerramento: null, status: 'EM_ANDAMENTO', observacoes: null, ...sobre };
  return p.id === 100 && permitidas.includes(2) ? [linha] : [];
};
const baseHandlers = (sobreAc = {}) => [
  { teste: /FROM acompanhamento ac(\s+WITH \([^)]*\))?\s+WHERE ac\.id = @id/, resp: (p) => acRow(p, sobreAc) },
  { teste: /INSERT INTO auditoria/, resp: () => [] },
  { teste: /FROM configuracao/, resp: () => [{ chave: 'alerta_sem_contato_dias', valor: '30' }] },
  { teste: /FROM tipo_contato WHERE ativo = 1/, resp: () => [{ id: 1, nome: 'Visita domiciliar', exigeTexto: false }, { id: 5, nome: 'Outro', exigeTexto: true }] },
];

test('assistente de outra unidade recebe 404 em todas as rotas de registro e linha do tempo', async () => {
  handlers = baseHandlers();
  const srv = await iniciar(assistenteA); // unidade 1; o acompanhamento 100 é da unidade 2
  try {
    for (const [metodo, url, corpo] of [
      ['GET', '/acompanhamentos/100/registros'],
      ['POST', '/acompanhamentos/100/registros', valido],
      ['PUT', '/acompanhamentos/100/registros/1', valido],
      ['POST', '/acompanhamentos/100/registros/1/anular', { motivo: 'erro' }],
      ['GET', '/acompanhamentos/100/linha-do-tempo'],
    ]) {
      const r = await srv.chamar(metodo, url, corpo);
      assert.equal(r.status, 404, `${metodo} ${url}`);
    }
  } finally { await srv.fechar(); }
});

test('ADMIN opera como a coordenação: lê os textos, altera registros de outros e a validação roda (V12)', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /^\s*SELECT \(SELECT MAX\(v\.d\)/, resp: () => [{ ultimoContato: new Date('2026-03-05') }] },
    { teste: /^\s*SELECT TOP 1 .*FROM acompanhamento_registro/s, resp: () => [] },
    { teste: /FROM acompanhamento_registro r\s+JOIN tipo_contato/, resp: () => [{
      id: 1, dataRegistro: new Date('2026-03-10'), tipoContatoId: 1, tipoContatoNome: 'Telefone', tipoContatoOutro: null, houveContato: true,
      situacao: 'IGUAL', resumo: 'Texto confidencial', proximoContatoEm: null, usuarioId: 10, autorNome: 'Ana', criadoEm: new Date(), alteradoEm: null }] },
  ];
  const srv = await iniciar(admin);
  try {
    // chega à validação (400), não é barrado por perfil (403)
    assert.equal((await srv.chamar('POST', '/acompanhamentos/100/registros', { houveContato: true })).status, 400);
    assert.equal((await srv.chamar('POST', '/acompanhamentos/100/registros/1/anular', {})).status, 400);
    const r = await srv.chamar('GET', '/acompanhamentos/100/registros');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.textoRestrito, undefined);
    assert.equal(r.corpo.registros[0].resumo, 'Texto confidencial');
    assert.equal(r.corpo.registros[0].podeAlterar, true, 'registro de outro autor (usuarioId 10): ADMIN pode, como a coordenação');
  } finally { await srv.fechar(); }
});

test('criar registro: validação 400 com detalhes por campo; encerrado => 409', async () => {
  handlers = baseHandlers();
  let srv = await iniciar(coordenador);
  try {
    const r = await srv.chamar('POST', '/acompanhamentos/100/registros', { houveContato: true });
    assert.equal(r.status, 400);
    assert.ok(r.corpo.erro.detalhes.tipoContatoId);
    assert.ok(r.corpo.erro.detalhes.situacao);
    assert.ok(r.corpo.erro.detalhes.resumo);
  } finally { await srv.fechar(); }
  handlers = baseHandlers({ status: 'DESLIGADO', dataEncerramento: new Date('2026-04-01') });
  srv = await iniciar(coordenador);
  try {
    const r = await srv.chamar('POST', '/acompanhamentos/100/registros', valido);
    assert.equal(r.status, 409);
  } finally { await srv.fechar(); }
});

test('criar registro: grava com usuário, tipo e auditoria', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /INSERT INTO acompanhamento_registro/, resp: () => [{ id: 55 }] },
  ];
  chamadas.length = 0;
  const srv = await iniciar(coordenador);
  try {
    const r = await srv.chamar('POST', '/acompanhamentos/100/registros', { ...valido, dataRegistro: hoje });
    assert.equal(r.status, 201);
    assert.deepEqual(r.corpo, { id: 55 });
    const ins = chamadas.find((c) => /INSERT INTO acompanhamento_registro/.test(c.sql));
    assert.equal(ins.params.usuario, 20);
    assert.equal(ins.params.ac, 100);
    assert.equal(ins.params.situacao, 'MELHORANDO');
    assert.ok(chamadas.some((c) => /INSERT INTO auditoria/.test(c.sql) && c.params.tabela === 'acompanhamento_registro'));
  } finally { await srv.fechar(); }
});

test('editar/anular: só o autor ou a coordenação; anular exige motivo', async () => {
  const registro = (usuarioId) => [{ id: 9, acompanhamentoId: 100, usuarioId, anuladoEm: null }];
  handlers = [
    ...baseHandlers(),
    { teste: /FROM acompanhamento_registro\s+WHERE id = @id AND acompanhamento_id = @ac/, resp: () => registro(10) },
    { teste: /^\s*UPDATE acompanhamento_registro/, resp: () => [] },
    { teste: /FROM acompanhamento_registro r JOIN tipo_contato tc ON tc\.id = r\.tipo_contato_id WHERE r\.id = @id/, resp: () => [{ id: 1, exigeTexto: false }] },
  ];
  // outra assistente da mesma unidade (acompanhamento 100 é da unidade 2 → precisa da unidade 2)
  const assistenteU2 = { ...outraAssistente, unidades: [{ id: 2, sigla: 'TIR' }] };
  let srv = await iniciar(assistenteU2);
  try {
    assert.equal((await srv.chamar('PUT', '/acompanhamentos/100/registros/9', valido)).status, 403);
    assert.equal((await srv.chamar('POST', '/acompanhamentos/100/registros/9/anular', { motivo: 'erro' })).status, 403);
  } finally { await srv.fechar(); }

  const autor = { ...assistenteA, unidades: [{ id: 2, sigla: 'TIR' }] }; // id 10 = autor do registro 9
  handlers.push({ teste: /^\s*SELECT \(SELECT MAX\(v\.d\)/, resp: () => [] }, { teste: /^\s*SELECT TOP 1 .*FROM acompanhamento_registro/s, resp: () => [] },
    { teste: /FROM acompanhamento_registro r\s+JOIN tipo_contato/, resp: () => [] });
  srv = await iniciar(autor);
  try {
    let r = await srv.chamar('POST', '/acompanhamentos/100/registros/9/anular', {});
    assert.equal(r.status, 400);
    assert.ok(r.corpo.erro.detalhes.motivo);
    r = await srv.chamar('POST', '/acompanhamentos/100/registros/9/anular', { motivo: 'Registrei na família errada' });
    assert.equal(r.status, 200);
    const upd = chamadas.filter((c) => /SET anulado_em/.test(c.sql)).pop();
    assert.equal(upd.params.motivo, 'Registrei na família errada');
    r = await srv.chamar('PUT', '/acompanhamentos/100/registros/9', valido);
    assert.equal(r.status, 200);
  } finally { await srv.fechar(); }

  const coord2 = { ...coordenador };
  srv = await iniciar(coord2);
  try {
    assert.equal((await srv.chamar('POST', '/acompanhamentos/100/registros/9/anular', { motivo: 'x' })).status, 200, 'coordenação pode anular registro de outra pessoa');
  } finally { await srv.fechar(); }
});

test('linha do tempo: filtra atendimentos pelas unidades permitidas e valida o filtro de tipos', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /FROM familia f JOIN pessoa p/, resp: () => [{ responsavelPessoaId: 5, nome: 'Maria' }] },
    { teste: /FROM acompanhamento_registro r\s+JOIN tipo_contato/, resp: () => [] },
    { teste: /FROM atendimento a\s+JOIN unidade/, resp: () => [] },
    { teste: /FROM questionario q LEFT JOIN usuario/, resp: () => [] },
    { teste: /FROM pesquisa_resposta r\s+JOIN pesquisa_modelo/, resp: () => [] },
    { teste: /^SELECT nome FROM usuario/, resp: () => [{ nome: 'Ana' }] },
  ];
  chamadas.length = 0;
  const srv = await iniciar(coordenador);
  try {
    let r = await srv.chamar('GET', '/acompanhamentos/100/linha-do-tempo?tipos=REGISTRO,XYZ');
    assert.equal(r.status, 400);
    r = await srv.chamar('GET', '/acompanhamentos/100/linha-do-tempo?tipos=INICIO');
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.itens.map((e) => e.tipo), ['INICIO']);
    const at = chamadas.find((c) => /FROM atendimento a/.test(c.sql));
    assert.match(at.sql, /a\.unidade_id IN \(@un0, @un1\)/);
    assert.equal(at.params.pessoa, 5);
  } finally { await srv.fechar(); }
});
