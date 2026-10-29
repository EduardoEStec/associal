'use strict';

// Testes sem SQL Server: substitui server/db.js por um banco simulado.
// Rodar: node tests/atendimentos/teste.js

const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

const raiz = path.resolve(__dirname, '..', '..');
const caminhoDb = require.resolve(path.join(raiz, 'server', 'db.js'));

// ---- banco simulado ----
const log = [];
let respostas = []; // [{ casa: RegExp, linhas: [...] }]
const executor = {
  async consultar(texto, params) {
    log.push({ texto, params });
    const r = respostas.find((x) => x.casa.test(texto));
    return r ? (typeof r.linhas === 'function' ? r.linhas(params) : r.linhas) : [];
  },
  async consultarUm(texto, params) { return (await executor.consultar(texto, params))[0] || null; },
  async executar(texto, params) { return { linhas: await executor.consultar(texto, params), afetadas: [1] }; },
};
const tipos = { Date: 'Date', Decimal: () => 'Decimal' };
require.cache[caminhoDb] = {
  id: caminhoDb, filename: caminhoDb, loaded: true, children: [], paths: [], parent: null,
  exports: { ...executor, tipos, transacao: async (fn) => fn(executor), obterPool: async () => ({}), fechar: async () => {} },
};
void Module;

const express = require('express');
const { ErroApp } = require(path.join(raiz, 'server', 'lib', 'erros.js'));
const atendimentos = require(path.join(raiz, 'server', 'routes', 'atendimentos.js'));
const pessoasRouter = require(path.join(raiz, 'server', 'routes', 'pessoas.js'));
const svc = require(path.join(raiz, 'server', 'services', 'atendimentos.js'));

const UNIDADE_A = { id: 1, sigla: 'BRA', nome: 'Brasilândia' };
let usuario = { id: 10, perfil: 'ASSISTENTE', unidades: [UNIDADE_A] };

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.usuario = usuario; req.session = {}; next(); });
app.use('/api/atendimentos', atendimentos);
app.use('/api/pessoas', pessoasRouter);
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof ErroApp) return res.status(err.status).json({ erro: { codigo: err.codigo, detalhes: err.detalhes } });
  console.error(err);
  return res.status(500).json({ erro: { codigo: 'ERRO_INTERNO', mensagem: err.message } });
});

let porta;
function chamar(metodo, url, corpo) {
  return new Promise((resolve, reject) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({ port: porta, path: url, method: metodo, headers: { 'content-type': 'application/json' } }, (res) => {
      let txt = '';
      res.on('data', (c) => { txt += c; });
      res.on('end', () => resolve({ status: res.statusCode, corpo: txt ? JSON.parse(txt) : null }));
    });
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}

const FAIXAS = [
  { id: 1, idade_min: 60, idade_max: null }, { id: 2, idade_min: 30, idade_max: 59 },
  { id: 3, idade_min: 18, idade_max: 29 }, { id: 4, idade_min: 12, idade_max: 17 }, { id: 5, idade_min: null, idade_max: null },
].map((f) => ({ id: f.id, idadeMin: f.idade_min, idadeMax: f.idade_max }));

const corpoValido = () => ({
  dataAtendimento: '2026-03-10', nome: 'Maria Souza', cpf: '529.982.247-25', dataNascimento: '1980-03-11',
  demandas: [1, 2], vulnerabilidades: [], encaminhamentos: [3], resumo: 'Teste',
});

let falhas = 0;
async function teste(nome, fn) {
  log.length = 0;
  try { await fn(); console.log(`ok   - ${nome}`); } catch (e) { falhas += 1; console.error(`FALHA - ${nome}\n  ${e.stack}`); }
}

(async () => {
  const servidor = http.createServer(app).listen(0);
  porta = servidor.address().port;

  await teste('faixa etária: calcula na data do atendimento (aniversário no dia seguinte)', () => {
    const base = { pessoa: { dataNascimento: '1980-03-11' }, dataAtendimento: '2026-03-10' };
    assert.equal(svc.escolherFaixa(FAIXAS, base), 2); // 45 anos
    assert.equal(svc.escolherFaixa(FAIXAS, { pessoa: { dataNascimento: '1966-03-11' }, dataAtendimento: '2026-03-10' }), 2); // 59
    assert.equal(svc.escolherFaixa(FAIXAS, { pessoa: { dataNascimento: '1966-03-10' }, dataAtendimento: '2026-03-10' }), 1); // 60
    assert.equal(svc.escolherFaixa(FAIXAS, { pessoa: { dataNascimento: '2020-01-01' }, dataAtendimento: '2026-03-10' }), 5); // criança -> Outra
    assert.equal(svc.escolherFaixa(FAIXAS, { pessoa: { dataNascimento: null }, dataAtendimento: '2026-03-10', faixaEtariaId: 3 }), 3);
  });

  await teste('validarCorpo: obrigatórios, CPF inválido e data futura', () => {
    const { problemas } = svc.validarCorpo({ cpf: '111.111.111-11', dataAtendimento: '2999-01-01', demandas: 'x' });
    assert.ok(problemas.nome && problemas.cpf && problemas.dataAtendimento && problemas.demandas);
    assert.deepEqual(Object.keys(svc.validarCorpo(corpoValido()).problemas), []);
  });

  await teste('telefone: normaliza dígitos, aceita 10/11 e rejeita inválidos', () => {
    const ok = svc.validarCorpo({ ...corpoValido(), telefone: '(11) 91234-5678', telefone2: '1123456789' });
    assert.equal(ok.dados.pessoa.telefone, '11912345678');
    assert.equal(ok.dados.pessoa.telefone2, '1123456789');
    assert.equal(svc.validarCorpo({ ...corpoValido(), telefone: '' }).dados.pessoa.telefone, null);
    assert.ok(svc.validarCorpo({ ...corpoValido(), telefone: '12345' }).problemas.telefone);
    assert.ok(svc.validarCorpo({ ...corpoValido(), telefone2: '0123456789' }).problemas.telefone2);
  });

  await teste('POST valida no back-end (400 com detalhes)', async () => {
    const r = await chamar('POST', '/api/atendimentos', { nome: '' });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.codigo, 'VALIDACAO');
    assert.ok(r.corpo.erro.detalhes.nome);
  });

  await teste('POST cria pessoa nova + atendimento + N:N na transação', async () => {
    respostas = [
      { casa: /FROM ASSOCIAL_demanda WHERE id IN/, linhas: [{ id: 1, exigeTexto: false }, { id: 2, exigeTexto: false }] },
      { casa: /FROM ASSOCIAL_encaminhamento WHERE id IN/, linhas: [{ id: 3, exigeTexto: false }] },
      { casa: /FROM ASSOCIAL_faixa_etaria/, linhas: FAIXAS },
      { casa: /INSERT INTO ASSOCIAL_pessoa/, linhas: [{ id: 77 }] },
      { casa: /INSERT INTO ASSOCIAL_atendimento \(/, linhas: [{ id: 501 }] },
    ];
    const r = await chamar('POST', '/api/atendimentos', corpoValido());
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.id, 501);
    const ins = log.find((l) => /INSERT INTO ASSOCIAL_atendimento \(/.test(l.texto));
    assert.equal(ins.params.unidadeId, 1);
    assert.equal(ins.params.pessoaId, 77);
    assert.equal(ins.params.faixaEtariaId, 2);
    assert.equal(ins.params.usuarioId, 10);
    assert.equal(log.filter((l) => /INSERT INTO ASSOCIAL_atendimento_demanda/.test(l.texto)).length, 2);
    assert.equal(log.filter((l) => /INSERT INTO ASSOCIAL_atendimento_encaminhamento/.test(l.texto)).length, 1);
    assert.ok(log.some((l) => /INSERT INTO ASSOCIAL_auditoria/.test(l.texto)));
  });

  await teste('POST com CPF existente reaproveita e atualiza a pessoa (não cria outra)', async () => {
    respostas = [
      { casa: /FROM ASSOCIAL_demanda WHERE id IN/, linhas: [{ id: 1, exigeTexto: false }, { id: 2, exigeTexto: false }] },
      { casa: /FROM ASSOCIAL_encaminhamento WHERE id IN/, linhas: [{ id: 3, exigeTexto: false }] },
      { casa: /FROM ASSOCIAL_faixa_etaria/, linhas: FAIXAS },
      { casa: /FROM ASSOCIAL_pessoa p WHERE p\.cpf/, linhas: [{ id: 42 }] },
      { casa: /INSERT INTO ASSOCIAL_atendimento \(/, linhas: [{ id: 502 }] },
    ];
    const r = await chamar('POST', '/api/atendimentos', corpoValido());
    assert.equal(r.status, 201);
    assert.ok(!log.some((l) => /INSERT INTO ASSOCIAL_pessoa/.test(l.texto)));
    assert.ok(log.some((l) => /UPDATE ASSOCIAL_pessoa/.test(l.texto) && l.params.id === 42));
    assert.equal(log.find((l) => /INSERT INTO ASSOCIAL_atendimento \(/.test(l.texto)).params.pessoaId, 42);
  });

  await teste('POST "Outra" sem texto => 400', async () => {
    respostas = [{ casa: /FROM ASSOCIAL_demanda WHERE id IN/, linhas: [{ id: 1, exigeTexto: false }, { id: 2, exigeTexto: true }] },
      { casa: /FROM ASSOCIAL_encaminhamento WHERE id IN/, linhas: [{ id: 3, exigeTexto: false }] }];
    const r = await chamar('POST', '/api/atendimentos', corpoValido());
    assert.equal(r.status, 400);
    assert.ok(r.corpo.erro.detalhes.demandaOutra);
  });

  await teste('POST em unidade não permitida => 403', async () => {
    respostas = [
      { casa: /FROM ASSOCIAL_demanda WHERE id IN/, linhas: [{ id: 1, exigeTexto: false }, { id: 2, exigeTexto: false }] },
      { casa: /FROM ASSOCIAL_encaminhamento WHERE id IN/, linhas: [{ id: 3, exigeTexto: false }] },
    ];
    const r = await chamar('POST', '/api/atendimentos', { ...corpoValido(), unidadeId: 2 });
    assert.equal(r.status, 403);
  });

  await teste('GET lista sempre filtra por unidade permitida; filtro de outra unidade => 403', async () => {
    respostas = [{ casa: /COUNT\(\*\)/, linhas: [{ total: 0 }] }];
    const r = await chamar('GET', '/api/atendimentos?q=maria');
    assert.equal(r.status, 200);
    assert.ok(log.every((l) => /a\.unidade_id IN \(@un0\)/.test(l.texto)));
    assert.equal(log[0].params.un0, 1);
    assert.equal((await chamar('GET', '/api/atendimentos?unidadeId=2')).status, 403);
  });

  await teste('GET detalhe de outra unidade => 404 (consulta carrega com filtro de unidade)', async () => {
    respostas = []; // nada encontrado dentro do escopo
    const r = await chamar('GET', '/api/atendimentos/9');
    assert.equal(r.status, 404);
    assert.match(log[0].texto, /a\.unidade_id IN \(@un0\)/);
  });

  await teste('DELETE: assistente só o próprio em até 24h; coordenação sempre', async () => {
    const base = { id: 9, unidadeId: 1, pessoaId: 1, usuarioId: 10, criadoEm: new Date(Date.now() - 3600e3) };
    respostas = [{ casa: /FROM ASSOCIAL_atendimento a\s+JOIN ASSOCIAL_unidade/, linhas: [base] }];
    assert.equal((await chamar('DELETE', '/api/atendimentos/9')).status, 204);

    respostas = [{ casa: /FROM ASSOCIAL_atendimento a\s+JOIN ASSOCIAL_unidade/, linhas: [{ ...base, criadoEm: new Date(Date.now() - 30 * 3600e3) }] }];
    assert.equal((await chamar('DELETE', '/api/atendimentos/9')).status, 403);

    respostas = [{ casa: /FROM ASSOCIAL_atendimento a\s+JOIN ASSOCIAL_unidade/, linhas: [{ ...base, usuarioId: 99 }] }];
    assert.equal((await chamar('DELETE', '/api/atendimentos/9')).status, 403);

    usuario = { id: 5, perfil: 'COORDENADOR', unidades: [UNIDADE_A] };
    respostas = [{ casa: /FROM ASSOCIAL_atendimento a\s+JOIN ASSOCIAL_unidade/, linhas: [{ ...base, usuarioId: 99, criadoEm: new Date(0) }] }];
    assert.equal((await chamar('DELETE', '/api/atendimentos/9')).status, 204);
    usuario = { id: 10, perfil: 'ASSISTENTE', unidades: [UNIDADE_A] };
  });

  await teste('ADMIN opera como a coordenação (V12): cria atendimento; usuarioId fica no nome dele', async () => {
    usuario = { id: 7, perfil: 'ADMIN', unidades: [UNIDADE_A] };
    respostas = [
      { casa: /FROM ASSOCIAL_demanda WHERE id IN/, linhas: [{ id: 1, exigeTexto: false }, { id: 2, exigeTexto: false }] },
      { casa: /FROM ASSOCIAL_encaminhamento WHERE id IN/, linhas: [{ id: 3, exigeTexto: false }] },
      { casa: /FROM ASSOCIAL_faixa_etaria/, linhas: FAIXAS },
      { casa: /INSERT INTO ASSOCIAL_pessoa/, linhas: [{ id: 78 }] },
      { casa: /INSERT INTO ASSOCIAL_atendimento \(/, linhas: [{ id: 502 }] },
    ];
    const r = await chamar('POST', '/api/atendimentos', corpoValido());
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(log.find((l) => /INSERT INTO ASSOCIAL_atendimento \(/.test(l.texto)).params.usuarioId, 7);
    const aud = log.find((l) => /INSERT INTO ASSOCIAL_auditoria/.test(l.texto));
    assert.ok(aud, 'auditoria registrada');
    usuario = { id: 10, perfil: 'ASSISTENTE', unidades: [UNIDADE_A] };
  });

  await teste('pessoas/buscar?cpf: inválido 400; não achada; achada devolve só dados pessoais', async () => {
    assert.equal((await chamar('GET', '/api/pessoas/buscar?cpf=123')).status, 400);
    respostas = [];
    assert.deepEqual((await chamar('GET', '/api/pessoas/buscar?cpf=52998224725')).corpo, { encontrada: false });
    respostas = [{ casa: /FROM ASSOCIAL_pessoa p WHERE p\.cpf/, linhas: [{ id: 3, cpf: '52998224725', nome: 'Ana' }] }];
    const r = await chamar('GET', '/api/pessoas/buscar?cpf=529.982.247-25');
    assert.equal(r.corpo.encontrada, true);
    assert.ok(!log.some((l) => /atendimento/i.test(l.texto)), 'busca por CPF não pode tocar atendimentos');
  });

  await teste('pessoas/buscar?nome: mínimo 3 letras e filtro por unidade', async () => {
    assert.equal((await chamar('GET', '/api/pessoas/buscar?nome=ma')).status, 400);
    respostas = [];
    assert.equal((await chamar('GET', '/api/pessoas/buscar?nome=mar')).status, 200);
    assert.match(log[0].texto, /a\.unidade_id IN \(@ua0\)/);
    assert.match(log[0].texto, /ac\.unidade_id IN \(@uc0\)/);
    assert.match(log[0].texto, /TOP \(20\)/);
  });

  await teste('pessoas POST duplicado => 409; PUT fora do escopo => 404', async () => {
    respostas = [{ casa: /FROM ASSOCIAL_pessoa p WHERE p\.cpf/, linhas: [{ id: 3 }] }];
    assert.equal((await chamar('POST', '/api/pessoas', { nome: 'Ana', cpf: '52998224725' })).status, 409);
    respostas = [{ casa: /SELECT id FROM ASSOCIAL_pessoa WHERE id/, linhas: [{ id: 3 }] }, { casa: /CASE WHEN EXISTS/, linhas: [{ ok: 0 }] }];
    assert.equal((await chamar('PUT', '/api/pessoas/3', { nome: 'Ana' })).status, 404);
  });

  servidor.close();
  if (falhas) { console.error(`\n${falhas} teste(s) falharam.`); process.exit(1); }
  console.log('\nTodos os testes passaram.');
})();
