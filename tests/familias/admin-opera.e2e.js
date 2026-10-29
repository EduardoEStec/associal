'use strict';

// Teste E2E (banco REAL do Docker de teste) da V12: o ADMIN opera como a coordenação (atendimento, família, questionário, ação).
// Uso:  node tests/familias/admin-opera.e2e.js     (sobe o próprio servidor em TESTE_PORT, padrão 3123)
// Cria os usuários v12_* e dados com o prefixo "Teste V12E2E" (CPF exclusivo) e remove SÓ o que criou (por prefixo).
// TRAVA: recusa rodar se o SQL Server não for o container Linux local.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const assert = require('assert');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');
const db = require('../../server/db');
const familias = require('../../server/services/familias');

const PORTA = process.env.TESTE_PORT || 3123;
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'V12-senha-teste-1';
const CPF = '39053344705';
const PREFIXO = 'Teste V12E2E';

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
  async entrar(login) {
    const r = await this.req('POST', '/api/auth/login', { login, senha: SENHA });
    assert.strictEqual(r.status, 200, `login ${login}: ${JSON.stringify(r.corpo)}`);
    return this;
  }
}

const hoje = familias.hojeIso();
const dias = (n) => familias.somarDias(hoje, n);
const itensCompletos = (nps = 9, likert = 4, extra = []) => [
  { codigo: 'NPS', valorNum: nps }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ codigo: `L${n}`, valorNum: likert })), ...extra];

async function travaDeSeguranca() {
  const [info] = await db.consultar(
    "SELECT (SELECT host_platform FROM sys.dm_os_host_info) AS plataforma, CAST(SERVERPROPERTY('MachineName') AS NVARCHAR(100)) AS maquina");
  const local = ['localhost', '127.0.0.1', '::1'].includes(String(process.env.DB_SERVER).toLowerCase());
  if (info.plataforma !== 'Linux' || !local) {
    console.error(`RECUSADO: o banco não parece ser o container Docker de teste (DB_SERVER=${process.env.DB_SERVER}, plataforma=${info.plataforma}).`);
    process.exit(2);
  }
  console.log(`Banco de teste confirmado: container Linux ${info.maquina}.`);
}

// Só apaga o que este teste criou: pessoa com CPF de teste E nome com o prefixo; usuários f3_*.
async function limpar() {
  const pessoas = (await db.consultar('SELECT id FROM ASSOCIAL_pessoa WHERE cpf = @cpf AND nome LIKE @p', { cpf: CPF, p: `${PREFIXO}%` })).map((p) => p.id);
  for (const pid of pessoas) {
    for (const f of await db.consultar('SELECT id FROM ASSOCIAL_familia WHERE responsavel_pessoa_id = @pid', { pid })) {
      for (const ac of await db.consultar('SELECT id FROM ASSOCIAL_acompanhamento WHERE familia_id = @f', { f: f.id })) {
        await db.consultar('DELETE FROM ASSOCIAL_pesquisa_resposta WHERE acompanhamento_id = @ac', { ac: ac.id });
        await db.consultar('DELETE FROM ASSOCIAL_acompanhamento_registro WHERE acompanhamento_id = @ac', { ac: ac.id });
        await db.consultar('DELETE FROM ASSOCIAL_questionario WHERE acompanhamento_id = @ac', { ac: ac.id });
        await db.consultar("DELETE FROM ASSOCIAL_auditoria WHERE tabela IN ('acompanhamento', 'pesquisa_resposta', 'acompanhamento_registro') AND registro_id = @ac", { ac: String(ac.id) });
        await db.consultar('DELETE FROM ASSOCIAL_acompanhamento WHERE id = @ac', { ac: ac.id });
      }
      await db.consultar('DELETE FROM ASSOCIAL_familia_membro WHERE familia_id = @f', { f: f.id });
      await db.consultar('DELETE FROM ASSOCIAL_familia WHERE id = @f', { f: f.id });
    }
    for (const at of await db.consultar('SELECT id FROM ASSOCIAL_atendimento WHERE pessoa_id = @pid', { pid })) {
      await db.consultar("DELETE FROM ASSOCIAL_auditoria WHERE tabela = 'atendimento' AND registro_id = @id", { id: String(at.id) });
    }
    await db.consultar('DELETE FROM ASSOCIAL_atendimento WHERE pessoa_id = @pid', { pid });
    await db.consultar('DELETE FROM ASSOCIAL_pessoa WHERE id = @pid', { pid });
  }
  for (const ac of await db.consultar('SELECT id FROM ASSOCIAL_acao_visita WHERE instituicao_local LIKE @p', { p: `${PREFIXO}%` })) {
    await db.consultar('DELETE FROM ASSOCIAL_acao_visita_tema WHERE acao_visita_id = @id', { id: ac.id });
    await db.consultar("DELETE FROM ASSOCIAL_auditoria WHERE tabela = 'acao_visita' AND registro_id = @id", { id: String(ac.id) });
    await db.consultar('DELETE FROM ASSOCIAL_acao_visita WHERE id = @id', { id: ac.id });
  }
  for (const u of await db.consultar("SELECT id FROM ASSOCIAL_usuario WHERE login LIKE 'v12[_]%'")) {
    const id = u.id;
    await db.consultar("DELETE FROM ASSOCIAL_sessao WHERE TRY_CAST(JSON_VALUE(dados, '$.usuarioId') AS INT) = @id", { id });
    await db.consultar('DELETE FROM ASSOCIAL_usuario_unidade WHERE usuario_id = @id', { id });
    await db.consultar("DELETE FROM ASSOCIAL_auditoria WHERE usuario_id = @id", { id });
    await db.consultar('UPDATE ASSOCIAL_usuario SET criado_por = NULL, alterado_por = NULL WHERE criado_por = @id OR alterado_por = @id', { id });
    await db.consultar('UPDATE ASSOCIAL_configuracao SET alterado_por = NULL WHERE alterado_por = @id', { id });
    await db.consultar('DELETE FROM ASSOCIAL_usuario WHERE id = @id', { id });
  }
}

async function criarUsuario(login, perfil, unidadeId) {
  const hash = await bcrypt.hash(SENHA, 10);
  const [u] = await db.consultar(
    `INSERT INTO ASSOCIAL_usuario (login, nome, senha_hash, perfil_id, deve_trocar_senha, ativo)
     OUTPUT INSERTED.id VALUES (@login, @login, @hash, (SELECT id FROM ASSOCIAL_perfil WHERE codigo = @perfil), 0, 1)`, { login, hash, perfil });
  if (unidadeId) await db.consultar('INSERT INTO ASSOCIAL_usuario_unidade VALUES (@id, @un)', { id: u.id, un: unidadeId });
  return u.id;
}

async function esperarServidor() {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/api/saude`)).ok) return; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('servidor de teste não subiu');
}

let ok = 0;
const teste = async (nome, fn) => { await fn(); ok += 1; console.log(`  ok - ${nome}`); };

(async () => {
  await travaDeSeguranca();
  const colisao = await db.consultar('SELECT cpf, nome FROM ASSOCIAL_pessoa WHERE cpf = @cpf AND nome NOT LIKE @p', { cpf: CPF, p: `${PREFIXO}%` });
  if (colisao.length) { console.error('RECUSADO: o CPF de teste já pertence a dados que este teste não criou:', colisao[0].nome); process.exit(3); }
  await limpar();

  const [uA, uB] = await db.consultar('SELECT TOP 2 id, sigla FROM ASSOCIAL_unidade WHERE ativo = 1 ORDER BY id');
  assert.ok(uA && uB, 'precisa de 2 unidades');
  const idAdmin = await criarUsuario('v12_admin', 'ADMIN');
  await criarUsuario('v12_assist', 'ASSISTENTE', uA.id);
  const demandas = await db.consultar('SELECT TOP 2 id FROM ASSOCIAL_demanda WHERE ativo = 1 ORDER BY id');
  const [tipoAcao] = await db.consultar('SELECT TOP 1 id FROM ASSOCIAL_tipo_acao WHERE ativo = 1 ORDER BY id');

  if (await fetch(`${BASE}/api/saude`).then((r) => r.ok, () => false)) throw new Error(`a porta ${PORTA} já está em uso; defina TESTE_PORT`);
  const servidor = spawn(process.execPath, ['server/index.js'], {
    cwd: require('path').join(__dirname, '..', '..'), env: { ...process.env, PORT: String(PORTA), NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await esperarServidor();
    const adm = await new Cliente().entrar('v12_admin');
    const a = await new Cliente().entrar('v12_assist');
    const nomePessoa = `${PREFIXO} Maria`;
    let atendimentoId; let acId;

    await teste('sessão: ADMIN vê todas as unidades (como a coordenação)', async () => {
      const resp = (await adm.req('GET', '/api/auth/me')).corpo; const me = resp.usuario || resp;
      assert.ok(me.unidades.length >= 2);
      assert.strictEqual(me.perfil, 'ADMIN');
    });

    await teste('atendimento: ADMIN cria em qualquer unidade, lê o texto, edita e a auditoria guarda quem fez', async () => {
      const corpo = { unidadeId: uB.id, dataAtendimento: hoje, nome: nomePessoa, cpf: CPF, dataNascimento: '1980-03-11',
        demandas: demandas.map((d) => d.id), vulnerabilidades: [], encaminhamentos: [], resumo: 'Atendimento criado pelo admin' };
      const r = await adm.req('POST', '/api/atendimentos', corpo);
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      atendimentoId = r.corpo.id;
      const det = (await adm.req('GET', `/api/atendimentos/${atendimentoId}`)).corpo;
      assert.strictEqual(det.podeEditar, true);
      assert.strictEqual(det.podeExcluir, true);
      assert.strictEqual(det.resumo, 'Atendimento criado pelo admin');
      const put = await adm.req('PUT', `/api/atendimentos/${atendimentoId}`, { ...corpo, resumo: 'Editado pelo admin' });
      assert.strictEqual(put.status, 200, JSON.stringify(put.corpo));
      const [x] = await db.consultar('SELECT usuario_id, resumo FROM ASSOCIAL_atendimento WHERE id = @id', { id: atendimentoId });
      assert.strictEqual(x.usuarioId, idAdmin);
      assert.strictEqual(x.resumo, 'Editado pelo admin');
      const [aud] = await db.consultar("SELECT COUNT(*) AS n FROM ASSOCIAL_auditoria WHERE tabela = 'atendimento' AND registro_id = @id AND usuario_id = @u AND acao IN ('CRIAR', 'ALTERAR')", { id: String(atendimentoId), u: idAdmin });
      assert.strictEqual(aud.n, 2);
      // a assistente da unidade A segue sem enxergar o atendimento da unidade B
      assert.strictEqual((await a.req('GET', `/api/atendimentos/${atendimentoId}`)).status, 404);
    });

    await teste('família: ADMIN cadastra, ajusta o prazo final, registra contato e aplica pesquisa; tudo auditado em nome dele', async () => {
      const r = await adm.req('POST', '/api/familias', { unidadeId: uB.id, dataInicio: dias(-10), responsavel: { cpf: CPF, nome: nomePessoa } });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      acId = r.corpo.acompanhamentoId ?? r.corpo.id;
      const prazo = await adm.req('PUT', `/api/familias/acompanhamentos/${acId}`, { dataPrevistaFinal: dias(50) });
      assert.strictEqual(prazo.status, 200, JSON.stringify(prazo.corpo));
      const tiposC = (await adm.req('GET', `/api/familias/acompanhamentos/${acId}/registros`)).corpo.tiposContato;
      const reg = await adm.req('POST', `/api/familias/acompanhamentos/${acId}/registros`, { dataRegistro: hoje, tipoContatoId: tiposC[0].id, houveContato: true, situacao: 'MELHORANDO', resumo: 'Visita registrada pelo admin' });
      assert.strictEqual(reg.status, 201, JSON.stringify(reg.corpo));
      const itens = [{ codigo: 'NPS', valorNum: 10 }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ codigo: `L${n}`, valorNum: 5 }))];
      const pes = await adm.req('POST', `/api/familias/acompanhamentos/${acId}/pesquisas`, { momento: 'AVULSA', situacao: 'CONCLUIDA', consentimentoLido: true, modo: 'COM_AJUDA', dataAplicacao: hoje, itens });
      assert.strictEqual(pes.status, 201, JSON.stringify(pes.corpo));
      const tl = (await adm.req('GET', `/api/familias/acompanhamentos/${acId}/linha-do-tempo`)).corpo.itens;
      assert.ok(tl.some((e) => e.tipo === 'REGISTRO' && /Visita registrada pelo admin/.test(e.resumo)), 'lê o texto do registro');
      assert.ok(tl.some((e) => e.tipo === 'PESQUISA'));
      const [aud] = await db.consultar("SELECT COUNT(*) AS n FROM ASSOCIAL_auditoria WHERE usuario_id = @u AND tabela IN ('acompanhamento', 'acompanhamento_registro', 'pesquisa_resposta')", { u: idAdmin });
      assert.ok(aud.n >= 3, 'cadastro, registro e pesquisa auditados em nome do admin');
      // a assistente da unidade A não vê a família da unidade B
      assert.strictEqual((await a.req('GET', `/api/familias/acompanhamentos/${acId}`)).status, 404);
    });

    await teste('questionário: o ADMIN passa pela porta de escrita (validação, não 403) e lê o questionário', async () => {
      const q = await adm.req('PUT', `/api/familias/acompanhamentos/${acId}/questionarios/INICIAL`, {});
      assert.notStrictEqual(q.status, 403, JSON.stringify(q.corpo));
      assert.strictEqual((await adm.req('GET', `/api/familias/acompanhamentos/${acId}/questionarios/INICIAL`)).status, 200);
    });

    await teste('encerrar acompanhamento: o ADMIN também pode (não é 403)', async () => {
      const r = await adm.req('POST', `/api/familias/acompanhamentos/${acId}/encerrar`, { status: 'DESLIGADO', observacoes: 'Encerrado no teste' });
      assert.notStrictEqual(r.status, 403, JSON.stringify(r.corpo));
    });

    await teste('ação: ADMIN cria em qualquer unidade', async () => {
      const r = await adm.req('POST', '/api/acoes', { unidadeId: uB.id, tipoAcaoId: tipoAcao.id, dataAcao: hoje, instituicaoLocal: `${PREFIXO} Escola`, status: 'PLANEJADA', temaIds: [] });
      assert.notStrictEqual(r.status, 403, JSON.stringify(r.corpo));
    });

    console.log(`\n${ok} testes OK`);
  } finally {
    servidor.kill();
    await limpar();
    const restos = await db.consultar("SELECT COUNT(*) AS n FROM ASSOCIAL_usuario WHERE login LIKE 'v12[_]%'");
    console.log(`Limpeza: usuários de teste restantes = ${restos[0].n}`);
    await db.fechar();
  }
})().catch(async (e) => {
  console.error('\nFALHOU:', e && e.stack ? e.stack : e);
  try { await limpar(); } catch { /* ignora */ }
  process.exit(1);
});
