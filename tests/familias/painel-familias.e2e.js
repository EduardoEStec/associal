'use strict';

// Teste E2E (banco REAL do Docker de teste) da F6: painel do coordenador (progresso, metas, satisfação, alertas) e relatórios.
// Uso:  node tests/familias/painel-familias.e2e.js        (sobe o próprio servidor em TESTE_PORT, padrão 3126)
// Cria os usuários f6_* e seis famílias "Teste F6E2E ..." (CPFs próprios), exercita a API e remove SÓ isso ao final (por prefixo).
// Restaura as configurações que alterar. Não toca no usuário "admin". TRAVA: recusa rodar se o SQL Server não for o container Linux local.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const assert = require('assert');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');
const PizZip = require('pizzip');
const db = require('../../server/db');
const familias = require('../../server/services/familias');

const PORTA = process.env.TESTE_PORT || 3126;
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'F6-senha-teste-1';
const PREFIXO = 'Teste F6E2E';
const CPFS = { A1: '73190482640', A2: '20461937506', A3: '65810349757', B1: '39726150868', A5: '14250869342', A6: '58093621415' };
const CPF_LISTA = Object.values(CPFS);
const CONFIGS = ['pesquisa_n_minimo', 'semaforo_progresso_verde_pct', 'semaforo_progresso_amarelo_pct', 'indice_tolerancia_pontos', 'alerta_sem_meta_dias'];

class Cliente {
  constructor() { this.cookie = ''; }
  async req(metodo, url, corpo, bruto = false) {
    const r = await fetch(BASE + url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Cookie: this.cookie },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    if (bruto) return { status: r.status, tipo: r.headers.get('content-type'), buffer: Buffer.from(await r.arrayBuffer()) };
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

// Só apaga o que este teste criou: pessoas com CPF de teste E nome com o prefixo; usuários f6_*.
async function limpar() {
  const params = Object.fromEntries(CPF_LISTA.map((c, i) => [`c${i}`, c]));
  const pessoas = (await db.consultar(`SELECT id FROM pessoa WHERE cpf IN (${CPF_LISTA.map((_, i) => `@c${i}`).join(', ')}) AND nome LIKE '${PREFIXO}%'`, params)).map((p) => p.id);
  for (const pid of pessoas) {
    for (const f of await db.consultar('SELECT id FROM familia WHERE responsavel_pessoa_id = @pid', { pid })) {
      for (const ac of await db.consultar('SELECT id FROM acompanhamento WHERE familia_id = @f', { f: f.id })) {
        await db.consultar('DELETE FROM pesquisa_resposta WHERE acompanhamento_id = @ac', { ac: ac.id });
        await db.consultar('DELETE FROM acompanhamento_registro WHERE acompanhamento_id = @ac', { ac: ac.id });
        await db.consultar('DELETE FROM acompanhamento_meta WHERE acompanhamento_id = @ac', { ac: ac.id });
        await db.consultar('DELETE FROM questionario WHERE acompanhamento_id = @ac', { ac: ac.id }); // o instantâneo sai em cascata
        await db.consultar('DELETE FROM acompanhamento_indice WHERE acompanhamento_id = @ac', { ac: ac.id });
        await db.consultar("DELETE FROM auditoria WHERE tabela IN ('acompanhamento', 'acompanhamento_registro', 'pesquisa_resposta', 'acompanhamento_meta') AND registro_id = @ac", { ac: String(ac.id) });
        await db.consultar('DELETE FROM acompanhamento WHERE id = @ac', { ac: ac.id });
      }
      await db.consultar('DELETE FROM familia_membro WHERE familia_id = @f', { f: f.id });
      await db.consultar('DELETE FROM familia WHERE id = @f', { f: f.id });
    }
    await db.consultar('DELETE FROM atendimento WHERE pessoa_id = @pid', { pid });
    await db.consultar('DELETE FROM pessoa WHERE id = @pid', { pid });
  }
  for (const u of await db.consultar("SELECT id FROM usuario WHERE login LIKE 'f6[_]%'")) {
    const id = u.id;
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
    try { if ((await fetch(`${BASE}/api/saude`)).ok) return; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('servidor de teste não subiu');
}

let ok = 0;
const teste = async (nome, fn) => { await fn(); ok += 1; console.log(`  ok - ${nome}`); };

// Respostas completas: "pobre" (renda baixa, nada melhorou) e "boa" (renda alta, tudo melhorou)
const pobre = (dataAplicacao) => ({
  dataAplicacao, qtdMembrosFamilia: 4, rendaMensalMedia: 1200, qtdMembrosComRenda: 1, recebeAuxilio: true, beneficioIds: [1],
  acessoAlimentosInNatura: 'NAO_TINHA', frequenciaFrutasVerduras: 'UMA_DUAS', qualidadeAlimentacao: 'NAO_MELHOROU', saudeNutricional: 'NENHUMA',
  conseguePoupar: false, economiaMensalFaixa: 'ATE_100', economiaMensalValor: 50, destinoEconomiaIds: [2],
  capacidadePoupanca: 'NAO_CONSEGUE', gestaoFinanceira: 'SEM_MUDANCA', empoderadaDecisoes: false, melhoriaPlanejamento: false,
  avaliacaoArmazem: 'BOA', recomendaria: true,
});
const boa = (dataAplicacao) => ({
  ...pobre(dataAplicacao), rendaMensalMedia: 4000, qtdMembrosComRenda: 2, qtdMembrosFamilia: 2,
  acessoAlimentosInNatura: 'DIARIO', frequenciaFrutasVerduras: 'CINCO_OU_MAIS', qualidadeAlimentacao: 'MELHOROU_MUITO', saudeNutricional: 'GRANDE_MELHORIA',
  conseguePoupar: true, economiaMensalFaixa: 'DE_201_300', economiaMensalValor: 250, capacidadePoupanca: 'REGULARMENTE', gestaoFinanceira: 'MELHOROU',
  empoderadaDecisoes: true, melhoriaPlanejamento: true, avaliacaoArmazem: 'OTIMA',
});
const itensPesquisa = (nps, likert, textos = []) => [
  { codigo: 'NPS', valorNum: nps }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ codigo: `L${n}`, valorNum: likert })), ...textos];

(async () => {
  await travaDeSeguranca();
  const params = Object.fromEntries(CPF_LISTA.map((c, i) => [`c${i}`, c]));
  const colisao = await db.consultar(`SELECT cpf, nome FROM pessoa WHERE cpf IN (${CPF_LISTA.map((_, i) => `@c${i}`).join(', ')}) AND nome NOT LIKE '${PREFIXO}%'`, params);
  if (colisao.length) { console.error('RECUSADO: CPF de teste já pertence a dados que este teste não criou:', colisao.map((c) => c.nome).join(', ')); process.exit(3); }
  await limpar();

  const [uA, uB] = await db.consultar('SELECT TOP 2 id, sigla FROM unidade WHERE ativo = 1 ORDER BY id');
  assert.ok(uA && uB, 'precisa de 2 unidades');
  await criarUsuario('f6_assist_a', 'ASSISTENTE', uA.id);
  await criarUsuario('f6_assist_b', 'ASSISTENTE', uB.id);
  await criarUsuario('f6_coord', 'COORDENADOR');
  await criarUsuario('f6_admin', 'ADMIN');
  const original = {};
  for (const l of await db.consultar(`SELECT chave, valor FROM configuracao WHERE chave IN (${CONFIGS.map((c) => `'${c}'`).join(', ')})`)) original[l.chave] = l.valor;
  assert.strictEqual(Object.keys(original).length, CONFIGS.length, 'as configurações da F4, F5 e F6 existem (migrações 082 a 084)');

  if (await fetch(`${BASE}/api/saude`).then((r) => r.ok, () => false)) throw new Error(`a porta ${PORTA} já está em uso; defina TESTE_PORT`);
  const servidor = spawn(process.execPath, ['server/index.js'], {
    cwd: require('path').join(__dirname, '..', '..'), env: { ...process.env, PORT: String(PORTA), NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await esperarServidor();
    const a = await new Cliente().entrar('f6_assist_a');
    const b = await new Cliente().entrar('f6_assist_b');
    const coord = await new Cliente().entrar('f6_coord');
    const adm = await new Cliente().entrar('f6_admin');

    // Período até ONTEM: deixa de fora a família de teste do banco ("Maria Teste E2E", criada hoje) e os dados de hoje; os testes de metas e
    // desligamento (que acontecem hoje) usam o período até hoje.
    const periodo = `inicio=${dias(-90)}&fim=${dias(-1)}`;
    const periodoHoje = `inicio=${dias(-90)}&fim=${hoje}`;
    const progresso = async (cli = coord, extra = '', per = periodo) => (await cli.req('GET', `/api/painel/progresso?${per}${extra}`));
    const satisfacao = async (cli = coord, extra = '') => (await cli.req('GET', `/api/painel/satisfacao?${periodo}${extra}`));
    const alertas = async (cli = coord) => (await cli.req('GET', '/api/painel/alertas')).corpo;
    const config = async (chave, valor, cli = coord) => cli.req('PUT', `/api/admin/configuracoes/${chave}`, { valor: String(valor) });

    const ac = {};
    const nova = async (cli, un, chave, inicio) => {
      const r = await cli.req('POST', '/api/familias', { unidadeId: un.id, dataInicio: inicio, responsavel: { cpf: CPFS[chave], nome: `${PREFIXO} ${chave}` }, membros: [] });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      ac[chave] = r.corpo.acompanhamentoId;
    };
    const q = async (cli, chave, tipo, corpo) => {
      const r = await cli.req('PUT', `/api/familias/acompanhamentos/${ac[chave]}/questionarios/${tipo}`, { ...corpo, concluir: true });
      assert.strictEqual(r.status, 200, `${chave} ${tipo}: ${JSON.stringify(r.corpo)}`);
    };

    let elegiveisAntes;
    await teste('preparo: seis famílias (A1 melhora, A2 igual, A3 piora, B1 melhora, A5 só inicial, A6 sem nada) e os instantâneos do índice', async () => {
      elegiveisAntes = (await satisfacao()).corpo.geral.elegiveis;
      await nova(a, uA, 'A1', dias(-60)); await nova(a, uA, 'A2', dias(-60)); await nova(a, uA, 'A3', dias(-60));
      await nova(b, uB, 'B1', dias(-60)); await nova(a, uA, 'A5', dias(-60)); await nova(a, uA, 'A6', dias(-200));
      await q(a, 'A1', 'INICIAL', pobre(dias(-60))); await q(a, 'A1', 'FINAL', boa(dias(-1)));
      await q(a, 'A2', 'INICIAL', pobre(dias(-60))); await q(a, 'A2', 'FINAL', pobre(dias(-1)));
      await q(a, 'A3', 'INICIAL', boa(dias(-60))); await q(a, 'A3', 'FINAL', pobre(dias(-1)));
      await q(b, 'B1', 'INICIAL', pobre(dias(-60))); await q(b, 'B1', 'FINAL', boa(dias(-1)));
      await q(a, 'A5', 'INICIAL', pobre(dias(-60)));
      const [n] = await db.consultar(`SELECT COUNT(*) AS n FROM acompanhamento_indice WHERE acompanhamento_id IN (${Object.values(ac).join(', ')})`);
      assert.strictEqual(n.n, 5 * 9, '9 questionários concluídos × 5 linhas (geral e 4 dimensões)');
    });

    await teste('n mínimo (padrão 5): com 4 famílias comparadas só os números absolutos aparecem, sem percentual nem semáforo', async () => {
      assert.strictEqual(await config('pesquisa_n_minimo', 5).then((r) => r.status), 200);
      const r = await progresso();
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      const g = r.corpo.geral;
      assert.strictEqual(r.corpo.nMinimo, 5);
      assert.strictEqual(g.n, 4);
      assert.deepStrictEqual([g.melhoraram, g.iguais, g.pioraram], [2, 1, 1]);
      assert.strictEqual(g.suficiente, false);
      assert.strictEqual(g.pctMelhoraram, null);
      assert.strictEqual(g.semaforo, null);
      assert.strictEqual(r.corpo.unidades.find((u) => u.sigla === uA.sigla).n, 3);
      assert.strictEqual(r.corpo.unidades.find((u) => u.sigla === uB.sigla).n, 1);
    });

    await teste('n mínimo 2: percentuais, semáforo (limiares provisórios 50 e 30), dimensões, unidades e distribuição do índice', async () => {
      assert.strictEqual((await config('pesquisa_n_minimo', 2)).status, 200);
      const r = (await progresso()).corpo;
      const g = r.geral;
      assert.strictEqual(g.suficiente, true);
      assert.strictEqual(g.pctMelhoraram, 50);
      assert.strictEqual(g.pctIguais, 25);
      assert.strictEqual(g.pctPioraram, 25);
      assert.strictEqual(g.semaforo, 'VERDE');
      assert.ok(g.indiceMedioInicial !== null && g.indiceMedioAtual !== null);
      assert.deepStrictEqual(r.dimensoes.map((d) => d.codigo), ['ALIMENTACAO', 'RENDA', 'ECONOMIA', 'AUTONOMIA']);
      assert.ok(r.dimensoes.every((d) => d.n >= 2));
      const bra = r.unidades.find((u) => u.sigla === uA.sigla);
      assert.strictEqual(bra.n, 3);
      assert.strictEqual(bra.pctMelhoraram, 33.3);
      assert.strictEqual(bra.semaforo, 'AMARELO');
      assert.strictEqual(bra.porDimensao.length, 4);
      assert.strictEqual(r.unidades.find((u) => u.sigla === uB.sigla).n, 1, 'uma família < n mínimo 2');
      assert.strictEqual(r.unidades.find((u) => u.sigla === uB.sigla).pctMelhoraram, null);
      assert.strictEqual(r.distribuicao.faixas.length, 5);
      assert.ok(r.distribuicao.n >= 4);
      assert.ok(r.anterior && r.anterior.periodo.fim === dias(-91));
      assert.strictEqual(r.semaforos.limiares.progressoVerde, 50);
    });

    await teste('limiares do semáforo editáveis (coordenação 200, assistente 403, valores fora da faixa 400) e mudam o resultado', async () => {
      assert.strictEqual((await config('semaforo_progresso_verde_pct', 60, a)).status, 403);
      assert.strictEqual((await config('semaforo_progresso_verde_pct', 0)).status, 400);
      assert.strictEqual((await config('semaforo_nps_verde', 101)).status, 400);
      assert.strictEqual((await config('semaforo_progresso_verde_pct', 60)).status, 200);
      assert.strictEqual((await progresso()).corpo.geral.semaforo, 'AMARELO', '50% < 60');
      assert.strictEqual((await config('semaforo_progresso_amarelo_pct', 55)).status, 200);
      assert.strictEqual((await progresso()).corpo.geral.semaforo, 'VERMELHO', '50% < 55 < 60');
      assert.strictEqual((await config('semaforo_progresso_verde_pct', original.semaforo_progresso_verde_pct)).status, 200);
      assert.strictEqual((await config('semaforo_progresso_amarelo_pct', original.semaforo_progresso_amarelo_pct)).status, 200);
      assert.strictEqual((await progresso()).corpo.geral.semaforo, 'VERDE');
    });

    await teste('metas no painel: em andamento, atingidas, por dimensão (fotografia no fim do período)', async () => {
      const m1 = await a.req('POST', `/api/familias/acompanhamentos/${ac.A1}/metas`, { dimensao: 'ALIMENTACAO', descricao: 'Comprar frutas toda semana' });
      assert.strictEqual(m1.status, 201, JSON.stringify(m1.corpo));
      assert.strictEqual((await a.req('PUT', `/api/familias/acompanhamentos/${ac.A1}/metas/${m1.corpo.id}`, { dimensao: 'ALIMENTACAO', descricao: 'Comprar frutas toda semana', status: 'ATINGIDA' })).status, 200);
      assert.strictEqual((await a.req('POST', `/api/familias/acompanhamentos/${ac.A2}/metas`, { dimensao: 'RENDA', descricao: 'Retomar o bico' })).status, 201);
      assert.strictEqual((await a.req('POST', `/api/familias/acompanhamentos/${ac.A2}/metas`, { dimensao: 'ECONOMIA', descricao: 'Guardar um pouco por semana' })).status, 201);
      const m = (await progresso(coord, '', periodoHoje)).corpo.metas;
      assert.strictEqual(m.total, 3);
      assert.strictEqual(m.atingidas, 1);
      assert.strictEqual(m.emAndamento, 2);
      assert.strictEqual(m.familiasComMeta, 2);
      assert.strictEqual(m.pctAtingidas, null, '1 meta encerrada < n mínimo 2');
      assert.strictEqual(m.porDimensao.find((d) => d.codigo === 'ALIMENTACAO').atingidas, 1);
      assert.strictEqual(m.porUnidade.find((u) => u.sigla === uB.sigla).total, 0);
    });

    await teste('satisfação: NPS, concordância, taxas, semáforo por unidade e n mínimo (assistente 403)', async () => {
      const aplicar = (cli, chave, itens, extra = {}) => cli.req('POST', `/api/familias/acompanhamentos/${ac[chave]}/pesquisas`,
        { momento: 'AVULSA', situacao: 'CONCLUIDA', consentimentoLido: true, modo: 'FAMILIA_FALOU', dataAplicacao: dias(-1), itens, ...extra });
      let r = await aplicar(a, 'A1', itensPesquisa(10, 5, [{ codigo: 'T1', valorTexto: 'Preço justo e atendimento acolhedor.' }, { codigo: 'T2', valorTexto: 'Mais dias de funcionamento.' }]));
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      r = await aplicar(a, 'A2', itensPesquisa(6, 3));
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      r = await aplicar(a, 'A3', itensPesquisa(9, 4));
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      r = await b.req('POST', `/api/familias/acompanhamentos/${ac.B1}/pesquisas`, { momento: 'AVULSA', situacao: 'RECUSADA', dataAplicacao: dias(-1) });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));

      assert.strictEqual((await satisfacao(a)).status, 403);
      assert.strictEqual((await satisfacao(b)).status, 403);
      const s = (await satisfacao()).corpo;
      const g = s.geral;
      assert.strictEqual(g.respostas, 3);
      assert.strictEqual(g.recusas, 1);
      assert.deepStrictEqual([g.promotoras, g.neutras, g.detratoras], [2, 0, 1]);
      assert.strictEqual(g.nps, 33, '(2 promotoras − 1 detratora) ÷ 3');
      assert.strictEqual(g.concordancia, 67, '12 de 18 respostas com 4 ou 5');
      assert.strictEqual(g.semaforo, 'AMARELO');
      assert.strictEqual(g.taxaRecusa, 25);
      assert.strictEqual(g.elegiveis, elegiveisAntes + 6, 'as seis famílias do teste (mais as que já estavam no banco)');
      assert.strictEqual(g.familiasComPesquisa, 4);
      assert.strictEqual(g.taxaCobertura, Math.round((4 / (elegiveisAntes + 6)) * 1000) / 10);
      assert.strictEqual(s.perguntas.length, 6);
      assert.ok(s.perguntas.every((p) => p.texto && p.texto !== p.codigo), 'texto da afirmação, não o código');
      const conc = s.perguntas.map((p) => p.concordancia);
      assert.deepStrictEqual(conc, [...conc].sort((x, y) => x - y), 'da pior para a melhor');
      const ua = s.unidades.find((u) => u.sigla === uA.sigla);
      const ub = s.unidades.find((u) => u.sigla === uB.sigla);
      assert.strictEqual(ua.respostas, 3);
      assert.strictEqual(ua.suficiente, true);
      assert.strictEqual(ub.respostas, 0);
      assert.strictEqual(ub.recusas, 1);
      assert.strictEqual(ub.nps, null);
      assert.strictEqual(ub.semaforo, null);
      // n mínimo 5: tudo some, só os números absolutos
      assert.strictEqual((await config('pesquisa_n_minimo', 5)).status, 200);
      const baixo = (await satisfacao()).corpo.geral;
      assert.strictEqual(baixo.respostas, 3);
      assert.strictEqual(baixo.nps, null);
      assert.strictEqual(baixo.concordancia, null);
      assert.strictEqual(baixo.semaforo, null);
      assert.strictEqual((await config('pesquisa_n_minimo', 2)).status, 200);
      // filtro de unidade
      const soB = (await satisfacao(coord, `&unidadeId=${uB.id}`)).corpo;
      assert.strictEqual(soB.geral.respostas, 0);
      assert.strictEqual(soB.geral.recusas, 1);
    });

    await teste('comentários: coordenação e ADMIN leem; ocultar tira da lista; a ASSISTENTE não tem a rota', async () => {
      let s = (await satisfacao()).corpo;
      assert.strictEqual(s.comentarios.length, 2);
      const t1 = s.comentarios.find((c) => c.codigo === 'T1');
      assert.strictEqual(t1.texto, 'Preço justo e atendimento acolhedor.');
      assert.strictEqual(t1.sigla, uA.sigla);
      assert.ok(t1.pesquisaId && t1.acompanhamentoId === ac.A1);
      assert.strictEqual((await satisfacao(adm)).corpo.comentarios.length, 2, 'ADMIN lê como a coordenação');
      assert.strictEqual((await coord.req('PUT', `/api/familias/acompanhamentos/${ac.A1}/pesquisas/${t1.pesquisaId}/comentario-oculto`, { oculto: true })).status, 200);
      s = (await satisfacao()).corpo;
      assert.strictEqual(s.comentarios.length, 0, 'os dois comentários eram da mesma pesquisa');
      assert.ok(!JSON.stringify(s).includes('Preço justo'));
      assert.strictEqual((await coord.req('PUT', `/api/familias/acompanhamentos/${ac.A1}/pesquisas/${t1.pesquisaId}/comentario-oculto`, { oculto: false })).status, 200);
      assert.strictEqual((await satisfacao()).corpo.comentarios.length, 2);
    });

    await teste('alertas consolidados: sem contato, sem meta, pesquisa pendente e reavaliação pendente (por unidade)', async () => {
      const al = await alertas();
      const dasMinhas = (lista) => lista.filter((x) => Object.values(ac).includes(x.acompanhamentoId));
      const ids = (lista) => dasMinhas(lista).map((x) => x.acompanhamentoId).sort((x, y) => x - y);
      const esperado = (...chaves) => chaves.map((c) => ac[c]).sort((x, y) => x - y);
      assert.deepStrictEqual(ids(al.familiasSemMeta), esperado('A3', 'B1', 'A5', 'A6'), 'A1 (meta atingida hoje) e A2 (meta em andamento) saem');
      assert.deepStrictEqual(ids(al.familiasSemContato), esperado('A5', 'A6'), 'as demais têm questionário final de ontem');
      assert.deepStrictEqual(ids(al.reavaliacoesPendentes), esperado('A5'), 'inicial há 60 dias, sem reavaliação (45 dias)');
      assert.strictEqual(al.reavaliacoesPendentes.find((x) => x.acompanhamentoId === ac.A5).diasAtraso, 15);
      const pesq = al.pesquisasPendentes.filter((x) => x.acompanhamentoId === ac.A6);
      assert.strictEqual(pesq.length, 1);
      assert.strictEqual(pesq[0].momento, 'SEMESTRAL');
      // A1 concluiu o questionário final e só recebeu pesquisa AVULSA: a pesquisa FINAL segue pendente
      assert.strictEqual(al.pesquisasPendentes.find((x) => x.acompanhamentoId === ac.A1).momento, 'FINAL');
      const unidadeA = al.resumoPorUnidade.find((r) => r.unidadeSigla === uA.sigla);
      for (const campo of ['familiasSemMeta', 'pesquisasPendentes', 'reavaliacoesPendentes', 'familiasSemContato']) assert.ok(unidadeA[campo] >= 1, campo);
      // com o filtro de unidade só aparecem as da unidade escolhida
      const soB = (await coord.req('GET', `/api/painel/alertas?unidadeId=${uB.id}`)).corpo;
      assert.ok(soB.familiasSemMeta.every((x) => x.unidadeSigla === uB.sigla));
      assert.ok(soB.familiasSemMeta.some((x) => x.acompanhamentoId === ac.B1));
      // tela Início: cada assistente vê só a sua unidade
      const ia = (await a.req('GET', '/api/painel/resumo-inicio')).corpo.pendentes;
      assert.ok(ia.reavaliacaoItens.some((x) => x.acompanhamentoId === ac.A5));
      assert.ok(ia.semMeta >= 3);
      const ib = (await b.req('GET', '/api/painel/resumo-inicio')).corpo.pendentes;
      assert.ok(!ib.reavaliacaoItens.some((x) => x.acompanhamentoId === ac.A5));
      assert.ok(ib.semMetaItens.some((x) => x.acompanhamentoId === ac.B1));
      assert.ok(!ib.semMetaItens.some((x) => x.acompanhamentoId === ac.A3));
    });

    await teste('isolamento: assistentes recebem 403 no painel; unidade fora do escopo e período inválido; ADMIN lê como a coordenação', async () => {
      for (const cli of [a, b]) {
        assert.strictEqual((await progresso(cli)).status, 403);
        assert.strictEqual((await satisfacao(cli)).status, 403);
      }
      assert.strictEqual((await progresso(coord, '&unidadeId=9999999')).status, 403);
      assert.strictEqual((await coord.req('GET', '/api/painel/progresso?inicio=2026-12-31&fim=2026-01-01')).status, 400);
      assert.strictEqual((await progresso(adm)).corpo.geral.n, 4);
      assert.strictEqual((await progresso(coord, `&unidadeId=${uB.id}`)).corpo.geral.n, 1);
    });

    await teste('acompanhamentos no período: desligamento entra nos números e tempo médio; família sai dos alertas', async () => {
      const antes = (await progresso(coord, '', periodoHoje)).corpo.acompanhamentos;
      const enc = await a.req('POST', `/api/familias/acompanhamentos/${ac.A3}/encerrar`, { status: 'DESLIGADO', observacoes: 'Mudou de bairro' });
      assert.strictEqual(enc.status, 200, JSON.stringify(enc.corpo));
      const depois = (await progresso(coord, '', periodoHoje)).corpo.acompanhamentos;
      assert.strictEqual(depois.desligados, antes.desligados + 1);
      assert.strictEqual(depois.emAndamento, antes.emAndamento - 1);
      assert.ok(depois.tempoMedioDias >= 1);
      assert.ok(!(await alertas()).familiasSemMeta.some((x) => x.acompanhamentoId === ac.A3));
      assert.strictEqual((await progresso()).corpo.geral.n, 4, 'a família desligada continua na comparação de progresso');
    });

    await teste('relatório semestral: prévia e .docx com as seções de progresso e satisfação; CSV; individual com metas', async () => {
      const prm = `dataInicio=${dias(-90)}&dataFim=${dias(-1)}`;
      const previa = (await coord.req('GET', `/api/relatorios/semestral/previa?${prm}`)).corpo;
      assert.strictEqual(previa.progresso.geral.n, 4);
      assert.strictEqual(previa.satisfacao.geral.respostas, 3);
      assert.strictEqual(previa.comentariosSatisfacao.length, 2);
      assert.match(previa.textos.progresso, /4 famílias tiveram duas ou mais medições/);
      assert.match(previa.textos.satisfacao, /3 pesquisas de satisfação foram respondidas e 1 família preferiu não responder/);
      assert.deepStrictEqual((await a.req('GET', `/api/relatorios/semestral/previa?${prm}`)).corpo.comentariosSatisfacao, [], 'assistente não recebe os comentários');

      const docx = await coord.req('POST', '/api/relatorios/semestral', { dataInicio: dias(-90), dataFim: dias(-1), fotos: [], relatos: [], comentariosSatisfacao: [{ id: previa.comentariosSatisfacao[0].id }] }, true);
      assert.strictEqual(docx.status, 200);
      const texto = new PizZip(docx.buffer).file('word/document.xml').asText().replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
      assert.match(texto, /4\. Acompanhamento e evolução das famílias/);
      assert.match(texto, /5\. Satisfação das famílias/);
      assert.match(texto, /6\. Considerações finais/);
      assert.match(texto, /Resolvi meus problemas|Fui tratada\(o\) com respeito/);
      assert.ok(!/\{|\}|undefined|NaN/.test(texto), 'sem tags soltas');

      const csvP = await coord.req('GET', `/api/relatorios/exportar/progresso.csv?${prm}`, undefined, true);
      assert.strictEqual(csvP.status, 200);
      const linhas = csvP.buffer.toString('utf8').replace('﻿', '').trim().split('\r\n');
      assert.ok(linhas.includes('Todas as unidades;Índice geral;4;2;1;1;50;Bom'), linhas.slice(0, 4).join('\n'));
      assert.strictEqual((await coord.req('GET', `/api/relatorios/exportar/satisfacao.csv?${prm}`, undefined, true)).status, 200);
      assert.strictEqual((await a.req('GET', `/api/relatorios/exportar/progresso.csv?${prm}`, undefined, true)).status, 403);

      const ind = await a.req('POST', `/api/relatorios/individual/${ac.A1}`, {}, true);
      assert.strictEqual(ind.status, 200);
      const txtInd = new PizZip(ind.buffer).file('word/document.xml').asText().replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
      assert.match(txtInd, /Foram combinadas com a família 1 meta: 1 atingida\(s\), 0 não atingida\(s\) e 0 em andamento\./);
      assert.match(txtInd, /Comprar frutas toda semana/);
    });

    console.log(`\n${ok} testes OK`);
  } finally {
    servidor.kill();
    for (const [chave, valor] of Object.entries(original)) await db.consultar('UPDATE configuracao SET valor = @v WHERE chave = @c', { v: valor, c: chave }).catch(() => {});
    await limpar();
    const [restos] = await db.consultar("SELECT COUNT(*) AS n FROM usuario WHERE login LIKE 'f6[_]%'");
    console.log(`Limpeza: usuários de teste restantes = ${restos.n}`);
    await db.fechar();
  }
})().catch(async (e) => {
  console.error('\nFALHOU:', e && e.stack ? e.stack : e);
  try { await limpar(); } catch { /* ignora */ }
  process.exit(1);
});
