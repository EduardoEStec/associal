'use strict';

// Testes da API /api/familias com banco SIMULADO (sem SQL Server): o mock responde por padrão de SQL.
// Verifica escopo por unidade (LGPD), perfis, validações e regras de negócio. Rodar: node --test tests/familias/

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const mssql = require('mssql');

// ---- mock de server/db.js (injetado no cache antes de carregar as rotas) ----
let handlers = [];
const chamadas = [];

async function despachar(sql, params = {}) {
  chamadas.push({ sql, params });
  for (const h of handlers) {
    if (h.teste.test(sql)) return h.resp(params, sql);
  }
  throw new Error(`SQL não simulado: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
}
const executor = {
  consultar: async (sql, params) => despachar(sql, params),
  consultarUm: async (sql, params) => (await despachar(sql, params))[0] || null,
  executar: async (sql, params) => ({ linhas: await despachar(sql, params) }),
};
const dbFalso = {
  tipos: mssql,
  ...executor,
  transacao: async (fn) => fn(executor),
  obterPool: async () => { throw new Error('sem pool'); },
  fechar: async () => {},
};
const caminhoDb = require.resolve('../../server/db');
require.cache[caminhoDb] = { id: caminhoDb, filename: caminhoDb, loaded: true, exports: dbFalso };

const rotasFamilias = require('../../server/routes/familias');
const { tratarErros, protecaoCsrf } = require('../../server/middlewares/erros');

function iniciar(usuario) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.usuario = usuario; next(); });
  app.use(protecaoCsrf);
  app.use('/api/familias', rotasFamilias);
  app.use(tratarErros);
  return new Promise((resolve) => {
    const srv = app.listen(0, () => {
      const base = `http://127.0.0.1:${srv.address().port}/api/familias`;
      const chamar = async (metodo, url, corpo) => {
        const r = await fetch(base + url, {
          method: metodo,
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
          body: corpo === undefined ? undefined : JSON.stringify(corpo),
        });
        return { status: r.status, corpo: await r.json().catch(() => null) };
      };
      resolve({ chamar, fechar: () => new Promise((ok) => srv.close(ok)) });
    });
  });
}

const assistenteA = { id: 10, perfil: 'ASSISTENTE', unidades: [{ id: 1, sigla: 'BRA', nome: 'Brasilândia' }] };
const coordenador = { id: 20, perfil: 'COORDENADOR', unidades: [{ id: 1, sigla: 'BRA' }, { id: 2, sigla: 'TIR' }] };
const admin = { id: 30, perfil: 'ADMIN', unidades: [{ id: 1 }, { id: 2 }] };

// Acompanhamento 100 pertence à unidade 2. O mock imita o filtro de unidade do SQL (IN (@un0, ...)).
const baseHandlers = () => [
  {
    teste: /FROM acompanhamento ac(\s+WITH \([^)]*\))?\s+WHERE ac\.id = @id/,
    resp: (p) => {
      const permitidas = Object.entries(p).filter(([k]) => /^un\d+$/.test(k)).map(([, v]) => v);
      const linha = { id: 100, familia_id: 7, unidade_id: 2, usuario_id: 99, data_inicio: new Date('2026-03-01'),
        data_prevista_final: new Date('2026-05-30'), data_encerramento: null, status: 'EM_ANDAMENTO', observacoes: null };
      const camel = { id: 100, familiaId: 7, unidadeId: 2, usuarioId: 99, dataInicio: linha.data_inicio,
        dataPrevistaFinal: linha.data_prevista_final, dataEncerramento: null, status: 'EM_ANDAMENTO', observacoes: null };
      return p.id === 100 && permitidas.includes(2) ? [camel] : [];
    },
  },
  { teste: /INSERT INTO auditoria/, resp: () => [] },
  // resumo de contato da ficha (F2): último contato e registros
  { teste: /^\s*SELECT \(SELECT MAX\(v\.d\)/, resp: () => [{ ultimoContato: new Date('2026-03-05') }] },
  { teste: /^\s*SELECT TOP 1 .*FROM acompanhamento_registro/s, resp: () => [] },
  { teste: /FROM configuracao/, resp: () => [{ chave: 'prazo_questionario_final_dias', valor: '90' }, { chave: 'alerta_questionario_final_dias_antes', valor: '15' }] },
];

test('assistente da unidade 1 NÃO enxerga acompanhamento da unidade 2 (404) em nenhuma rota', async () => {
  handlers = baseHandlers();
  const srv = await iniciar(assistenteA);
  try {
    for (const url of ['/acompanhamentos/100', '/acompanhamentos/100/comparacao', '/acompanhamentos/100/questionarios/INICIAL']) {
      const r = await srv.chamar('GET', url);
      assert.equal(r.status, 404, url);
      assert.equal(r.corpo.erro.codigo, 'NAO_ENCONTRADO');
    }
    let r = await srv.chamar('PUT', '/acompanhamentos/100/questionarios/INICIAL', { respostas: {} });
    assert.equal(r.status, 404);
    r = await srv.chamar('POST', '/acompanhamentos/100/encerrar', { status: 'DESLIGADO', observacoes: 'mudou' });
    assert.equal(r.status, 404);
    r = await srv.chamar('PUT', '/acompanhamentos/100', { observacoes: 'x' });
    assert.equal(r.status, 404);
  } finally { await srv.fechar(); }
});

test('listagem: aplica filtro de unidade; unidadeId não permitida => 403', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /SELECT COUNT\(\*\) AS total FROM base/, resp: () => [{ total: 0 }] },
    { teste: /SELECT \* FROM base/, resp: () => [] },
  ];
  chamadas.length = 0;
  const srv = await iniciar(assistenteA);
  try {
    let r = await srv.chamar('GET', '/?unidadeId=2');
    assert.equal(r.status, 403);
    r = await srv.chamar('GET', '/?finalSituacao=VENCIDO&q=maria&status=EM_ANDAMENTO');
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, { itens: [], total: 0, pagina: 1, tamanho: 20 });
    const sql = chamadas.find((c) => /SELECT COUNT/.test(c.sql));
    assert.match(sql.sql, /ac\.unidade_id IN \(@un0\)/);
    assert.equal(sql.params.un0, 1);
    assert.equal(sql.params.situacao, 'VENCIDO');
    r = await srv.chamar('GET', '/?finalSituacao=XYZ');
    assert.equal(r.status, 400);
  } finally { await srv.fechar(); }
});

test('listagem: calcula selo do questionário final (vencido / vencendo / em dia)', async () => {
  const hoje = new Date();
  const dia = (n) => { const d = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n)); return d; };
  const linha = (id, prevista, extra = {}) => ({
    acompanhamento_id: id, familiaId: id, acompanhamentoId: id, unidadeId: 1, unidadeSigla: 'BRA', status: 'EM_ANDAMENTO',
    dataInicio: dia(-60), dataPrevistaFinal: prevista, dataEncerramento: null, responsavelId: id, responsavelNome: `Fam ${id}`,
    responsavelCpf: '52998224725', qtdMembros: 3, inicialConcluido: true, finalConcluido: false, ...extra,
  });
  handlers = [
    ...baseHandlers(),
    { teste: /SELECT COUNT\(\*\) AS total FROM base/, resp: () => [{ total: 4 }] },
    { teste: /SELECT \* FROM base/, resp: () => [linha(1, dia(-3)), linha(2, dia(10)), linha(3, dia(40)), linha(4, dia(-1), { finalConcluido: true })] },
  ];
  const srv = await iniciar(coordenador);
  try {
    const r = await srv.chamar('GET', '/');
    assert.deepEqual(r.corpo.itens.map((i) => i.finalSituacao), ['VENCIDO', 'VENCENDO', 'EM_DIA', 'CONCLUIDO']);
    assert.equal(r.corpo.itens[0].diasParaFinal, -3);
    assert.equal(r.corpo.itens[1].diasParaFinal, 10);
  } finally { await srv.fechar(); }
});

test('criar: ADMIN não escreve (403); validações em português com chaves por campo', async () => {
  handlers = baseHandlers();
  let srv = await iniciar(admin);
  try {
    const r = await srv.chamar('POST', '/', { responsavel: { cpf: '52998224725', nome: 'Maria' }, unidadeId: 1 });
    assert.equal(r.status, 403);
  } finally { await srv.fechar(); }

  srv = await iniciar(assistenteA);
  try {
    let r = await srv.chamar('POST', '/', {
      responsavel: { cpf: '11111111111', nome: '' },
      membros: [{ nome: '' }, { nome: 'Pedro', dataNascimento: '2999-01-01' }],
      dataInicio: '2999-01-01',
    });
    assert.equal(r.status, 400);
    const d = r.corpo.erro.detalhes;
    assert.equal(d['responsavel.cpf'], 'CPF inválido.');
    assert.ok(d['responsavel.nome']);
    assert.ok(d['membros.0.nome']);
    assert.ok(d['membros.1.dataNascimento']);
    assert.ok(d.dataInicio);

    // unidade fora do escopo
    r = await srv.chamar('POST', '/', { responsavel: { cpf: '52998224725', nome: 'Maria' }, unidadeId: 2 });
    assert.equal(r.status, 403);
  } finally { await srv.fechar(); }
});

test('criar: família já acompanhada em OUTRA unidade => 409 sem revelar o acompanhamento', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /FROM (genero|escolaridade|raca) WHERE/, resp: () => [] },
    { teste: /FROM pessoa WITH/, resp: () => [{ id: 5 }] },
    { teste: /UPDATE pessoa/, resp: () => [] },
    { teste: /FROM familia WITH/, resp: () => [{ id: 7 }] },
    { teste: /FROM acompanhamento WHERE familia_id/, resp: () => [{ id: 100, unidadeId: 2 }] },
  ];
  const srv = await iniciar(assistenteA);
  try {
    const r = await srv.chamar('POST', '/', { responsavel: { cpf: '52998224725', nome: 'Maria' }, unidadeId: 1 });
    assert.equal(r.status, 409);
    assert.match(r.corpo.erro.mensagem, /outra unidade/);
    assert.equal(r.corpo.erro.detalhes, undefined);
    assert.ok(!JSON.stringify(r.corpo).includes('100'));
  } finally { await srv.fechar(); }
});

test('criar: família já acompanhada na MINHA unidade => 409 com o id', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /FROM pessoa WITH/, resp: () => [{ id: 5 }] },
    { teste: /UPDATE pessoa/, resp: () => [] },
    { teste: /FROM familia WITH/, resp: () => [{ id: 7 }] },
    { teste: /FROM acompanhamento WHERE familia_id/, resp: () => [{ id: 55, unidadeId: 1 }] },
  ];
  const srv = await iniciar(assistenteA);
  try {
    const r = await srv.chamar('POST', '/', { responsavel: { cpf: '52998224725', nome: 'Maria' } });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.detalhes.acompanhamentoId, 55);
  } finally { await srv.fechar(); }
});

test('criar: sucesso — pessoa nova, família nova, prazo = início + 90 dias, unidade única do usuário', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /FROM pessoa WITH/, resp: () => [] },
    { teste: /INSERT INTO pessoa/, resp: () => [{ id: 5 }] },
    { teste: /FROM familia WITH/, resp: () => [] },
    { teste: /INSERT INTO familia /, resp: () => [{ id: 8 }] },
    { teste: /DELETE FROM familia_membro/, resp: () => [] },
    { teste: /INSERT INTO familia_membro/, resp: () => [] },
    { teste: /INSERT INTO acompanhamento/, resp: () => [{ id: 300 }] },
  ];
  chamadas.length = 0;
  const srv = await iniciar(assistenteA);
  try {
    const r = await srv.chamar('POST', '/', {
      responsavel: { cpf: '529.982.247-25', nome: '  Maria da Silva ' },
      membros: [{ nome: 'Pedro', idade: 8, parentesco: 'Filho', trabalha: false }],
      dataInicio: '2026-01-10',
    });
    assert.equal(r.status, 201);
    assert.deepEqual(r.corpo, { acompanhamentoId: 300, familiaId: 8, dataPrevistaFinal: '2026-04-10' });
    const ins = chamadas.find((c) => /INSERT INTO acompanhamento/.test(c.sql));
    assert.equal(ins.params.unidade, 1);
    assert.equal(ins.params.usuario, 10);
    const pessoa = chamadas.find((c) => /INSERT INTO pessoa/.test(c.sql));
    assert.equal(pessoa.params.cpf[1], '52998224725');
    assert.equal(pessoa.params.nome, 'Maria da Silva');
  } finally { await srv.fechar(); }
});

test('encerrar: CONCLUIDO exige questionário final concluído; DESLIGADO exige motivo', async () => {
  let finalConcluido = false;
  handlers = [
    ...baseHandlers(),
    { teste: /FROM questionario WHERE acompanhamento_id = @id AND tipo = 'FINAL'/, resp: () => [{ concluido: finalConcluido }] },
    { teste: /UPDATE acompanhamento\s+SET status/, resp: () => [] },
    // detalhar()
    { teste: /FROM familia f JOIN pessoa p/, resp: () => [{ id: 7, nome: 'Maria' }] },
    { teste: /FROM familia_membro/, resp: () => [] },
    { teste: /FROM questionario WHERE acompanhamento_id = @id$/, resp: () => [] },
    { teste: /FROM unidade WHERE id/, resp: () => [{ id: 2 }] },
    { teste: /FROM usuario WHERE id/, resp: () => [{ id: 99 }] },
  ];
  const srv = await iniciar(coordenador);
  try {
    let r = await srv.chamar('POST', '/acompanhamentos/100/encerrar', { status: 'CONCLUIDO' });
    assert.equal(r.status, 409);
    assert.match(r.corpo.erro.mensagem, /questionário final/);

    r = await srv.chamar('POST', '/acompanhamentos/100/encerrar', { status: 'DESLIGADO' });
    assert.equal(r.status, 400);
    assert.ok(r.corpo.erro.detalhes.observacoes);

    r = await srv.chamar('POST', '/acompanhamentos/100/encerrar', { status: 'TALVEZ' });
    assert.equal(r.status, 400);

    r = await srv.chamar('POST', '/acompanhamentos/100/encerrar', { status: 'DESLIGADO', observacoes: 'Mudou de cidade' });
    assert.equal(r.status, 200);

    finalConcluido = true;
    r = await srv.chamar('POST', '/acompanhamentos/100/encerrar', { status: 'CONCLUIDO' });
    assert.equal(r.status, 200);
  } finally { await srv.fechar(); }
});

test('questionário FINAL só depois do INICIAL concluído; tipo inválido => 404', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /FROM questionario WHERE acompanhamento_id = @ac AND tipo = @tipo/, resp: () => [] },
    { teste: /FROM questionario_(beneficio|destino_economia)/, resp: () => [] },
    { teste: /COUNT\(\*\) AS total FROM familia_membro/, resp: () => [{ total: 2 }] },
  ];
  const srv = await iniciar(coordenador);
  try {
    let r = await srv.chamar('PUT', '/acompanhamentos/100/questionarios/FINAL', { concluir: false, rendaMensalMedia: 1000 });
    assert.equal(r.status, 409);
    assert.match(r.corpo.erro.mensagem, /questionário inicial/);

    r = await srv.chamar('GET', '/acompanhamentos/100/questionarios/FINAL');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.podeEditar, false);
    assert.equal(r.corpo.sugestoes.qtdMembrosFamilia, 3);

    r = await srv.chamar('GET', '/acompanhamentos/100/questionarios/INICIAL');
    assert.equal(r.corpo.podeEditar, true);
    assert.equal(r.corpo.existe, false);

    r = await srv.chamar('GET', '/acompanhamentos/100/questionarios/OUTRO');
    assert.equal(r.status, 404);
  } finally { await srv.fechar(); }
});

test('questionário INICIAL: rascunho grava; conclusão incompleta => 400 com campos', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /FROM questionario WHERE acompanhamento_id = @ac AND tipo = @tipo/, resp: () => [] },
    { teste: /FROM questionario_(beneficio|destino_economia)/, resp: () => [] },
    { teste: /COUNT\(\*\) AS total FROM familia_membro/, resp: () => [{ total: 0 }] },
    { teste: /INSERT INTO questionario \(/, resp: () => [{ id: 900 }] },
    { teste: /DELETE FROM questionario_/, resp: () => [] },
  ];
  chamadas.length = 0;
  const srv = await iniciar(coordenador);
  try {
    let r = await srv.chamar('PUT', '/acompanhamentos/100/questionarios/INICIAL', { concluir: true, rendaMensalMedia: 900 });
    assert.equal(r.status, 400);
    assert.ok(r.corpo.erro.detalhes.avaliacaoArmazem);
    assert.ok(r.corpo.erro.detalhes.destinoEconomiaIds);
    assert.equal(chamadas.some((c) => /INSERT INTO questionario \(/.test(c.sql)), false);

    r = await srv.chamar('PUT', '/acompanhamentos/100/questionarios/INICIAL', { concluir: false, rendaMensalMedia: 900, conseguePoupar: false });
    assert.equal(r.status, 200);
    const ins = chamadas.find((c) => /INSERT INTO questionario \(/.test(c.sql));
    assert.equal(ins.params.concluido, false);
    assert.equal(ins.params.tipo, 'INICIAL');
    assert.equal(ins.params.conseguePoupar, false);
    assert.deepEqual(ins.params.rendaMensalMedia[1], 900);
  } finally { await srv.fechar(); }
});

test('comparação: incompleta quando falta questionário concluído', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /FROM familia f JOIN pessoa p/, resp: () => [{ nome: 'Maria' }] },
    { teste: /FROM questionario WHERE acompanhamento_id = @ac AND tipo = @tipo/, resp: (p) => (p.tipo === 'INICIAL' ? [{ id: 1, concluido: true }] : []) },
  ];
  const srv = await iniciar(coordenador);
  try {
    const r = await srv.chamar('GET', '/acompanhamentos/100/comparacao');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.completo, false);
    assert.match(r.corpo.motivo, /final/);
  } finally { await srv.fechar(); }
});

test('comparação consolidada: valida datas e exige unidade permitida', async () => {
  handlers = [
    ...baseHandlers(),
    { teste: /FROM questionario q JOIN acompanhamento ac/, resp: () => [] },
    { teste: /FROM questionario_beneficio qb/, resp: () => [] },
    { teste: /FROM questionario_destino_economia qd/, resp: () => [] },
    { teste: /FROM beneficio$|FROM beneficio\s*$/, resp: () => [] },
    { teste: /FROM destino_economia\s*$/, resp: () => [] },
    { teste: /FROM unidade\s*$/, resp: () => [] },
  ];
  chamadas.length = 0;
  const srv = await iniciar(assistenteA);
  try {
    let r = await srv.chamar('GET', '/comparacao?inicio=2026-13-01');
    assert.equal(r.status, 400);
    r = await srv.chamar('GET', '/comparacao?inicio=2026-02-01&fim=2026-01-01');
    assert.equal(r.status, 400);
    r = await srv.chamar('GET', '/comparacao?unidadeId=2');
    assert.equal(r.status, 403);
    r = await srv.chamar('GET', '/comparacao?inicio=2026-01-01&fim=2026-06-30&unidadeId=1');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.totalFamilias, 0);
    const q = chamadas.find((c) => /FROM questionario q JOIN acompanhamento ac/.test(c.sql));
    assert.match(q.sql, /ac\.unidade_id IN \(@un0\)/);
    assert.match(q.sql, /qf\.data_aplicacao >= @inicio/);
  } finally { await srv.fechar(); }
});

test('modelo do questionário é servido (FINAL em texto presente)', async () => {
  handlers = baseHandlers();
  const srv = await iniciar(assistenteA);
  try {
    const r = await srv.chamar('GET', '/questionario/modelo?tipo=FINAL');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.tipo, 'FINAL');
    assert.equal(r.corpo.blocos.length, 5);
  } finally { await srv.fechar(); }
});
