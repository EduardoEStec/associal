'use strict';

// Teste E2E (banco REAL) do encerramento de sessões — T9.
// Uso: PORT=3109 node server/index.js   (em outro terminal)   e   node tests/admin/sessoes.e2e.js
// Cria os usuários t9_admin / t9_assist, exercita a API e remove tudo ao final. Não toca no usuário "admin".

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const assert = require('assert');
const bcrypt = require('bcrypt');
const db = require('../../server/db');

const BASE = `http://localhost:${process.env.TESTE_PORT || 3109}`;
const SENHA = 'T9-senha-teste-1';

class Cliente {
  constructor() { this.cookie = ''; }
  async req(metodo, url, corpo) {
    const r = await fetch(BASE + url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Cookie: this.cookie },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    const txt = await r.text();
    return { status: r.status, corpo: txt ? JSON.parse(txt) : null };
  }
  async entrar(login, senha) {
    const r = await this.req('POST', '/api/auth/login', { login, senha });
    assert.strictEqual(r.status, 200, `login ${login}: ${JSON.stringify(r.corpo)}`);
    return this;
  }
}

const sessoesDe = async (id) => (await db.consultar(
  "SELECT COUNT(*) AS n FROM ASSOCIAL_sessao WHERE TRY_CAST(JSON_VALUE(dados, '$.usuarioId') AS INT) = @id", { id }))[0].n;
const ultimaAuditoria = async (id, acaoLike) => JSON.parse((await db.consultar(
  `SELECT TOP 1 detalhes FROM ASSOCIAL_auditoria WHERE tabela = 'usuario' AND registro_id = @id AND detalhes LIKE @l ORDER BY id DESC`,
  { id: String(id), l: `%${acaoLike}%` }))[0].detalhes);

async function limpar() {
  const ids = (await db.consultar("SELECT id FROM ASSOCIAL_usuario WHERE login LIKE 't9[_]%'")).map((u) => u.id);
  for (const id of ids) {
    await db.consultar("DELETE FROM ASSOCIAL_sessao WHERE TRY_CAST(JSON_VALUE(dados, '$.usuarioId') AS INT) = @id", { id });
    await db.consultar('DELETE FROM ASSOCIAL_usuario_unidade WHERE usuario_id = @id', { id });
    await db.consultar('UPDATE ASSOCIAL_usuario SET criado_por = NULL, alterado_por = NULL WHERE criado_por = @id OR alterado_por = @id', { id });
    await db.consultar('UPDATE ASSOCIAL_configuracao SET alterado_por = NULL WHERE alterado_por = @id', { id });
    await db.consultar('DELETE FROM ASSOCIAL_auditoria WHERE usuario_id = @id OR (tabela = \'usuario\' AND registro_id = @rid)', { id, rid: String(id) });
    await db.consultar('DELETE FROM ASSOCIAL_usuario WHERE id = @id', { id });
  }
}

async function criar(login, perfil, unidadeId) {
  const hash = await bcrypt.hash(SENHA, 10);
  const [u] = await db.consultar(
    `INSERT INTO ASSOCIAL_usuario (login, nome, senha_hash, perfil_id, deve_trocar_senha, ativo)
     OUTPUT INSERTED.id VALUES (@login, @login, @hash, (SELECT id FROM ASSOCIAL_perfil WHERE codigo = @perfil), 0, 1)`, { login, hash, perfil });
  if (unidadeId) await db.consultar('INSERT INTO ASSOCIAL_usuario_unidade VALUES (@id, @un)', { id: u.id, un: unidadeId });
  return u.id;
}

let ok = 0;
const teste = async (nome, fn) => { await fn(); ok += 1; console.log(`  ok - ${nome}`); };

(async () => {
  await limpar();
  const unidades = await db.consultar('SELECT TOP 2 id FROM ASSOCIAL_unidade WHERE ativo = 1 ORDER BY id');
  assert.ok(unidades.length >= 2, 'precisa de 2 unidades no banco');
  const idAdmin = await criar('t9_admin', 'ADMIN');
  const idAssist = await criar('t9_assist', 'ASSISTENTE', unidades[0].id);
  try {
    const admin = await new Cliente().entrar('t9_admin', SENHA);

    await teste('desativar usuário derruba todas as sessões dele e audita a contagem', async () => {
      await new Cliente().entrar('t9_assist', SENHA);
      const b = await new Cliente().entrar('t9_assist', SENHA);
      assert.strictEqual(await sessoesDe(idAssist), 2);
      assert.strictEqual((await admin.req('PATCH', `/api/admin/usuarios/${idAssist}/ativo`, { ativo: false })).status, 200);
      assert.strictEqual(await sessoesDe(idAssist), 0);
      assert.strictEqual((await b.req('GET', '/api/auth/me')).status, 401);
      assert.strictEqual((await ultimaAuditoria(idAssist, 'sessoesEncerradas')).sessoesEncerradas, 2);
      assert.strictEqual(await sessoesDe(idAdmin), 1, 'sessão do admin intacta');
      await admin.req('PATCH', `/api/admin/usuarios/${idAssist}/ativo`, { ativo: true });
    });

    await teste('redefinir senha derruba sessões; nova senha provisória exige troca', async () => {
      const a = await new Cliente().entrar('t9_assist', SENHA);
      await new Cliente().entrar('t9_assist', SENHA);
      const r = await admin.req('POST', `/api/admin/usuarios/${idAssist}/redefinir-senha`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(await sessoesDe(idAssist), 0);
      assert.strictEqual((await a.req('GET', '/api/auth/me')).status, 401);
      assert.strictEqual((await ultimaAuditoria(idAssist, 'redefinicao')).sessoesEncerradas, 2);
      const novo = await new Cliente().entrar('t9_assist', r.corpo.senhaProvisoria);
      assert.strictEqual((await novo.req('GET', '/api/auth/me')).corpo.usuario.deveTrocarSenha, true);
      await db.consultar('UPDATE ASSOCIAL_usuario SET deve_trocar_senha = 0 WHERE id = @id', { id: idAssist });
    });

    await teste('trocar a própria senha mantém a sessão atual e derruba as outras', async () => {
      await db.consultar('UPDATE ASSOCIAL_usuario SET senha_hash = @h WHERE id = @id', { h: await bcrypt.hash(SENHA, 10), id: idAssist });
      await db.consultar("DELETE FROM ASSOCIAL_sessao WHERE TRY_CAST(JSON_VALUE(dados, '$.usuarioId') AS INT) = @id", { id: idAssist }); // sobra do teste anterior
      const a = await new Cliente().entrar('t9_assist', SENHA);
      const b = await new Cliente().entrar('t9_assist', SENHA);
      const r = await a.req('POST', '/api/auth/senha', { senhaAtual: SENHA, novaSenha: 'T9-outra-senha-2' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.strictEqual((await a.req('GET', '/api/auth/me')).status, 200, 'atual segue ativa');
      assert.strictEqual((await b.req('GET', '/api/auth/me')).status, 401, 'outra derrubada');
      assert.strictEqual(await sessoesDe(idAssist), 1);
      assert.strictEqual((await ultimaAuditoria(idAssist, 'sessoesEncerradas')).sessoesEncerradas, 1);
    });

    await teste('mudar unidades/perfil derruba sessões; salvar sem mudança de acesso não', async () => {
      await db.consultar('UPDATE ASSOCIAL_usuario SET senha_hash = @h WHERE id = @id', { h: await bcrypt.hash(SENHA, 10), id: idAssist });
      const a = await new Cliente().entrar('t9_assist', SENHA);
      const corpo = { nome: 'T9 Assist', perfil: 'ASSISTENTE', unidadeIds: [unidades[0].id] };
      assert.strictEqual((await admin.req('PUT', `/api/admin/usuarios/${idAssist}`, { ...corpo, nome: 'T9 Renomeado' })).status, 200);
      assert.strictEqual((await a.req('GET', '/api/auth/me')).status, 200, 'sem mudança de acesso, sessão fica');
      assert.strictEqual((await admin.req('PUT', `/api/admin/usuarios/${idAssist}`, { ...corpo, unidadeIds: [unidades[1].id] })).status, 200);
      assert.strictEqual((await a.req('GET', '/api/auth/me')).status, 401);
      const b = await new Cliente().entrar('t9_assist', SENHA);
      assert.strictEqual((await admin.req('PUT', `/api/admin/usuarios/${idAssist}`, { ...corpo, perfil: 'COORDENADOR', unidadeIds: [] })).status, 200);
      assert.strictEqual((await b.req('GET', '/api/auth/me')).status, 401);
    });

    await teste('admin que altera as próprias unidades/redefine a própria senha mantém a sessão atual', async () => {
      const outra = await new Cliente().entrar('t9_admin', SENHA);
      const r = await admin.req('POST', `/api/admin/usuarios/${idAdmin}/redefinir-senha`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual((await outra.req('GET', '/api/auth/me')).status, 401, 'outra sessão do próprio admin cai');
      assert.strictEqual(await sessoesDe(idAdmin), 1, 'só a atual resta');
    });
  } finally {
    await limpar();
    await db.fechar();
  }
  console.log(`\n${ok} testes passaram (banco real).`);
})().catch(async (e) => { console.error(e); try { await limpar(); await db.fechar(); } catch { /* ignora */ } process.exit(1); });
