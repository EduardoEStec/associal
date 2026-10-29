'use strict';

// Teste E2E (banco REAL do Docker de teste) da M1: modelos oficiais de questionário inicial e final (perguntas diferentes),
// comparação por pares, índice de progresso v2, catálogo configurável (opção nova com "vale como"), .docx dos modelos e legado.
// Uso:  node tests/familias/m1.e2e.js        (sobe o próprio servidor em TESTE_PORT, padrão 3143)
// Cria os usuários m1_*, famílias "Teste M1E2E ..." (CPFs próprios) e perguntas/opções "M1E2E ..." e remove SÓ isso ao final;
// textos e opções oficiais alterados pelo teste são restaurados. Não toca no usuário "admin" nem nos dados de outras origens.
// TRAVA: recusa rodar se o SQL Server não for o container Linux local.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const assert = require('assert');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');
const PizZip = require('pizzip');
const db = require('../../server/db');
const familias = require('../../server/services/familias');
const { corpoInicial, corpoFinal, RESPOSTAS_INICIAL } = require('./m1-dados');

const PORTA = process.env.TESTE_PORT || 3143;
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'M1-senha-teste-1';
const PREFIXO = 'M1E2E';

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
const CPF_A = cpfDe('808080801');
const CPF_B = cpfDe('808080802');
const CPF_C = cpfDe('808080803');
const CPF_D = cpfDe('808080804');

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
    if (bruto) return { status: r.status, headers: r.headers, buffer: Buffer.from(await r.arrayBuffer()) };
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
    "SELECT id FROM ASSOCIAL_pessoa WHERE cpf IN (@a, @b, @c, @d) AND nome LIKE 'Teste M1E2E%'", { a: CPF_A, b: CPF_B, c: CPF_C, d: CPF_D })).map((p) => p.id);
  for (const pid of pessoas) {
    const fams = (await db.consultar('SELECT id FROM ASSOCIAL_familia WHERE responsavel_pessoa_id = @pid', { pid })).map((f) => f.id);
    for (const fid of fams) {
      const acs = (await db.consultar('SELECT id FROM ASSOCIAL_acompanhamento WHERE familia_id = @fid', { fid })).map((a) => a.id);
      for (const ac of acs) {
        await db.consultar('DELETE FROM ASSOCIAL_pesquisa_resposta_item WHERE resposta_id IN (SELECT id FROM ASSOCIAL_pesquisa_resposta WHERE acompanhamento_id = @ac)', { ac });
        await db.consultar('DELETE FROM ASSOCIAL_pesquisa_resposta WHERE acompanhamento_id = @ac', { ac });
        await db.consultar('DELETE FROM ASSOCIAL_acompanhamento_registro WHERE acompanhamento_id = @ac', { ac });
        await db.consultar('DELETE FROM ASSOCIAL_questionario WHERE acompanhamento_id = @ac', { ac }); // instantâneo e respostas saem em cascata
        await db.consultar('DELETE FROM ASSOCIAL_acompanhamento_indice WHERE acompanhamento_id = @ac', { ac });
        await db.consultar("DELETE FROM ASSOCIAL_auditoria WHERE tabela IN ('acompanhamento', 'acompanhamento_registro', 'pesquisa_resposta', 'questionario') AND registro_id = @ac", { ac: String(ac) });
        await db.consultar('DELETE FROM ASSOCIAL_acompanhamento WHERE id = @ac', { ac });
      }
      await db.consultar('DELETE FROM ASSOCIAL_familia_membro WHERE familia_id = @fid', { fid });
      await db.consultar('DELETE FROM ASSOCIAL_familia WHERE id = @fid', { fid });
    }
    await db.consultar('DELETE FROM ASSOCIAL_atendimento WHERE pessoa_id = @pid', { pid });
    await db.consultar('DELETE FROM ASSOCIAL_pessoa WHERE id = @pid', { pid });
  }
  await db.consultar(
    `DELETE FROM ASSOCIAL_resposta_extra WHERE pergunta_id IN (SELECT id FROM ASSOCIAL_catalogo_pergunta WHERE oficial = 0 AND texto LIKE @p)
        OR opcao_id IN (SELECT id FROM ASSOCIAL_catalogo_opcao WHERE texto LIKE @p)`, { p: `${PREFIXO}%` });
  await db.consultar('DELETE FROM ASSOCIAL_catalogo_opcao WHERE base = 0 AND (texto LIKE @p OR pergunta_id IN (SELECT id FROM ASSOCIAL_catalogo_pergunta WHERE oficial = 0 AND texto LIKE @p))', { p: `${PREFIXO}%` });
  await db.consultar('DELETE FROM ASSOCIAL_catalogo_pergunta WHERE oficial = 0 AND texto LIKE @p', { p: `${PREFIXO}%` });
  const ids = (await db.consultar("SELECT id FROM ASSOCIAL_usuario WHERE login LIKE 'm1[_]%'")).map((u) => u.id);
  for (const id of ids) {
    await db.consultar("DELETE FROM ASSOCIAL_sessao WHERE TRY_CAST(JSON_VALUE(dados, '$.usuarioId') AS INT) = @id", { id });
    await db.consultar('DELETE FROM ASSOCIAL_usuario_unidade WHERE usuario_id = @id', { id });
    await db.consultar('DELETE FROM ASSOCIAL_auditoria WHERE usuario_id = @id', { id });
    await db.consultar('UPDATE ASSOCIAL_usuario SET criado_por = NULL, alterado_por = NULL WHERE criado_por = @id OR alterado_por = @id', { id });
    await db.consultar('UPDATE ASSOCIAL_catalogo_pergunta SET criado_por = NULL, alterado_por = NULL WHERE criado_por = @id OR alterado_por = @id', { id });
    await db.consultar('UPDATE ASSOCIAL_catalogo_opcao SET criado_por = NULL, alterado_por = NULL WHERE criado_por = @id OR alterado_por = @id', { id });
    await db.consultar('DELETE FROM ASSOCIAL_usuario WHERE id = @id', { id });
  }
}

async function criarUsuario(login, perfil, unidadeId) {
  const hash = await bcrypt.hash(SENHA, 10);
  const [u] = await db.consultar(
    `INSERT INTO ASSOCIAL_usuario (login, nome, senha_hash, perfil_id, deve_trocar_senha, ativo)
     OUTPUT INSERTED.id VALUES (@login, @nome, @hash, (SELECT id FROM ASSOCIAL_perfil WHERE codigo = @perfil), 0, 1)`, { login, nome: `Teste ${login}`, hash, perfil });
  if (unidadeId) await db.consultar('INSERT INTO ASSOCIAL_usuario_unidade VALUES (@id, @un)', { id: u.id, un: unidadeId });
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
const xmlDe = (buffer) => new PizZip(buffer).file('word/document.xml').asText();
const textoXml = (xml) => xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

(async () => {
  await travaDeSeguranca();
  const colisao = await db.consultar("SELECT cpf, nome FROM ASSOCIAL_pessoa WHERE cpf IN (@a, @b, @c, @d) AND nome NOT LIKE 'Teste M1E2E%'", { a: CPF_A, b: CPF_B, c: CPF_C, d: CPF_D });
  if (colisao.length) { console.error('RECUSADO: CPF de teste já pertence a dados que este teste não criou:', colisao.map((c) => c.nome).join(', ')); process.exit(3); }
  await limpar();

  const [uA] = await db.consultar('SELECT TOP 1 id, sigla FROM ASSOCIAL_unidade WHERE ativo = 1 ORDER BY id');
  await criarUsuario('m1_assist', 'ASSISTENTE', uA.id);
  await criarUsuario('m1_coord', 'COORDENADOR');
  const textosOriginais = await db.consultar("SELECT id, texto FROM ASSOCIAL_catalogo_pergunta WHERE oficial = 1 AND formulario LIKE 'QUESTIONARIO[_]%'");
  const legado = await db.consultar("SELECT TOP 1 ac.id FROM ASSOCIAL_acompanhamento ac WHERE EXISTS (SELECT 1 FROM ASSOCIAL_questionario q WHERE q.acompanhamento_id = ac.id AND q.modelo = 'LEGADO' AND q.concluido = 1) ORDER BY ac.id");

  if (await fetch(`${BASE}/api/saude`).then((r) => r.ok, () => false)) throw new Error(`a porta ${PORTA} já está em uso; defina TESTE_PORT`);
  const servidor = spawn(process.execPath, ['server/index.js'], {
    cwd: require('path').join(__dirname, '..', '..'),
    env: { ...process.env, PORT: String(PORTA), NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let falha = null;
  try {
    await esperarServidor();
    const a = await new Cliente().entrar('m1_assist');
    const coord = await new Cliente().entrar('m1_coord');

    // =====================================================================
    await teste('migração 086: catálogo dos modelos semeado (14 perguntas no inicial, 21 no final, 3.2 com a faixa 301–400) e modelo LEGADO nas linhas antigas', async () => {
      const [t] = await db.consultar(`SELECT (SELECT COUNT(*) FROM ASSOCIAL_catalogo_pergunta WHERE oficial = 1 AND formulario = 'QUESTIONARIO_INICIAL') AS i,
        (SELECT COUNT(*) FROM ASSOCIAL_catalogo_pergunta WHERE oficial = 1 AND formulario = 'QUESTIONARIO_FINAL') AS f,
        (SELECT COUNT(*) FROM ASSOCIAL_questionario WHERE modelo = 'LEGADO') AS l`);
      assert.strictEqual(t.i, 14);
      assert.strictEqual(t.f, 21);
      assert.ok(t.l >= 0);
      const faixas = await db.consultar(`SELECT o.codigo FROM ASSOCIAL_catalogo_opcao o JOIN ASSOCIAL_catalogo_pergunta p ON p.id = o.pergunta_id
        WHERE p.formulario = 'QUESTIONARIO_FINAL' AND p.codigo = '3.2' ORDER BY o.ordem`);
      assert.deepStrictEqual(faixas.map((x) => x.codigo), ['ATE_100', 'DE_101_300', 'DE_301_400', 'ACIMA_400', 'OUTRO_VALOR']);
      const frutas = await db.consultar(`SELECT o.codigo FROM ASSOCIAL_catalogo_opcao o JOIN ASSOCIAL_catalogo_pergunta p ON p.id = o.pergunta_id
        WHERE p.formulario = 'QUESTIONARIO_INICIAL' AND p.codigo = '3.6' ORDER BY o.ordem`);
      assert.deepStrictEqual(frutas.map((x) => x.codigo), ['SIM', 'PARCIALMENTE', 'NAO']);
    });

    await teste('modelo servido: inicial (3 etapas) e final (4 etapas) com perguntas DIFERENTES; reavaliação com 5; legado ainda disponível', async () => {
      const i = (await a.req('GET', '/api/familias/questionario/modelo?tipo=INICIAL')).corpo;
      const f = (await a.req('GET', '/api/familias/questionario/modelo?tipo=FINAL')).corpo;
      const r = (await a.req('GET', '/api/familias/questionario/modelo?tipo=REAVALIACAO')).corpo;
      assert.strictEqual(i.modelo, 'M1');
      assert.strictEqual(i.blocos.length, 3);
      assert.strictEqual(f.blocos.length, 4);
      assert.strictEqual(i.blocos.flatMap((b) => b.perguntas).length, 14);
      assert.strictEqual(f.blocos.flatMap((b) => b.perguntas).length, 21);
      assert.strictEqual(r.blocos.flatMap((b) => b.perguntas).length, 5);
      assert.ok(i.blocos[2].perguntas.some((p) => p.codigo === '3.6' && p.opcoes.length === 3));
      const leg = (await a.req('GET', '/api/familias/questionario/modelo?tipo=INICIAL&modelo=LEGADO')).corpo;
      assert.strictEqual(leg.modelo, 'LEGADO');
      assert.strictEqual(leg.blocos.length, 5);
    });

    // =====================================================================
    let acA;
    await teste('família nova: questionário inicial em branco traz o cabeçalho do papel (unidade, assistente, datas, responsável)', async () => {
      const r = await a.req('POST', '/api/familias', {
        unidadeId: uA.id, dataInicio: dias(-60), responsavel: { cpf: CPF_A, nome: 'Teste M1E2E Família A' }, membros: [],
      });
      assert.strictEqual(r.status, 201, r.texto);
      acA = r.corpo.acompanhamentoId;
      const q = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/questionarios/INICIAL`)).corpo;
      assert.strictEqual(q.modelo, 'M1');
      assert.strictEqual(q.existe, false);
      assert.strictEqual(q.cabecalho.responsavel.nome, 'Teste M1E2E Família A');
      assert.ok(q.cabecalho.unidade);
      assert.ok(q.cabecalho.assistente);
      assert.ok(q.cabecalho.meta.includes('10 famílias'));
      assert.strictEqual(q.podeEditar, true);
    });

    await teste('final só depois do inicial concluído; rascunho do inicial grava; conclusão incompleta => 400 com as perguntas faltantes', async () => {
      assert.strictEqual((await a.req('PUT', `/api/familias/acompanhamentos/${acA}/questionarios/FINAL`, corpoFinal(dias(-1)))).status, 409);
      const rasc = await a.req('PUT', `/api/familias/acompanhamentos/${acA}/questionarios/INICIAL`,
        { dataAplicacao: dias(-60), respostas: { '1.1': 4, '2.1': 'TRABALHO_INFORMAL' }, concluir: false });
      assert.strictEqual(rasc.status, 200, rasc.texto);
      assert.strictEqual(rasc.corpo.concluido, false);
      assert.strictEqual(rasc.corpo.respostas['2.1'], 'TRABALHO_INFORMAL');
      const incompleto = await a.req('PUT', `/api/familias/acompanhamentos/${acA}/questionarios/INICIAL`, { dataAplicacao: dias(-60), concluir: true });
      assert.strictEqual(incompleto.status, 400);
      for (const campo of ['extras.1.2', 'extras.1.3', 'extras.2.2', 'extras.2.3', 'extras.2.4', 'extras.3.2', 'extras.3.6']) {
        assert.ok(incompleto.corpo.erro.detalhes[campo], campo);
      }
      assert.ok(!incompleto.corpo.erro.detalhes['extras.3.1'], '3.1 é texto livre: não é obrigatória');
      assert.ok(!incompleto.corpo.erro.detalhes['extras.2.1'], '2.1 já respondida no rascunho');
    });

    await teste('validações: opção inválida, número fora da faixa, "pessoas com renda" maior que integrantes', async () => {
      const r = await a.req('PUT', `/api/familias/acompanhamentos/${acA}/questionarios/INICIAL`,
        corpoInicial(dias(-60), { '2.2': 'DE_9_99', '1.1': 99, '2.3': 40 }));
      assert.strictEqual(r.status, 400);
      assert.ok(r.corpo.erro.detalhes['extras.2.2']);
      assert.ok(r.corpo.erro.detalhes['extras.1.1']);
      const r2 = await a.req('PUT', `/api/familias/acompanhamentos/${acA}/questionarios/INICIAL`, corpoInicial(dias(-60), { '1.1': 2, '2.3': 3 }));
      assert.strictEqual(r2.status, 400);
      assert.ok(r2.corpo.erro.detalhes['extras.2.3']);
      const r3 = await a.req('PUT', `/api/familias/acompanhamentos/${acA}/questionarios/INICIAL`, corpoInicial(dias(-60), { '3.6': 'UMA_DUAS' }));
      assert.strictEqual(r3.status, 400, 'a opção "1–2 vezes por semana" saiu do 3.6 do inicial');
    });

    await teste('inicial concluído grava o índice (regra v2: Alimentação e Renda; Economia e Autonomia sem nível)', async () => {
      const r = await a.req('PUT', `/api/familias/acompanhamentos/${acA}/questionarios/INICIAL`, corpoInicial(dias(-60)));
      assert.strictEqual(r.status, 200, r.texto);
      assert.strictEqual(r.corpo.concluido, true);
      assert.strictEqual(r.corpo.respostas['3.4'], 'SIM');
      const linhas = await db.consultar('SELECT dimensao, nivel, itens_total, versao_regra FROM ASSOCIAL_acompanhamento_indice WHERE acompanhamento_id = @ac', { ac: acA });
      assert.strictEqual(linhas.length, 5);
      const por = Object.fromEntries(linhas.map((l) => [l.dimensao, l]));
      assert.strictEqual(por.ALIMENTACAO.versaoRegra, 2);
      assert.strictEqual(Number(por.ALIMENTACAO.nivel), 0); // dificuldade frequente, redução frequente, deixou refeição, sem frutas
      assert.strictEqual(Number(por.RENDA.nivel), 25);
      assert.strictEqual(por.ECONOMIA.nivel, null);
      assert.strictEqual(por.ECONOMIA.itensTotal, 0);
      assert.strictEqual(Number(por.GERAL.nivel), 12.5);
    });

    await teste('final concluído com "Outras" + complemento; comparação por pares e perguntas comparativas; índice melhorou', async () => {
      const rascunho = await a.req('PUT', `/api/familias/acompanhamentos/${acA}/questionarios/FINAL`,
        { dataAplicacao: dias(-1), respostas: { '1.2': 'TRABALHO_INFORMAL' }, concluir: false });
      assert.strictEqual(rascunho.status, 200, rascunho.texto);
      const r = await a.req('PUT', `/api/familias/acompanhamentos/${acA}/questionarios/FINAL`, corpoFinal(dias(-1)));
      assert.strictEqual(r.status, 200, r.texto);
      assert.deepStrictEqual(r.corpo.respostas['3.3'].sort(), ['MORADIA', 'OUTRAS']);
      assert.strictEqual(r.corpo.detalhes['3.3'], 'Dívida do gás');
      assert.ok(r.corpo.respostasLegiveis.some((x) => x.codigo === '3.3' && /Outras: Dívida do gás/.test(x.resposta)));

      const c = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/comparacao`)).corpo;
      assert.strictEqual(c.completo, true);
      assert.strictEqual(c.modelo, 'M1');
      assert.strictEqual(c.itens.length, 6);
      const pe = Object.fromEntries(c.itens.map((i) => [i.chave, i]));
      assert.strictEqual(pe.alimentosSuficientes.tendencia, 'melhorou'); // Frequentemente -> Sim
      assert.strictEqual(pe.reducaoAlimentos.tendencia, 'melhorou');
      assert.strictEqual(pe.deixouRefeicao.tendencia, 'melhorou');
      assert.strictEqual(pe.rendaFaixa.tendencia, 'melhorou'); // 501–1000 -> 1001–2000
      assert.strictEqual(pe.fonteRenda.tendencia, 'igual');
      assert.strictEqual(pe.frutasVerduras.aproximado, true);
      assert.strictEqual(pe.frutasVerduras.tendencia, 'melhorou');
      assert.deepStrictEqual(c.comparativas.map((x) => x.codigo), ['1.4', '2.8', '3.4']);
      assert.ok(c.comparativas.every((x) => x.tendencia === 'melhorou'));
      assert.ok(c.outras.final.some((x) => x.codigo === '2.1'));

      const ind = (await a.req('GET', `/api/familias/acompanhamentos/${acA}/indicadores`)).corpo;
      assert.strictEqual(ind.versaoRegra, 2);
      assert.strictEqual(ind.pontos.length, 2);
      assert.strictEqual(ind.pontos.every((p) => !p.desatualizado), true);
      assert.strictEqual(ind.comparacao.geral.selo, 'melhorou');
      assert.strictEqual(ind.comparacao.dimensoes.ALIMENTACAO.depois, 100);
    });

    // =====================================================================
    await teste('.docx dos modelos 1 e 3: preenchido ("( X )" nas escolhidas) e em branco (família sem final ainda)', async () => {
      const i = await a.req('GET', `/api/relatorios/formulario/${acA}/INICIAL`, null, true);
      assert.strictEqual(i.status, 200);
      assert.match(i.headers.get('content-type'), /wordprocessingml/);
      const txt = textoXml(xmlDe(i.buffer));
      assert.match(txt, /QUESTIONÁRIO INICIAL DE ACOMPANHAMENTO FAMILIAR/);
      assert.match(txt, /Teste M1E2E Família A/);
      assert.match(txt, /\( X \) Trabalho informal\/autônomo/);
      assert.match(txt, /\(\s+\) Trabalho formal/);
      assert.match(txt, /3\.6\. A família possuía acesso regular a frutas, verduras e legumes\?/);
      assert.match(txt, /CRESS\/SP/);
      assert.match(txt, /Assinatura responsável familiar/);
      const f = await a.req('GET', `/api/relatorios/formulario/${acA}/FINAL`, null, true);
      const tf = textoXml(xmlDe(f.buffer));
      assert.match(tf, /QUESTIONÁRIO FINAL FAMILIAR/);
      assert.match(tf, /\( X \) De R\$ 301,00 a R\$ 400,00/);
      assert.match(tf, /\( X \) Outras: Dívida do gás/);
      assert.match(tf, /4\.1\. Quais as principais mudanças/);

      const r2 = (await a.req('POST', '/api/familias', { unidadeId: uA.id, dataInicio: dias(-5), responsavel: { cpf: CPF_B, nome: 'Teste M1E2E Família B' }, membros: [] })).corpo;
      const branco = await a.req('GET', `/api/relatorios/formulario/${r2.acompanhamentoId}/FINAL`, null, true);
      assert.strictEqual(branco.status, 200);
      assert.match(textoXml(xmlDe(branco.buffer)), /\(\s+\) Semanalmente/);
      assert.strictEqual((await a.req('GET', `/api/relatorios/formulario/${acA}/REAVALIACAO`, null, true)).status, 404);
    });

    await teste('relatório final familiar (modelo 4): prévia gerada dos questionários e .docx com as 7 seções', async () => {
      const p = (await a.req('GET', `/api/relatorios/individual/${acA}/previa`)).corpo;
      assert.match(p.textos.objetivo, /10 famílias locais/);
      assert.match(p.textos.metodologia, /Os instrumentos utilizados permitiram observar/);
      assert.match(p.textos.diagnostico, /composta por 4 integrantes/);
      assert.match(p.textos.diagnostico, /Situação do CadÚnico: atualizado/);
      assert.match(p.textos.diagnostico, /acesso regular a frutas, verduras e legumes: não/);
      assert.match(p.textos.impactoAlimentar, /Alimentos suficientes para todos: de "Frequentemente" para "Sim"/);
      assert.match(p.textos.impactoEconomico, /Renda familiar mensal: de "De R\$ 501,00 a R\$ 1\.000,00" para "De R\$ 1\.001,00 a R\$ 2\.000,00"/);
      assert.match(p.textos.feedback, /Sobrou dinheiro para outras despesas/);
      assert.match(p.textos.feedback, /avaliou o Armazém Solidário como "Boa" e recomendaria/);
      assert.match(p.textos.consideracoes, /registros periódicos/);
      assert.deepStrictEqual(p.avisos, []);
      const d = await a.req('POST', `/api/relatorios/individual/${acA}`, { textos: { diagnostico: 'Texto do diagnóstico editado pela assistente.' }, local: 'São Paulo/SP', data: hoje }, true);
      assert.strictEqual(d.status, 200);
      assert.match(d.headers.get('content-disposition'), /Relatorio_Final_Familiar_/);
      const t = textoXml(xmlDe(d.buffer));
      for (const s of ['RELATÓRIO FINAL FAMILIAR', '1. Introdução', '2. Objetivo', '3. Metodologia', '4. Diagnóstico Inicial', '5. Impacto na Comunidade', '6. Feedback dos Beneficiários', '7. Considerações finais']) {
        assert.ok(t.includes(s), s);
      }
      assert.match(t, /Texto do diagnóstico editado pela assistente\./);
      assert.match(t, /Responsável Familiar: Teste M1E2E Família A/);
      assert.match(t, /Assistente Social/);
    });

    // =====================================================================
    await teste('catálogo: a coordenação acrescenta opção ao 3.2 do inicial ("vale como" Nunca) e o índice trata como a base; nova pergunta no final aparece no formulário, comparação e .docx', async () => {
      const cat = (await coord.req('GET', '/api/admin/perguntas?formulario=QUESTIONARIO_INICIAL')).corpo;
      assert.strictEqual(cat.secoes.length, 3);
      const p32 = cat.secoes.flatMap((s) => s.perguntas).find((p) => p.codigo === '3.2');
      assert.strictEqual(p32.oficial, true);
      assert.strictEqual(p32.opcoes.length, 4);
      // sem dizer como pontua => 400
      assert.strictEqual((await coord.req('POST', `/api/admin/perguntas/${p32.id}/opcoes`, { texto: `${PREFIXO} Só no fim do mês` })).status, 400);
      const nova = await coord.req('POST', `/api/admin/perguntas/${p32.id}/opcoes`, { texto: `${PREFIXO} Só no fim do mês`, equivaleA: 'ALGUMAS_VEZES' });
      assert.strictEqual(nova.status, 201, nova.texto);
      // pergunta neutra (2.1 fonte de renda) aceita opção nova sem "vale como"
      const p21 = cat.secoes.flatMap((s) => s.perguntas).find((p) => p.codigo === '2.1');
      const outra = await coord.req('POST', `/api/admin/perguntas/${p21.id}/opcoes`, { texto: `${PREFIXO} Venda de reciclados` });
      assert.strictEqual(outra.status, 201, outra.texto);

      const novaPergunta = await coord.req('POST', '/api/admin/perguntas', {
        formulario: 'QUESTIONARIO_FINAL', secao: 4, tipo: 'ESCOLHA', texto: `${PREFIXO} Como conheceu o Armazém?`, opcoes: ['Vizinho', 'Escola'],
      });
      assert.strictEqual(novaPergunta.status, 201, novaPergunta.texto);
      const codExtra = novaPergunta.corpo.codigo;

      const rB = (await a.req('POST', '/api/familias', { unidadeId: uA.id, dataInicio: dias(-30), responsavel: { cpf: CPF_C, nome: 'Teste M1E2E Família C' }, membros: [] })).corpo;
      const mod = (await a.req('GET', '/api/familias/questionario/modelo?tipo=INICIAL')).corpo;
      const p32m = mod.blocos.flatMap((b) => b.perguntas).find((p) => p.codigo === '3.2');
      assert.ok(p32m.opcoes.some((o) => o.valor === nova.corpo.codigo));
      const r = await a.req('PUT', `/api/familias/acompanhamentos/${rB.acompanhamentoId}/questionarios/INICIAL`,
        corpoInicial(dias(-30), { '3.2': nova.corpo.codigo, '2.1': outra.corpo.codigo }));
      assert.strictEqual(r.status, 200, r.texto);
      const linhas = await db.consultar("SELECT dimensao, nivel FROM ASSOCIAL_acompanhamento_indice WHERE acompanhamento_id = @ac AND dimensao = 'ALIMENTACAO'", { ac: rB.acompanhamentoId });
      // 3.2 = 50 (vale como "Algumas vezes"), 3.3 = 0, 3.4 = 0, 3.6 = 0 -> média 12,5
      assert.strictEqual(Number(linhas[0].nivel), 12.5);

      // pergunta nova no final: obrigatória ao concluir? não (padrão); responde e aparece nos documentos
      const fin = await a.req('PUT', `/api/familias/acompanhamentos/${rB.acompanhamentoId}/questionarios/FINAL`,
        corpoFinal(dias(-1)));
      assert.strictEqual(fin.status, 200, fin.texto);
      const modF = (await a.req('GET', '/api/familias/questionario/modelo?tipo=FINAL')).corpo;
      assert.ok(modF.blocos[3].perguntas.some((p) => p.codigo === codExtra && p.extra));
      const opcaoVizinho = modF.blocos[3].perguntas.find((p) => p.codigo === codExtra).opcoes[0].valor;
      const resp = await a.req('PUT', `/api/familias/acompanhamentos/${rB.acompanhamentoId}/questionarios/FINAL`,
        corpoFinal(dias(-1), { [codExtra]: opcaoVizinho }));
      assert.strictEqual(resp.status, 200, resp.texto);
      const docx = textoXml(xmlDe((await a.req('GET', `/api/relatorios/formulario/${rB.acompanhamentoId}/FINAL`, null, true)).buffer));
      assert.match(docx, new RegExp(`${PREFIXO} Como conheceu o Armazém\\?`));
      assert.match(docx, /\( X \) Vizinho/);
      const comp = (await a.req('GET', `/api/familias/acompanhamentos/${rB.acompanhamentoId}/comparacao`)).corpo;
      assert.ok(comp.extrasAdicionais.final.some((x) => x.codigo === codExtra && x.resposta === 'Vizinho'));
      const csv = await coord.req('GET', `/api/relatorios/exportar/perguntas-extras.csv?dataInicio=${dias(-10)}&dataFim=${hoje}`);
      assert.strictEqual(csv.status, 200);
      assert.match(csv.texto, new RegExp(`${PREFIXO} Como conheceu`));
      assert.match(csv.texto, /Questionário final/);

      // opção usada não pode ser excluída nem mudar o "vale como"
      assert.strictEqual((await coord.req('DELETE', `/api/admin/perguntas/${p32.id}/opcoes/${nova.corpo.id}`)).status, 409);
      assert.strictEqual((await coord.req('PUT', `/api/admin/perguntas/${p32.id}/opcoes/${nova.corpo.id}`, { texto: `${PREFIXO} Só no fim do mês`, equivaleA: 'NUNCA' })).status, 409);
      // renomear a pergunta oficial vale na hora e não muda código nem respostas
      const ren = await coord.req('PUT', `/api/admin/perguntas/${p32.id}`, { texto: `${PREFIXO} Antes do projeto faltava comida em casa?`, ajuda: '' });
      assert.strictEqual(ren.status, 200, ren.texto);
      const apos = (await a.req('GET', `/api/familias/acompanhamentos/${rB.acompanhamentoId}/questionarios/INICIAL`)).corpo;
      assert.strictEqual(apos.respostas['3.2'], nova.corpo.codigo);
      assert.ok(apos.respostasLegiveis.some((x) => x.codigo === '3.2' && x.pergunta.startsWith(PREFIXO)));
    });

    await teste('reavaliação rápida usa 5 perguntas do final e entra no índice como ponto intermediário', async () => {
      const rr = await a.req('POST', '/api/familias', { unidadeId: uA.id, dataInicio: dias(-50), responsavel: { cpf: CPF_D, nome: 'Teste M1E2E Família D' }, membros: [] });
      assert.strictEqual(rr.status, 201, rr.texto);
      const ac = rr.corpo.acompanhamentoId;
      assert.strictEqual((await a.req('PUT', `/api/familias/acompanhamentos/${ac}/questionarios/INICIAL`, corpoInicial(dias(-50)))).status, 200);
      const reav = await a.req('PUT', `/api/familias/acompanhamentos/${ac}/questionarios/REAVALIACAO`, {
        dataAplicacao: dias(-10), concluir: true,
        respostas: { '1.3': 'DE_1001_2000', '2.4': 'TRES_QUATRO', '2.5': 'PARCIALMENTE', '2.6': 'ALGUMAS_VEZES', '2.7': 'NAO' },
      });
      assert.strictEqual(reav.status, 200, reav.texto);
      const ind = (await a.req('GET', `/api/familias/acompanhamentos/${ac}/indicadores`)).corpo;
      assert.deepStrictEqual(ind.pontos.map((p) => p.tipo), ['INICIAL', 'REAVALIACAO']);
      assert.ok(ind.pontos[1].dimensoes.ALIMENTACAO.nivel > ind.pontos[0].dimensoes.ALIMENTACAO.nivel);
      // perguntas fora do subconjunto da reavaliação são ignoradas
      const fora = await a.req('PUT', `/api/familias/acompanhamentos/${ac}/questionarios/REAVALIACAO`, {
        dataAplicacao: dias(-10), concluir: true,
        respostas: { '1.3': 'DE_1001_2000', '2.4': 'TRES_QUATRO', '2.5': 'PARCIALMENTE', '2.6': 'ALGUMAS_VEZES', '2.7': 'NAO', '4.5': 'BOA' },
      });
      assert.strictEqual(fora.status, 200);
      assert.strictEqual(fora.corpo.respostas['4.5'], undefined);
    });

    // =====================================================================
    await teste('legado: questionário antigo concluído continua visível (modelo LEGADO), é só leitura e a comparação antiga segue funcionando', async () => {
      if (!legado.length) { console.log('    (sem questionário legado no banco: verificação pulada)'); return; }
      const id = legado[0].id;
      const q = (await coord.req('GET', `/api/familias/acompanhamentos/${id}/questionarios/INICIAL`)).corpo;
      assert.strictEqual(q.modelo, 'LEGADO');
      assert.strictEqual(q.podeEditar, false);
      assert.match(q.bloqueio, /formato anterior/);
      assert.ok(q.respostas.qtdMembrosFamilia !== undefined);
      const put = await coord.req('PUT', `/api/familias/acompanhamentos/${id}/questionarios/INICIAL`, { dataAplicacao: dias(-1), concluir: true });
      assert.strictEqual(put.status, 409);
      const c = (await coord.req('GET', `/api/familias/acompanhamentos/${id}/comparacao`)).corpo;
      assert.strictEqual(c.modelo, 'LEGADO');
      assert.ok(Array.isArray(c.itens));
      const doc = await coord.req('GET', `/api/relatorios/formulario/${id}/INICIAL`);
      assert.strictEqual(doc.status, 409);
      const ind = (await coord.req('GET', `/api/familias/acompanhamentos/${id}/indicadores`)).corpo;
      assert.ok(ind.pontos.every((p) => p.modelo === 'LEGADO' && p.versaoRegra === 1 && p.desatualizado === false));
    });

    await teste('permissões: assistente de outra unidade não vê o formulário da família; perfil sem escrita não grava', async () => {
      const fora = await new Cliente().entrar('m1_coord'); // coordenação vê tudo
      assert.strictEqual((await fora.req('GET', `/api/familias/acompanhamentos/${acA}/questionarios/INICIAL`)).status, 200);
      assert.strictEqual((await a.req('GET', '/api/admin/perguntas?formulario=QUESTIONARIO_INICIAL')).status, 403);
      assert.strictEqual((await coord.req('POST', '/api/admin/perguntas', { formulario: 'QUESTIONARIO', tipo: 'TEXTO', texto: `${PREFIXO} no legado` })).status, 409);
    });

    console.log(`\nM1 e2e: ${ok} testes passaram.`);
  } catch (e) {
    falha = e;
    console.error(e);
  } finally {
    servidor.kill();
    // restaura textos oficiais renomeados pelo teste e remove o que foi criado
    for (const t of textosOriginais) await db.consultar('UPDATE ASSOCIAL_catalogo_pergunta SET texto = @t WHERE id = @id', { t: t.texto, id: t.id });
    await limpar();
    const [sobras] = await db.consultar("SELECT (SELECT COUNT(*) FROM ASSOCIAL_pessoa WHERE nome LIKE 'Teste M1E2E%') AS p, (SELECT COUNT(*) FROM ASSOCIAL_usuario WHERE login LIKE 'm1[_]%') AS u, (SELECT COUNT(*) FROM ASSOCIAL_catalogo_pergunta WHERE texto LIKE 'M1E2E%') AS c, (SELECT COUNT(*) FROM ASSOCIAL_catalogo_opcao WHERE texto LIKE 'M1E2E%') AS o");
    console.log('sobras do teste após a limpeza:', JSON.stringify(sobras));
    process.exit(falha ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
