'use strict';

// Teste E2E (banco REAL do Docker de teste) da F2: registros de acompanhamento, linha do tempo e alerta de contato.
// Uso:  node tests/familias/registros.e2e.js        (sobe o próprio servidor em TESTE_PORT, padrão 3121)
// Cria os usuários f2_* e duas famílias de teste, exercita a API e remove tudo ao final.
// Não toca no usuário "admin". TRAVA: recusa rodar se o SQL Server não for o container Linux local.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const assert = require('assert');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');
const db = require('../../server/db');
const familias = require('../../server/services/familias');

const PORTA = process.env.TESTE_PORT || 3121;
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'F2-senha-teste-1';
const CPF_A = '11144477735';
const CPF_B = '39053344705';

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

async function limpar() {
  const pessoas = (await db.consultar('SELECT id FROM pessoa WHERE cpf IN (@a, @b)', { a: CPF_A, b: CPF_B })).map((p) => p.id);
  for (const pid of pessoas) {
    const fams = (await db.consultar('SELECT id FROM familia WHERE responsavel_pessoa_id = @pid', { pid })).map((f) => f.id);
    for (const fid of fams) {
      const acs = (await db.consultar('SELECT id FROM acompanhamento WHERE familia_id = @fid', { fid })).map((a) => a.id);
      for (const ac of acs) {
        await db.consultar('DELETE FROM acompanhamento_registro WHERE acompanhamento_id = @ac', { ac });
        await db.consultar('DELETE FROM questionario WHERE acompanhamento_id = @ac', { ac });
        await db.consultar("DELETE FROM auditoria WHERE tabela IN ('acompanhamento', 'acompanhamento_registro') AND registro_id = @ac", { ac: String(ac) });
        await db.consultar('DELETE FROM acompanhamento WHERE id = @ac', { ac });
      }
      await db.consultar('DELETE FROM familia_membro WHERE familia_id = @fid', { fid });
      await db.consultar('DELETE FROM familia WHERE id = @fid', { fid });
    }
    await db.consultar('DELETE FROM atendimento WHERE pessoa_id = @pid', { pid });
    await db.consultar('DELETE FROM pessoa WHERE id = @pid', { pid });
  }
  const ids = (await db.consultar("SELECT id FROM usuario WHERE login LIKE 'f2[_]%'")).map((u) => u.id);
  for (const id of ids) {
    await db.consultar("DELETE FROM sessao WHERE TRY_CAST(JSON_VALUE(dados, '$.usuarioId') AS INT) = @id", { id });
    await db.consultar('DELETE FROM usuario_unidade WHERE usuario_id = @id', { id });
    await db.consultar('DELETE FROM auditoria WHERE usuario_id = @id', { id });
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
    try { if ((await fetch(`${BASE}/api/saude`)).ok) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('servidor de teste não subiu');
}

let ok = 0;
const teste = async (nome, fn) => { await fn(); ok += 1; console.log(`  ok - ${nome}`); };
const iso = (v) => String(v).slice(0, 10);

(async () => {
  await travaDeSeguranca();
  await limpar();

  const unidades = await db.consultar('SELECT TOP 2 id, sigla FROM unidade WHERE ativo = 1 ORDER BY id');
  assert.ok(unidades.length >= 2, 'precisa de 2 unidades');
  const [uA, uB] = unidades;
  const idA = await criarUsuario('f2_assist_a', 'ASSISTENTE', uA.id);
  const idB = await criarUsuario('f2_assist_b', 'ASSISTENTE', uB.id);
  const idCoord = await criarUsuario('f2_coord', 'COORDENADOR');
  await criarUsuario('f2_admin', 'ADMIN');
  const valorOriginal = (await db.consultar("SELECT valor FROM configuracao WHERE chave = 'alerta_sem_contato_dias'"))[0].valor;

  // nunca reaproveita um servidor que já esteja na porta (poderia ser de outra sessão, com código antigo)
  if (await fetch(`${BASE}/api/saude`).then((r) => r.ok, () => false)) throw new Error(`a porta ${PORTA} já está em uso; defina TESTE_PORT`);
  const servidor = spawn(process.execPath, ['server/index.js'], {
    cwd: require('path').join(__dirname, '..', '..'),
    env: { ...process.env, PORT: String(PORTA), NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await esperarServidor();
    const a = await new Cliente().entrar('f2_assist_a');
    const b = await new Cliente().entrar('f2_assist_b');
    const coord = await new Cliente().entrar('f2_coord');
    const adm = await new Cliente().entrar('f2_admin');

    let acId;
    let pessoaId;
    let registro1;

    await teste('apoio: 5 tipos de contato semeados e editáveis pelo ADMIN', async () => {
      const apoio = await a.req('GET', '/api/apoio');
      assert.deepStrictEqual(apoio.corpo.tipoContato.map((t) => t.nome),
        ['Visita domiciliar', 'Atendimento no Armazém', 'Telefone', 'WhatsApp', 'Outro']);
      assert.ok(apoio.corpo.tipoContato.find((t) => t.nome === 'Outro').exigeTexto);
      const lista = await adm.req('GET', '/api/admin/apoio/tipo_contato');
      assert.strictEqual(lista.status, 200);
    });

    await teste('cadastro: família iniciada há 40 dias já nasce "sem contato" (padrão 30 dias)', async () => {
      const r = await a.req('POST', '/api/familias', {
        unidadeId: uA.id, dataInicio: dias(-40), responsavel: { cpf: CPF_A, nome: 'Familia F2 Teste A' }, membros: [],
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      acId = r.corpo.acompanhamentoId;
      const ficha = await a.req('GET', `/api/familias/acompanhamentos/${acId}`);
      pessoaId = ficha.corpo.responsavel.pessoaId;
      assert.strictEqual(ficha.corpo.contato.semContato, true);
      assert.strictEqual(ficha.corpo.contato.diasSemContato, 40);
      assert.strictEqual(ficha.corpo.contato.ultimoContatoEm, dias(-40));
    });

    await teste('lista de famílias traz o último contato e o filtro "sem contato" funciona', async () => {
      const todas = await a.req('GET', '/api/familias?status=EM_ANDAMENTO');
      const item = todas.corpo.itens.find((i) => i.acompanhamentoId === acId);
      assert.strictEqual(item.semContato, true);
      assert.strictEqual(item.diasSemContato, 40);
      const so = await a.req('GET', '/api/familias?contato=SEM_CONTATO');
      assert.ok(so.corpo.itens.some((i) => i.acompanhamentoId === acId));
      assert.ok(so.corpo.itens.every((i) => i.semContato === true));
      assert.strictEqual((await a.req('GET', '/api/familias?contato=XYZ')).status, 400);
    });

    await teste('painel: alerta e resumo da tela inicial listam a família sem contato', async () => {
      const alertas = await coord.req('GET', '/api/painel/alertas');
      assert.strictEqual(alertas.status, 200);
      assert.ok(alertas.corpo.familiasSemContato.some((f) => f.acompanhamentoId === acId && f.diasSemContato === 40));
      assert.ok(alertas.corpo.resumoPorUnidade.find((u) => u.unidadeSigla === uA.sigla).familiasSemContato >= 1);
      const inicio = await a.req('GET', '/api/painel/resumo-inicio');
      assert.ok(inicio.corpo.pendentes.semContato >= 1);
      assert.ok(inicio.corpo.pendentes.semContatoItens.some((f) => f.acompanhamentoId === acId));
    });

    await teste('registro: validações (data futura, antes do início, tipo, situação, resumo)', async () => {
      const url = `/api/familias/acompanhamentos/${acId}/registros`;
      const tipos = (await a.req('GET', url)).corpo.tiposContato;
      const visita = tipos.find((t) => t.nome === 'Visita domiciliar').id;
      const outro = tipos.find((t) => t.nome === 'Outro').id;
      let r = await a.req('POST', url, { dataRegistro: dias(1), tipoContatoId: visita, houveContato: true, situacao: 'IGUAL', resumo: 'x' });
      assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.dataRegistro);
      r = await a.req('POST', url, { dataRegistro: dias(-41), tipoContatoId: visita, houveContato: true, situacao: 'IGUAL', resumo: 'x' });
      assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.dataRegistro);
      r = await a.req('POST', url, { dataRegistro: hoje, tipoContatoId: outro, houveContato: true, situacao: 'IGUAL', resumo: 'x' });
      assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.tipoContatoOutro);
      r = await a.req('POST', url, { dataRegistro: hoje, tipoContatoId: visita, houveContato: true });
      assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.situacao && r.corpo.erro.detalhes.resumo);
      r = await a.req('POST', url, { dataRegistro: hoje, tipoContatoId: 9999, houveContato: false });
      assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.tipoContatoId);
    });

    await teste('tentativa sem sucesso NÃO conta como contato', async () => {
      const url = `/api/familias/acompanhamentos/${acId}/registros`;
      const tipos = (await a.req('GET', url)).corpo.tiposContato;
      const tel = tipos.find((t) => t.nome === 'Telefone').id;
      const r = await a.req('POST', url, { dataRegistro: dias(-2), tipoContatoId: tel, houveContato: false, situacao: 'MELHORANDO', resumo: 'Não atendeu' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      const lista = await a.req('GET', url);
      assert.strictEqual(lista.corpo.registros[0].situacao, null, 'situação é descartada quando não houve contato');
      assert.strictEqual(lista.corpo.resumo.semContato, true);
      assert.strictEqual(lista.corpo.resumo.ultimoContatoEm, dias(-40));
    });

    await teste('registro com contato zera o alerta e atualiza último contato, situação e próximo contato', async () => {
      const url = `/api/familias/acompanhamentos/${acId}/registros`;
      const tipos = (await a.req('GET', url)).corpo.tiposContato;
      const visita = tipos.find((t) => t.nome === 'Visita domiciliar').id;
      const r = await a.req('POST', url, {
        dataRegistro: dias(-5), tipoContatoId: visita, houveContato: true, situacao: 'MELHORANDO',
        resumo: 'Compraram frutas e verduras.', proximoContatoEm: dias(-1),
      });
      assert.strictEqual(r.status, 201);
      registro1 = r.corpo.id;
      const lista = await a.req('GET', url);
      assert.strictEqual(lista.corpo.registros.length, 2);
      assert.strictEqual(lista.corpo.resumo.semContato, false);
      assert.strictEqual(lista.corpo.resumo.ultimoContatoEm, dias(-5));
      assert.strictEqual(lista.corpo.resumo.diasSemContato, 5);
      assert.strictEqual(lista.corpo.resumo.ultimaSituacao.situacao, 'MELHORANDO');
      assert.strictEqual(lista.corpo.resumo.proximoContatoAtrasado, true);
      const alertas = await coord.req('GET', '/api/painel/alertas');
      assert.ok(!alertas.corpo.familiasSemContato.some((f) => f.acompanhamentoId === acId));
      const so = await a.req('GET', '/api/familias?contato=SEM_CONTATO');
      assert.ok(!so.corpo.itens.some((i) => i.acompanhamentoId === acId));
    });

    await teste('editar: o autor altera; outra assistente da mesma unidade não (403); a coordenação sim', async () => {
      const outra = await new Cliente().entrar('f2_assist_a'); // mesma conta/unidade => é o autor; testa abaixo com a coord
      const url = `/api/familias/acompanhamentos/${acId}/registros/${registro1}`;
      const lista = (await a.req('GET', `/api/familias/acompanhamentos/${acId}/registros`)).corpo;
      const reg = lista.registros.find((x) => x.id === registro1);
      const corpo = { dataRegistro: reg.dataRegistro.slice(0, 10), tipoContatoId: reg.tipoContatoId, houveContato: true, situacao: 'IGUAL', resumo: 'Revisado.', proximoContatoEm: dias(10) };
      let r = await outra.req('PUT', url, corpo);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.corpo.registros.find((x) => x.id === registro1).situacao, 'IGUAL');
      assert.strictEqual(r.corpo.resumo.proximoContatoAtrasado, false);
      r = await coord.req('PUT', url, { ...corpo, resumo: 'Revisado pela coordenação.' });
      assert.strictEqual(r.status, 200, 'coordenação enxerga todas as unidades');
      // segunda assistente na MESMA unidade que não é autora
      const idC = await criarUsuario('f2_assist_c', 'ASSISTENTE', uA.id);
      const c = await new Cliente().entrar('f2_assist_c');
      r = await c.req('PUT', url, corpo);
      assert.strictEqual(r.status, 403);
      r = await c.req('POST', `${url}/anular`, { motivo: 'não sou a autora' });
      assert.strictEqual(r.status, 403);
      assert.ok(idC);
    });

    await teste('isolamento por unidade: assistente da outra unidade recebe 404 e não vê a família', async () => {
      const base = `/api/familias/acompanhamentos/${acId}`;
      for (const url of [`${base}/registros`, `${base}/linha-do-tempo`, base]) {
        assert.strictEqual((await b.req('GET', url)).status, 404, url);
      }
      const tipos = (await a.req('GET', `${base}/registros`)).corpo.tiposContato;
      const r = await b.req('POST', `${base}/registros`, { dataRegistro: hoje, tipoContatoId: tipos[0].id, houveContato: false });
      assert.strictEqual(r.status, 404);
      const lista = await b.req('GET', '/api/familias');
      assert.ok(!lista.corpo.itens.some((i) => i.acompanhamentoId === acId));
    });

    await teste('atendimento do responsável na unidade conta como contato e entra na linha do tempo com encaminhamentos', async () => {
      const [dem] = await db.consultar('SELECT TOP 1 id FROM demanda ORDER BY id');
      const encs = await db.consultar('SELECT TOP 2 id FROM encaminhamento ORDER BY id');
      const at = async (unidadeId, usuarioId, data, resumo) => {
        const [x] = await db.consultar(
          `INSERT INTO atendimento (unidade_id, pessoa_id, usuario_id, data_atendimento, resumo, criado_por)
           OUTPUT INSERTED.id VALUES (@u, @p, @us, @d, @r, @us)`,
          { u: unidadeId, p: pessoaId, us: usuarioId, d: [db.tipos.Date, data], r: resumo });
        await db.consultar('INSERT INTO atendimento_demanda VALUES (@a, @d)', { a: x.id, d: dem.id });
        return x.id;
      };
      const atA = await at(uA.id, idA, dias(-1), 'Atendimento na unidade A');
      for (const e of encs) await db.consultar('INSERT INTO atendimento_encaminhamento VALUES (@a, @e)', { a: atA, e: e.id });
      await at(uB.id, idB, dias(-3), 'Atendimento na unidade B (confidencial)');

      const tl = await a.req('GET', `/api/familias/acompanhamentos/${acId}/linha-do-tempo`);
      assert.strictEqual(tl.status, 200);
      const tipos = tl.corpo.itens.map((e) => e.tipo);
      assert.ok(tipos.includes('ATENDIMENTO') && tipos.includes('ENCAMINHAMENTO') && tipos.includes('REGISTRO') && tipos.includes('INICIO') && tipos.includes('PRAZO'));
      assert.strictEqual(tl.corpo.itens.filter((e) => e.tipo === 'ATENDIMENTO').length, 1, 'atendimento da unidade B não aparece para a assistente A');
      assert.ok(!JSON.stringify(tl.corpo).includes('confidencial'));
      const enc = tl.corpo.itens.find((e) => e.tipo === 'ENCAMINHAMENTO');
      assert.ok(enc.detalhe.length > 0);
      // ordem: nunca uma data mais nova depois de uma mais antiga
      const datas = tl.corpo.itens.map((e) => e.data);
      assert.deepStrictEqual(datas, [...datas].sort().reverse());
      // coordenação vê os dois atendimentos
      const tlc = await coord.req('GET', `/api/familias/acompanhamentos/${acId}/linha-do-tempo`);
      assert.strictEqual(tlc.corpo.itens.filter((e) => e.tipo === 'ATENDIMENTO').length, 2);
      // filtro por tipo e paginação
      const so = await a.req('GET', `/api/familias/acompanhamentos/${acId}/linha-do-tempo?tipos=REGISTRO`);
      assert.ok(so.corpo.itens.every((e) => e.tipo === 'REGISTRO'));
      const p1 = await a.req('GET', `/api/familias/acompanhamentos/${acId}/linha-do-tempo?tamanho=2&pagina=2`);
      assert.strictEqual(p1.corpo.itens.length, 2);
      assert.strictEqual(p1.corpo.total, tl.corpo.total);
      // o atendimento de ontem na unidade A passou a ser o último contato (e o da unidade B, mais antigo, não influi)
      const ficha = await a.req('GET', `/api/familias/acompanhamentos/${acId}`);
      assert.strictEqual(ficha.corpo.contato.ultimoContatoEm, dias(-1));
    });

    await teste('anular: some da lista e dos números, motivo obrigatório, fica na auditoria', async () => {
      const base = `/api/familias/acompanhamentos/${acId}/registros`;
      assert.strictEqual((await a.req('POST', `${base}/${registro1}/anular`, {})).status, 400);
      const r = await a.req('POST', `${base}/${registro1}/anular`, { motivo: 'Lançado na família errada' });
      assert.strictEqual(r.status, 200);
      assert.ok(!r.corpo.registros.some((x) => x.id === registro1));
      assert.strictEqual((await a.req('PUT', `${base}/${registro1}`, {})).status, 404, 'registro anulado não é editável');
      const [aud] = await db.consultar("SELECT COUNT(*) AS n FROM auditoria WHERE tabela = 'acompanhamento_registro' AND registro_id = @id AND acao = 'EXCLUIR'", { id: String(registro1) });
      assert.strictEqual(aud.n, 1);
      const [linha] = await db.consultar('SELECT anulado_motivo, anulado_por FROM acompanhamento_registro WHERE id = @id', { id: registro1 });
      assert.strictEqual(linha.anuladoMotivo, 'Lançado na família errada');
      assert.strictEqual(linha.anuladoPor, idA);
    });

    await teste('ADMIN: lê sem textos livres e não escreve', async () => {
      const base = `/api/familias/acompanhamentos/${acId}`;
      const lista = await adm.req('GET', `${base}/registros`);
      assert.strictEqual(lista.status, 200);
      assert.strictEqual(lista.corpo.textoRestrito, true);
      assert.ok(lista.corpo.registros.every((x) => x.resumo === null));
      const tl = await adm.req('GET', `${base}/linha-do-tempo`);
      assert.ok(tl.corpo.itens.every((e) => !e.resumo));
      assert.ok(!JSON.stringify(tl.corpo).includes('Atendimento na unidade A'));
      const tipos = lista.corpo.tiposContato;
      assert.strictEqual((await adm.req('POST', `${base}/registros`, { dataRegistro: hoje, tipoContatoId: tipos[0].id, houveContato: false })).status, 403);
    });

    await teste('configuração: coordenação altera o limite (alerta muda) e valores inválidos são recusados', async () => {
      const ficha = async () => (await a.req('GET', `/api/familias/acompanhamentos/${acId}`)).corpo.contato;
      // último contato = ontem (atendimento): com limite 1 dia, 1 dia não é "mais de 1"
      assert.strictEqual((await ficha()).semContato, false);
      let r = await coord.req('PUT', '/api/admin/configuracoes/alerta_sem_contato_dias', { valor: '0' });
      assert.strictEqual(r.status, 400);
      r = await coord.req('PUT', '/api/admin/configuracoes/alerta_sem_contato_dias', { valor: 'abc' });
      assert.strictEqual(r.status, 400);
      r = await coord.req('PUT', '/api/admin/configuracoes/alerta_sem_contato_dias', { valor: '365' });
      assert.strictEqual(r.status, 200);
      const lista = await coord.req('GET', '/api/admin/configuracoes');
      assert.ok(lista.corpo.some((c) => c.chave === 'alerta_sem_contato_dias' && c.editavel));
      assert.strictEqual((await a.req('GET', `/api/familias/acompanhamentos/${acId}/registros`)).corpo.semContatoDias, 365);
      assert.strictEqual((await a.req('PUT', '/api/admin/configuracoes/alerta_sem_contato_dias', { valor: '10' })).status, 403, 'assistente não edita configuração');
    });

    await teste('encerrar: acompanhamento fechado não aceita registros (409) e sai do alerta', async () => {
      // restaura o limite padrão antes
      await db.consultar("UPDATE configuracao SET valor = @v WHERE chave = 'alerta_sem_contato_dias'", { v: valorOriginal });
      const base = `/api/familias/acompanhamentos/${acId}`;
      const tipos = (await a.req('GET', `${base}/registros`)).corpo.tiposContato;
      const enc = await a.req('POST', `${base}/encerrar`, { status: 'DESLIGADO', observacoes: 'Mudou de cidade' });
      assert.strictEqual(enc.status, 200);
      const r = await a.req('POST', `${base}/registros`, { dataRegistro: hoje, tipoContatoId: tipos[0].id, houveContato: false });
      assert.strictEqual(r.status, 409);
      const ficha = (await a.req('GET', base)).corpo;
      assert.strictEqual(ficha.contato.semContato, false);
      assert.strictEqual(ficha.contato.diasSemContato, null);
      const tl = (await a.req('GET', `${base}/linha-do-tempo`)).corpo.itens;
      assert.strictEqual(tl[0].tipo, 'ENCERRAMENTO');
      assert.ok(!tl.some((e) => e.tipo === 'PRAZO'));
      const alertas = await coord.req('GET', '/api/painel/alertas');
      assert.ok(!alertas.corpo.familiasSemContato.some((f) => f.acompanhamentoId === acId));
    });

    console.log(`\n${ok} testes OK`);
  } finally {
    servidor.kill();
    await db.consultar("UPDATE configuracao SET valor = @v WHERE chave = 'alerta_sem_contato_dias'", { v: valorOriginal }).catch(() => {});
    await limpar();
    const restos = await db.consultar("SELECT COUNT(*) AS n FROM usuario WHERE login LIKE 'f2[_]%'");
    console.log(`Limpeza: usuários de teste restantes = ${restos[0].n}`);
    await db.fechar();
  }
})().catch(async (e) => {
  console.error('\nFALHOU:', e && e.stack ? e.stack : e);
  try { await limpar(); } catch { /* ignora */ }
  process.exit(1);
});
