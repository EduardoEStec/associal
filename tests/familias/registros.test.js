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

test('validarRegistro: observações do profissional aceitam até 2000 caracteres (M1)', () => {
  const ok = registros.validarRegistro({ ...valido, resumo: 'x'.repeat(2000) }, { hoje, dataInicio: diasAtras(10), tiposAtivos });
  assert.ok(!ok.erros.resumo);
  const r = registros.validarRegistro({ ...valido, resumo: 'x'.repeat(2001) }, { hoje, dataInicio: diasAtras(10), tiposAtivos });
  assert.ok(r.erros.resumo);
});

// ---------------------------------------------------------------------------
// M1 — registro periódico (modelo oficial 2): mês, uso do Armazém, orientações, aceite de foto
// ---------------------------------------------------------------------------

const usosAtivos = [{ id: 1 }, { id: 2 }, { id: 3 }];
const orientacoesAtivas = [{ id: 1, exigeTexto: false }, { id: 2, exigeTexto: false }, { id: 5, exigeTexto: true }];
const regra = (extra) => registros.validarRegistro({ ...valido, ...extra }, { hoje, dataInicio: diasAtras(60), tiposAtivos, usosAtivos, orientacoesAtivas });

test('M1 normalizarMes: aceita AAAA-MM e AAAA-MM-DD e devolve o dia 1', () => {
  assert.strictEqual(registros.normalizarMes('2026-10'), '2026-10-01');
  assert.strictEqual(registros.normalizarMes('2026-10-17'), '2026-10-01');
  assert.strictEqual(registros.normalizarMes(undefined), undefined);
  assert.strictEqual(registros.normalizarMes(''), null);
  assert.strictEqual(registros.normalizarMes('2026-13'), false);
  assert.strictEqual(registros.normalizarMes('outubro'), false);
});

test('M1 campos novos ausentes => undefined (não mexe no que já está gravado)', () => {
  const r = regra({});
  assert.deepStrictEqual(r.erros, {});
  for (const campo of ['mesReferencia', 'usoArmazemId', 'orientacaoIds', 'orientacaoOutro', 'familiaAceitaFoto']) assert.strictEqual(r.dados[campo], undefined, campo);
});

test('M1 mês de referência: não pode ser futuro nem anterior ao início do acompanhamento', () => {
  assert.strictEqual(regra({ mesReferencia: hoje.slice(0, 7) }).dados.mesReferencia, `${hoje.slice(0, 7)}-01`);
  assert.ok(regra({ mesReferencia: '2999-01' }).erros.mesReferencia);
  assert.ok(regra({ mesReferencia: '2001-01' }).erros.mesReferencia);
  assert.ok(regra({ mesReferencia: 'xx' }).erros.mesReferencia);
});

test('M1 uso do Armazém: só ids da lista; tentativa sem contato limpa', () => {
  assert.strictEqual(regra({ usoArmazemId: 2 }).dados.usoArmazemId, 2);
  assert.ok(regra({ usoArmazemId: 99 }).erros.usoArmazemId);
  assert.strictEqual(regra({ usoArmazemId: null }).dados.usoArmazemId, null);
  assert.strictEqual(regra({ houveContato: false, usoArmazemId: 2 }).dados.usoArmazemId, null);
});

test('M1 orientações: várias; "Outros" pede o texto; sem contato limpa', () => {
  assert.deepStrictEqual(regra({ orientacaoIds: [1, 2, 2] }).dados.orientacaoIds, [1, 2]);
  assert.ok(regra({ orientacaoIds: [9] }).erros.orientacaoIds);
  assert.ok(regra({ orientacaoIds: 'x' }).erros.orientacaoIds);
  assert.ok(regra({ orientacaoIds: [1, 5] }).erros.orientacaoOutro);
  const ok = regra({ orientacaoIds: [5], orientacaoOutro: 'Curso de culinária' });
  assert.deepStrictEqual(ok.erros, {});
  assert.strictEqual(ok.dados.orientacaoOutro, 'Curso de culinária');
  assert.strictEqual(regra({ orientacaoIds: [1], orientacaoOutro: 'sobra' }).dados.orientacaoOutro, null);
  assert.deepStrictEqual(regra({ houveContato: false, orientacaoIds: [1] }).dados.orientacaoIds, []);
});

test('M1 aceite de foto: booleano', () => {
  assert.strictEqual(regra({ familiaAceitaFoto: true }).dados.familiaAceitaFoto, true);
  assert.strictEqual(regra({ familiaAceitaFoto: false }).dados.familiaAceitaFoto, false);
  assert.ok(regra({ familiaAceitaFoto: 'talvez' }).erros.familiaAceitaFoto);
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
  { teste: /FROM ASSOCIAL_acompanhamento ac(\s+WITH \([^)]*\))?\s+WHERE ac\.id = @id/, resp: (p) => acRow(p, sobreAc) },
  { teste: /INSERT INTO ASSOCIAL_auditoria/, resp: () => [] },
  { teste: /FROM ASSOCIAL_configuracao/, resp: () => [{ chave: 'alerta_sem_contato_dias', valor: '30' }] },
  { teste: /FROM ASSOCIAL_tipo_contato WHERE ativo = 1/, resp: () => [{ id: 1, nome: 'Visita domiciliar', exigeTexto: false }, { id: 5, nome: 'Outro', exigeTexto: true }] },
  { teste: /FROM ASSOCIAL_uso_armazem WHERE ativo = 1/, resp: () => [
    { lista: 'USO', id: 1, nome: 'Utilizou regularmente', exigeTexto: false }, { lista: 'USO', id: 3, nome: 'Não utilizou no período', exigeTexto: false },
    { lista: 'ORI', id: 1, nome: 'Orientação sobre CadÚnico', exigeTexto: false }, { lista: 'ORI', id: 5, nome: 'Outros', exigeTexto: true },
    { lista: 'FRA', id: 1, nome: 'Atendimento realizado; situação familiar mantida.', exigeTexto: false }] },
  { teste: /FROM ASSOCIAL_(acompanhamento_meta|registro_meta)/, resp: () => [] },
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
    { teste: /^\s*SELECT TOP 1 .*FROM ASSOCIAL_acompanhamento_registro/s, resp: () => [] },
    { teste: /FROM ASSOCIAL_acompanhamento_registro r\s+JOIN ASSOCIAL_tipo_contato/, resp: () => [{
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
    { teste: /INSERT INTO ASSOCIAL_acompanhamento_registro/, resp: () => [{ id: 55 }] },
  ];
  chamadas.length = 0;
  const srv = await iniciar(coordenador);
  try {
    const r = await srv.chamar('POST', '/acompanhamentos/100/registros', { ...valido, dataRegistro: hoje });
    assert.equal(r.status, 201);
    assert.deepEqual(r.corpo, { id: 55 });
    const ins = chamadas.find((c) => /INSERT INTO ASSOCIAL_acompanhamento_registro/.test(c.sql));
    assert.equal(ins.params.usuario, 20);
    assert.equal(ins.params.ac, 100);
    assert.equal(ins.params.situacao, 'MELHORANDO');
    assert.ok(chamadas.some((c) => /INSERT INTO ASSOCIAL_auditoria/.test(c.sql) && c.params.tabela === 'acompanhamento_registro'));
  } finally { await srv.fechar(); }
});

test('editar/anular: só o autor ou a coordenação; anular exige motivo', async () => {
  const registro = (usuarioId) => [{ id: 9, acompanhamentoId: 100, usuarioId, anuladoEm: null }];
  handlers = [
    ...baseHandlers(),
    { teste: /FROM ASSOCIAL_acompanhamento_registro\s+WHERE id = @id AND acompanhamento_id = @ac/, resp: () => registro(10) },
    { teste: /^\s*UPDATE ASSOCIAL_acompanhamento_registro/, resp: () => [] },
    { teste: /FROM ASSOCIAL_acompanhamento_registro r JOIN ASSOCIAL_tipo_contato tc ON tc\.id = r\.tipo_contato_id WHERE r\.id = @id/, resp: () => [{ id: 1, exigeTexto: false }] },
  ];
  // outra assistente da mesma unidade (acompanhamento 100 é da unidade 2 → precisa da unidade 2)
  const assistenteU2 = { ...outraAssistente, unidades: [{ id: 2, sigla: 'TIR' }] };
  let srv = await iniciar(assistenteU2);
  try {
    assert.equal((await srv.chamar('PUT', '/acompanhamentos/100/registros/9', valido)).status, 403);
    assert.equal((await srv.chamar('POST', '/acompanhamentos/100/registros/9/anular', { motivo: 'erro' })).status, 403);
  } finally { await srv.fechar(); }

  const autor = { ...assistenteA, unidades: [{ id: 2, sigla: 'TIR' }] }; // id 10 = autor do registro 9
  handlers.push({ teste: /^\s*SELECT \(SELECT MAX\(v\.d\)/, resp: () => [] }, { teste: /^\s*SELECT TOP 1 .*FROM ASSOCIAL_acompanhamento_registro/s, resp: () => [] },
    { teste: /FROM ASSOCIAL_acompanhamento_registro r\s+JOIN ASSOCIAL_tipo_contato/, resp: () => [] });
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
    { teste: /FROM ASSOCIAL_familia f JOIN ASSOCIAL_pessoa p/, resp: () => [{ responsavelPessoaId: 5, nome: 'Maria' }] },
    { teste: /FROM ASSOCIAL_acompanhamento_registro r\s+JOIN ASSOCIAL_tipo_contato/, resp: () => [] },
    { teste: /FROM ASSOCIAL_atendimento a\s+JOIN ASSOCIAL_unidade/, resp: () => [] },
    { teste: /FROM ASSOCIAL_questionario q LEFT JOIN ASSOCIAL_usuario/, resp: () => [] },
    { teste: /FROM ASSOCIAL_pesquisa_resposta r\s+JOIN ASSOCIAL_pesquisa_modelo/, resp: () => [] },
    { teste: /^SELECT nome FROM ASSOCIAL_usuario/, resp: () => [{ nome: 'Ana' }] },
  ];
  chamadas.length = 0;
  const srv = await iniciar(coordenador);
  try {
    let r = await srv.chamar('GET', '/acompanhamentos/100/linha-do-tempo?tipos=REGISTRO,XYZ');
    assert.equal(r.status, 400);
    r = await srv.chamar('GET', '/acompanhamentos/100/linha-do-tempo?tipos=INICIO');
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.itens.map((e) => e.tipo), ['INICIO']);
    const at = chamadas.find((c) => /FROM ASSOCIAL_atendimento a/.test(c.sql));
    assert.match(at.sql, /a\.unidade_id IN \(@un0, @un1\)/);
    assert.equal(at.params.pessoa, 5);
  } finally { await srv.fechar(); }
});

// ---------------------------------------------------------------------------
// M1 — registro periódico (modelo oficial 2): rotas com banco simulado
// ---------------------------------------------------------------------------

test('M1 criar registro com mês, uso do Armazém, orientações e aceite de foto grava os campos novos e a N:N', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /INSERT INTO ASSOCIAL_acompanhamento_registro\s*\(/, resp: () => [{ id: 61 }] },
    { teste: /acompanhamento_registro_orientacao/, resp: () => [] },
  ];
  chamadas.length = 0;
  const srv = await iniciar(coordenador);
  try {
    const mes = hoje.slice(0, 7);
    const r = await srv.chamar('POST', '/acompanhamentos/100/registros', {
      ...valido, dataRegistro: hoje, mesReferencia: mes, usoArmazemId: 1, orientacaoIds: [1, 5], orientacaoOutro: 'Curso', familiaAceitaFoto: true,
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const ins = chamadas.find((c) => /INSERT INTO ASSOCIAL_acompanhamento_registro\s*\(/.test(c.sql));
    assert.equal(ins.params.uso, 1);
    assert.equal(ins.params.orientacaoOutro, 'Curso');
    assert.equal(ins.params.aceitaFoto, true);
    assert.equal(ins.params.mes[1], `${mes}-01`);
    const nn = chamadas.filter((c) => /INSERT INTO ASSOCIAL_acompanhamento_registro_orientacao/.test(c.sql));
    assert.deepEqual(nn.map((c) => c.params.o), [1, 5]);
    // uso fora da lista => 400 por campo
    const ruim = await srv.chamar('POST', '/acompanhamentos/100/registros', { ...valido, dataRegistro: hoje, usoArmazemId: 42 });
    assert.equal(ruim.status, 400);
    assert.ok(ruim.corpo.erro.detalhes.usoArmazemId);
  } finally { await srv.fechar(); }
});

test('M1 criar registro sem os campos novos continua válido (mês = mês da data) e não consulta as listas', async () => {
  handlers = [...baseHandlers(), { teste: /INSERT INTO ASSOCIAL_acompanhamento_registro\s*\(/, resp: () => [{ id: 62 }] }];
  chamadas.length = 0;
  const srv = await iniciar(coordenador);
  try {
    assert.equal((await srv.chamar('POST', '/acompanhamentos/100/registros', { ...valido, dataRegistro: hoje })).status, 201);
    const ins = chamadas.find((c) => /INSERT INTO ASSOCIAL_acompanhamento_registro\s*\(/.test(c.sql));
    assert.equal(ins.params.mes[1], `${hoje.slice(0, 7)}-01`);
    assert.equal(ins.params.uso, null);
    assert.equal(ins.params.aceitaFoto, false);
    assert.ok(!chamadas.some((c) => /FROM ASSOCIAL_uso_armazem/.test(c.sql)));
  } finally { await srv.fechar(); }
});

test('M1 listar registros devolve os campos novos, as listas de apoio e as fotos com data', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /^\s*SELECT \(SELECT MAX\(v\.d\)/, resp: () => [{ ultimoContato: new Date('2026-03-05') }] },
    { teste: /^\s*SELECT TOP 1 .*FROM ASSOCIAL_acompanhamento_registro/s, resp: () => [] },
    { teste: /FROM ASSOCIAL_acompanhamento_registro r\s+JOIN ASSOCIAL_tipo_contato/, resp: () => [{
      id: 1, dataRegistro: new Date('2026-03-10'), mesReferencia: new Date('2026-03-01'), tipoContatoId: 1, tipoContatoNome: 'Visita domiciliar',
      houveContato: true, situacao: 'IGUAL', resumo: 'Obs', usuarioId: 20, autorNome: 'Ana', criadoEm: new Date(), alteradoEm: null,
      usoArmazemId: 1, usoArmazemNome: 'Utilizou regularmente', orientacaoOutro: null, familiaAceitaFoto: true,
      orientacoesJson: '[{"id":1,"nome":"Orientação sobre CadÚnico","exige_texto":false}]',
      fotosJson: '[{"id":7,"legenda":"Cozinha","data_foto":"2026-03-10"}]' }] },
  ];
  const srv = await iniciar(coordenador);
  try {
    const r = await srv.chamar('GET', '/acompanhamentos/100/registros');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.usosArmazem.length, 2);
    assert.equal(r.corpo.frases[0].nome, 'Atendimento realizado; situação familiar mantida.');
    assert.ok(r.corpo.orientacoes.some((o) => o.exigeTexto));
    const reg = r.corpo.registros[0];
    assert.equal(reg.mesReferencia, '2026-03-01');
    assert.deepEqual(reg.usoArmazem, { id: 1, nome: 'Utilizou regularmente' });
    assert.equal(reg.orientacoes[0].nome, 'Orientação sobre CadÚnico');
    assert.equal(reg.familiaAceitaFoto, true);
    assert.deepEqual(reg.fotos, [{ id: 7, legenda: 'Cozinha', dataFoto: '2026-03-10', url: '/api/familias/acompanhamentos/100/registros/1/fotos/7' }]);
  } finally { await srv.fechar(); }
});

test('M1 fotos do registro: outra unidade 404; sem o aceite da família 409; foto de registro anulado 404', async () => {
  handlers = baseHandlers();
  let srv = await iniciar(assistenteA); // unidade 1; o acompanhamento 100 é da unidade 2
  try {
    for (const [metodo, url] of [
      ['POST', '/acompanhamentos/100/registros/1/fotos'], ['GET', '/acompanhamentos/100/registros/1/fotos/3'],
      ['PATCH', '/acompanhamentos/100/registros/1/fotos/3'], ['DELETE', '/acompanhamentos/100/registros/1/fotos/3'],
    ]) assert.equal((await srv.chamar(metodo, url, metodo === 'GET' ? undefined : {})).status, 404, `${metodo} ${url}`);
  } finally { await srv.fechar(); }

  handlers = [
    ...baseHandlers(),
    { teste: /FROM ASSOCIAL_acompanhamento_registro\s+WHERE id = @id AND acompanhamento_id = @ac/, resp: () => [{ id: 1, acompanhamentoId: 100, usuarioId: 20, anuladoEm: null, dataRegistro: new Date('2026-03-10'), familiaAceitaFoto: false }] },
    { teste: /FROM ASSOCIAL_acompanhamento_registro_foto f/, resp: () => [] },
  ];
  srv = await iniciar(coordenador);
  try {
    const r = await srv.chamar('POST', '/acompanhamentos/100/registros/1/fotos', {});
    assert.equal(r.status, 409);
    assert.match(r.corpo.erro.mensagem, /não aceitou fotos/);
    assert.equal((await srv.chamar('DELETE', '/acompanhamentos/100/registros/1/fotos/3')).status, 404, 'foto inexistente (ou de registro anulado)');
  } finally { await srv.fechar(); }
});

test('M1 editar: desmarcar o aceite com fotos anexadas é recusado', async () => {
  const registro = [{ id: 9, acompanhamentoId: 100, usuarioId: 20, anuladoEm: null, familiaAceitaFoto: true }];
  handlers = [
    ...baseHandlers(),
    { teste: /FROM ASSOCIAL_acompanhamento_registro\s+WHERE id = @id AND acompanhamento_id = @ac/, resp: () => registro },
    { teste: /FROM ASSOCIAL_acompanhamento_registro r JOIN ASSOCIAL_tipo_contato tc ON tc\.id = r\.tipo_contato_id WHERE r\.id = @id/, resp: () => [{ id: 1, exigeTexto: false }] },
    { teste: /COUNT\(\*\) AS n FROM ASSOCIAL_acompanhamento_registro_foto/, resp: () => [{ n: 2 }] },
    { teste: /^\s*UPDATE ASSOCIAL_acompanhamento_registro/, resp: () => [] },
  ];
  const srv = await iniciar(coordenador);
  try {
    const r = await srv.chamar('PUT', '/acompanhamentos/100/registros/9', { ...valido, dataRegistro: hoje, familiaAceitaFoto: false });
    assert.equal(r.status, 400);
    assert.match(r.corpo.erro.detalhes.familiaAceitaFoto, /Remova as fotos/);
  } finally { await srv.fechar(); }
});
