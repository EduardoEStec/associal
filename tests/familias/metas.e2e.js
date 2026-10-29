'use strict';

// Teste E2E (banco REAL do Docker de teste) da F4: plano de metas.
// Uso:  node tests/familias/metas.e2e.js        (sobe o próprio servidor em TESTE_PORT, padrão 3124)
// Cria os usuários f4_* e uma família "Teste F4E2E Maria" (CPF exclusivo), exercita a API e remove SÓ o que criou (por prefixo).
// TRAVA: recusa rodar se o SQL Server não for o container Linux local.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const assert = require('assert');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');
const db = require('../../server/db');
const familias = require('../../server/services/familias');

const PORTA = process.env.TESTE_PORT || 3124;
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'F4-senha-teste-1';
const CPF = '86287306300';
const PREFIXO = 'Teste F4E2E';

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
        await db.consultar('DELETE FROM ASSOCIAL_acompanhamento_meta WHERE acompanhamento_id = @ac', { ac: ac.id });
        await db.consultar('DELETE FROM ASSOCIAL_questionario WHERE acompanhamento_id = @ac', { ac: ac.id });
        await db.consultar("DELETE FROM ASSOCIAL_auditoria WHERE tabela IN ('acompanhamento', 'pesquisa_resposta', 'acompanhamento_registro') AND registro_id = @ac", { ac: String(ac.id) });
        await db.consultar('DELETE FROM ASSOCIAL_acompanhamento WHERE id = @ac', { ac: ac.id });
      }
      await db.consultar('DELETE FROM ASSOCIAL_familia_membro WHERE familia_id = @f', { f: f.id });
      await db.consultar('DELETE FROM ASSOCIAL_familia WHERE id = @f', { f: f.id });
    }
    await db.consultar('DELETE FROM ASSOCIAL_atendimento WHERE pessoa_id = @pid', { pid });
    await db.consultar('DELETE FROM ASSOCIAL_pessoa WHERE id = @pid', { pid });
  }
  for (const u of await db.consultar("SELECT id FROM ASSOCIAL_usuario WHERE login LIKE 'f4[_]%'")) {
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
const config = {};

(async () => {
  await travaDeSeguranca();
  const colisao = await db.consultar('SELECT cpf, nome FROM ASSOCIAL_pessoa WHERE cpf = @cpf AND nome NOT LIKE @p', { cpf: CPF, p: `${PREFIXO}%` });
  if (colisao.length) { console.error('RECUSADO: o CPF de teste já pertence a dados que este teste não criou:', colisao[0].nome); process.exit(3); }
  await limpar();

  const [uA, uB] = await db.consultar('SELECT TOP 2 id, sigla FROM ASSOCIAL_unidade WHERE ativo = 1 ORDER BY id');
  assert.ok(uA && uB, 'precisa de 2 unidades');
  await criarUsuario('f4_assist_a', 'ASSISTENTE', uA.id);
  await criarUsuario('f4_assist_b', 'ASSISTENTE', uB.id);
  const idCoord = await criarUsuario('f4_coord', 'COORDENADOR');
  await criarUsuario('f4_admin', 'ADMIN');
  for (const l of await db.consultar("SELECT chave, valor FROM ASSOCIAL_configuracao WHERE chave IN ('alerta_sem_meta_dias', 'alerta_sem_contato_dias')")) config[l.chave] = l.valor;

  if (await fetch(`${BASE}/api/saude`).then((r) => r.ok, () => false)) throw new Error(`a porta ${PORTA} já está em uso; defina TESTE_PORT`);
  const servidor = spawn(process.execPath, ['server/index.js'], {
    cwd: require('path').join(__dirname, '..', '..'), env: { ...process.env, PORT: String(PORTA), NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await esperarServidor();
    const a = await new Cliente().entrar('f4_assist_a');
    const b = await new Cliente().entrar('f4_assist_b');
    const coord = await new Cliente().entrar('f4_coord');
    const adm = await new Cliente().entrar('f4_admin');

    let acId;
    const base = () => `/api/familias/acompanhamentos/${acId}`;
    const metas = async (cli = a) => (await cli.req('GET', `${base()}/metas`)).corpo;
    const inicioSemMeta = async (cli = a) => (await cli.req('GET', '/api/painel/resumo-inicio')).corpo.pendentes;
    const corpoMeta = (sobre = {}) => ({ dimensao: 'ALIMENTACAO', descricao: 'Comprar frutas e verduras 3x por semana', prazo: dias(60), ...sobre });
    let metaId; let tipoContato;

    await teste('família iniciada há 45 dias sem meta: alerta na ficha, em /metas e na tela Início', async () => {
      const r = await a.req('POST', '/api/familias', { unidadeId: uA.id, dataInicio: dias(-45), responsavel: { cpf: CPF, nome: `${PREFIXO} Maria` } });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      acId = r.corpo.acompanhamentoId ?? r.corpo.id;
      const ficha = (await a.req('GET', base())).corpo;
      assert.strictEqual(ficha.metas.emAndamento, 0);
      assert.strictEqual(ficha.metas.semMeta.dias, 45);
      const m = await metas();
      assert.strictEqual(m.semMeta.dias, 45);
      assert.strictEqual(m.semMeta.limiteDias, 30);
      assert.deepStrictEqual(m.dimensoes.map((d) => d.codigo), ['ALIMENTACAO', 'RENDA', 'ECONOMIA', 'AUTONOMIA', 'OUTRA']);
      const pend = await inicioSemMeta();
      const item = pend.semMetaItens.find((i) => i.acompanhamentoId === acId);
      assert.ok(item, 'aparece no Início');
      assert.strictEqual(item.diasSemMeta, 45);
      assert.ok(pend.semMeta >= 1);
      // a assistente da outra unidade não vê esse item
      assert.ok(!(await inicioSemMeta(b)).semMetaItens.some((i) => i.acompanhamentoId === acId));
    });

    await teste('criar meta: validações em português por campo; grava com autor; o alerta some', async () => {
      let r = await a.req('POST', `${base()}/metas`, { dimensao: 'SAUDE', descricao: '' });
      assert.strictEqual(r.status, 400);
      assert.ok(r.corpo.erro.detalhes.dimensao && r.corpo.erro.detalhes.descricao);
      assert.strictEqual((await a.req('POST', `${base()}/metas`, corpoMeta({ descricao: 'x'.repeat(301) }))).status, 400);
      assert.strictEqual((await a.req('POST', `${base()}/metas`, corpoMeta({ prazo: dias(-60) }))).status, 400, 'prazo antes do início');
      assert.strictEqual((await a.req('POST', `${base()}/metas`, corpoMeta({ status: 'ATINGIDA' }))).status, 400, 'meta nova só em andamento');
      r = await a.req('POST', `${base()}/metas`, corpoMeta());
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      metaId = r.corpo.id;
      const m = await metas();
      assert.strictEqual(m.semMeta, null);
      assert.strictEqual(m.metas.length, 1);
      assert.strictEqual(m.metas[0].status, 'EM_ANDAMENTO');
      assert.strictEqual(m.metas[0].dimensaoNome, 'Alimentação');
      assert.strictEqual(m.metas[0].vencida, false);
      assert.strictEqual((await a.req('GET', base())).corpo.metas.emAndamento, 1);
      assert.ok(!(await inicioSemMeta()).semMetaItens.some((i) => i.acompanhamentoId === acId), 'sai do Início');
      const [aud] = await db.consultar("SELECT COUNT(*) AS n FROM ASSOCIAL_auditoria WHERE tabela = 'acompanhamento_meta' AND registro_id = @id AND acao = 'CRIAR'", { id: String(metaId) });
      assert.strictEqual(aud.n, 1);
      const [linha] = await db.consultar('SELECT u.login FROM ASSOCIAL_acompanhamento_meta m JOIN ASSOCIAL_usuario u ON u.id = m.usuario_id WHERE m.id = @id', { id: metaId });
      assert.strictEqual(linha.login, 'f4_assist_a');
    });

    await teste('registro de contato marca avanço na meta; tentativa sem contato não marca; meta inválida é recusada', async () => {
      tipoContato = (await a.req('GET', `${base()}/registros`)).corpo.tiposContato[0].id;
      const corpo = { dataRegistro: hoje, tipoContatoId: tipoContato, houveContato: true, situacao: 'MELHORANDO', resumo: 'Visita: já compram frutas.' };
      let r = await a.req('POST', `${base()}/registros`, { ...corpo, metas: [{ metaId, avanco: 'VOOU' }] });
      assert.strictEqual(r.status, 400);
      assert.ok(r.corpo.erro.detalhes.metas);
      r = await a.req('POST', `${base()}/registros`, { ...corpo, metas: [{ metaId: 999999, avanco: 'AVANCOU' }] });
      assert.strictEqual(r.status, 400, 'meta que não é desta família');
      r = await a.req('POST', `${base()}/registros`, { ...corpo, metas: [{ metaId, avanco: 'AVANCOU' }] });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      const regId = r.corpo.id;
      const lista = (await a.req('GET', `${base()}/registros`)).corpo.registros.find((x) => x.id === regId);
      assert.strictEqual(lista.metas.length, 1);
      assert.strictEqual(lista.metas[0].avanco, 'AVANCOU');
      assert.strictEqual(lista.metas[0].dimensaoNome, 'Alimentação');
      const m = (await metas()).metas[0];
      assert.strictEqual(m.ultimoAvanco, 'AVANCOU');
      assert.strictEqual(m.historico.length, 1);
      assert.strictEqual(m.historico[0].registroId, regId);
      // tentativa sem contato: metas ignoradas
      r = await a.req('POST', `${base()}/registros`, { dataRegistro: hoje, tipoContatoId: tipoContato, houveContato: false, metas: [{ metaId, avanco: 'RETROCEDEU' }] });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      assert.strictEqual((await metas()).metas[0].historico.length, 1, 'tentativa sem contato não grava avanço');
      // editar: troca o avanço (e sem "metas" no corpo mantém)
      let put = await a.req('PUT', `${base()}/registros/${regId}`, { ...corpo, metas: [{ metaId, avanco: 'SEM_MUDANCA' }] });
      assert.strictEqual(put.status, 200, JSON.stringify(put.corpo));
      assert.strictEqual((await metas()).metas[0].ultimoAvanco, 'SEM_MUDANCA');
      put = await a.req('PUT', `${base()}/registros/${regId}`, corpo);
      assert.strictEqual((await metas()).metas[0].ultimoAvanco, 'SEM_MUDANCA', 'sem metas no corpo, mantém');
      put = await a.req('PUT', `${base()}/registros/${regId}`, { ...corpo, metas: [] });
      assert.strictEqual((await metas()).metas[0].historico.length, 0, 'lista vazia remove o avanço');
      // anular o registro tira o avanço do histórico
      await a.req('PUT', `${base()}/registros/${regId}`, { ...corpo, metas: [{ metaId, avanco: 'AVANCOU' }] });
      assert.strictEqual((await metas()).metas[0].historico.length, 1);
      assert.strictEqual((await a.req('POST', `${base()}/registros/${regId}/anular`, { motivo: 'teste' })).status, 200);
      assert.strictEqual((await metas()).metas[0].historico.length, 0);
      // um novo registro com avanço (para a linha do tempo)
      r = await a.req('POST', `${base()}/registros`, { ...corpo, metas: [{ metaId, avanco: 'AVANCOU' }] });
      assert.strictEqual(r.status, 201);
    });

    await teste('linha do tempo: meta definida e metas tratadas no contato; filtro por tipo META', async () => {
      const tl = (await a.req('GET', `${base()}/linha-do-tempo`)).corpo.itens;
      const def = tl.find((e) => e.tipo === 'META');
      assert.ok(def, 'evento META');
      assert.strictEqual(def.titulo, 'Meta definida');
      assert.match(def.detalhe, /Alimentação/);
      assert.match(def.resumo, /frutas e verduras/);
      const reg = tl.find((e) => e.tipo === 'REGISTRO' && /frutas/.test(e.resumo || ''));
      assert.match(reg.detalhe, /^Metas: Comprar frutas e verduras 3x por semana \(avançou\)$/);
      const so = (await a.req('GET', `${base()}/linha-do-tempo?tipos=META`)).corpo;
      assert.ok(so.itens.length >= 1 && so.itens.every((e) => e.tipo === 'META'));
    });

    await teste('atualizar: editar descrição e prazo vencido; encerrar como atingida (data padrão hoje) e reabrir', async () => {
      let r = await a.req('PUT', `${base()}/metas/${metaId}`, corpoMeta({ descricao: 'Frutas e verduras toda semana', prazo: dias(-1) }));
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      let m = r.corpo.metas[0];
      assert.strictEqual(m.descricao, 'Frutas e verduras toda semana');
      assert.strictEqual(m.vencida, true);
      assert.strictEqual((await a.req('GET', base())).corpo.metas.vencidas, 1);
      assert.strictEqual((await a.req('PUT', `${base()}/metas/${metaId}`, corpoMeta({ status: 'ATINGIDA', concluidaEm: dias(2) }))).status, 400, 'data futura');
      assert.strictEqual((await a.req('PUT', `${base()}/metas/999999`, corpoMeta())).status, 404);
      r = await a.req('PUT', `${base()}/metas/${metaId}`, corpoMeta({ status: 'ATINGIDA' }));
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      m = r.corpo.metas[0];
      assert.strictEqual(m.status, 'ATINGIDA');
      assert.strictEqual(String(m.concluidaEm).slice(0, 10), hoje);
      assert.strictEqual(m.vencida, false, 'encerrada não é vencida');
      // sem meta em andamento, mas o relógio recomeça hoje: sem alerta
      assert.strictEqual(r.corpo.semMeta, null);
      const tl = (await a.req('GET', `${base()}/linha-do-tempo?tipos=META`)).corpo.itens;
      assert.ok(tl.some((e) => e.titulo === 'Meta atingida'));
      // registro não pode mais marcar meta encerrada
      const reg = await a.req('POST', `${base()}/registros`, { dataRegistro: hoje, tipoContatoId: tipoContato, houveContato: true, situacao: 'IGUAL', resumo: 'x', metas: [{ metaId, avanco: 'AVANCOU' }] });
      assert.strictEqual(reg.status, 400);
      // reabrir limpa a data de encerramento
      r = await a.req('PUT', `${base()}/metas/${metaId}`, corpoMeta({ status: 'EM_ANDAMENTO' }));
      assert.strictEqual(r.corpo.metas[0].status, 'EM_ANDAMENTO');
      assert.strictEqual(r.corpo.metas[0].concluidaEm, null);
      const [aud] = await db.consultar("SELECT COUNT(*) AS n FROM ASSOCIAL_auditoria WHERE tabela = 'acompanhamento_meta' AND registro_id = @id AND acao = 'ALTERAR'", { id: String(metaId) });
      assert.ok(aud.n >= 3);
    });

    await teste('meta cancelada recomeça a contagem do alerta; limite editável pela coordenação (assistente 403)', async () => {
      assert.strictEqual((await a.req('PUT', `${base()}/metas/${metaId}`, corpoMeta({ status: 'CANCELADA', concluidaEm: dias(-5) }))).status, 200);
      assert.strictEqual((await metas()).semMeta, null, 'cancelada há 5 dias: ainda dentro do limite de 30');
      // data de encerramento antiga (direto no banco, só nos dados do próprio teste) => alerta volta contando dessa data
      await db.consultar('UPDATE ASSOCIAL_acompanhamento_meta SET concluida_em = @d WHERE id = @id', { id: metaId, d: [db.tipos.Date, dias(-40)] });
      const m = await metas();
      assert.strictEqual(m.semMeta.dias, 40);
      assert.strictEqual(m.semMeta.desde, dias(-40));
      assert.ok((await inicioSemMeta()).semMetaItens.some((i) => i.acompanhamentoId === acId && i.diasSemMeta === 40));
      // limite editável
      assert.strictEqual((await a.req('PUT', '/api/admin/configuracoes/alerta_sem_meta_dias', { valor: '60' })).status, 403);
      assert.strictEqual((await coord.req('PUT', '/api/admin/configuracoes/alerta_sem_meta_dias', { valor: '3' })).status, 400);
      assert.strictEqual((await coord.req('PUT', '/api/admin/configuracoes/alerta_sem_meta_dias', { valor: '60' })).status, 200);
      assert.strictEqual((await metas()).semMeta, null, 'com limite de 60, 40 dias não alerta');
      assert.strictEqual((await metas()).semMetaDias, 60);
      assert.strictEqual((await coord.req('PUT', '/api/admin/configuracoes/alerta_sem_meta_dias', { valor: config.alerta_sem_meta_dias })).status, 200);
      // reabrir a meta resolve o alerta
      assert.strictEqual((await a.req('PUT', `${base()}/metas/${metaId}`, corpoMeta({ status: 'EM_ANDAMENTO' }))).status, 200);
      assert.strictEqual((await metas()).semMeta, null);
    });

    await teste('isolamento por unidade: assistente de outra unidade recebe 404; coordenação e ADMIN escrevem', async () => {
      for (const [m, u, x] of [['GET', `${base()}/metas`], ['POST', `${base()}/metas`, corpoMeta()], ['PUT', `${base()}/metas/${metaId}`, corpoMeta()]]) {
        assert.strictEqual((await b.req(m, u, x)).status, 404, `${m} ${u}`);
      }
      const rc = await coord.req('POST', `${base()}/metas`, corpoMeta({ dimensao: 'RENDA', descricao: 'Retomar o bico semanal' }));
      assert.strictEqual(rc.status, 201, JSON.stringify(rc.corpo));
      const ra = await adm.req('POST', `${base()}/metas`, corpoMeta({ dimensao: 'AUTONOMIA', descricao: 'Tirar o documento atrasado' }));
      assert.strictEqual(ra.status, 201, JSON.stringify(ra.corpo));
      const [aud] = await db.consultar("SELECT COUNT(*) AS n FROM ASSOCIAL_auditoria WHERE tabela = 'acompanhamento_meta' AND registro_id = @id AND acao = 'CRIAR' AND usuario_id = @u", { id: String(rc.corpo.id), u: idCoord });
      assert.strictEqual(aud.n, 1, 'auditoria em nome da coordenação');
    });

    await teste('encerrar o acompanhamento: metas ficam só para leitura (409) e o alerta de sem meta some', async () => {
      const antes = (await metas()).metas.length;
      const enc = await a.req('POST', `${base()}/encerrar`, { status: 'DESLIGADO', observacoes: 'Mudou de bairro' });
      assert.strictEqual(enc.status, 200, JSON.stringify(enc.corpo));
      assert.strictEqual((await a.req('POST', `${base()}/metas`, corpoMeta())).status, 409);
      assert.strictEqual((await a.req('PUT', `${base()}/metas/${metaId}`, corpoMeta())).status, 409);
      const m = await metas();
      assert.strictEqual(m.metas.length, antes);
      assert.strictEqual(m.semMeta, null);
      assert.ok(!(await inicioSemMeta()).semMetaItens.some((i) => i.acompanhamentoId === acId));
    });

    console.log(`\n${ok} testes OK`);
  } finally {
    servidor.kill();
    for (const [chave, valor] of Object.entries(config)) await db.consultar('UPDATE ASSOCIAL_configuracao SET valor = @v WHERE chave = @c', { v: valor, c: chave }).catch(() => {});
    await limpar();
    const restos = await db.consultar("SELECT COUNT(*) AS n FROM ASSOCIAL_usuario WHERE login LIKE 'f4[_]%'");
    console.log(`Limpeza: usuários de teste restantes = ${restos[0].n}`);
    await db.fechar();
  }
})().catch(async (e) => {
  console.error('\nFALHOU:', e && e.stack ? e.stack : e);
  try { await limpar(); } catch { /* ignora */ }
  process.exit(1);
});
