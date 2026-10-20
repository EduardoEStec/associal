'use strict';

// Teste da API /api/acoes com banco SIMULADO em memória (não há SQL Server disponível).
// Executar: node --test tests/acoes/
// O que isto cobre: rotas, validações, escopo por unidade, upload/serving de fotos.
// O que NÃO cobre: a sintaxe T-SQL real (só é exercitada contra um SQL Server de verdade).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'associal-acoes-'));
process.env.UPLOAD_DIR = uploads;

// ---------- banco simulado ----------
const estado = { acoes: [], temas: [], fotos: [], seqAcao: 0, seqFoto: 0 };
const TEMAS = [{ id: 1, ativo: true }, { id: 2, ativo: true }, { id: 3, ativo: true }, { id: 4, ativo: true }, { id: 5, ativo: true }, { id: 9, ativo: false }];
const UNIDADES = { 1: { sigla: 'BRA', nome: 'Brasilândia' }, 2: { sigla: 'TIR', nome: 'Cidade Tiradentes' } };

const unidadesDe = (p) => Object.keys(p).filter((k) => /^un\d+$/.test(k)).map((k) => p[k]);
const visiveis = (p) => estado.acoes.filter((a) => unidadesDe(p).includes(a.unidadeId));
const ver = (a) => ({
  ...a, unidadeSigla: UNIDADES[a.unidadeId].sigla, unidadeNome: UNIDADES[a.unidadeId].nome, tipoAcaoNome: 'Palestra', criadoPorNome: 'Fulana',
});

async function consultar(sql, p = {}) {
  const s = sql.replace(/\s+/g, ' ');
  if (/FROM tipo_acao WHERE id/.test(s)) return p.id === 1 ? [{ id: 1, ativo: true }] : [];
  if (/FROM tema WHERE id IN/.test(s)) return TEMAS.filter((t) => Object.entries(p).some(([k, v]) => /^t\d+$/.test(k) && v === t.id));
  if (/FROM configuracao/.test(s)) return [{ valor: '1' }]; // 1 MB
  if (/INSERT INTO auditoria/.test(s)) return [];
  if (/^SELECT TOP/.test(s)) {
    let l = visiveis(p);
    if (p.filtroStatus) l = l.filter((a) => a.status === p.filtroStatus);
    return l.map((a) => ({ ...ver(a), qtdFotos: estado.fotos.filter((f) => f.acaoVisitaId === a.id).length }));
  }
  if (/FROM acao_visita_tema avt JOIN tema tm ON tm.id = avt.tema_id JOIN acao_visita a/.test(s)) {
    const ids = visiveis(p).map((a) => a.id);
    return estado.temas.filter((t) => ids.includes(t.acaoVisitaId)).map((t) => ({ acaoVisitaId: t.acaoVisitaId, ordem: t.ordem, temaId: t.temaId, nome: `Tema ${t.temaId}` }));
  }
  if (/FROM acao_visita a JOIN unidade un.*WHERE a.id = @id/.test(s)) {
    const a = visiveis(p).find((x) => x.id === p.id);
    return a ? [ver(a)] : [];
  }
  if (/SELECT tema_id FROM acao_visita_tema/.test(s)) return estado.temas.filter((t) => t.acaoVisitaId === p.id).map((t) => ({ temaId: t.temaId }));
  if (/SELECT tm.id, tm.nome, avt.ordem/.test(s)) return estado.temas.filter((t) => t.acaoVisitaId === p.id).map((t) => ({ id: t.temaId, nome: `Tema ${t.temaId}`, ordem: t.ordem }));
  if (/SELECT id, legenda, ordem, nome_original/.test(s)) return estado.fotos.filter((f) => f.acaoVisitaId === p.id).map((f) => ({ ...f, nomeOriginal: f.nomeOriginal }));
  if (/INSERT INTO acao_visita \(/.test(s)) {
    const a = { id: ++estado.seqAcao, unidadeId: p.unidadeId, tipoAcaoId: p.tipoAcaoId, dataAcao: p.dataAcao[1], instituicaoLocal: p.instituicaoLocal, endereco: p.endereco, status: p.status, qtdParticipantes: p.qtdParticipantes, descricao: p.descricao, criadoPor: p.usuario };
    estado.acoes.push(a);
    return [{ id: a.id }];
  }
  if (/^DELETE FROM acao_visita_tema/.test(s)) { estado.temas = estado.temas.filter((t) => t.acaoVisitaId !== p.id); return []; }
  if (/^INSERT INTO acao_visita_tema/.test(s)) { estado.temas.push({ acaoVisitaId: p.id, ordem: p.ordem, temaId: p.temaId }); return []; }
  if (/^UPDATE acao_visita SET status/.test(s)) { Object.assign(estado.acoes.find((a) => a.id === p.id), { status: p.status, qtdParticipantes: p.qtd }); return []; }
  if (/^UPDATE acao_visita SET unidade_id/.test(s)) {
    Object.assign(estado.acoes.find((a) => a.id === p.id), { unidadeId: p.unidadeId, status: p.status, qtdParticipantes: p.qtdParticipantes, instituicaoLocal: p.instituicaoLocal });
    return [];
  }
  if (/^DELETE FROM acao_visita WHERE/.test(s)) {
    estado.acoes = estado.acoes.filter((a) => a.id !== p.id);
    estado.fotos = estado.fotos.filter((f) => f.acaoVisitaId !== p.id);
    return [];
  }
  if (/SELECT arquivo FROM acao_visita_foto/.test(s)) return estado.fotos.filter((f) => f.acaoVisitaId === p.id).map((f) => ({ arquivo: f.arquivo }));
  if (/COUNT\(\*\) AS total/.test(s)) {
    const l = estado.fotos.filter((f) => f.acaoVisitaId === p.id);
    return [{ total: l.length, maior: Math.max(0, ...l.map((f) => f.ordem)) }];
  }
  if (/INSERT INTO acao_visita_foto/.test(s)) {
    const f = { id: ++estado.seqFoto, acaoVisitaId: p.acaoId, arquivo: p.arquivo, mimeType: p.mime, legenda: p.legenda, ordem: p.ordem, nomeOriginal: p.nomeOriginal };
    estado.fotos.push(f);
    return [{ id: f.id }];
  }
  if (/FROM acao_visita_foto WHERE id = @fotoId/.test(s)) return estado.fotos.filter((f) => f.id === p.fotoId && f.acaoVisitaId === p.acaoId);
  if (/^UPDATE acao_visita_foto/.test(s)) { Object.assign(estado.fotos.find((f) => f.id === p.id), { legenda: p.legenda, ordem: p.ordem }); return []; }
  if (/^DELETE FROM acao_visita_foto/.test(s)) { estado.fotos = estado.fotos.filter((f) => f.id !== p.id); return []; }
  if (/GROUP BY a.unidade_id/.test(s)) {
    const l = visiveis(p).filter((a) => a.status === 'REALIZADA');
    return [...new Set(l.map((a) => a.unidadeId))].map((u) => ({
      unidadeId: u, qtdAcoes: l.filter((a) => a.unidadeId === u).length, qtdParticipantes: l.filter((a) => a.unidadeId === u).reduce((x, a) => x + a.qtdParticipantes, 0),
    }));
  }
  if (/SELECT DISTINCT a.unidade_id, a.instituicao_local/.test(s)) {
    return visiveis(p).filter((a) => a.status === 'REALIZADA' && a.instituicaoLocal).map((a) => ({ unidadeId: a.unidadeId, instituicaoLocal: a.instituicaoLocal }));
  }
  throw new Error(`SQL não simulado: ${s.slice(0, 120)}`);
}

const dbFalso = {
  tipos: { Date: 'Date' },
  consultar,
  consultarUm: async (s, p) => (await consultar(s, p))[0] || null,
  transacao: async (fn) => fn({ consultar }),
};
require.cache[require.resolve('../../server/db')] = { id: 'db', filename: 'db', loaded: true, exports: dbFalso };

const { tratarErros } = require('../../server/middlewares/erros');
const router = require('../../server/routes/acoes');

// ---------- servidor de teste ----------
const USUARIOS = {
  ana: { id: 10, perfil: 'ASSISTENTE', unidades: [{ id: 1, sigla: 'BRA', nome: 'Brasilândia' }] },
  bia: { id: 11, perfil: 'ASSISTENTE', unidades: [{ id: 1, sigla: 'BRA', nome: 'Brasilândia' }] },
  caio: { id: 12, perfil: 'ASSISTENTE', unidades: [{ id: 2, sigla: 'TIR', nome: 'Cidade Tiradentes' }] },
  coord: { id: 1, perfil: 'COORDENADOR', unidades: [{ id: 1, sigla: 'BRA', nome: 'Brasilândia' }, { id: 2, sigla: 'TIR', nome: 'Cidade Tiradentes' }] },
};
let servidor;
let base;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.usuario = USUARIOS[req.get('x-user')]; next(); });
  app.use('/api/acoes', router);
  app.use(tratarErros);
  servidor = await new Promise((ok) => { const s = app.listen(Number(process.env.PORT) || 3103, () => ok(s)); });
  base = `http://127.0.0.1:${servidor.address().port}/api/acoes`;
});
test.after(() => { servidor.close(); fs.rmSync(uploads, { recursive: true, force: true }); });

async function chamar(usuario, metodo, url, corpo) {
  const opcoes = { method: metodo, headers: { 'x-user': usuario, 'X-Requested-With': 'fetch' } };
  if (corpo instanceof FormData) opcoes.body = corpo;
  else if (corpo !== undefined) { opcoes.headers['Content-Type'] = 'application/json'; opcoes.body = JSON.stringify(corpo); }
  const r = await fetch(base + url, opcoes);
  const tipo = r.headers.get('content-type') || '';
  return { status: r.status, corpo: tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}

const valida = { dataAcao: '2026-03-10', tipoAcaoId: 1, instituicaoLocal: 'EMEF Central', temaIds: [1, 2] };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const formFoto = (conteudo, tipo = 'image/jpeg', nome = 'a.jpg') => {
  const f = new FormData();
  f.append('fotos', new Blob([conteudo], { type: tipo }), nome);
  f.append('legendas', 'Legenda 1');
  return f;
};

test('criação, validações e escopo por unidade', async () => {
  let r = await chamar('ana', 'POST', '/', valida);
  assert.equal(r.status, 201);
  const id = r.corpo.id;

  r = await chamar('ana', 'POST', '/', { ...valida, temaIds: [1, 2, 3, 4, 5] });
  assert.equal(r.status, 400); assert.ok(r.corpo.erro.detalhes.temaIds);
  r = await chamar('ana', 'POST', '/', { ...valida, temaIds: [1, 1] });
  assert.equal(r.status, 400);
  r = await chamar('ana', 'POST', '/', { ...valida, temaIds: [9] });
  assert.equal(r.status, 400, 'tema inativo não vale em nova ação');
  r = await chamar('ana', 'POST', '/', { ...valida, status: 'REALIZADA' });
  assert.equal(r.status, 400); assert.ok(r.corpo.erro.detalhes.qtdParticipantes);
  r = await chamar('ana', 'POST', '/', { ...valida, dataAcao: '2026-02-31' });
  assert.equal(r.status, 400);
  r = await chamar('ana', 'POST', '/', { ...valida, unidadeId: 2 });
  assert.equal(r.status, 403, 'assistente não grava em outra unidade');
  r = await chamar('coord', 'POST', '/', valida);
  assert.equal(r.status, 400, 'coordenador com 2 unidades precisa informar a unidade');
  r = await chamar('coord', 'POST', '/', { ...valida, unidadeId: 2, status: 'REALIZADA', qtdParticipantes: 30, instituicaoLocal: 'UBS Sul' });
  assert.equal(r.status, 201);

  r = await chamar('ana', 'GET', `/${id}`);
  assert.equal(r.status, 200); assert.deepEqual(r.corpo.temas.map((t) => t.id), [1, 2]);
  r = await chamar('caio', 'GET', `/${id}`);
  assert.equal(r.status, 404, 'outra unidade não enxerga');
  r = await chamar('caio', 'PUT', `/${id}`, valida);
  assert.equal(r.status, 404);

  r = await chamar('ana', 'GET', '/');
  assert.deepEqual(r.corpo.map((a) => a.unidadeSigla), ['BRA']);
  r = await chamar('coord', 'GET', '/');
  assert.equal(r.corpo.length, 2);
  r = await chamar('ana', 'GET', '/?unidadeId=2');
  assert.equal(r.status, 403);
  r = await chamar('ana', 'GET', '/?status=XPTO');
  assert.equal(r.status, 400);
});

test('edição e mudança de status', async () => {
  const { corpo: { id } } = await chamar('ana', 'POST', '/', valida);
  let r = await chamar('ana', 'PATCH', `/${id}/status`, { status: 'REALIZADA' });
  assert.equal(r.status, 400, 'realizada exige participantes');
  r = await chamar('ana', 'PATCH', `/${id}/status`, { status: 'REALIZADA', qtdParticipantes: 25 });
  assert.equal(r.status, 200); assert.equal(r.corpo.qtdParticipantes, 25);
  r = await chamar('ana', 'PATCH', `/${id}/status`, { status: 'CANCELADA' });
  assert.equal(r.status, 200);
  r = await chamar('ana', 'PUT', `/${id}`, { ...valida, instituicaoLocal: 'Novo local', temaIds: [3] });
  assert.equal(r.status, 200);
  r = await chamar('ana', 'GET', `/${id}`);
  assert.equal(r.corpo.instituicaoLocal, 'Novo local'); assert.deepEqual(r.corpo.temas.map((t) => t.id), [3]);
});

test('fotos: upload, validação, serving autenticado por unidade, legenda e exclusão', async () => {
  const { corpo: { id } } = await chamar('ana', 'POST', '/', valida);

  let r = await chamar('ana', 'POST', `/${id}/fotos`, formFoto(JPEG));
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const fotoId = r.corpo.fotos[0].id;
  const arquivo = estado.fotos.find((f) => f.id === fotoId).arquivo;
  assert.match(arquivo, /^[a-f0-9]{32}\.jpg$/);
  assert.ok(fs.existsSync(path.join(uploads, 'acoes', arquivo)));

  r = await chamar('ana', 'POST', `/${id}/fotos`, formFoto(Buffer.from('não sou imagem'), 'image/jpeg'));
  assert.equal(r.status, 400, 'assinatura inválida');
  r = await chamar('ana', 'POST', `/${id}/fotos`, formFoto(Buffer.from('texto'), 'text/plain', 'a.txt'));
  assert.equal(r.status, 400, 'tipo não permitido');
  r = await chamar('ana', 'POST', `/${id}/fotos`, formFoto(Buffer.concat([JPEG, Buffer.alloc(1.2 * 1024 * 1024)])));
  assert.equal(r.status, 400, 'acima de upload_max_mb');
  assert.equal(fs.readdirSync(path.join(uploads, 'acoes')).length, 1, 'rejeitados não deixam arquivo órfão');
  r = await chamar('caio', 'POST', `/${id}/fotos`, formFoto(JPEG));
  assert.equal(r.status, 404, 'outra unidade não envia');

  r = await chamar('ana', 'GET', `/${id}/fotos/${fotoId}`);
  assert.equal(r.status, 200); assert.ok(r.corpo.equals(JPEG));
  r = await chamar('caio', 'GET', `/${id}/fotos/${fotoId}`);
  assert.equal(r.status, 404, 'foto de outra unidade');

  r = await chamar('ana', 'PATCH', `/${id}/fotos/${fotoId}`, { legenda: 'Nova', ordem: 3 });
  assert.equal(r.status, 200); assert.equal(r.corpo.legenda, 'Nova');
  r = await chamar('ana', 'DELETE', `/${id}/fotos/${fotoId}`);
  assert.equal(r.status, 204);
  assert.ok(!fs.existsSync(path.join(uploads, 'acoes', arquivo)));
});

test('exclusão: autor ou coordenação; arquivos das fotos são removidos', async () => {
  const { corpo: { id } } = await chamar('ana', 'POST', '/', valida);
  await chamar('ana', 'POST', `/${id}/fotos`, formFoto(JPEG));
  const arquivo = estado.fotos.find((f) => f.acaoVisitaId === id).arquivo;

  let r = await chamar('bia', 'DELETE', `/${id}`);
  assert.equal(r.status, 403, 'outra assistente da mesma unidade não exclui');
  r = await chamar('ana', 'DELETE', `/${id}`);
  assert.equal(r.status, 204);
  assert.ok(!fs.existsSync(path.join(uploads, 'acoes', arquivo)));

  const { corpo: { id: id2 } } = await chamar('ana', 'POST', '/', valida);
  r = await chamar('coord', 'DELETE', `/${id2}`);
  assert.equal(r.status, 204);
});

test('resumo por unidade respeita o escopo', async () => {
  let r = await chamar('coord', 'GET', '/resumo?inicio=2026-01-01&fim=2026-12-31');
  assert.equal(r.status, 200);
  const tir = r.corpo.find((u) => u.sigla === 'TIR');
  assert.equal(tir.qtdAcoes, 1); assert.equal(tir.qtdParticipantes, 30); assert.deepEqual(tir.instituicoes, ['UBS Sul']);
  r = await chamar('ana', 'GET', '/resumo');
  assert.deepEqual(r.corpo.map((u) => u.sigla), ['BRA']);
  r = await chamar('ana', 'GET', '/resumo?unidadeId=2');
  assert.equal(r.status, 403);
});
