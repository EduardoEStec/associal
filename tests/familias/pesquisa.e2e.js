'use strict';

// Teste E2E (banco REAL do Docker de teste) da F3: pesquisa de satisfação identificada.
// Uso:  node tests/familias/pesquisa.e2e.js        (sobe o próprio servidor em TESTE_PORT, padrão 3122)
// Cria os usuários f3_* e uma família "Teste F3E2E A", exercita a API e remove SÓ o que criou (por prefixo).
// TRAVA: recusa rodar se o SQL Server não for o container Linux local.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const assert = require('assert');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');
const db = require('../../server/db');
const familias = require('../../server/services/familias');

const PORTA = process.env.TESTE_PORT || 3122;
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'F3-senha-teste-1';
const CPF = '73184529673';
const PREFIXO = 'Teste F3E2E';

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
  const pessoas = (await db.consultar('SELECT id FROM pessoa WHERE cpf = @cpf AND nome LIKE @p', { cpf: CPF, p: `${PREFIXO}%` })).map((p) => p.id);
  for (const pid of pessoas) {
    for (const f of await db.consultar('SELECT id FROM familia WHERE responsavel_pessoa_id = @pid', { pid })) {
      for (const ac of await db.consultar('SELECT id FROM acompanhamento WHERE familia_id = @f', { f: f.id })) {
        await db.consultar('DELETE FROM pesquisa_resposta WHERE acompanhamento_id = @ac', { ac: ac.id });
        await db.consultar('DELETE FROM acompanhamento_registro WHERE acompanhamento_id = @ac', { ac: ac.id });
        await db.consultar('DELETE FROM questionario WHERE acompanhamento_id = @ac', { ac: ac.id });
        await db.consultar("DELETE FROM auditoria WHERE tabela IN ('acompanhamento', 'pesquisa_resposta') AND registro_id = @ac", { ac: String(ac.id) });
        await db.consultar('DELETE FROM acompanhamento WHERE id = @ac', { ac: ac.id });
      }
      await db.consultar('DELETE FROM familia_membro WHERE familia_id = @f', { f: f.id });
      await db.consultar('DELETE FROM familia WHERE id = @f', { f: f.id });
    }
    await db.consultar('DELETE FROM atendimento WHERE pessoa_id = @pid', { pid });
    await db.consultar('DELETE FROM pessoa WHERE id = @pid', { pid });
  }
  for (const u of await db.consultar("SELECT id FROM usuario WHERE login LIKE 'f3[_]%'")) {
    const id = u.id;
    await db.consultar("DELETE FROM sessao WHERE TRY_CAST(JSON_VALUE(dados, '$.usuarioId') AS INT) = @id", { id });
    await db.consultar('DELETE FROM usuario_unidade WHERE usuario_id = @id', { id });
    await db.consultar("DELETE FROM auditoria WHERE usuario_id = @id", { id });
    await db.consultar('UPDATE usuario SET criado_por = NULL, alterado_por = NULL WHERE criado_por = @id OR alterado_por = @id', { id });
    await db.consultar('UPDATE configuracao SET alterado_por = NULL WHERE alterado_por = @id', { id });
    await db.consultar('DELETE FROM usuario WHERE id = @id', { id });
  }
}

async function criarUsuario(login, perfil, unidadeId) {
  const hash = await bcrypt.hash(SENHA, 10);
  const [u] = await db.consultar(
    `INSERT INTO usuario (login, nome, senha_hash, perfil_id, deve_trocar_senha, ativo)
     OUTPUT INSERTED.id VALUES (@login, @login, @hash, (SELECT id FROM perfil WHERE codigo = @perfil), 0, 1)`, { login, hash, perfil });
  if (unidadeId) await db.consultar('INSERT INTO usuario_unidade VALUES (@id, @un)', { id: u.id, un: unidadeId });
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
  const colisao = await db.consultar('SELECT cpf, nome FROM pessoa WHERE cpf = @cpf AND nome NOT LIKE @p', { cpf: CPF, p: `${PREFIXO}%` });
  if (colisao.length) { console.error('RECUSADO: o CPF de teste já pertence a dados que este teste não criou:', colisao[0].nome); process.exit(3); }
  await limpar();

  const [uA, uB] = await db.consultar('SELECT TOP 2 id, sigla FROM unidade WHERE ativo = 1 ORDER BY id');
  assert.ok(uA && uB, 'precisa de 2 unidades');
  await criarUsuario('f3_assist_a', 'ASSISTENTE', uA.id);
  await criarUsuario('f3_assist_b', 'ASSISTENTE', uB.id);
  await criarUsuario('f3_assist_c', 'ASSISTENTE', uA.id);
  await criarUsuario('f3_coord', 'COORDENADOR');
  await criarUsuario('f3_admin', 'ADMIN');
  for (const l of await db.consultar("SELECT chave, valor FROM configuracao WHERE chave IN ('pesquisa_intervalo_dias', 'alerta_sem_contato_dias')")) config[l.chave] = l.valor;

  if (await fetch(`${BASE}/api/saude`).then((r) => r.ok, () => false)) throw new Error(`a porta ${PORTA} já está em uso; defina TESTE_PORT`);
  const servidor = spawn(process.execPath, ['server/index.js'], {
    cwd: require('path').join(__dirname, '..', '..'), env: { ...process.env, PORT: String(PORTA), NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await esperarServidor();
    const a = await new Cliente().entrar('f3_assist_a');
    const b = await new Cliente().entrar('f3_assist_b');
    const c = await new Cliente().entrar('f3_assist_c');
    const coord = await new Cliente().entrar('f3_coord');
    const adm = await new Cliente().entrar('f3_admin');

    let acId;
    const base = () => `/api/familias/acompanhamentos/${acId}`;
    const corpo = (sobre = {}) => ({
      momento: 'SEMESTRAL', situacao: 'CONCLUIDA', consentimentoLido: true, modo: 'FAMILIA_FALOU', dataAplicacao: hoje,
      itens: itensCompletos(9, 4, [{ codigo: 'T1', valorTexto: 'Preço bom e atendimento atencioso' }, { codigo: 'T2', valorTexto: 'Mais horários' }]), ...sobre,
    });
    const lista = async (cli = a) => (await cli.req('GET', `${base()}/pesquisas`)).corpo;
    const pendencia = async () => (await a.req('GET', base())).corpo.pesquisa.pendencia;

    await teste('cadastro de família iniciada há 200 dias: pesquisa semestral pendente na ficha e no Início', async () => {
      const r = await a.req('POST', '/api/familias', { unidadeId: uA.id, dataInicio: dias(-200), responsavel: { cpf: CPF, nome: `${PREFIXO} A` }, membros: [] });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      acId = r.corpo.acompanhamentoId;
      const p = await pendencia();
      assert.strictEqual(p.momento, 'SEMESTRAL');
      assert.strictEqual(p.devidaEm, dias(-20));
      assert.strictEqual(p.diasAtraso, 20);
      const inicio = await a.req('GET', '/api/painel/resumo-inicio');
      assert.ok(inicio.corpo.pendentes.pesquisa >= 1);
      assert.ok(inicio.corpo.pendentes.pesquisaItens.some((i) => i.acompanhamentoId === acId && i.momento === 'SEMESTRAL'));
      const deB = await b.req('GET', '/api/painel/resumo-inicio');
      assert.ok(!deB.corpo.pendentes.pesquisaItens.some((i) => i.acompanhamentoId === acId), 'a assistente de outra unidade não vê a pendência');
    });

    await teste('modelo versionado: v1 com 9 perguntas (NPS, 6 afirmações, 2 textos) e aviso de consentimento', async () => {
      const l = await lista();
      assert.strictEqual(l.modelo.codigo, 'SATISFACAO');
      assert.strictEqual(l.modelo.versao, 1);
      assert.deepStrictEqual(l.modelo.perguntas.map((p) => p.tipo), ['NPS', 'LIKERT', 'LIKERT', 'LIKERT', 'LIKERT', 'LIKERT', 'LIKERT', 'TEXTO', 'TEXTO']);
      assert.ok(l.modelo.aviso.length > 100);
      assert.strictEqual(l.pendencia.momento, 'SEMESTRAL');
      assert.deepStrictEqual(l.pesquisas, []);
    });

    let rascunhoId;
    await teste('rascunho: salva parcial, bloqueia segundo rascunho do mesmo momento e continua até concluir', async () => {
      let r = await a.req('POST', `${base()}/pesquisas`, { momento: 'SEMESTRAL', situacao: 'RASCUNHO', consentimentoLido: false, itens: [] });
      assert.strictEqual(r.status, 400);
      assert.ok(r.corpo.erro.detalhes.consentimentoLido);
      r = await a.req('POST', `${base()}/pesquisas`, { momento: 'SEMESTRAL', situacao: 'RASCUNHO', consentimentoLido: true, itens: [{ codigo: 'NPS', valorNum: 10 }] });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      rascunhoId = r.corpo.id;
      assert.strictEqual((await pendencia()).momento, 'SEMESTRAL', 'rascunho não resolve a pendência');
      r = await a.req('POST', `${base()}/pesquisas`, { momento: 'SEMESTRAL', situacao: 'RASCUNHO', consentimentoLido: true, itens: [] });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.corpo.erro.detalhes.respostaId, rascunhoId);
      const l = await lista();
      assert.strictEqual(l.pesquisas.length, 1);
      assert.strictEqual(l.pesquisas[0].situacao, 'RASCUNHO');
      const cheia = (await a.req('GET', `${base()}/pesquisas/${rascunhoId}`)).corpo;
      assert.strictEqual(cheia.itens.length, 1);
      assert.strictEqual(cheia.itens[0].valorNum, 10);
      assert.strictEqual(cheia.consentimentoLido, true);
    });

    await teste('concluir: exige todas as notas (ou recusa), mostra NPS e satisfação, resolve a pendência e conta como contato', async () => {
      const url = `${base()}/pesquisas/${rascunhoId}`;
      let r = await a.req('PUT', url, corpo({ itens: [{ codigo: 'NPS', valorNum: 9 }] }));
      assert.strictEqual(r.status, 400);
      assert.ok(r.corpo.erro.detalhes['itens.L1']);
      r = await a.req('PUT', url, corpo({ modo: undefined }));
      assert.strictEqual(r.status, 400);
      assert.ok(r.corpo.erro.detalhes.modo);
      r = await a.req('PUT', url, corpo({ itens: itensCompletos(11, 4) }));
      assert.strictEqual(r.status, 400);
      assert.ok(r.corpo.erro.detalhes['itens.NPS']);
      r = await a.req('PUT', url, corpo());
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.strictEqual(r.corpo.situacao, 'CONCLUIDA');
      const l = await lista();
      const p = l.pesquisas[0];
      assert.strictEqual(p.resumo.nps, 9);
      assert.strictEqual(p.resumo.categoriaNps, 'PROMOTORA');
      assert.strictEqual(p.resumo.indice, 75);
      assert.strictEqual(p.resumo.concordancia, 100);
      assert.strictEqual(l.pendencia, null);
      assert.strictEqual((await pendencia()), null);
      const ficha = (await a.req('GET', base())).corpo;
      assert.strictEqual(ficha.contato.ultimoContatoEm, hoje, 'pesquisa aplicada conta como contato');
      const cheia = (await a.req('GET', `${base()}/pesquisas/${rascunhoId}`)).corpo;
      assert.strictEqual(cheia.itens.find((i) => i.codigo === 'T1').valorTexto, 'Preço bom e atendimento atencioso');
      // "prefere não responder" é gravado e devolvido (regressão: a coluna prefere_nao_responder vira prefereNaoResponder)
      const recusa = await a.req('POST', `${base()}/pesquisas`, corpo({ momento: 'AVULSA', itens: [{ codigo: 'NPS', valorNum: 8 }, { codigo: 'L1', preferNaoResponder: true }, ...[2, 3, 4, 5, 6].map((n) => ({ codigo: `L${n}`, valorNum: 5 }))] }));
      assert.strictEqual(recusa.status, 201, JSON.stringify(recusa.corpo));
      const lida = (await a.req('GET', `${base()}/pesquisas/${recusa.corpo.id}`)).corpo;
      assert.strictEqual(lida.itens.find((i) => i.codigo === 'L1').preferNaoResponder, true);
      assert.strictEqual(lida.itens.find((i) => i.codigo === 'L2').preferNaoResponder, false);
      assert.strictEqual(lida.resumo.recusas, 1);
      assert.strictEqual(lida.resumo.afirmacoesRespondidas, 5);
      assert.strictEqual((await a.req('POST', `${base()}/pesquisas/${recusa.corpo.id}/anular`, { motivo: 'teste' })).status, 200);
      assert.strictEqual(cheia.modelo.versao, 1);
    });

    await teste('concluída não se edita (409); só o autor ou a coordenação anula/altera (403 para a colega)', async () => {
      const url = `${base()}/pesquisas/${rascunhoId}`;
      assert.strictEqual((await a.req('PUT', url, corpo())).status, 409);
      assert.strictEqual((await c.req('POST', `${url}/anular`, { motivo: 'não fui eu' })).status, 403);
      const vendo = await c.req('GET', url);
      assert.strictEqual(vendo.status, 200, 'a colega da mesma unidade enxerga');
      assert.strictEqual(vendo.corpo.podeAlterar, false);
    });

    await teste('linha do tempo: pesquisa aparece com nota e comentários; filtro por tipo', async () => {
      const tl = (await a.req('GET', `${base()}/linha-do-tempo`)).corpo.itens;
      const ev = tl.find((e) => e.tipo === 'PESQUISA');
      assert.ok(ev, 'evento PESQUISA');
      assert.match(ev.detalhe, /Nota geral: 9 de 10/);
      assert.match(ev.detalhe, /Satisfação: 75%/);
      assert.match(ev.resumo, /Faz de melhor: Preço bom/);
      const so = (await a.req('GET', `${base()}/linha-do-tempo?tipos=PESQUISA`)).corpo;
      assert.strictEqual(so.itens.length, 1);
    });

    await teste('ADMIN: lista vazia e restrita, detalhe 403, escrita 403, linha do tempo sem pesquisa', async () => {
      const l = await lista(adm);
      assert.strictEqual(l.textoRestrito, true);
      assert.deepStrictEqual(l.pesquisas, []);
      assert.strictEqual((await adm.req('GET', `${base()}/pesquisas/${rascunhoId}`)).status, 403);
      assert.strictEqual((await adm.req('POST', `${base()}/pesquisas`, corpo({ momento: 'AVULSA' }))).status, 403);
      const tl = JSON.stringify((await adm.req('GET', `${base()}/linha-do-tempo`)).corpo);
      assert.ok(!tl.includes('PESQUISA') && !tl.includes('Preço bom'));
    });

    await teste('isolamento por unidade: assistente de outra unidade recebe 404 em tudo', async () => {
      for (const [m, u, x] of [['GET', `${base()}/pesquisas`], ['GET', `${base()}/pesquisas/${rascunhoId}`], ['POST', `${base()}/pesquisas`, corpo({ momento: 'AVULSA' })],
        ['PUT', `${base()}/pesquisas/${rascunhoId}`, corpo()], ['POST', `${base()}/pesquisas/${rascunhoId}/anular`, { motivo: 'x' }]]) {
        assert.strictEqual((await b.req(m, u, x)).status, 404, `${m} ${u}`);
      }
    });

    await teste('coordenação oculta o comentário; assistente não pode', async () => {
      const url = `${base()}/pesquisas/${rascunhoId}/comentario-oculto`;
      assert.strictEqual((await a.req('PUT', url, { oculto: true })).status, 403);
      assert.strictEqual((await coord.req('PUT', url, { oculto: 'sim' })).status, 400);
      const r = await coord.req('PUT', url, { oculto: true });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.corpo.pesquisas.find((p) => p.id === rascunhoId).comentarioOculto, true);
    });

    await teste('anular: motivo obrigatório; a pendência volta; auditoria sem texto da resposta', async () => {
      const url = `${base()}/pesquisas/${rascunhoId}/anular`;
      assert.strictEqual((await a.req('POST', url, {})).status, 400);
      const r = await a.req('POST', url, { motivo: 'Aplicada na família errada' });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.corpo.pesquisas, []);
      assert.strictEqual((await pendencia()).momento, 'SEMESTRAL');
      assert.strictEqual((await a.req('GET', `${base()}/pesquisas/${rascunhoId}`)).status, 404);
      const aud = await db.consultar("SELECT detalhes FROM auditoria WHERE tabela = 'pesquisa_resposta' AND registro_id = @id", { id: String(rascunhoId) });
      assert.ok(aud.length >= 3, 'criar, alterar, anular');
      assert.ok(aud.every((x) => !/Preço bom|Mais horários/.test(x.detalhes)), 'nenhum comentário na auditoria');
      const [linha] = await db.consultar('SELECT anulado_motivo, anulado_por, situacao FROM pesquisa_resposta WHERE id = @id', { id: rascunhoId });
      assert.strictEqual(linha.situacao, 'ANULADA');
      assert.strictEqual(linha.anuladoMotivo, 'Aplicada na família errada');
    });

    await teste('recusada: a família preferiu não responder resolve a pendência e aparece na linha do tempo sem conteúdo', async () => {
      const r = await a.req('POST', `${base()}/pesquisas`, { momento: 'SEMESTRAL', situacao: 'RECUSADA', dataAplicacao: hoje, itens: itensCompletos(), modo: 'FAMILIA_FALOU' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      assert.strictEqual(await pendencia(), null);
      const l = await lista();
      assert.strictEqual(l.pesquisas[0].situacao, 'RECUSADA');
      const [{ n }] = await db.consultar('SELECT COUNT(*) AS n FROM pesquisa_resposta_item WHERE resposta_id = @id', { id: r.corpo.id });
      assert.strictEqual(n, 0, 'nenhum item guardado');
      const ev = (await a.req('GET', `${base()}/linha-do-tempo?tipos=PESQUISA`)).corpo.itens[0];
      assert.match(ev.titulo, /preferiu não responder/);
      await a.req('POST', `${base()}/pesquisas/${r.corpo.id}/anular`, { motivo: 'teste' });
    });

    await teste('configuração: intervalo editável pela coordenação; valores inválidos recusados; assistente 403', async () => {
      assert.strictEqual((await coord.req('PUT', '/api/admin/configuracoes/pesquisa_intervalo_dias', { valor: '10' })).status, 400);
      assert.strictEqual((await a.req('PUT', '/api/admin/configuracoes/pesquisa_intervalo_dias', { valor: '365' })).status, 403);
      assert.strictEqual((await coord.req('PUT', '/api/admin/configuracoes/pesquisa_intervalo_dias', { valor: '365' })).status, 200);
      assert.strictEqual(await pendencia(), null, 'com intervalo de 365 dias a família (200 dias) ainda não deve pesquisa');
      assert.strictEqual((await coord.req('PUT', '/api/admin/configuracoes/pesquisa_intervalo_dias', { valor: config.pesquisa_intervalo_dias })).status, 200);
      assert.strictEqual((await pendencia()).momento, 'SEMESTRAL');
    });

    await teste('final: exige questionário final concluído; vira pendência; uma por acompanhamento', async () => {
      let r = await a.req('POST', `${base()}/pesquisas`, corpo({ momento: 'FINAL' }));
      assert.strictEqual(r.status, 409);
      const [{ id: ac }] = [{ id: acId }];
      await db.consultar("INSERT INTO questionario (acompanhamento_id, tipo, data_aplicacao, concluido, criado_por) VALUES (@ac, 'INICIAL', @d, 1, 1), (@ac, 'FINAL', @d2, 1, 1)",
        { ac, d: [db.tipos.Date, dias(-150)], d2: [db.tipos.Date, dias(-2)] });
      const p = await pendencia();
      assert.strictEqual(p.momento, 'FINAL');
      assert.strictEqual(p.devidaEm, dias(-2));
      r = await a.req('POST', `${base()}/pesquisas`, corpo({ momento: 'FINAL' }));
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      assert.strictEqual(await pendencia(), null);
      r = await a.req('POST', `${base()}/pesquisas`, corpo({ momento: 'FINAL' }));
      assert.strictEqual(r.status, 409, 'só uma pesquisa final');
    });

    await teste('encerrar: pesquisa final continua pendente por 60 dias após concluir; semestral é recusada; avulsa continua possível', async () => {
      // o acompanhamento só conclui com o final concluído; a pesquisa final já foi feita, então apagamos para ver a pendência pós-encerramento
      const feitas = await db.consultar("SELECT id FROM pesquisa_resposta WHERE acompanhamento_id = @ac AND momento = 'FINAL'", { ac: acId });
      for (const f of feitas) assert.strictEqual((await a.req('POST', `${base()}/pesquisas/${f.id}/anular`, { motivo: 'refazer' })).status, 200);
      const enc = await a.req('POST', `${base()}/encerrar`, { status: 'CONCLUIDO', observacoes: 'Concluiu o programa' });
      assert.strictEqual(enc.status, 200, JSON.stringify(enc.corpo));
      const p = await pendencia();
      assert.strictEqual(p.momento, 'FINAL');
      assert.strictEqual(p.devidaEm, hoje);
      assert.strictEqual((await a.req('POST', `${base()}/pesquisas`, corpo({ momento: 'SEMESTRAL' }))).status, 409);
      let r = await a.req('POST', `${base()}/pesquisas`, corpo({ momento: 'FINAL' }));
      assert.strictEqual(r.status, 201, 'a pesquisa final pode ser feita depois de encerrar');
      assert.strictEqual(await pendencia(), null);
      r = await a.req('POST', `${base()}/pesquisas`, corpo({ momento: 'AVULSA' }));
      assert.strictEqual(r.status, 201);
      const inicio = await a.req('GET', '/api/painel/resumo-inicio');
      assert.ok(!inicio.corpo.pendentes.pesquisaItens.some((i) => i.acompanhamentoId === acId));
    });

    console.log(`\n${ok} testes OK`);
  } finally {
    servidor.kill();
    for (const [chave, valor] of Object.entries(config)) await db.consultar('UPDATE configuracao SET valor = @v WHERE chave = @c', { v: valor, c: chave }).catch(() => {});
    await limpar();
    const restos = await db.consultar("SELECT COUNT(*) AS n FROM usuario WHERE login LIKE 'f3[_]%'");
    console.log(`Limpeza: usuários de teste restantes = ${restos[0].n}`);
    await db.fechar();
  }
})().catch(async (e) => {
  console.error('\nFALHOU:', e && e.stack ? e.stack : e);
  try { await limpar(); } catch { /* ignora */ }
  process.exit(1);
});
