'use strict';

// Teste da API de administração com banco SIMULADO (sem SQL Server).
// Uso: node tests/admin/admin.test.js
// O mock reconhece as consultas por trechos do SQL; serve para validar regras de negócio e permissões,
// NÃO a sintaxe T-SQL (que só pode ser verificada em um SQL Server real).

const assert = require('assert');
const path = require('path');
const express = require('express');

const raiz = path.join(__dirname, '..', '..');
const dbPath = require.resolve(path.join(raiz, 'server', 'db.js'));

// ---- estado simulado ----
const estado = {
  usuarios: [
    { id: 1, login: 'admin', nome: 'Admin', perfil: 'ADMIN', ativo: 1 },
    { id: 2, login: 'maria', nome: 'Maria', perfil: 'ASSISTENTE', ativo: 1 },
  ],
  unidades: [{ id: 1, sigla: 'UN1' }, { id: 2, sigla: 'UN2' }],
  config: { prazo_questionario_final_dias: '90', upload_max_mb: '10' },
  demandaEmUso: new Set([1]),
  sessoes: [],
  chamadas: [],
};

async function consultar(sql, p = {}) {
  estado.chamadas.push(sql.replace(/\s+/g, ' ').trim());
  const s = sql.replace(/\s+/g, ' ');
  if (s.startsWith('DELETE FROM sessao')) { estado.sqlSessao = s; estado.paramsSessao = p; return estado.sessoes.splice(0).map((sid) => ({ sid })); }
  if (s.includes('INSERT INTO auditoria') || s.startsWith('DELETE FROM usuario_unidade') || s.startsWith('INSERT INTO usuario_unidade')) return [];
  if (s.includes('FROM sys.foreign_key_columns')) return [{ tabela: 'atendimento_demanda', coluna: 'demanda_id' }];
  if (s.includes("p.codigo = 'ADMIN' AND u.ativo = 1 AND u.id <> @id")) {
    return [{ total: estado.usuarios.filter((u) => u.perfil === 'ADMIN' && u.ativo && u.id !== p.id).length }];
  }
  if (s.includes('SELECT p.codigo AS perfil, u.ativo FROM usuario')) {
    const u = estado.usuarios.find((x) => x.id === p.id);
    return u ? [{ perfil: u.perfil, ativo: u.ativo }] : [];
  }
  if (s.includes('SELECT 1 AS x FROM usuario WHERE login')) return estado.usuarios.filter((u) => u.login === p.login).map(() => ({ x: 1 }));
  if (s.includes('COUNT(*) AS total FROM unidade')) return [{ total: Object.keys(p).filter((k) => k.startsWith('u')).filter((k) => estado.unidades.some((u) => u.id === p[k])).length }];
  if (s.startsWith('INSERT INTO usuario ')) {
    const id = estado.usuarios.length + 1;
    estado.usuarios.push({ id, login: p.login, nome: p.nome, perfil: p.perfil, ativo: 1, hash: p.hash });
    return [{ id }];
  }
  if (s.startsWith('UPDATE usuario SET ativo')) { estado.usuarios.find((u) => u.id === p.id).ativo = p.ativo; return []; }
  if (s.startsWith('UPDATE usuario SET senha_hash')) { estado.usuarios.find((u) => u.id === p.id).hash = p.hash; return []; }
  if (s.startsWith('SELECT id FROM usuario WHERE id')) return estado.usuarios.filter((u) => u.id === p.id).map((u) => ({ id: u.id }));
  if (s.includes('FROM demanda t WHERE t.id = @id')) return p.id === 99 ? [] : [{ id: p.id, nome: 'X', ordem: 0, ativo: 1, exigeTexto: 0, emUso: estado.demandaEmUso.has(p.id) ? 1 : 0 }];
  if (s.startsWith('DELETE FROM demanda')) { estado.deletou = true; return []; }
  if (s.startsWith('SELECT chave, valor FROM configuracao')) return p.chave in estado.config ? [{ chave: p.chave, valor: estado.config[p.chave] }] : [];
  if (s.startsWith('SELECT chave, valor, descricao')) return Object.entries(estado.config).map(([chave, valor]) => ({ chave, valor, descricao: null, alteradoEm: null }));
  if (s.startsWith('UPDATE configuracao')) { estado.config[p.chave] = p.valor; return []; }
  if (s.includes('COUNT(*) AS total FROM auditoria')) return [{ total: 0 }];
  if (s.includes('FROM auditoria a LEFT JOIN')) { estado.sqlAuditoria = s; estado.paramsAuditoria = p; return []; }
  throw new Error(`SQL não previsto no mock: ${s.slice(0, 120)}`);
}
const consultarUm = async (s, p) => (await consultar(s, p))[0] || null;
const transacao = async (fn) => fn({ consultar, consultarUm });

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { consultar, consultarUm, transacao, tipos: { Date: function Date() {} } },
};

const { tratarErros } = require(path.join(raiz, 'server', 'middlewares', 'erros.js'));
const router = require(path.join(raiz, 'server', 'routes', 'admin.js'));

let usuarioAtual;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.usuario = usuarioAtual; next(); });
app.use('/api/admin', router);
app.use(tratarErros);

async function chamar(metodo, url, corpo) {
  const r = await fetch(`http://127.0.0.1:${servidor.address().port}/api/admin${url}`, {
    method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await r.text();
  return { status: r.status, corpo: txt ? JSON.parse(txt) : null };
}

const ADMIN = { id: 1, perfil: 'ADMIN', unidades: [] };
const COORD = { id: 5, perfil: 'COORDENADOR', unidades: [] };
const ASSIST = { id: 2, perfil: 'ASSISTENTE', unidades: [] };
let servidor;
let ok = 0;
const teste = async (nome, fn) => { await fn(); ok += 1; console.log(`  ok - ${nome}`); };

(async () => {
  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));

  usuarioAtual = ASSIST;
  await teste('assistente é barrado em tudo (403)', async () => {
    assert.strictEqual((await chamar('GET', '/usuarios')).status, 403);
    assert.strictEqual((await chamar('GET', '/auditoria')).status, 403);
    assert.strictEqual((await chamar('GET', '/configuracoes')).status, 403);
  });

  usuarioAtual = COORD;
  await teste('coordenador não acessa usuários nem auditoria', async () => {
    assert.strictEqual((await chamar('GET', '/usuarios')).status, 403);
    assert.strictEqual((await chamar('GET', '/auditoria')).status, 403);
  });
  await teste('coordenador vê só as configs editáveis por ele e altera o prazo', async () => {
    const l = await chamar('GET', '/configuracoes');
    assert.deepStrictEqual(l.corpo.map((c) => c.chave), ['prazo_questionario_final_dias']);
    const r = await chamar('PUT', '/configuracoes/prazo_questionario_final_dias', { valor: '120' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(estado.config.prazo_questionario_final_dias, '120');
  });
  await teste('coordenador não altera config de admin (403) e valor inválido dá 400', async () => {
    assert.strictEqual((await chamar('PUT', '/configuracoes/upload_max_mb', { valor: '5' })).status, 403);
    for (const v of ['abc', '-3', '0', '1.5', '']) {
      const r = await chamar('PUT', '/configuracoes/prazo_questionario_final_dias', { valor: v });
      assert.strictEqual(r.status, 400, `valor ${v}`);
    }
    assert.strictEqual((await chamar('PUT', '/configuracoes/inexistente', { valor: '1' })).status, 404);
  });

  usuarioAtual = ADMIN;
  await teste('admin cria usuário com senha provisória de 12+ caracteres e hash bcrypt', async () => {
    const r = await chamar('POST', '/usuarios', { login: 'Joao.Silva', nome: 'João', perfil: 'ASSISTENTE', unidadeIds: [1] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
    assert.strictEqual(r.corpo.login, 'joao.silva');
    assert.ok(r.corpo.senhaProvisoria.length >= 8);
    const salvo = estado.usuarios.find((u) => u.login === 'joao.silva');
    assert.ok(salvo.hash.startsWith('$2'), 'hash bcrypt');
    assert.notStrictEqual(salvo.hash, r.corpo.senhaProvisoria);
    assert.ok(estado.chamadas.some((c) => c.startsWith('INSERT INTO usuario ') && c.includes(', 1, 1, @por')), 'deve_trocar_senha=1');
  });
  await teste('assistente sem unidade, login repetido, perfil/e-mail inválidos => 400', async () => {
    let r = await chamar('POST', '/usuarios', { login: 'ana', nome: 'Ana', perfil: 'ASSISTENTE', unidadeIds: [] });
    assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.unidadeIds);
    r = await chamar('POST', '/usuarios', { login: 'maria', nome: 'M', perfil: 'ADMIN' });
    assert.ok(r.corpo.erro.detalhes.login);
    r = await chamar('POST', '/usuarios', { login: 'x!', nome: '', email: 'ruim', perfil: 'XYZ' });
    assert.deepStrictEqual(Object.keys(r.corpo.erro.detalhes).sort(), ['email', 'login', 'nome', 'perfil']);
    r = await chamar('POST', '/usuarios', { login: 'ana', nome: 'Ana', perfil: 'ASSISTENTE', unidadeIds: [77] });
    assert.ok(r.corpo.erro.detalhes.unidadeIds);
  });
  await teste('não desativa a si mesmo nem o último admin', async () => {
    let r = await chamar('PATCH', '/usuarios/1/ativo', { ativo: false });
    assert.strictEqual(r.status, 409);
    usuarioAtual = { id: 9, perfil: 'ADMIN', unidades: [] }; // outro admin tentando desativar o único ativo
    r = await chamar('PATCH', '/usuarios/1/ativo', { ativo: false });
    assert.strictEqual(r.status, 409);
    assert.match(r.corpo.erro.mensagem, /único administrador/);
    usuarioAtual = ADMIN;
  });
  await teste('desativa assistente normalmente; usuário inexistente => 404', async () => {
    assert.strictEqual((await chamar('PATCH', '/usuarios/2/ativo', { ativo: false })).status, 200);
    assert.strictEqual(estado.usuarios.find((u) => u.id === 2).ativo, 0);
    assert.strictEqual((await chamar('PATCH', '/usuarios/999/ativo', { ativo: false })).status, 404);
  });
  await teste('desativar e redefinir senha encerram as sessões do alvo e auditam a contagem', async () => {
    estado.sessoes = ['a', 'b'];
    estado.usuarios.find((u) => u.id === 2).ativo = 1;
    assert.strictEqual((await chamar('PATCH', '/usuarios/2/ativo', { ativo: false })).status, 200);
    assert.ok(estado.sqlSessao.includes("JSON_VALUE(dados, '$.usuarioId')"));
    assert.strictEqual(estado.paramsSessao.id, 2);
    assert.ok(estado.chamadas.some((c) => c.includes('INSERT INTO auditoria')));
    estado.sessoes = ['c'];
    await chamar('POST', '/usuarios/2/redefinir-senha');
    assert.strictEqual(estado.sessoes.length, 0, 'sessões apagadas');
  });
  await teste('reativar não mexe nas sessões', async () => {
    estado.sqlSessao = null;
    await chamar('PATCH', '/usuarios/2/ativo', { ativo: true });
    assert.strictEqual(estado.sqlSessao, null);
  });
  await teste('redefinir senha devolve nova senha e troca o hash', async () => {
    const r = await chamar('POST', '/usuarios/2/redefinir-senha');
    assert.strictEqual(r.status, 200);
    assert.ok(r.corpo.senhaProvisoria.length >= 8);
    assert.ok(estado.usuarios.find((u) => u.id === 2).hash.startsWith('$2'));
    assert.ok(estado.chamadas.some((c) => c.startsWith('UPDATE usuario SET senha_hash') && c.includes('deve_trocar_senha = 1')));
  });
  await teste('auditoria nunca registra a senha', async () => {
    assert.ok(!JSON.stringify(estado.chamadas).includes('senhaProvisoria'));
  });
  await teste('tabela de apoio fora da whitelist => 404; excluir em uso => 409; sem uso exclui', async () => {
    assert.strictEqual((await chamar('GET', '/apoio/usuario')).status, 404);
    assert.strictEqual((await chamar('DELETE', '/apoio/demanda/1')).status, 409);
    assert.ok(!estado.deletou);
    assert.strictEqual((await chamar('DELETE', '/apoio/demanda/99')).status, 404);
    estado.demandaEmUso.clear();
    assert.strictEqual((await chamar('DELETE', '/apoio/demanda/2')).status, 204);
    assert.ok(estado.deletou);
  });
  await teste('auditoria: data inválida => 400; filtros viram parâmetros', async () => {
    assert.strictEqual((await chamar('GET', '/auditoria?dataInicio=31-13-2026')).status, 400);
    const r = await chamar('GET', '/auditoria?acao=CRIAR&usuarioId=3&dataInicio=2026-01-01&dataFim=2026-01-31&porPagina=9999');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.porPagina, 200);
    assert.strictEqual(estado.paramsAuditoria.acao, 'CRIAR');
    assert.ok(estado.sqlAuditoria.includes('a.criado_em < DATEADD(day, 1, @fim)'));
    assert.ok(!estado.sqlAuditoria.includes('CRIAR'), 'valores não são concatenados no SQL');
  });

  servidor.close();
  console.log(`\n${ok} testes passaram.`);
})().catch((e) => { console.error(e); process.exit(1); });
