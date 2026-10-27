'use strict';

// Teste E2E (banco REAL do Docker de teste) da F5 sobre os modelos oficiais M1: índice de progresso (regra v2), instantâneo, reavaliação rápida e escopo.
// Uso:  node tests/familias/indice.e2e.js        (sobe o próprio servidor em TESTE_PORT, padrão 3125)
// Cria os usuários f5_* e três famílias "Teste F5E2E ..." (CPFs próprios), exercita a API e remove SÓ isso ao final.
// Não toca no usuário "admin". TRAVA: recusa rodar se o SQL Server não for o container Linux local.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const assert = require('assert');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');
const db = require('../../server/db');
const familias = require('../../server/services/familias');
const regras = require('../../server/services/indice-progresso');
const { corpoInicial, corpoFinal } = require('./m1-dados');

const PORTA = process.env.TESTE_PORT || 3125;
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'F5-senha-teste-1';
const CPF_A = '88123456204';
const CPF_B = '88234567209';
const CPF_C = '88345678203';

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
  // só apaga o que o próprio teste criou: CPF de teste E nome com o prefixo exclusivo
  const pessoas = (await db.consultar("SELECT id FROM pessoa WHERE cpf IN (@a, @b, @c) AND nome LIKE 'Teste F5E2E%'", { a: CPF_A, b: CPF_B, c: CPF_C })).map((p) => p.id);
  for (const pid of pessoas) {
    const fams = (await db.consultar('SELECT id FROM familia WHERE responsavel_pessoa_id = @pid', { pid })).map((f) => f.id);
    for (const fid of fams) {
      const acs = (await db.consultar('SELECT id FROM acompanhamento WHERE familia_id = @fid', { fid })).map((a) => a.id);
      for (const ac of acs) {
        await db.consultar('DELETE FROM acompanhamento_registro WHERE acompanhamento_id = @ac', { ac });
        await db.consultar('DELETE FROM questionario WHERE acompanhamento_id = @ac', { ac }); // o instantâneo sai em cascata
        await db.consultar('DELETE FROM acompanhamento_indice WHERE acompanhamento_id = @ac', { ac });
        await db.consultar("DELETE FROM auditoria WHERE tabela IN ('acompanhamento', 'acompanhamento_registro') AND registro_id = @ac", { ac: String(ac) });
        await db.consultar('DELETE FROM acompanhamento WHERE id = @ac', { ac });
      }
      await db.consultar('DELETE FROM familia_membro WHERE familia_id = @fid', { fid });
      await db.consultar('DELETE FROM familia WHERE id = @fid', { fid });
    }
    await db.consultar('DELETE FROM atendimento WHERE pessoa_id = @pid', { pid });
    await db.consultar('DELETE FROM pessoa WHERE id = @pid', { pid });
  }
  const ids = (await db.consultar("SELECT id FROM usuario WHERE login LIKE 'f5[_]%'")).map((u) => u.id);
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

// Respostas completas do INICIAL (família com renda baixa) e do FINAL (melhorou em tudo) nos modelos oficiais M1
const inicial = (extra = {}) => corpoInicial(dias(-60), extra);
const reavaliacao = (extra = {}, dataAplicacao = dias(-30)) => ({
  dataAplicacao,
  respostas: { '1.3': 'DE_1001_2000', '2.4': 'TRES_QUATRO', '2.5': 'PARCIALMENTE', '2.6': 'ALGUMAS_VEZES', '2.7': 'NAO', ...extra },
});
const final = (extra = {}) => corpoFinal(dias(-1), extra);
// o cálculo "de referência": mesmas respostas, regra pura
const mapaDe = (corpo) => ({ modelo: 'M1', mapa: corpo.respostas });

(async () => {
  await travaDeSeguranca();
  const colisao = await db.consultar("SELECT cpf, nome FROM pessoa WHERE cpf IN (@a, @b, @c) AND nome NOT LIKE 'Teste F5E2E%'", { a: CPF_A, b: CPF_B, c: CPF_C });
  if (colisao.length) { console.error('RECUSADO: CPF de teste já pertence a dados que este teste não criou:', colisao.map((c) => c.nome).join(', ')); process.exit(3); }
  await limpar();

  const unidades = await db.consultar('SELECT TOP 2 id, sigla FROM unidade WHERE ativo = 1 ORDER BY id');
  assert.ok(unidades.length >= 2, 'precisa de 2 unidades');
  const [uA, uB] = unidades;
  await criarUsuario('f5_assist_a', 'ASSISTENTE', uA.id);
  await criarUsuario('f5_assist_b', 'ASSISTENTE', uB.id);
  await criarUsuario('f5_coord', 'COORDENADOR');
  await criarUsuario('f5_admin', 'ADMIN');
  const cfg = async (chave) => Number((await db.consultar('SELECT valor FROM configuracao WHERE chave = @chave', { chave }))[0].valor);
  const tolOriginal = await cfg('indice_tolerancia_pontos');

  if (await fetch(`${BASE}/api/saude`).then((r) => r.ok, () => false)) throw new Error(`a porta ${PORTA} já está em uso; defina TESTE_PORT`);
  const servidor = spawn(process.execPath, ['server/index.js'], {
    cwd: require('path').join(__dirname, '..', '..'),
    env: { ...process.env, PORT: String(PORTA), NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await esperarServidor();
    const a = await new Cliente().entrar('f5_assist_a');
    const b = await new Cliente().entrar('f5_assist_b');
    const coord = await new Cliente().entrar('f5_coord');
    const adm = await new Cliente().entrar('f5_admin');

    let acA; let acB; let acC;
    const nova = async (cpf, nome, inicio) => {
      const r = await a.req('POST', '/api/familias', { unidadeId: uA.id, dataInicio: inicio, responsavel: { cpf, nome }, membros: [] });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      return r.corpo.acompanhamentoId;
    };
    const q = (ac, tipo, corpo, concluir = true) => a.req('PUT', `/api/familias/acompanhamentos/${ac}/questionarios/${tipo}`, { ...corpo, concluir });
    const instantaneo = (ac) => db.consultar('SELECT * FROM acompanhamento_indice WHERE acompanhamento_id = @ac ORDER BY data_ref, dimensao', { ac });

    await teste('migração 083: tipo REAVALIACAO aceito, instantâneo e 3 configurações existem', async () => {
      const [ck] = await db.consultar("SELECT definition FROM sys.check_constraints WHERE name = 'ck_questionario_tipo'");
      assert.match(ck.definition, /REAVALIACAO/);
      assert.strictEqual(await cfg('reavaliacao_dias'), 45);
      assert.strictEqual(await cfg('salario_minimo_referencia') > 0, true);
      assert.ok(tolOriginal > 0);
      const [t] = await db.consultar("SELECT OBJECT_ID('dbo.acompanhamento_indice') AS id");
      assert.ok(t.id);
    });

    await teste('INICIAL concluído grava o instantâneo (5 linhas, regra v2) igual ao cálculo puro', async () => {
      acA = await nova(CPF_A, 'Teste F5E2E A', dias(-60));
      const r = await q(acA, 'INICIAL', inicial());
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      const linhas = await instantaneo(acA);
      assert.strictEqual(linhas.length, 5);
      assert.deepStrictEqual(linhas.map((l) => l.dimensao).sort(), ['ALIMENTACAO', 'AUTONOMIA', 'ECONOMIA', 'GERAL', 'RENDA']);
      assert.ok(linhas.every((l) => l.versaoRegra === regras.VERSAO_REGRA && l.tipo === 'INICIAL'));
      const esperado = regras.calcularIndice(mapaDe(inicial()), { tipo: 'INICIAL' });
      const geral = linhas.find((l) => l.dimensao === 'GERAL');
      assert.strictEqual(Number(geral.nivel), esperado.geral.nivel);
      assert.strictEqual(Number(linhas.find((l) => l.dimensao === 'ALIMENTACAO').nivel), esperado.dimensoes.ALIMENTACAO.nivel);
      assert.strictEqual(linhas.find((l) => l.dimensao === 'AUTONOMIA').nivel, null, 'sem itens nos modelos oficiais: vazio, nunca zero');
    });

    await teste('rascunho NÃO grava instantâneo', async () => {
      acB = await nova(CPF_B, 'Teste F5E2E B', dias(-60));
      const r = await q(acB, 'INICIAL', { respostas: { '2.2': 'ATE_500' } }, false);
      assert.strictEqual(r.status, 200);
      assert.strictEqual((await instantaneo(acB)).length, 0);
      const ind = await a.req('GET', `/api/familias/acompanhamentos/${acB}/indicadores`);
      assert.strictEqual(ind.corpo.pontos.length, 0);
      assert.strictEqual(ind.corpo.reavaliacao.situacao, 'NAO_SE_APLICA');
    });

    await teste('indicadores: 1 ponto, sem semáforo; reavaliação pendente (iniciado há 60 dias, prazo 45)', async () => {
      const r = await a.req('GET', `/api/familias/acompanhamentos/${acA}/indicadores`);
      assert.strictEqual(r.status, 200);
      const d = r.corpo;
      assert.strictEqual(d.pontos.length, 1);
      assert.strictEqual(d.versaoRegra, 2);
      assert.strictEqual(d.comparacao, null);
      assert.strictEqual(d.pontos[0].tipo, 'INICIAL');
      assert.strictEqual(d.pontos[0].modelo, 'M1');
      assert.strictEqual(d.reavaliacao.situacao, 'PENDENTE');
      assert.strictEqual(d.reavaliacao.dataPrevista, dias(-15));
      assert.strictEqual(d.tolerancia, tolOriginal);
    });

    await teste('modelo da reavaliação: 5 perguntas (as de estado com par no inicial); os modelos oficiais não mudaram', async () => {
      const m = await a.req('GET', '/api/familias/questionario/modelo?tipo=REAVALIACAO');
      assert.strictEqual(m.corpo.tipo, 'REAVALIACAO');
      assert.strictEqual(m.corpo.blocos.flatMap((x) => x.perguntas).length, 5);
      assert.deepStrictEqual(m.corpo.blocos.flatMap((x) => x.perguntas).map((p) => p.codigo), ['1.3', '2.4', '2.5', '2.6', '2.7']);
      const oficial = await a.req('GET', '/api/familias/questionario/modelo?tipo=INICIAL');
      assert.strictEqual(oficial.corpo.blocos.length, 3);
      assert.strictEqual(oficial.corpo.blocos.flatMap((x) => x.perguntas).length, 14);
    });

    await teste('reavaliação: bloqueada sem o inicial concluído (GET bloqueio, PUT 409)', async () => {
      const g = await a.req('GET', `/api/familias/acompanhamentos/${acB}/questionarios/REAVALIACAO`);
      assert.strictEqual(g.corpo.podeEditar, false);
      assert.match(g.corpo.bloqueio, /inicial/);
      assert.strictEqual((await q(acB, 'REAVALIACAO', reavaliacao(), false)).status, 409);
    });

    await teste('reavaliação: concluir incompleta => 400 só com as perguntas de estado; completa => 200 e instantâneo', async () => {
      let r = await q(acA, 'REAVALIACAO', { dataAplicacao: dias(-30), respostas: { '1.3': 'DE_1001_2000' } });
      assert.strictEqual(r.status, 400);
      assert.ok(r.corpo.erro.detalhes['extras.2.5']);
      assert.ok(!r.corpo.erro.detalhes['extras.4.5'] && !r.corpo.erro.detalhes['extras.3.2'], 'só as perguntas da reavaliação são exigidas');

      r = await q(acA, 'REAVALIACAO', reavaliacao());
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.strictEqual(r.corpo.concluido, true);
      const [linha] = await db.consultar("SELECT modelo FROM questionario WHERE acompanhamento_id = @ac AND tipo = 'REAVALIACAO'", { ac: acA });
      assert.strictEqual(linha.modelo, 'M1');
      const [n] = await db.consultar(`SELECT COUNT(*) AS n FROM resposta_extra r JOIN questionario q ON q.id = r.questionario_id
        WHERE q.acompanhamento_id = @ac AND q.tipo = 'REAVALIACAO'`, { ac: acA });
      assert.strictEqual(n.n, 5, 'só as 5 respostas de estado são gravadas');
      assert.strictEqual((await instantaneo(acA)).length, 10, '5 do inicial + 5 da reavaliação');
    });

    await teste('indicadores: 2 pontos, semáforo melhorou, gráfico em ordem; datas fora de ordem recusadas', async () => {
      const d = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/indicadores`)).corpo;
      assert.deepStrictEqual(d.pontos.map((p) => p.tipo), ['INICIAL', 'REAVALIACAO']);
      assert.strictEqual(d.comparacao.geral.selo, 'melhorou');
      assert.strictEqual(d.comparacao.dimensoes.ALIMENTACAO.selo, 'melhorou');
      assert.strictEqual(d.comparacao.dimensoes.ECONOMIA.selo, 'sem_dados', 'Economia não tem par nos modelos oficiais');
      assert.strictEqual(d.reavaliacao.situacao, 'CONCLUIDA');
      assert.strictEqual(d.passos.length, 1);
      const antes = await q(acA, 'REAVALIACAO', reavaliacao({}, dias(-90)));
      assert.strictEqual(antes.status, 400, 'reavaliação não pode ser anterior ao inicial');
      assert.ok(antes.corpo.erro.detalhes.dataAplicacao);
    });

    await teste('corrigir a reavaliação concluída substitui o instantâneo (sem duplicar)', async () => {
      const corrigida = reavaliacao({ '2.5': 'SIM', '2.6': 'NAO' });
      const r = await q(acA, 'REAVALIACAO', corrigida);
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.strictEqual((await instantaneo(acA)).length, 10);
      const d = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/indicadores`)).corpo;
      const esperado = regras.calcularIndice(mapaDe(corrigida), { tipo: 'REAVALIACAO' });
      assert.strictEqual(d.pontos[1].dimensoes.ALIMENTACAO.nivel, esperado.dimensoes.ALIMENTACAO.nivel);
      const [n] = await db.consultar(`SELECT COUNT(*) AS n FROM resposta_extra r JOIN questionario q ON q.id = r.questionario_id
        WHERE q.acompanhamento_id = @ac AND q.tipo = 'REAVALIACAO'`, { ac: acA });
      assert.strictEqual(n.n, 5, 'as respostas também são substituídas, não duplicadas');
    });

    await teste('FINAL concluído: 3 pontos; reavaliação não interfere na comparação oficial inicial × final', async () => {
      const r = await q(acA, 'FINAL', final());
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      const d = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/indicadores`)).corpo;
      assert.deepStrictEqual(d.pontos.map((p) => p.tipo), ['INICIAL', 'REAVALIACAO', 'FINAL']);
      assert.strictEqual(d.comparacao.geral.selo, 'melhorou');
      assert.deepStrictEqual([d.comparacao.de, d.comparacao.para], ['INICIAL', 'FINAL']);
      assert.strictEqual(d.passos.length, 2);
      const cmp = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/comparacao`)).corpo;
      assert.strictEqual(cmp.completo, true);
      assert.strictEqual(cmp.modelo, 'M1');
      const renda = cmp.itens.find((i) => i.chave === 'rendaFaixa');
      assert.strictEqual(renda.inicial.valor, 'DE_501_1000');
      assert.strictEqual(renda.final.valor, 'DE_1001_2000');
      const ficha = (await a.req('GET', `/api/familias/acompanhamentos/${acA}`)).corpo;
      assert.strictEqual(ficha.questionarios.inicial.concluido, true);
      assert.strictEqual(ficha.questionarios.inicial.modelo, 'M1');
      assert.strictEqual(ficha.questionarios.final.concluido, true);
      const lista = (await a.req('GET', '/api/familias?status=EM_ANDAMENTO')).corpo.itens.find((i) => i.acompanhamentoId === acA);
      assert.strictEqual(lista.finalConcluido, true);
    });

    await teste('linha do tempo mostra a reavaliação concluída', async () => {
      const t = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/linha-do-tempo`)).corpo;
      assert.ok(t.itens.some((e) => e.titulo === 'Reavaliação rápida concluída'), JSON.stringify(t.itens.map((e) => e.titulo)));
    });

    await teste('família com final concluído e sem reavaliação: dispensada e bloqueada (409)', async () => {
      acC = await nova(CPF_C, 'Teste F5E2E C', dias(-90));
      assert.strictEqual((await q(acC, 'INICIAL', corpoInicial(dias(-90)))).status, 200);
      assert.strictEqual((await q(acC, 'FINAL', final())).status, 200);
      const d = (await a.req('GET', `/api/familias/acompanhamentos/${acC}/indicadores`)).corpo;
      assert.strictEqual(d.reavaliacao.situacao, 'DISPENSADA');
      assert.strictEqual(d.pontos.length, 2);
      const g = (await a.req('GET', `/api/familias/acompanhamentos/${acC}/questionarios/REAVALIACAO`)).corpo;
      assert.strictEqual(g.podeEditar, false);
      assert.strictEqual((await q(acC, 'REAVALIACAO', reavaliacao())).status, 409);
    });

    await teste('tipo inexistente continua 404 e a rota de indicadores exige escopo de unidade (outra unidade => 404)', async () => {
      assert.strictEqual((await a.req('GET', `/api/familias/acompanhamentos/${acA}/questionarios/XYZ`)).status, 404);
      assert.strictEqual((await b.req('GET', `/api/familias/acompanhamentos/${acA}/indicadores`)).status, 404);
      assert.strictEqual((await b.req('PUT', `/api/familias/acompanhamentos/${acA}/questionarios/REAVALIACAO`, { ...reavaliacao(), concluir: false })).status, 404);
      assert.strictEqual((await coord.req('GET', `/api/familias/acompanhamentos/${acA}/indicadores`)).status, 200);
      assert.strictEqual((await adm.req('GET', `/api/familias/acompanhamentos/${acA}/indicadores`)).status, 200);
      assert.strictEqual((await a.req('GET', '/api/familias/acompanhamentos/999999999/indicadores')).status, 404);
    });

    await teste('tolerância editável pelo COORDENADOR muda o semáforo (e volta ao valor original)', async () => {
      try {
        const antes = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/indicadores`)).corpo;
        assert.strictEqual(antes.comparacao.geral.selo, 'melhorou');
        const r = await coord.req('PUT', '/api/admin/configuracoes/indice_tolerancia_pontos', { valor: '50' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
        const depois = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/indicadores`)).corpo;
        assert.strictEqual(depois.tolerancia, 50);
        assert.ok(['igual', 'melhorou'].includes(depois.comparacao.geral.selo));
        assert.strictEqual(depois.comparacao.geral.diferenca, antes.comparacao.geral.diferenca, 'a diferença não muda, só o semáforo');
        const tolo = await coord.req('PUT', '/api/admin/configuracoes/indice_tolerancia_pontos', { valor: '0' });
        assert.strictEqual(tolo.status, 400);
        assert.strictEqual((await a.req('PUT', '/api/admin/configuracoes/indice_tolerancia_pontos', { valor: '9' })).status, 403);
      } finally {
        await coord.req('PUT', '/api/admin/configuracoes/indice_tolerancia_pontos', { valor: String(tolOriginal) });
      }
      assert.strictEqual(await cfg('indice_tolerancia_pontos'), tolOriginal);
    });

    await teste('regra versionada: instantâneo marcado com a versão antiga aparece como desatualizado e recalcular refaz com a atual', async () => {
      await db.consultar("UPDATE acompanhamento_indice SET versao_regra = 1 WHERE acompanhamento_id = @ac AND tipo = 'INICIAL'", { ac: acA });
      const velho = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/indicadores`)).corpo;
      assert.strictEqual(velho.pontos.find((p) => p.tipo === 'INICIAL').desatualizado, true);
      const { recalcularTodos } = require('../../server/services/indice-dados');
      await db.transacao((tx) => recalcularTodos(tx));
      const novo = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/indicadores`)).corpo;
      assert.ok(novo.pontos.every((p) => p.desatualizado === false));
      assert.strictEqual((await instantaneo(acA)).length, 15);
      assert.ok((await instantaneo(acA)).every((l) => l.versaoRegra === 2));
    });

    await teste('relatório final familiar .docx traz a seção de evolução (família com 3 pontos)', async () => {
      const r = await fetch(`${BASE}/api/relatorios/individual/${acA}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Cookie: a.cookie }, body: '{}' });
      assert.strictEqual(r.status, 200);
      const PizZip = require('pizzip');
      const xml = new PizZip(Buffer.from(await r.arrayBuffer())).file('word/document.xml').asText();
      assert.ok(xml.includes('Evolução durante o acompanhamento'));
      assert.ok(xml.includes('Reavaliação ('), 'coluna da reavaliação');
      assert.ok(xml.includes('Melhorou'), xml.replace(/<[^>]+>/g, ' ').replace(/ +/g, ' ').slice(-1500));
      assert.ok(!xml.includes('Economia e poupança'), 'dimensão sem itens nos modelos oficiais não aparece');
      assert.ok(!/\{[#/@]?[a-zA-Z.]+\}/.test(xml.replace(/<[^>]+>/g, '')), 'sem tags soltas');
      // família só com o inicial (rascunho do B): sem a seção
      const sem = await fetch(`${BASE}/api/relatorios/individual/${acB}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Cookie: a.cookie }, body: '{}' });
      assert.strictEqual(sem.status, 200);
      const xml2 = new PizZip(Buffer.from(await sem.arrayBuffer())).file('word/document.xml').asText();
      assert.ok(!xml2.includes('Evolução durante o acompanhamento'));
    });

    console.log(`\n${ok} testes passaram.`);
  } finally {
    servidor.kill();
    await db.consultar("UPDATE configuracao SET valor = @v WHERE chave = 'indice_tolerancia_pontos'", { v: String(tolOriginal) });
    await limpar();
    const [resto] = await db.consultar("SELECT (SELECT COUNT(*) FROM pessoa WHERE nome LIKE 'Teste F5E2E%') AS p, (SELECT COUNT(*) FROM usuario WHERE login LIKE 'f5[_]%') AS u");
    console.log(`limpeza: pessoas F5 restantes=${resto.p}, usuários F5 restantes=${resto.u}`);
    await db.fechar();
  }
})().catch((e) => { console.error(e); process.exit(1); });
