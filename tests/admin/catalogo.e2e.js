'use strict';

// Teste E2E (banco REAL do Docker de teste) da P1 + P2: permissões da Administração e catálogo de perguntas/opções configurável.
// Uso:  node tests/admin/catalogo.e2e.js        (sobe o próprio servidor em TESTE_PORT, padrão 3141)
// Cria os usuários p2_*, famílias "Teste P2E2E ..." (CPFs próprios), perguntas/opções/listas "P2E2E ..." e remove SÓ isso ao final;
// os textos das perguntas oficiais que o teste renomeia são restaurados. Não toca no usuário "admin".
// TRAVA: recusa rodar se o SQL Server não for o container Linux local.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const assert = require('assert');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');
const db = require('../../server/db');
const familias = require('../../server/services/familias');
const regras = require('../../server/services/indice-progresso');

const PORTA = process.env.TESTE_PORT || 3141;
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'P2-senha-teste-1';
const PREFIXO = 'P2E2E';

// CPFs válidos gerados a partir de bases exclusivas (nunca CPF de exemplo)
function cpfDe(base9) {
  const dv = (digitos) => {
    const soma = digitos.reduce((s, d, i) => s + d * (digitos.length + 1 - i), 0);
    return ((soma * 10) % 11) % 10;
  };
  const d = base9.split('').map(Number);
  d.push(dv(d));
  d.push(dv(d));
  return d.join('');
}
const CPF_A = cpfDe('707070701');
const CPF_B = cpfDe('707070702');
const CPF_C = cpfDe('707070703');
const CPF_ATEND = cpfDe('707070704');
const CPF_X = cpfDe('707070705');

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
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch { /* csv */ }
    return { status: r.status, corpo: json, texto: txt };
  }
  async entrar(login) {
    const r = await this.req('POST', '/api/auth/login', { login, senha: SENHA });
    assert.strictEqual(r.status, 200, `login ${login}: ${r.texto}`);
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

// ---------- limpeza: só o que este teste criou (prefixo exclusivo) ----------
async function limpar() {
  const pessoas = (await db.consultar(
    "SELECT id FROM pessoa WHERE cpf IN (@a, @b, @c, @d, @e) AND nome LIKE 'Teste P2E2E%'", { a: CPF_A, b: CPF_B, c: CPF_C, d: CPF_ATEND, e: CPF_X })).map((p) => p.id);
  for (const pid of pessoas) {
    const fams = (await db.consultar('SELECT id FROM familia WHERE responsavel_pessoa_id = @pid', { pid })).map((f) => f.id);
    for (const fid of fams) {
      const acs = (await db.consultar('SELECT id FROM acompanhamento WHERE familia_id = @fid', { fid })).map((a) => a.id);
      for (const ac of acs) {
        await db.consultar('DELETE FROM pesquisa_resposta_item WHERE resposta_id IN (SELECT id FROM pesquisa_resposta WHERE acompanhamento_id = @ac)', { ac });
        await db.consultar('DELETE FROM pesquisa_resposta WHERE acompanhamento_id = @ac', { ac }); // as respostas extras saem em cascata
        await db.consultar('DELETE FROM acompanhamento_registro WHERE acompanhamento_id = @ac', { ac });
        await db.consultar('DELETE FROM questionario WHERE acompanhamento_id = @ac', { ac }); // instantâneo e extras saem em cascata
        await db.consultar('DELETE FROM acompanhamento_indice WHERE acompanhamento_id = @ac', { ac });
        await db.consultar("DELETE FROM auditoria WHERE tabela IN ('acompanhamento', 'acompanhamento_registro', 'pesquisa_resposta', 'questionario') AND registro_id = @ac", { ac: String(ac) });
        await db.consultar('DELETE FROM acompanhamento WHERE id = @ac', { ac });
      }
      await db.consultar('DELETE FROM familia_membro WHERE familia_id = @fid', { fid });
      await db.consultar('DELETE FROM familia WHERE id = @fid', { fid });
    }
    await db.consultar('DELETE FROM atendimento WHERE pessoa_id = @pid', { pid }); // N:N e extras em cascata
    await db.consultar('DELETE FROM pessoa WHERE id = @pid', { pid });
  }
  // catálogo: perguntas extras e opções acrescentadas com o prefixo do teste
  await db.consultar(
    `DELETE FROM resposta_extra WHERE pergunta_id IN (SELECT id FROM catalogo_pergunta WHERE oficial = 0 AND texto LIKE @p)
        OR opcao_id IN (SELECT id FROM catalogo_opcao WHERE texto LIKE @p)`, { p: `${PREFIXO}%` });
  await db.consultar('DELETE FROM catalogo_opcao WHERE base = 0 AND (texto LIKE @p OR pergunta_id IN (SELECT id FROM catalogo_pergunta WHERE oficial = 0 AND texto LIKE @p))', { p: `${PREFIXO}%` });
  await db.consultar('DELETE FROM catalogo_pergunta WHERE oficial = 0 AND texto LIKE @p', { p: `${PREFIXO}%` });
  // listas de apoio e unidade criadas pela coordenação durante o teste
  await db.consultar('DELETE FROM demanda WHERE nome LIKE @p', { p: `${PREFIXO}%` });
  await db.consultar("DELETE FROM unidade WHERE sigla = 'P2T' AND nome LIKE @p", { p: `${PREFIXO}%` });
  const ids = (await db.consultar("SELECT id FROM usuario WHERE login LIKE 'p2[_]%'")).map((u) => u.id);
  for (const id of ids) {
    await db.consultar("DELETE FROM sessao WHERE TRY_CAST(JSON_VALUE(dados, '$.usuarioId') AS INT) = @id", { id });
    await db.consultar('DELETE FROM usuario_unidade WHERE usuario_id = @id', { id });
    await db.consultar('DELETE FROM auditoria WHERE usuario_id = @id', { id });
    await db.consultar('UPDATE usuario SET criado_por = NULL, alterado_por = NULL WHERE criado_por = @id OR alterado_por = @id', { id });
    await db.consultar('UPDATE configuracao SET alterado_por = NULL WHERE alterado_por = @id', { id });
    await db.consultar('UPDATE catalogo_pergunta SET criado_por = NULL, alterado_por = NULL WHERE criado_por = @id OR alterado_por = @id', { id });
    await db.consultar('UPDATE catalogo_opcao SET criado_por = NULL, alterado_por = NULL WHERE criado_por = @id OR alterado_por = @id', { id });
    await db.consultar('UPDATE unidade SET criado_por = NULL, alterado_por = NULL WHERE criado_por = @id OR alterado_por = @id', { id });
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

const inicial = (extra = {}) => ({
  dataAplicacao: dias(-60), qtdMembrosFamilia: 4, rendaMensalMedia: 1200, qtdMembrosComRenda: 1, recebeAuxilio: true, beneficioIds: [1],
  acessoAlimentosInNatura: 'NAO_TINHA', frequenciaFrutasVerduras: 'UMA_DUAS', qualidadeAlimentacao: 'NAO_MELHOROU', saudeNutricional: 'NENHUMA',
  conseguePoupar: false, economiaMensalFaixa: 'ATE_100', economiaMensalValor: 50, destinoEconomiaIds: [2],
  capacidadePoupanca: 'NAO_CONSEGUE', gestaoFinanceira: 'SEM_MUDANCA', empoderadaDecisoes: false, melhoriaPlanejamento: false,
  avaliacaoArmazem: 'BOA', recomendaria: true,
  ...extra,
});
const final = (extra = {}) => ({
  ...inicial(), dataAplicacao: dias(-1), acessoAlimentosInNatura: 'DIARIO', frequenciaFrutasVerduras: 'CINCO_OU_MAIS',
  qualidadeAlimentacao: 'MELHOROU_MUITO', saudeNutricional: 'GRANDE_MELHORIA', conseguePoupar: true, economiaMensalFaixa: 'DE_201_300',
  economiaMensalValor: 250, capacidadePoupanca: 'REGULARMENTE', gestaoFinanceira: 'MELHOROU', empoderadaDecisoes: true,
  melhoriaPlanejamento: true, avaliacaoArmazem: 'OTIMA', ...extra,
});

(async () => {
  await travaDeSeguranca();
  const colisao = await db.consultar(
    "SELECT cpf, nome FROM pessoa WHERE cpf IN (@a, @b, @c, @d, @e) AND nome NOT LIKE 'Teste P2E2E%'", { a: CPF_A, b: CPF_B, c: CPF_C, d: CPF_ATEND, e: CPF_X });
  if (colisao.length) { console.error('RECUSADO: CPF de teste já pertence a dados que este teste não criou:', colisao.map((c) => c.nome).join(', ')); process.exit(3); }
  const colisaoCatalogo = await db.consultar("SELECT COUNT(*) AS n FROM catalogo_pergunta WHERE oficial = 0 AND texto NOT LIKE @p", { p: `${PREFIXO}%` });
  console.log(`Perguntas extras de outras origens no catálogo (serão preservadas): ${colisaoCatalogo[0].n}`);
  await limpar();

  const unidades = await db.consultar('SELECT TOP 2 id, sigla FROM unidade WHERE ativo = 1 ORDER BY id');
  assert.ok(unidades.length >= 2, 'precisa de 2 unidades');
  const [uA, uB] = unidades;
  await criarUsuario('p2_assist_a', 'ASSISTENTE', uA.id);
  await criarUsuario('p2_assist_b', 'ASSISTENTE', uB.id);
  await criarUsuario('p2_coord', 'COORDENADOR');
  await criarUsuario('p2_admin', 'ADMIN');
  const textosOriginais = Object.fromEntries((await db.consultar(
    "SELECT codigo, formulario, texto, texto_final FROM catalogo_pergunta WHERE oficial = 1")).map((p) => [`${p.formulario}:${p.codigo}`, p]));
  const opcoesOriginais = await db.consultar('SELECT id, texto, texto_final FROM catalogo_opcao WHERE base = 1');
  const [{ valor: uploadOriginal }] = await db.consultar("SELECT valor FROM configuracao WHERE chave = 'upload_max_mb'");

  if (await fetch(`${BASE}/api/saude`).then((r) => r.ok, () => false)) throw new Error(`a porta ${PORTA} já está em uso; defina TESTE_PORT`);
  const servidor = spawn(process.execPath, ['server/index.js'], {
    cwd: require('path').join(__dirname, '..', '..'),
    env: { ...process.env, PORT: String(PORTA), NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await esperarServidor();
    const a = await new Cliente().entrar('p2_assist_a');
    const b = await new Cliente().entrar('p2_assist_b');
    const coord = await new Cliente().entrar('p2_coord');
    const adm = await new Cliente().entrar('p2_admin');

    // =====================================================================
    // P1 — permissões
    // =====================================================================
    await teste('migração 085: catálogo semeado (30 perguntas e 28 opções oficiais), CHECKs fixos trocados por formato', async () => {
      const [t] = await db.consultar("SELECT (SELECT COUNT(*) FROM catalogo_pergunta WHERE oficial = 1) AS p, (SELECT COUNT(*) FROM catalogo_opcao WHERE base = 1) AS o, OBJECT_ID('dbo.resposta_extra') AS r");
      assert.strictEqual(t.p, 30);
      assert.strictEqual(t.o, 28);
      assert.ok(t.r);
      const ck = await db.consultar("SELECT name FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.questionario') AND name IN ('ck_questionario_2a', 'ck_questionario_5a')");
      assert.strictEqual(ck.length, 0);
    });

    await teste('P1: assistente recebe 403 em TODA a Administração (contas, apoio, unidades, configurações, perguntas, auditoria)', async () => {
      for (const [m, u] of [['GET', '/usuarios'], ['GET', '/apoio'], ['GET', '/apoio/demanda'], ['GET', '/unidades'], ['GET', '/configuracoes'],
        ['GET', '/perguntas?formulario=QUESTIONARIO'], ['GET', '/auditoria'], ['GET', '/auditoria/opcoes']]) {
        const r = await a.req(m, `/api/admin${u}`);
        assert.strictEqual(r.status, 403, `${m} ${u}`);
      }
      for (const [m, u, c] of [['POST', '/apoio/demanda', { nome: 'x' }], ['POST', '/unidades', { sigla: 'ZZ', nome: 'x' }],
        ['PUT', '/configuracoes/upload_max_mb', { valor: '5' }], ['POST', '/perguntas', { formulario: 'ATENDIMENTO', tipo: 'TEXTO', texto: 'abc def' }],
        ['POST', '/usuarios', { login: 'p2_x', nome: 'x', perfil: 'ASSISTENTE' }]]) {
        assert.strictEqual((await a.req(m, `/api/admin${u}`, c)).status, 403, `${m} ${u}`);
      }
    });

    await teste('P1: coordenador recebe 403 nas CONTAS e na auditoria, mas 200 em apoio, unidades, configurações e perguntas', async () => {
      for (const [m, u] of [['GET', '/usuarios'], ['GET', '/usuarios/1'], ['GET', '/auditoria'], ['GET', '/auditoria/opcoes']]) {
        assert.strictEqual((await coord.req(m, `/api/admin${u}`)).status, 403, `${m} ${u}`);
      }
      for (const [m, u, c] of [['POST', '/usuarios', { login: 'p2_novo', nome: 'x', perfil: 'ASSISTENTE', unidadeIds: [uA.id] }],
        ['PUT', '/usuarios/1', { nome: 'x', perfil: 'ADMIN' }], ['PATCH', '/usuarios/1/ativo', { ativo: false }], ['POST', '/usuarios/1/redefinir-senha', {}]]) {
        assert.strictEqual((await coord.req(m, `/api/admin${u}`, c)).status, 403, `${m} ${u}`);
      }
      const novo = await db.consultar("SELECT 1 AS x FROM usuario WHERE login = 'p2_novo'");
      assert.strictEqual(novo.length, 0, 'a conta não pode ter sido criada');
      for (const u of ['/apoio', '/apoio/demanda', '/unidades', '/configuracoes', '/perguntas?formulario=QUESTIONARIO', '/perguntas?formulario=PESQUISA', '/perguntas?formulario=ATENDIMENTO']) {
        assert.strictEqual((await coord.req('GET', `/api/admin${u}`)).status, 200, u);
      }
    });

    await teste('P1: ADMIN continua com tudo (contas e auditoria incluídas)', async () => {
      assert.strictEqual((await adm.req('GET', '/api/admin/usuarios')).status, 200);
      assert.strictEqual((await adm.req('GET', '/api/admin/auditoria')).status, 200);
      assert.strictEqual((await adm.req('GET', '/api/admin/perguntas?formulario=QUESTIONARIO')).status, 200);
      assert.strictEqual((await adm.req('GET', '/api/admin/unidades')).status, 200);
    });

    await teste('P1: coordenador gerencia listas de apoio (criar, editar, desativar, excluir) e vê TODAS as configurações', async () => {
      const nome = `${PREFIXO} demanda`;
      let r = await coord.req('POST', '/api/admin/apoio/demanda', { nome, ordem: 998 });
      assert.strictEqual(r.status, 201, r.texto);
      const id = r.corpo.id;
      r = await coord.req('PUT', `/api/admin/apoio/demanda/${id}`, { nome: `${nome} 2`, ordem: 998 });
      assert.strictEqual(r.status, 200, r.texto);
      assert.strictEqual((await coord.req('PATCH', `/api/admin/apoio/demanda/${id}/ativo`, { ativo: false })).status, 200);
      assert.strictEqual((await coord.req('DELETE', `/api/admin/apoio/demanda/${id}`)).status, 204);

      const cfgs = (await coord.req('GET', '/api/admin/configuracoes')).corpo;
      assert.ok(cfgs.find((c) => c.chave === 'upload_max_mb' && c.editavel), 'configuração antes só do ADMIN agora é da coordenação');
      assert.ok(cfgs.find((c) => c.chave === 'nome_entidade' && c.editavel));
      assert.strictEqual((await coord.req('PUT', '/api/admin/configuracoes/upload_max_mb', { valor: '11' })).status, 200);
      assert.strictEqual((await coord.req('PUT', '/api/admin/configuracoes/upload_max_mb', { valor: '0' })).status, 400);
      await coord.req('PUT', '/api/admin/configuracoes/upload_max_mb', { valor: uploadOriginal });
    });

    await teste('P1: coordenador cria e edita unidade; desativar e reativar', async () => {
      let r = await coord.req('POST', '/api/admin/unidades', { sigla: 'P2T', nome: `${PREFIXO} unidade`, ordem: 998 });
      assert.strictEqual(r.status, 201, r.texto);
      const id = r.corpo.id;
      assert.strictEqual((await coord.req('PUT', `/api/admin/unidades/${id}`, { sigla: 'P2T', nome: `${PREFIXO} unidade 2`, ordem: 998 })).status, 200);
      assert.strictEqual((await coord.req('PATCH', `/api/admin/unidades/${id}/ativo`, { ativo: false })).status, 200);
    });

    // =====================================================================
    // P2 — catálogo
    // =====================================================================
    const pergunta = (corpo) => coord.req('POST', '/api/admin/perguntas', corpo);
    const catalogoDe = async (cliente, formulario) => (await cliente.req('GET', `/api/admin/perguntas?formulario=${formulario}`)).corpo;
    const achar = (cat, codigo) => cat.secoes.flatMap((s) => s.perguntas).find((p) => p.codigo === codigo);
    const oficialQ = (campoCodigo) => achar(catalogoQ0, campoCodigo);
    let catalogoQ0;

    await teste('catálogo: editor do questionário traz 5 seções, 21 perguntas oficiais e as opções oficiais como base', async () => {
      catalogoQ0 = await catalogoDe(coord, 'QUESTIONARIO');
      assert.strictEqual(catalogoQ0.secoes.length, 5);
      const todas = catalogoQ0.secoes.flatMap((s) => s.perguntas);
      assert.strictEqual(todas.filter((p) => p.oficial).length, 21);
      const p2a = achar(catalogoQ0, '2a');
      assert.deepStrictEqual(p2a.opcoes.map((o) => o.codigo), ['NAO_TINHA', 'SEMANAL_1_2', 'SEMANAL_2_3', 'DIARIO']);
      assert.ok(p2a.opcoes.every((o) => o.base && o.pontua));
      const [{ n }] = await db.consultar("SELECT COUNT(*) AS n FROM questionario WHERE acesso_alimentos_in_natura = 'DIARIO'");
      assert.strictEqual(p2a.opcoes.find((o) => o.codigo === 'DIARIO').respostas, n, 'o uso das opções oficiais vem das colunas do questionário');
      assert.strictEqual(achar(catalogoQ0, '3c').apoio, 'destino_economia');
      const pesq = await catalogoDe(coord, 'PESQUISA');
      assert.strictEqual(pesq.secoes[0].perguntas.filter((p) => p.oficial).length, 9);
    });

    let extraTexto; let extraNum; let extraEsc; let extraMult; let extraSim; let atEsc; let atTexto; let pqTexto; let pqEsc;

    await teste('criar perguntas extras: validação (tipo, texto, opções) e criação nos três formulários', async () => {
      assert.strictEqual((await pergunta({ formulario: 'ATENDIMENTO', tipo: 'XYZ', texto: `${PREFIXO} tipo ruim` })).status, 400);
      assert.strictEqual((await pergunta({ formulario: 'ATENDIMENTO', tipo: 'TEXTO', texto: 'ab' })).status, 400);
      assert.strictEqual((await pergunta({ formulario: 'OUTRO', tipo: 'TEXTO', texto: `${PREFIXO} formulário ruim` })).status, 400);
      let r = await pergunta({ formulario: 'ATENDIMENTO', tipo: 'ESCOLHA', texto: `${PREFIXO} uma só opção`, opcoes: ['única'] });
      assert.strictEqual(r.status, 400);
      assert.ok(r.corpo.erro.detalhes.opcoes);
      r = await pergunta({ formulario: 'ATENDIMENTO', tipo: 'ESCOLHA', texto: `${PREFIXO} repetidas`, opcoes: ['A', 'a'] });
      assert.strictEqual(r.status, 400);

      const novo = async (corpo) => { const x = await pergunta(corpo); assert.strictEqual(x.status, 201, x.texto); return x.corpo; };
      atTexto = await novo({ formulario: 'ATENDIMENTO', secao: 1, tipo: 'TEXTO', texto: `${PREFIXO} Como a pessoa conheceu o Armazém?`, obrigatoria: true });
      atEsc = await novo({ formulario: 'ATENDIMENTO', secao: 1, tipo: 'ESCOLHA', texto: `${PREFIXO} Primeira vez no Armazém?`, opcoes: ['Sim, primeira vez', 'Já veio antes', 'Não sabe informar'] });
      extraTexto = await novo({ formulario: 'QUESTIONARIO', secao: 4, tipo: 'TEXTO', texto: `${PREFIXO} O que mudou na rotina da casa?`, textoFinal: `${PREFIXO} O que mudou na rotina da casa depois do projeto?` });
      extraNum = await novo({ formulario: 'QUESTIONARIO', secao: 2, tipo: 'NUMERO', texto: `${PREFIXO} Quantas refeições por dia?` });
      extraEsc = await novo({ formulario: 'QUESTIONARIO', secao: 2, tipo: 'ESCOLHA', texto: `${PREFIXO} Onde costuma comprar frutas?`, opcoes: ['Feira', 'Mercado', 'Armazém'], obrigatoria: true });
      extraMult = await novo({ formulario: 'QUESTIONARIO', secao: 3, tipo: 'MULTIPLA', texto: `${PREFIXO} Quais gastos diminuíram?`, opcoes: ['Alimentação', 'Transporte', 'Remédios'] });
      extraSim = await novo({ formulario: 'QUESTIONARIO', secao: 5, tipo: 'SIM_NAO', texto: `${PREFIXO} Indicou a vizinhos?` });
      pqTexto = await novo({ formulario: 'PESQUISA', tipo: 'TEXTO', texto: `${PREFIXO} Algum recado para a equipe?`, obrigatoria: true });
      pqEsc = await novo({ formulario: 'PESQUISA', tipo: 'ESCOLHA', texto: `${PREFIXO} Como prefere ser avisado?`, opcoes: ['Telefone', 'Mensagem'] });
      assert.match(atTexto.codigo, /^E\d{4}$/);
      assert.notStrictEqual(atTexto.codigo, atEsc.codigo);
      // na pesquisa nunca é obrigatória
      const pesq = await catalogoDe(coord, 'PESQUISA');
      assert.strictEqual(achar(pesq, pqTexto.codigo).obrigatoria, false);
    });

    await teste('formulários leem o catálogo: modelo do questionário, perguntas do atendimento (todos os perfis) e modelo da pesquisa', async () => {
      const m = (await a.req('GET', '/api/familias/questionario/modelo?tipo=INICIAL')).corpo;
      const b2 = m.blocos.find((x) => x.numero === 2);
      const ex = b2.perguntas.filter((p) => p.extra);
      assert.deepStrictEqual(ex.map((p) => p.codigo), [extraNum.codigo, extraEsc.codigo].sort());
      assert.strictEqual(ex.find((p) => p.codigo === extraNum.codigo).tipo, 'numero');
      assert.strictEqual(ex.find((p) => p.codigo === extraEsc.codigo).obrigatoria, true);
      assert.deepStrictEqual(ex.find((p) => p.codigo === extraEsc.codigo).opcoes.map((o) => o.rotulo), ['Feira', 'Mercado', 'Armazém']);
      assert.strictEqual(m.blocos.find((x) => x.numero === 3).perguntas.find((p) => p.extra).tipo, 'multipla-extra');
      assert.match(m.blocos.find((x) => x.numero === 4).perguntas.find((p) => p.extra).texto, /rotina da casa\?$/);
      const f = (await a.req('GET', '/api/familias/questionario/modelo?tipo=FINAL')).corpo;
      assert.match(f.blocos.find((x) => x.numero === 4).perguntas.find((p) => p.extra).texto, /depois do projeto\?$/);
      const r = (await a.req('GET', '/api/familias/questionario/modelo?tipo=REAVALIACAO')).corpo;
      assert.strictEqual(r.blocos.flatMap((x) => x.perguntas).filter((p) => p.extra).length, 0, 'reavaliação rápida não tem extras');

      const at = (await b.req('GET', '/api/apoio/perguntas/ATENDIMENTO')).corpo.filter((p) => p.codigo.startsWith('E'));
      assert.ok(at.find((p) => p.codigo === atTexto.codigo && p.obrigatoria));
      assert.strictEqual((await a.req('GET', '/api/apoio/perguntas/OUTRO')).status, 404);
    });

    await teste('renomear pergunta e opção OFICIAIS: o código não muda, o modelo mostra o texto novo', async () => {
      const p2a = oficialQ('2a');
      let r = await coord.req('PUT', `/api/admin/perguntas/${p2a.id}`, { texto: `${PREFIXO} Frequência de alimentos in natura?`, textoFinal: `${PREFIXO} Hoje, frequência de alimentos in natura?`, ajuda: '' });
      assert.strictEqual(r.status, 200, r.texto);
      const op = p2a.opcoes.find((o) => o.codigo === 'SEMANAL_1_2');
      r = await coord.req('PUT', `/api/admin/perguntas/${p2a.id}/opcoes/${op.id}`, { texto: `${PREFIXO} Uma ou duas vezes por semana`, textoFinal: '' });
      assert.strictEqual(r.status, 200, r.texto);
      const m = (await a.req('GET', '/api/familias/questionario/modelo?tipo=INICIAL')).corpo;
      const p = m.blocos[1].perguntas.find((x) => x.codigo === '2a');
      assert.match(p.texto, /^P2E2E Frequência/);
      assert.strictEqual(p.campo, 'acessoAlimentosInNatura');
      assert.strictEqual(p.opcoes.find((o) => o.valor === 'SEMANAL_1_2').rotulo, `${PREFIXO} Uma ou duas vezes por semana`);
      const f = (await a.req('GET', '/api/familias/questionario/modelo?tipo=FINAL')).corpo;
      assert.match(f.blocos[1].perguntas.find((x) => x.codigo === '2a').texto, /^P2E2E Hoje/);
      assert.strictEqual(f.blocos[1].perguntas.find((x) => x.codigo === '2a').opcoes.find((o) => o.valor === 'NAO_TINHA').rotulo, 'Não tem acesso', 'rótulo "hoje" original preservado');
      // pesquisa: renomeia a NPS
      const pesq = await catalogoDe(coord, 'PESQUISA');
      const nps = achar(pesq, 'NPS');
      assert.strictEqual((await coord.req('PUT', `/api/admin/perguntas/${nps.id}`, { texto: `${PREFIXO} Nota de 0 a 10 para o projeto?` })).status, 200);
    });

    await teste('pergunta oficial não se desativa nem se exclui; tipo e opção de pergunta sem opções recusados', async () => {
      const p2b = oficialQ('2b');
      assert.strictEqual((await coord.req('PATCH', `/api/admin/perguntas/${p2b.id}/ativa`, { ativa: false })).status, 409);
      assert.strictEqual((await coord.req('DELETE', `/api/admin/perguntas/${p2b.id}`)).status, 409);
      const p1b = oficialQ('1b');
      assert.strictEqual((await coord.req('POST', `/api/admin/perguntas/${p1b.id}/opcoes`, { texto: `${PREFIXO} x` })).status, 409);
      const base = p2b.opcoes[0];
      assert.strictEqual((await coord.req('DELETE', `/api/admin/perguntas/${p2b.id}/opcoes/${base.id}`)).status, 409, 'opção oficial não se exclui');
    });

    let opNova; let opNaoPontua;
    await teste('acrescentar opção a pergunta OFICIAL exige dizer como pontua (vale como X, ou não pontua)', async () => {
      const p2a = oficialQ('2a');
      let r = await coord.req('POST', `/api/admin/perguntas/${p2a.id}/opcoes`, { texto: `${PREFIXO} Todo dia, com horta própria` });
      assert.strictEqual(r.status, 400);
      assert.ok(r.corpo.erro.detalhes.equivaleA);
      r = await coord.req('POST', `/api/admin/perguntas/${p2a.id}/opcoes`, { texto: `${PREFIXO} Todo dia, com horta própria`, equivaleA: 'NAO_EXISTE' });
      assert.strictEqual(r.status, 400);
      r = await coord.req('POST', `/api/admin/perguntas/${p2a.id}/opcoes`, { texto: `${PREFIXO} Todo dia, com horta própria`, equivaleA: 'DIARIO' });
      assert.strictEqual(r.status, 201, r.texto);
      opNova = r.corpo;
      assert.match(opNova.codigo, /^OP\d{2}$/);
      r = await coord.req('POST', `/api/admin/perguntas/${p2a.id}/opcoes`, { texto: `${PREFIXO} Não sabe informar`, naoPontua: true });
      assert.strictEqual(r.status, 201, r.texto);
      opNaoPontua = r.corpo;
      r = await coord.req('POST', `/api/admin/perguntas/${p2a.id}/opcoes`, { texto: `${PREFIXO} Todo dia, com horta própria`, equivaleA: 'DIARIO' });
      assert.strictEqual(r.status, 400, 'texto repetido');
      const cat = await catalogoDe(coord, 'QUESTIONARIO');
      const novas = achar(cat, '2a').opcoes.filter((o) => !o.base);
      assert.deepStrictEqual(novas.map((o) => [o.codigo, o.pontua, o.equivaleCodigo]), [[opNova.codigo, true, 'DIARIO'], [opNaoPontua.codigo, false, null]]);
      const m = (await a.req('GET', '/api/familias/questionario/modelo?tipo=INICIAL')).corpo;
      const codigos = m.blocos[1].perguntas.find((x) => x.codigo === '2a').opcoes.map((o) => o.valor);
      assert.ok(codigos.includes(opNova.codigo) && codigos.includes(opNaoPontua.codigo));
    });

    let acA; let acB; let acC;
    const nova = async (cliente, unidadeId, cpf, nome) => {
      const r = await cliente.req('POST', '/api/familias', { unidadeId, dataInicio: dias(-60), responsavel: { cpf, nome }, membros: [] });
      assert.strictEqual(r.status, 201, r.texto);
      return r.corpo.acompanhamentoId;
    };
    const q = (cliente, ac, tipo, corpo, concluir = true) => cliente.req('PUT', `/api/familias/acompanhamentos/${ac}/questionarios/${tipo}`, { ...corpo, concluir });
    const nivelAlimentacao = async (ac) => {
      const [l] = await db.consultar("SELECT nivel, itens_validos FROM acompanhamento_indice WHERE acompanhamento_id = @ac AND dimensao = 'ALIMENTACAO' AND tipo = 'INICIAL'", { ac });
      return { nivel: Number(l.nivel), itens: l.itensValidos };
    };

    await teste('questionário com opção nova: aceita o código, índice usa a opção equivalente; "não pontua" sai do índice', async () => {
      acA = await nova(a, uA.id, CPF_A, 'Teste P2E2E A');
      acB = await nova(a, uA.id, CPF_B, 'Teste P2E2E B');
      acC = await nova(a, uA.id, CPF_C, 'Teste P2E2E C');
      // A responde DIARIO (oficial); B responde a opção nova que vale como DIARIO; C responde a que não pontua
      const extrasObrig = { [extraEsc.codigo]: 'OP01' };
      let r = await q(a, acA, 'INICIAL', inicial({ acessoAlimentosInNatura: 'DIARIO', extras: extrasObrig }));
      assert.strictEqual(r.status, 200, r.texto);
      r = await q(a, acB, 'INICIAL', inicial({ acessoAlimentosInNatura: opNova.codigo, extras: extrasObrig }));
      assert.strictEqual(r.status, 200, r.texto);
      assert.strictEqual(r.corpo.respostas.acessoAlimentosInNatura, opNova.codigo);
      r = await q(a, acC, 'INICIAL', inicial({ acessoAlimentosInNatura: opNaoPontua.codigo, extras: extrasObrig }));
      assert.strictEqual(r.status, 200, r.texto);
      const A = await nivelAlimentacao(acA);
      const B = await nivelAlimentacao(acB);
      const C = await nivelAlimentacao(acC);
      assert.strictEqual(B.nivel, A.nivel, 'a opção nova vale exatamente como DIARIO');
      assert.strictEqual(B.itens, A.itens);
      assert.strictEqual(C.itens, A.itens - 1, 'a que não pontua deixa de contar como item respondido');
      assert.strictEqual((await q(a, acA, 'INICIAL', inicial({ acessoAlimentosInNatura: 'CODIGO_INVENTADO', extras: extrasObrig }))).status, 400);
    });

    await teste('perguntas extras do questionário: obrigatória só exigida ao concluir; rascunho aceita vazio; valores gravados e devolvidos', async () => {
      const acX = await nova(a, uA.id, CPF_X, 'Teste P2E2E X');
      // rascunho sem a obrigatória: tudo bem
      let r = await q(a, acX, 'INICIAL', { rendaMensalMedia: 900 }, false);
      assert.strictEqual(r.status, 200, r.texto);
      // concluir sem a obrigatória: 400 no campo extras.<código>
      r = await q(a, acX, 'INICIAL', inicial());
      assert.strictEqual(r.status, 400);
      assert.ok(r.corpo.erro.detalhes[`extras.${extraEsc.codigo}`], JSON.stringify(r.corpo.erro.detalhes));
      // valores inválidos
      r = await q(a, acX, 'INICIAL', inicial({ extras: { [extraEsc.codigo]: 'NAO_EXISTE' } }));
      assert.strictEqual(r.status, 400);
      r = await q(a, acX, 'INICIAL', inicial({ extras: { [extraEsc.codigo]: 'OP01', [extraNum.codigo]: 'abc' } }));
      assert.strictEqual(r.status, 400);
      assert.ok(r.corpo.erro.detalhes[`extras.${extraNum.codigo}`]);
      r = await q(a, acX, 'INICIAL', inicial({ extras: { [extraEsc.codigo]: 'OP01', [extraMult.codigo]: ['OP01', 'OP99'] } }));
      assert.strictEqual(r.status, 400);
      // completo
      r = await q(a, acX, 'INICIAL', inicial({
        extras: { [extraEsc.codigo]: 'OP02', [extraNum.codigo]: '3,5', [extraMult.codigo]: ['OP01', 'OP03'], [extraSim.codigo]: false, [extraTexto.codigo]: '  Almoço juntos  ' },
      }));
      assert.strictEqual(r.status, 200, r.texto);
      assert.deepStrictEqual(r.corpo.extras, {
        [extraEsc.codigo]: 'OP02', [extraNum.codigo]: 3.5, [extraMult.codigo]: ['OP01', 'OP03'], [extraSim.codigo]: false, [extraTexto.codigo]: 'Almoço juntos',
      });
      const lista = r.corpo.respostasExtras.map((x) => [x.pergunta.replace(`${PREFIXO} `, ''), x.resposta]);
      assert.deepStrictEqual(lista, [
        ['Quantas refeições por dia?', '3,5'], ['Onde costuma comprar frutas?', 'Mercado'],
        ['Quais gastos diminuíram?', 'Alimentação; Remédios'], ['O que mudou na rotina da casa?', 'Almoço juntos'], ['Indicou a vizinhos?', 'Não'],
      ]);
      // sem `extras` no corpo: não apaga o que já está gravado
      r = await q(a, acX, 'INICIAL', inicial());
      assert.strictEqual(r.status, 200, r.texto);
      assert.strictEqual(r.corpo.respostasExtras.length, 5);
      // limpar uma resposta opcional (enviada vazia)
      r = await q(a, acX, 'INICIAL', inicial({ extras: { [extraEsc.codigo]: 'OP02', [extraNum.codigo]: '', [extraMult.codigo]: [] } }));
      assert.strictEqual(r.status, 200, r.texto);
      assert.deepStrictEqual(Object.keys(r.corpo.extras).sort(), [extraEsc.codigo].sort());
      assert.strictEqual((await db.consultar('SELECT COUNT(*) AS n FROM resposta_extra WHERE questionario_id = @id', { id: r.corpo.id }))[0].n, 1);
    });

    await teste('comparação da família traz as perguntas extras lado a lado; relatório individual (.docx) e CSV as incluem', async () => {
      const extras = { [extraEsc.codigo]: 'OP02', [extraTexto.codigo]: 'Texto inicial P2' };
      assert.strictEqual((await q(a, acA, 'INICIAL', inicial({ acessoAlimentosInNatura: 'DIARIO', extras }))).status, 200);
      const rf = await q(a, acA, 'FINAL', final({ extras: { [extraEsc.codigo]: 'OP03', [extraTexto.codigo]: 'Texto final P2' } }));
      assert.strictEqual(rf.status, 200, rf.texto);
      const c = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/comparacao`)).corpo;
      assert.strictEqual(c.completo, true);
      const linha = c.extras.find((x) => x.codigo === extraTexto.codigo);
      assert.strictEqual(linha.inicial, 'Texto inicial P2');
      assert.strictEqual(linha.final, 'Texto final P2');
      assert.strictEqual(c.extras.find((x) => x.codigo === extraEsc.codigo).final, 'Armazém');

      const prev = (await a.req('GET', `/api/relatorios/individual/${acA}/previa`)).corpo;
      const texto = JSON.stringify(prev);
      assert.match(texto, /Texto inicial P2/);
      assert.match(texto, /Texto final P2/);
      assert.match(texto, /Perguntas adicionais do questionário/);

      const hojeIso = familias.hojeIso();
      const csv = await coord.req('GET', `/api/relatorios/exportar/perguntas-extras.csv?dataInicio=${dias(-120)}&dataFim=${hojeIso}`);
      assert.strictEqual(csv.status, 200, csv.texto.slice(0, 200));
      assert.match(csv.texto, /Texto final P2/);
      assert.match(csv.texto, /FORMULÁRIO;DATA;UNIDADE/);
      assert.doesNotMatch(csv.texto, /Teste P2E2E A/, 'não identifica a família');
      assert.strictEqual((await a.req('GET', `/api/relatorios/exportar/perguntas-extras.csv?dataInicio=${dias(-120)}&dataFim=${hojeIso}`)).status, 403);
    });

    await teste('atendimento: pergunta adicional obrigatória, gravação, detalhe e edição sem apagar', async () => {
      const corpo = {
        dataAtendimento: hoje, nome: 'Teste P2E2E Atendida', cpf: CPF_ATEND, unidadeId: uA.id,
      };
      let r = await a.req('POST', '/api/atendimentos', corpo);
      assert.strictEqual(r.status, 400, 'falta a obrigatória');
      assert.ok(r.corpo.erro.detalhes[`extras.${atTexto.codigo}`]);
      r = await a.req('POST', '/api/atendimentos', { ...corpo, extras: { [atTexto.codigo]: 'Indicação da vizinha', [atEsc.codigo]: 'OP99' } });
      assert.strictEqual(r.status, 400);
      r = await a.req('POST', '/api/atendimentos', { ...corpo, extras: { [atTexto.codigo]: 'Indicação da vizinha', [atEsc.codigo]: 'OP02' } });
      assert.strictEqual(r.status, 201, r.texto);
      const id = r.corpo.id;
      let d = (await a.req('GET', `/api/atendimentos/${id}`)).corpo;
      assert.deepStrictEqual(d.extras, { [atTexto.codigo]: 'Indicação da vizinha', [atEsc.codigo]: 'OP02' });
      assert.deepStrictEqual(d.respostasExtras.map((x) => x.resposta), ['Indicação da vizinha', 'Já veio antes']);
      // outra unidade não vê
      assert.strictEqual((await b.req('GET', `/api/atendimentos/${id}`)).status, 404);
      // edição sem `extras`: mantém; com `extras`: troca
      r = await a.req('PUT', `/api/atendimentos/${id}`, corpo);
      assert.strictEqual(r.status, 200, r.texto);
      d = (await a.req('GET', `/api/atendimentos/${id}`)).corpo;
      assert.strictEqual(d.respostasExtras.length, 2);
      r = await a.req('PUT', `/api/atendimentos/${id}`, { ...corpo, extras: { [atTexto.codigo]: 'Redes sociais', [atEsc.codigo]: 'OP01' } });
      assert.strictEqual(r.status, 200, r.texto);
      d = (await a.req('GET', `/api/atendimentos/${id}`)).corpo;
      assert.deepStrictEqual(d.respostasExtras.map((x) => x.resposta), ['Redes sociais', 'Sim, primeira vez']);
      // obrigatória não pode ser limpa
      r = await a.req('PUT', `/api/atendimentos/${id}`, { ...corpo, extras: { [atTexto.codigo]: '' } });
      assert.strictEqual(r.status, 400);
    });

    await teste('pesquisa de satisfação: perguntas adicionais sempre opcionais; respostas gravadas e mostradas', async () => {
      const m = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/pesquisas`)).corpo.modelo;
      assert.match(m.perguntas.find((p) => p.codigo === 'NPS').texto, /^P2E2E Nota/);
      const ex = m.extras.find((x) => x.codigo === pqTexto.codigo);
      assert.ok(ex);
      assert.strictEqual(ex.obrigatoria, false);
      const itens = [{ codigo: 'NPS', valorNum: 9 }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ codigo: `L${n}`, valorNum: 5 }))];
      const base = { momento: 'AVULSA', situacao: 'CONCLUIDA', consentimentoLido: true, dataAplicacao: hoje, modo: 'FAMILIA_FALOU', itens };
      let r = await a.req('POST', `/api/familias/acompanhamentos/${acB}/pesquisas`, { ...base, extras: { [pqEsc.codigo]: 'NAO_EXISTE' } });
      assert.strictEqual(r.status, 400);
      r = await a.req('POST', `/api/familias/acompanhamentos/${acB}/pesquisas`, { ...base, extras: { [pqEsc.codigo]: 'OP02', [pqTexto.codigo]: 'Obrigada pelo cuidado' } });
      assert.strictEqual(r.status, 201, r.texto);
      const lista = (await a.req('GET', `/api/familias/acompanhamentos/${acB}/pesquisas`)).corpo.pesquisas;
      assert.deepStrictEqual(lista[0].respostasExtras.map((x) => x.resposta).sort(), ['Mensagem', 'Obrigada pelo cuidado']);
      const cheia = (await a.req('GET', `/api/familias/acompanhamentos/${acB}/pesquisas/${r.corpo.id}`)).corpo;
      assert.strictEqual(cheia.extras[pqEsc.codigo], 'OP02');
      // sem as extras também conclui (opcionais)
      r = await a.req('POST', `/api/familias/acompanhamentos/${acC}/pesquisas`, { ...base, momento: 'SEMESTRAL' });
      assert.strictEqual(r.status, 201, r.texto);
    });

    await teste('ordenar, desativar e reativar pergunta extra; desativada some do modelo mas mantém as respostas', async () => {
      const cat = await catalogoDe(coord, 'QUESTIONARIO');
      const s2 = cat.secoes.find((s) => s.numero === 2).perguntas.filter((p) => !p.oficial);
      assert.deepStrictEqual(s2.map((p) => p.codigo), [extraNum.codigo, extraEsc.codigo].sort(), 'ordem de criação');
      const ids = s2.map((p) => p.id).reverse();
      assert.strictEqual((await coord.req('PUT', '/api/admin/perguntas/ordem', { formulario: 'QUESTIONARIO', secao: 2, ids })).status, 204);
      assert.strictEqual((await coord.req('PUT', '/api/admin/perguntas/ordem', { formulario: 'QUESTIONARIO', secao: 2, ids: [ids[0]] })).status, 400, 'lista incompleta');
      const m = (await a.req('GET', '/api/familias/questionario/modelo?tipo=INICIAL')).corpo;
      const ordem = m.blocos.find((x) => x.numero === 2).perguntas.filter((p) => p.extra).map((p) => p.codigo);
      assert.deepStrictEqual(ordem, s2.map((p) => p.codigo).reverse());

      const pid = s2.find((p) => p.codigo === extraNum.codigo).id;
      assert.strictEqual((await coord.req('PATCH', `/api/admin/perguntas/${pid}/ativa`, { ativa: false })).status, 200);
      const m2 = (await a.req('GET', '/api/familias/questionario/modelo?tipo=INICIAL')).corpo;
      assert.ok(!m2.blocos.flatMap((x) => x.perguntas).some((p) => p.codigo === extraNum.codigo));
      // a resposta que existia continua no banco
      const [{ n }] = await db.consultar('SELECT COUNT(*) AS n FROM resposta_extra WHERE pergunta_id = @pid', { pid });
      assert.ok(n >= 0);
      assert.strictEqual((await coord.req('PATCH', `/api/admin/perguntas/${pid}/ativa`, { ativa: true })).status, 200);
    });

    await teste('nunca apaga o que tem resposta: pergunta e opção usadas dão 409; sem resposta pode excluir', async () => {
      const cat = await catalogoDe(coord, 'QUESTIONARIO');
      const emUso = achar(cat, extraEsc.codigo);
      assert.ok(emUso.respostas > 0);
      let r = await coord.req('DELETE', `/api/admin/perguntas/${emUso.id}`);
      assert.strictEqual(r.status, 409);
      const op = emUso.opcoes.find((o) => o.texto === 'Feira');
      assert.ok(op.respostas > 0);
      r = await coord.req('DELETE', `/api/admin/perguntas/${emUso.id}/opcoes/${op.id}`);
      assert.strictEqual(r.status, 409);
      // opção oficial acrescentada e USADA: não exclui, não muda o quanto vale
      const p2a = achar(cat, '2a');
      const usada = p2a.opcoes.find((o) => o.codigo === opNova.codigo);
      assert.ok(usada.respostas > 0);
      assert.strictEqual((await coord.req('DELETE', `/api/admin/perguntas/${p2a.id}/opcoes/${usada.id}`)).status, 409);
      r = await coord.req('PUT', `/api/admin/perguntas/${p2a.id}/opcoes/${usada.id}`, { texto: usada.texto, equivaleA: 'NAO_TINHA' });
      assert.strictEqual(r.status, 409, 'mudar o valor de uma opção já usada alteraria índices antigos');
      r = await coord.req('PUT', `/api/admin/perguntas/${p2a.id}/opcoes/${usada.id}`, { texto: `${usada.texto} (horta)`, equivaleA: 'DIARIO' });
      assert.strictEqual(r.status, 200, 'renomear é livre');
      // pergunta sem respostas: exclui
      const livre = await pergunta({ formulario: 'ATENDIMENTO', tipo: 'NUMERO', texto: `${PREFIXO} pergunta descartável` });
      assert.strictEqual((await coord.req('DELETE', `/api/admin/perguntas/${livre.corpo.id}`)).status, 204);
    });

    await teste('opção desativada: não aceita resposta nova, mas quem já respondeu com ela continua válido; mínimo de 2 ativas', async () => {
      const cat = await catalogoDe(coord, 'QUESTIONARIO');
      const p2a = achar(cat, '2a');
      const usada = p2a.opcoes.find((o) => o.codigo === opNova.codigo);
      assert.strictEqual((await coord.req('PATCH', `/api/admin/perguntas/${p2a.id}/opcoes/${usada.id}/ativa`, { ativa: false })).status, 200);
      const m = (await a.req('GET', '/api/familias/questionario/modelo?tipo=INICIAL')).corpo;
      assert.strictEqual(m.blocos[1].perguntas.find((x) => x.codigo === '2a').opcoes.find((o) => o.valor === opNova.codigo).ativa, false);
      const extras = { [extraEsc.codigo]: 'OP01' };
      // B já tinha a opção: pode salvar de novo
      let r = await q(a, acB, 'INICIAL', inicial({ acessoAlimentosInNatura: opNova.codigo, extras }));
      assert.strictEqual(r.status, 200, r.texto);
      // outra família não pode escolhê-la agora
      r = await q(a, acA, 'INICIAL', inicial({ acessoAlimentosInNatura: opNova.codigo, extras }));
      assert.strictEqual(r.status, 400);
      assert.match(r.corpo.erro.detalhes.acessoAlimentosInNatura, /não está mais disponível/);
      assert.strictEqual((await coord.req('PATCH', `/api/admin/perguntas/${p2a.id}/opcoes/${usada.id}/ativa`, { ativa: true })).status, 200);
      // pergunta de escolha precisa manter 2 opções ativas (a de 2 opções não perde nenhuma; a de 3 pode perder uma)
      const pe = await catalogoDe(coord, 'PESQUISA');
      const duas = achar(pe, pqEsc.codigo);
      assert.strictEqual((await coord.req('PATCH', `/api/admin/perguntas/${duas.id}/opcoes/${duas.opcoes[0].id}/ativa`, { ativa: false })).status, 409);
      const tres = achar(await catalogoDe(coord, 'QUESTIONARIO'), extraMult.codigo);
      assert.strictEqual((await coord.req('PATCH', `/api/admin/perguntas/${tres.id}/opcoes/${tres.opcoes[0].id}/ativa`, { ativa: false })).status, 200);
      assert.strictEqual((await coord.req('PATCH', `/api/admin/perguntas/${tres.id}/opcoes/${tres.opcoes[1].id}/ativa`, { ativa: false })).status, 409);
    });

    await teste('comparação inicial × final com opção nova: usa a posição da opção equivalente', async () => {
      // B: inicial com a opção nova (vale DIARIO); final com NAO_TINHA => piorou; A: inicial DIARIO, final DIARIO => igual
      const extras = { [extraEsc.codigo]: 'OP01' };
      assert.strictEqual((await q(a, acB, 'FINAL', final({ acessoAlimentosInNatura: 'NAO_TINHA', extras }))).status, 200);
      const c = (await a.req('GET', `/api/familias/acompanhamentos/${acB}/comparacao`)).corpo;
      const item = c.itens.find((i) => i.campo === 'acessoAlimentosInNatura');
      assert.strictEqual(item.tendencia, 'piorou');
      assert.match(item.inicialRotulo, /horta/);
      const ca = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/comparacao`)).corpo;
      assert.strictEqual(ca.itens.find((i) => i.campo === 'acessoAlimentosInNatura').tendencia, 'igual');
      // C: inicial "não pontua" => sem dados na comparação
      assert.strictEqual((await q(a, acC, 'FINAL', final({ extras }))).status, 200);
      const cc = (await a.req('GET', `/api/familias/acompanhamentos/${acC}/comparacao`)).corpo;
      assert.strictEqual(cc.itens.find((i) => i.campo === 'acessoAlimentosInNatura').tendencia, 'sem_dados');
      // o índice puro bate com o instantâneo do banco
      const [ger] = await db.consultar("SELECT nivel FROM acompanhamento_indice WHERE acompanhamento_id = @ac AND dimensao = 'GERAL' AND tipo = 'FINAL'", { ac: acA });
      assert.ok(Number(ger.nivel) > 0 && regras.VERSAO_REGRA >= 1);
    });

    await teste('auditoria: toda mudança no catálogo fica registrada (só o ADMIN consulta)', async () => {
      const r = await adm.req('GET', '/api/admin/auditoria?tabela=catalogo_pergunta&porPagina=200');
      assert.strictEqual(r.status, 200);
      const acoes = new Set(r.corpo.itens.map((i) => i.acao));
      assert.ok(acoes.has('CRIAR') && acoes.has('ALTERAR') && acoes.has('EXCLUIR'), [...acoes].join());
      const o = await adm.req('GET', '/api/admin/auditoria?tabela=catalogo_opcao&porPagina=200');
      assert.ok(o.corpo.itens.some((i) => i.acao === 'CRIAR'));
      assert.ok(r.corpo.itens.some((i) => /P2E2E/.test(i.detalhes || '')));
    });

    await teste('restaurar os textos oficiais renomeados pelo teste', async () => {
      const cat = await catalogoDe(coord, 'QUESTIONARIO');
      const p2a = achar(cat, '2a');
      const orig = textosOriginais['QUESTIONARIO:2a'];
      assert.strictEqual((await coord.req('PUT', `/api/admin/perguntas/${p2a.id}`, { texto: orig.texto, textoFinal: orig.textoFinal, ajuda: '' })).status, 200);
      const [ajudaOriginal] = await db.consultar("SELECT ajuda FROM catalogo_pergunta WHERE formulario = 'QUESTIONARIO' AND codigo = '2a'");
      void ajudaOriginal;
      const op = p2a.opcoes.find((o) => o.codigo === 'SEMANAL_1_2');
      assert.strictEqual((await coord.req('PUT', `/api/admin/perguntas/${p2a.id}/opcoes/${op.id}`, { texto: '1-2 vezes por semana', textoFinal: '' })).status, 200);
      const pesq = await catalogoDe(coord, 'PESQUISA');
      const nps = achar(pesq, 'NPS');
      assert.strictEqual((await coord.req('PUT', `/api/admin/perguntas/${nps.id}`, { texto: textosOriginais['PESQUISA:NPS'].texto })).status, 200);
    });
  } finally {
    servidor.kill();
    await new Promise((r) => setTimeout(r, 300));
    await limpar();
    // restaura os textos oficiais que o teste renomeou (perguntas e opções) e confere que nada do teste sobrou
    const mudou = (await db.consultar("SELECT formulario, codigo, texto FROM catalogo_pergunta WHERE oficial = 1"))
      .filter((p) => textosOriginais[`${p.formulario}:${p.codigo}`].texto !== p.texto);
    if (mudou.length) {
      console.log('Restaurando textos oficiais alterados:', mudou.map((p) => p.codigo).join(', '));
      for (const p of mudou) {
        const o = textosOriginais[`${p.formulario}:${p.codigo}`];
        await db.consultar('UPDATE catalogo_pergunta SET texto = @t, texto_final = @f WHERE formulario = @fo AND codigo = @c', { t: o.texto, f: o.textoFinal, fo: p.formulario, c: p.codigo });
      }
    }
    for (const o of opcoesOriginais) {
      await db.consultar("UPDATE catalogo_opcao SET texto = @t, texto_final = @f WHERE id = @id AND base = 1", { id: o.id, t: o.texto, f: o.textoFinal });
    }
    const sobra = await db.consultar(
      `SELECT (SELECT COUNT(*) FROM catalogo_pergunta WHERE texto LIKE @p) AS perguntas,
              (SELECT COUNT(*) FROM catalogo_opcao WHERE texto LIKE @p) AS opcoes,
              (SELECT COUNT(*) FROM usuario WHERE login LIKE 'p2[_]%') AS usuarios,
              (SELECT COUNT(*) FROM pessoa WHERE nome LIKE 'Teste P2E2E%') AS pessoas`, { p: `${PREFIXO}%` });
    console.log('Sobras após a limpeza:', JSON.stringify(sobra[0]));
    await db.consultar("UPDATE configuracao SET valor = @v WHERE chave = 'upload_max_mb'", { v: uploadOriginal });
    await db.fechar();
  }
  console.log(`\n${ok} testes passaram.`);
})().catch((e) => { console.error(e); process.exit(1); });
