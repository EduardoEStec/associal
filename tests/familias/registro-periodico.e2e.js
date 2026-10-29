'use strict';

// Teste E2E (banco REAL do Docker de teste) do M1 — registro periódico (modelo oficial 2): mês de referência, uso do Armazém,
// orientações, frases-sugestão, fotos com data (só com o aceite da família) e o .docx.
// Uso:  node tests/familias/registro-periodico.e2e.js        (sobe o próprio servidor em TESTE_PORT, padrão 3142)
// Cria só dados com prefixo exclusivo (usuários rp_*, nome "Teste RPERIODICO", itens de lista "RPERIODICO...") e remove ao final.
// TRAVA: recusa rodar se o SQL Server não for o container Linux local.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');
const PizZip = require('pizzip');
const db = require('../../server/db');
const config = require('../../server/config');
const familias = require('../../server/services/familias');

const PORTA = process.env.TESTE_PORT || 3142;
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'RP-senha-teste-1';
const PREFIXO = 'Teste RPERIODICO';

// CPF válido gerado a partir de uma base própria (nunca CPF de exemplo)
function cpfDe(base9) {
  const dv = (d) => ((d.reduce((s, x, i) => s + x * (d.length + 1 - i), 0) * 10) % 11) % 10;
  const d = base9.split('').map(Number); d.push(dv(d)); d.push(dv(d)); return d.join('');
}
const CPF_A = cpfDe('808080811');
const CPF_B = cpfDe('808080812');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABvrngfAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAC8BQPQ1QvYjAAAAABJRU5ErkJggg==', 'base64');

class Cliente {
  constructor() { this.cookie = ''; }
  async bruto(metodo, url, opcoes = {}) {
    const r = await fetch(BASE + url, { method: metodo, headers: { 'X-Requested-With': 'fetch', Cookie: this.cookie, ...(opcoes.headers || {}) }, body: opcoes.body });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    return r;
  }
  async req(metodo, url, corpo) {
    const r = await this.bruto(metodo, url, corpo ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) } : {});
    const txt = await r.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch { /* não é JSON */ }
    return { status: r.status, corpo: json, headers: r.headers };
  }
  async enviarFoto(url, { arquivo = PNG, tipo = 'image/png', nome = 'foto.png', legenda = '', data } = {}) {
    const f = new FormData();
    f.append('fotos', new Blob([arquivo], { type: tipo }), nome);
    f.append('legendas', legenda);
    f.append('datas', data || '');
    const r = await this.bruto('POST', url, { body: f });
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
  const pessoas = (await db.consultar('SELECT id FROM ASSOCIAL_pessoa WHERE cpf IN (@a, @b) AND nome LIKE @prefixo', { a: CPF_A, b: CPF_B, prefixo: `${PREFIXO}%` })).map((p) => p.id);
  for (const pid of pessoas) {
    const fams = (await db.consultar('SELECT id FROM ASSOCIAL_familia WHERE responsavel_pessoa_id = @pid', { pid })).map((f) => f.id);
    for (const fid of fams) {
      const acs = (await db.consultar('SELECT id FROM ASSOCIAL_acompanhamento WHERE familia_id = @fid', { fid })).map((a) => a.id);
      for (const ac of acs) {
        const arquivos = await db.consultar(
          'SELECT f.arquivo FROM ASSOCIAL_acompanhamento_registro_foto f JOIN ASSOCIAL_acompanhamento_registro r ON r.id = f.registro_id WHERE r.acompanhamento_id = @ac', { ac });
        for (const f of arquivos) { try { fs.unlinkSync(path.join(config.uploadDir, 'acoes', f.arquivo)); } catch { /* já removido */ } }
        await db.consultar('DELETE FROM ASSOCIAL_acompanhamento_registro WHERE acompanhamento_id = @ac', { ac }); // orientações e fotos em cascata
        await db.consultar('DELETE FROM ASSOCIAL_questionario WHERE acompanhamento_id = @ac', { ac });
        await db.consultar("DELETE FROM ASSOCIAL_auditoria WHERE tabela IN ('acompanhamento', 'acompanhamento_registro') AND registro_id = @ac", { ac: String(ac) });
        await db.consultar('DELETE FROM ASSOCIAL_acompanhamento WHERE id = @ac', { ac });
      }
      await db.consultar('DELETE FROM ASSOCIAL_familia_membro WHERE familia_id = @fid', { fid });
      await db.consultar('DELETE FROM ASSOCIAL_familia WHERE id = @fid', { fid });
    }
    await db.consultar('DELETE FROM ASSOCIAL_atendimento WHERE pessoa_id = @pid', { pid });
    await db.consultar('DELETE FROM ASSOCIAL_pessoa WHERE id = @pid', { pid });
  }
  // itens de lista criados pelo teste (nome com prefixo exclusivo)
  for (const tabela of ['frase_registro', 'orientacao_registro', 'uso_armazem']) {
    await db.consultar(`DELETE FROM ASSOCIAL_${tabela} WHERE nome LIKE 'RPERIODICO%'`);
  }
  const ids = (await db.consultar("SELECT id FROM ASSOCIAL_usuario WHERE login LIKE 'rp[_]%'")).map((u) => u.id);
  for (const id of ids) {
    await db.consultar("DELETE FROM ASSOCIAL_sessao WHERE TRY_CAST(JSON_VALUE(dados, '$.usuarioId') AS INT) = @id", { id });
    await db.consultar('DELETE FROM ASSOCIAL_usuario_unidade WHERE usuario_id = @id', { id });
    await db.consultar('DELETE FROM ASSOCIAL_auditoria WHERE usuario_id = @id', { id });
    await db.consultar('UPDATE ASSOCIAL_usuario SET criado_por = NULL, alterado_por = NULL WHERE criado_por = @id OR alterado_por = @id', { id });
    await db.consultar('DELETE FROM ASSOCIAL_usuario WHERE id = @id', { id });
  }
}

async function criarUsuario(login, perfil, unidadeId) {
  const hash = await bcrypt.hash(SENHA, 10);
  const [u] = await db.consultar(
    `INSERT INTO ASSOCIAL_usuario (login, nome, senha_hash, perfil_id, deve_trocar_senha, ativo)
     OUTPUT INSERTED.id VALUES (@login, @nome, @hash, (SELECT id FROM ASSOCIAL_perfil WHERE codigo = @perfil), 0, 1)`, { login, nome: `${login} (${PREFIXO})`, hash, perfil });
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

(async () => {
  await travaDeSeguranca();
  const colisao = await db.consultar('SELECT cpf, nome FROM ASSOCIAL_pessoa WHERE cpf IN (@a, @b) AND nome NOT LIKE @prefixo', { a: CPF_A, b: CPF_B, prefixo: `${PREFIXO}%` });
  if (colisao.length) { console.error('RECUSADO: CPF de teste já pertence a dados que este teste não criou:', colisao.map((c) => c.nome).join(', ')); process.exit(3); }
  await limpar();

  const unidades = await db.consultar('SELECT TOP 2 id, sigla FROM ASSOCIAL_unidade WHERE ativo = 1 ORDER BY id');
  assert.ok(unidades.length >= 2, 'precisa de 2 unidades');
  const [uA, uB] = unidades;
  await criarUsuario('rp_assist_a', 'ASSISTENTE', uA.id);
  await criarUsuario('rp_assist_b', 'ASSISTENTE', uB.id);
  await criarUsuario('rp_coord', 'COORDENADOR');

  if (await fetch(`${BASE}/api/saude`).then((r) => r.ok, () => false)) throw new Error(`a porta ${PORTA} já está em uso; defina TESTE_PORT`);
  const servidor = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, PORT: String(PORTA), NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await esperarServidor();
    const a = await new Cliente().entrar('rp_assist_a');
    const b = await new Cliente().entrar('rp_assist_b');
    const coord = await new Cliente().entrar('rp_coord');

    let acId; let base; let apoio; let regId; let fotoId;
    const mesAtual = hoje.slice(0, 7);

    await teste('apoio: listas do modelo oficial 2 semeadas (uso do Armazém, orientações, frases-sugestão) e tipos de contato', async () => {
      const r = await a.req('GET', '/api/apoio');
      apoio = r.corpo;
      assert.deepStrictEqual(apoio.usoArmazem.map((x) => x.nome), ['Utilizou regularmente', 'Utilizou eventualmente', 'Não utilizou no período']);
      assert.deepStrictEqual(apoio.orientacaoRegistro.map((x) => x.nome), [
        'Orientação sobre CadÚnico', 'Encaminhamento para CRAS/Descomplica', 'Encaminhamento para serviço da rede',
        'Orientação sobre alimentação/nutrição', 'Outros']);
      assert.ok(apoio.orientacaoRegistro.find((x) => x.nome === 'Outros').exigeTexto);
      assert.deepStrictEqual(apoio.fraseRegistro.map((x) => x.nome), [
        'Família realizou atendimento; relatou dificuldade para aquisição de alimentos; recebeu orientação.',
        'Família informou que continua utilizando o Armazém; não houve alteração significativa na renda.',
        'Família relatou redução das despesas com alimentação.',
        'Atendimento realizado; situação familiar mantida.']);
      const tipos = apoio.tipoContato.map((x) => x.nome);
      for (const t of ['Atendimento presencial', 'Visita domiciliar', 'Contato telefônico']) assert.ok(tipos.includes(t), t);
    });

    await teste('P1: a coordenação edita as listas novas (200/201/204); a assistente não (403)', async () => {
      assert.strictEqual((await a.req('GET', '/api/admin/apoio/uso_armazem')).status, 403);
      for (const tabela of ['uso_armazem', 'orientacao_registro', 'frase_registro']) {
        const nome = `RPERIODICO ${tabela}`;
        const c = await coord.req('POST', `/api/admin/apoio/${tabela}`, { nome, ordem: 99 });
        assert.strictEqual(c.status, 201, JSON.stringify(c.corpo));
        const lista = await coord.req('GET', `/api/admin/apoio/${tabela}`);
        assert.strictEqual(lista.status, 200);
        assert.ok(lista.corpo.some((x) => x.nome === nome));
        assert.strictEqual((await coord.req('DELETE', `/api/admin/apoio/${tabela}/${c.corpo.id}`)).status, 204);
      }
      // a frase-sugestão aceita texto longo (até 300 caracteres)
      const longa = `RPERIODICO ${'x'.repeat(250)}`;
      const c = await coord.req('POST', '/api/admin/apoio/frase_registro', { nome: longa, ordem: 98 });
      assert.strictEqual(c.status, 201, JSON.stringify(c.corpo));
      assert.strictEqual((await coord.req('DELETE', `/api/admin/apoio/frase_registro/${c.corpo.id}`)).status, 204);
    });

    await teste('cadastro da família de teste', async () => {
      const r = await a.req('POST', '/api/familias', {
        unidadeId: uA.id, dataInicio: dias(-70), responsavel: { cpf: CPF_A, nome: `${PREFIXO} A`, telefone: '11987650001' }, membros: [],
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      acId = r.corpo.acompanhamentoId;
      base = `/api/familias/acompanhamentos/${acId}`;
    });

    await teste('registro completo (mês, uso, orientações, "Outros", aceite de foto) grava e volta na lista', async () => {
      const lista = (await a.req('GET', `${base}/registros`)).corpo;
      assert.strictEqual(lista.usosArmazem.length, 3);
      assert.strictEqual(lista.orientacoes.length, 5);
      assert.strictEqual(lista.frases.length, 4);
      const visita = lista.tiposContato.find((t) => t.nome === 'Visita domiciliar').id;
      const outros = lista.orientacoes.find((o) => o.nome === 'Outros').id;
      const cadunico = lista.orientacoes.find((o) => o.nome === 'Orientação sobre CadÚnico').id;
      const uso = lista.usosArmazem.find((u) => u.nome === 'Utilizou regularmente').id;
      const r = await a.req('POST', `${base}/registros`, {
        dataRegistro: dias(-5), mesReferencia: dias(-5).slice(0, 7), tipoContatoId: visita, houveContato: true, situacao: 'MELHORANDO',
        resumo: lista.frases[2].nome, usoArmazemId: uso, orientacaoIds: [cadunico, outros], orientacaoOutro: 'Curso de culinária', familiaAceitaFoto: true,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      regId = r.corpo.id;
      const reg = (await a.req('GET', `${base}/registros`)).corpo.registros.find((x) => x.id === regId);
      assert.strictEqual(reg.mesReferencia, `${dias(-5).slice(0, 7)}-01`);
      assert.strictEqual(reg.usoArmazem.nome, 'Utilizou regularmente');
      assert.deepStrictEqual(reg.orientacoes.map((o) => o.nome), ['Orientação sobre CadÚnico', 'Outros']);
      assert.strictEqual(reg.orientacaoOutro, 'Curso de culinária');
      assert.strictEqual(reg.familiaAceitaFoto, true);
      assert.strictEqual(reg.resumo, 'Família relatou redução das despesas com alimentação.');
      assert.deepStrictEqual(reg.fotos, []);
    });

    await teste('validações: uso/orientação fora da lista, "Outros" sem texto, mês futuro ou anterior ao início, aceite inválido', async () => {
      const tipo = (await a.req('GET', `${base}/registros`)).corpo.tiposContato[0].id;
      const dados = { dataRegistro: hoje, tipoContatoId: tipo, houveContato: true, situacao: 'IGUAL', resumo: 'x' };
      const outros = apoio.orientacaoRegistro.find((o) => o.nome === 'Outros').id;
      let r = await a.req('POST', `${base}/registros`, { ...dados, usoArmazemId: 999999 });
      assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.usoArmazemId);
      r = await a.req('POST', `${base}/registros`, { ...dados, orientacaoIds: [999999] });
      assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.orientacaoIds);
      r = await a.req('POST', `${base}/registros`, { ...dados, orientacaoIds: [outros] });
      assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.orientacaoOutro);
      r = await a.req('POST', `${base}/registros`, { ...dados, mesReferencia: '2999-01' });
      assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.mesReferencia);
      r = await a.req('POST', `${base}/registros`, { ...dados, mesReferencia: '2001-01' });
      assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.mesReferencia);
      r = await a.req('POST', `${base}/registros`, { ...dados, familiaAceitaFoto: 'talvez' });
      assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.familiaAceitaFoto);
    });

    await teste('registro antigo/sem os campos novos continua válido: mês = mês da data, sem aceite de foto', async () => {
      const tipo = apoio.tipoContato.find((t) => t.nome === 'Contato telefônico').id;
      const r = await a.req('POST', `${base}/registros`, { dataRegistro: dias(-2), tipoContatoId: tipo, houveContato: true, situacao: 'IGUAL', resumo: 'Ligação rápida.' });
      assert.strictEqual(r.status, 201);
      const reg = (await a.req('GET', `${base}/registros`)).corpo.registros.find((x) => x.id === r.corpo.id);
      assert.strictEqual(reg.mesReferencia, `${dias(-2).slice(0, 7)}-01`);
      assert.strictEqual(reg.usoArmazem, null);
      assert.deepStrictEqual(reg.orientacoes, []);
      assert.strictEqual(reg.familiaAceitaFoto, false);
    });

    await teste('editar: campo ausente não mexe; lista vazia limpa; trocar o uso do Armazém', async () => {
      const lista = (await a.req('GET', `${base}/registros`)).corpo;
      const atual = lista.registros.find((x) => x.id === regId);
      const corpoBase = { dataRegistro: atual.dataRegistro.slice(0, 10), tipoContatoId: atual.tipoContatoId, houveContato: true, situacao: 'MELHORANDO', resumo: 'Revisado.' };
      let r = await a.req('PUT', `${base}/registros/${regId}`, corpoBase); // sem os campos novos
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      let reg = r.corpo.registros.find((x) => x.id === regId);
      assert.strictEqual(reg.usoArmazem.nome, 'Utilizou regularmente');
      assert.strictEqual(reg.orientacoes.length, 2);
      assert.strictEqual(reg.familiaAceitaFoto, true);
      const eventual = lista.usosArmazem.find((u) => u.nome === 'Utilizou eventualmente').id;
      r = await a.req('PUT', `${base}/registros/${regId}`, { ...corpoBase, usoArmazemId: eventual, orientacaoIds: [] });
      reg = r.corpo.registros.find((x) => x.id === regId);
      assert.strictEqual(reg.usoArmazem.nome, 'Utilizou eventualmente');
      assert.deepStrictEqual(reg.orientacoes, []);
      assert.strictEqual(reg.orientacaoOutro, null);
    });

    await teste('fotos: só com o aceite da família, com data; arquivo inválido e data futura recusados', async () => {
      // registro sem aceite => 409
      const tipo = apoio.tipoContato[0].id;
      const semAceite = (await a.req('POST', `${base}/registros`, { dataRegistro: hoje, tipoContatoId: tipo, houveContato: false })).corpo.id;
      let r = await a.enviarFoto(`${base}/registros/${semAceite}/fotos`);
      assert.strictEqual(r.status, 409, JSON.stringify(r.corpo));
      // com aceite
      r = await a.enviarFoto(`${base}/registros/${regId}/fotos`, { legenda: 'Cozinha', data: dias(-5) });
      assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
      fotoId = r.corpo.fotos[0].id;
      assert.ok(r.corpo.fotos[0].url.endsWith(`/registros/${regId}/fotos/${fotoId}`));
      // sem data: vale a data do registro
      r = await a.enviarFoto(`${base}/registros/${regId}/fotos`);
      assert.strictEqual(r.status, 201);
      const reg = (await a.req('GET', `${base}/registros`)).corpo.registros.find((x) => x.id === regId);
      assert.strictEqual(reg.fotos.length, 2);
      assert.strictEqual(reg.fotos[0].legenda, 'Cozinha');
      assert.strictEqual(reg.fotos[0].dataFoto, dias(-5));
      assert.strictEqual(reg.fotos[1].dataFoto, reg.dataRegistro.slice(0, 10));
      // arquivo que não é imagem (mimetype mentiroso) e data futura
      r = await a.enviarFoto(`${base}/registros/${regId}/fotos`, { arquivo: Buffer.from('isto não é uma imagem'), tipo: 'image/png', nome: 'x.png' });
      assert.strictEqual(r.status, 400, JSON.stringify(r.corpo));
      r = await a.enviarFoto(`${base}/registros/${regId}/fotos`, { data: dias(3) });
      assert.strictEqual(r.status, 400, JSON.stringify(r.corpo));
      assert.strictEqual((await a.req('GET', `${base}/registros`)).corpo.registros.find((x) => x.id === regId).fotos.length, 2, 'nada foi gravado nas recusas');
    });

    await teste('foto: leitura autenticada com o arquivo; corrigir a data/legenda; outra unidade 404', async () => {
      const r = await a.bruto('GET', `${base}/registros/${regId}/fotos/${fotoId}`);
      assert.strictEqual(r.status, 200);
      assert.match(r.headers.get('content-type'), /image\/png/);
      assert.ok(Buffer.from(await r.arrayBuffer()).equals(PNG));
      const p = await a.req('PATCH', `${base}/registros/${regId}/fotos/${fotoId}`, { legenda: 'Cozinha limpa', dataFoto: dias(-4) });
      assert.strictEqual(p.status, 200, JSON.stringify(p.corpo));
      assert.strictEqual(p.corpo.dataFoto, dias(-4));
      assert.strictEqual((await a.req('PATCH', `${base}/registros/${regId}/fotos/${fotoId}`, { dataFoto: dias(2) })).status, 400);
      for (const [metodo, url] of [['GET', `${base}/registros/${regId}/fotos/${fotoId}`], ['DELETE', `${base}/registros/${regId}/fotos/${fotoId}`], ['POST', `${base}/registros/${regId}/fotos`]]) {
        assert.strictEqual((await b.req(metodo, url)).status, 404, `${metodo} outra unidade`);
      }
    });

    await teste('desmarcar o aceite com fotos anexadas é recusado; excluir a foto remove o arquivo e libera', async () => {
      const lista = (await a.req('GET', `${base}/registros`)).corpo;
      const atual = lista.registros.find((x) => x.id === regId);
      const corpo = { dataRegistro: atual.dataRegistro.slice(0, 10), tipoContatoId: atual.tipoContatoId, houveContato: true, situacao: 'MELHORANDO', resumo: 'Revisado.' };
      let r = await a.req('PUT', `${base}/registros/${regId}`, { ...corpo, familiaAceitaFoto: false });
      assert.strictEqual(r.status, 400); assert.ok(r.corpo.erro.detalhes.familiaAceitaFoto);
      const arquivos = (await db.consultar('SELECT arquivo FROM ASSOCIAL_acompanhamento_registro_foto WHERE registro_id = @r', { r: regId })).map((x) => x.arquivo);
      assert.strictEqual(arquivos.length, 2);
      for (const f of atual.fotos) assert.strictEqual((await a.req('DELETE', `${base}/registros/${regId}/fotos/${f.id}`)).status, 204);
      for (const arq of arquivos) assert.ok(!fs.existsSync(path.join(config.uploadDir, 'acoes', arq)), 'arquivo removido do disco');
      r = await a.req('PUT', `${base}/registros/${regId}`, { ...corpo, familiaAceitaFoto: false });
      assert.strictEqual(r.status, 200);
      // volta o aceite para os próximos testes
      assert.strictEqual((await a.req('PUT', `${base}/registros/${regId}`, { ...corpo, familiaAceitaFoto: true })).status, 200);
    });

    await teste('linha do tempo mostra o uso do Armazém e as orientações do registro', async () => {
      const lista = (await a.req('GET', `${base}/registros`)).corpo;
      const atual = lista.registros.find((x) => x.id === regId);
      const cadunico = lista.orientacoes.find((o) => o.nome === 'Orientação sobre CadÚnico').id;
      const corpo = { dataRegistro: atual.dataRegistro.slice(0, 10), tipoContatoId: atual.tipoContatoId, houveContato: true, situacao: 'MELHORANDO', resumo: 'Revisado.', orientacaoIds: [cadunico] };
      assert.strictEqual((await a.req('PUT', `${base}/registros/${regId}`, corpo)).status, 200);
      const tl = (await a.req('GET', `${base}/linha-do-tempo?tipos=REGISTRO`)).corpo.itens;
      const ev = tl.find((e) => e.referencia.id === regId);
      assert.match(ev.detalhe, /Armazém: utilizou eventualmente/);
      assert.match(ev.detalhe, /Orientações: Orientação sobre CadÚnico/);
    });

    await teste('.docx do registro periódico: prévia editável, tabela por mês, observações editadas e fotos com data; escopo de unidade', async () => {
      // uma foto para o anexo
      const up = await a.enviarFoto(`${base}/registros/${regId}/fotos`, { legenda: 'Sala', data: dias(-5) });
      assert.strictEqual(up.status, 201);
      const previa = await a.req('GET', `/api/relatorios/registro-periodico/${acId}`);
      assert.strictEqual(previa.status, 200, JSON.stringify(previa.corpo));
      assert.strictEqual(previa.corpo.identificacao.responsavel, `${PREFIXO} A`);
      assert.ok(previa.corpo.registros.length >= 3);
      const mais = previa.corpo.registros.find((x) => x.id === regId);
      assert.match(mais.mes, /^[a-zç]+\/\d{4}$/);
      assert.strictEqual(mais.uso, 'Utilizou eventualmente');
      assert.strictEqual(previa.corpo.fotos.length, 1);
      assert.strictEqual(previa.corpo.fotos[0].data, dias(-5));

      const r = await a.bruto('POST', `/api/relatorios/registro-periodico/${acId}/docx`, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identificacao: { profissional: 'Profissional Editada RPERIODICO' },
          observacoes: { [regId]: 'Observação editada pela assistente RPERIODICO.' },
          fotos: previa.corpo.fotos.map((f) => f.id),
        }),
      });
      assert.strictEqual(r.status, 200);
      assert.match(r.headers.get('content-type'), /wordprocessingml/);
      const zip = new PizZip(Buffer.from(await r.arrayBuffer()));
      const texto = zip.file('word/document.xml').asText().replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
      for (const esperado of ['REGISTRO PERIÓDICO DE ACOMPANHAMENTO', `Responsável Familiar: ${PREFIXO} A`, 'Profissional responsável: Profissional Editada RPERIODICO',
        'Visita domiciliar', 'Utilizou eventualmente', 'Observação editada pela assistente RPERIODICO.', 'Foto 1 –']) assert.ok(texto.includes(esperado), `faltou: ${esperado}`);
      assert.ok(zip.file(/word\/media\/foto_anexo_1\./).length === 1, 'foto incorporada');

      // sem escolher fotos no corpo, vão todas; com lista vazia, nenhuma
      const semFotos = await a.bruto('POST', `/api/relatorios/registro-periodico/${acId}/docx`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fotos: [] }) });
      assert.strictEqual(semFotos.status, 200);
      assert.ok(new PizZip(Buffer.from(await semFotos.arrayBuffer())).file(/word\/media\/foto_anexo_/).length === 0);

      // outra unidade: 404; coordenação (todas as unidades): 200
      assert.strictEqual((await b.req('GET', `/api/relatorios/registro-periodico/${acId}`)).status, 404);
      assert.strictEqual((await b.bruto('POST', `/api/relatorios/registro-periodico/${acId}/docx`, { headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
      assert.strictEqual((await coord.req('GET', `/api/relatorios/registro-periodico/${acId}`)).status, 200);
    });

    await teste('anular o registro tira as fotos de vista (404) e do documento', async () => {
      const fotos = (await a.req('GET', `${base}/registros`)).corpo.registros.find((x) => x.id === regId).fotos;
      assert.strictEqual(fotos.length, 1);
      const an = await a.req('POST', `${base}/registros/${regId}/anular`, { motivo: 'Teste RPERIODICO: registro duplicado' });
      assert.strictEqual(an.status, 200);
      assert.strictEqual((await a.req('GET', `${base}/registros/${regId}/fotos/${fotos[0].id}`)).status, 404);
      assert.strictEqual((await a.req('DELETE', `${base}/registros/${regId}/fotos/${fotos[0].id}`)).status, 404);
      const previa = (await a.req('GET', `/api/relatorios/registro-periodico/${acId}`)).corpo;
      assert.ok(!previa.registros.some((x) => x.id === regId));
      assert.strictEqual(previa.fotos.length, 0);
      // a linha continua no banco (anulação preserva) e a foto também, para a auditoria
      const [{ n }] = await db.consultar('SELECT COUNT(*) AS n FROM ASSOCIAL_acompanhamento_registro_foto WHERE registro_id = @r', { r: regId });
      assert.strictEqual(n, 1);
    });

    console.log(`\n${ok} testes OK`);
  } finally {
    servidor.kill();
    await limpar();
    const restos = await db.consultar("SELECT (SELECT COUNT(*) FROM ASSOCIAL_usuario WHERE login LIKE 'rp[_]%') AS u, (SELECT COUNT(*) FROM ASSOCIAL_pessoa WHERE nome LIKE @p) AS p", { p: `${PREFIXO}%` });
    console.log(`Limpeza: usuários restantes = ${restos[0].u}, pessoas restantes = ${restos[0].p}`);
    await db.fechar();
  }
})().catch(async (e) => {
  console.error('\nFALHOU:', e && e.stack ? e.stack : e);
  try { await limpar(); } catch { /* ignora */ }
  process.exit(1);
});
