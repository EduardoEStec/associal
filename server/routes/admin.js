'use strict';

// Administração: usuários, unidades, tabelas de apoio, configurações, perguntas e opções (P2) e auditoria.
// Montado em /api/admin. Permissões (P1):
//   ADMIN        tudo, e é o ÚNICO que mexe em CONTAS de usuário (criar, editar perfil, desativar, redefinir senha) e vê a auditoria;
//   COORDENADOR  gerencia todo o resto: listas de apoio, unidades, configurações, perguntas e opções;
//   ASSISTENTE   nada aqui (403).

const express = require('express');
const bcrypt = require('bcrypt');
const { consultar, consultarUm, transacao, tipos } = require('../db');
const { requirePerfil } = require('../middlewares/auth');
const { erros } = require('../lib/erros');
const { registrarAuditoria } = require('../lib/auditoria');
const { PERFIS, TABELAS_APOIO } = require('../lib/dominios');
const { texto, lancarSeErros, normalizarData, inteiroPositivo } = require('../lib/validacao');
const svc = require('../services/admin');
const catalogoAdmin = require('../services/catalogo-admin');

const router = express.Router();
const soAdmin = requirePerfil(PERFIS.ADMIN);
const gestao = requirePerfil(PERFIS.COORDENADOR, PERFIS.ADMIN);
router.use(gestao); // o assistente social não entra na Administração; contas e auditoria ainda exigem `soAdmin`
const ehVerdadeiro = (v) => v === true || v === 1 || v === '1' || v === 'true';

function idDaRota(req) {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw erros.naoEncontrado();
  return id;
}

// =====================================================================
// Usuários
// =====================================================================

const SQL_USUARIOS = `
  SELECT u.id, u.login, u.nome, u.email, u.cress, p.codigo AS perfil, u.ativo,
         u.deve_trocar_senha, u.ultimo_login_em, u.criado_em
    FROM ASSOCIAL_usuario u JOIN ASSOCIAL_perfil p ON p.id = u.perfil_id`;

async function unidadesDosUsuarios(ids, executor = { consultar }) {
  const mapa = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return mapa;
  const params = {};
  const marcas = ids.map((id, i) => { params[`u${i}`] = id; return `@u${i}`; });
  const linhas = await executor.consultar(
    `SELECT uu.usuario_id, un.id, un.sigla, un.nome
       FROM ASSOCIAL_usuario_unidade uu JOIN ASSOCIAL_unidade un ON un.id = uu.unidade_id
      WHERE uu.usuario_id IN (${marcas.join(',')}) ORDER BY un.ordem, un.sigla`, params);
  for (const l of linhas) mapa.get(l.usuarioId).push({ id: l.id, sigla: l.sigla, nome: l.nome });
  return mapa;
}

async function carregarUsuario(id, executor = { consultar }) {
  const [u] = await executor.consultar(`${SQL_USUARIOS} WHERE u.id = @id`, { id });
  if (!u) throw erros.naoEncontrado('Usuário não encontrado.');
  u.unidades = (await unidadesDosUsuarios([id], executor)).get(id);
  return u;
}

// Valida o corpo de criação/edição; devolve valores normalizados.
async function validarUsuario(corpo, { criacao }) {
  const problemas = {};
  const nome = texto(corpo.nome, 150);
  if (!nome) problemas.nome = 'Informe o nome.';

  let login;
  if (criacao) {
    login = (texto(corpo.login, 60) || '').toLowerCase();
    if (!/^[a-z0-9._-]{3,60}$/.test(login)) problemas.login = 'Use de 3 a 60 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.';
  }

  const email = texto(corpo.email, 150);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problemas.email = 'E-mail inválido.';

  const perfil = String(corpo.perfil || '').toUpperCase();
  if (!Object.values(PERFIS).includes(perfil)) problemas.perfil = 'Escolha um perfil válido.';

  const cress = texto(corpo.cress, 30);

  const bruto = Array.isArray(corpo.unidadeIds) ? corpo.unidadeIds : [];
  const unidadeIds = [...new Set(bruto.map(inteiroPositivo))];
  if (unidadeIds.includes(null)) problemas.unidadeIds = 'Unidade inválida.';
  else if (perfil === PERFIS.ASSISTENTE && unidadeIds.length === 0) problemas.unidadeIds = 'Vincule ao menos uma unidade ao assistente social.';
  // COORDENADOR/ADMIN veem todas as unidades; o vínculo é ignorado, então não é gravado.
  const unidadesGravar = perfil === PERFIS.ASSISTENTE && !problemas.unidadeIds ? unidadeIds : [];

  if (unidadesGravar.length) {
    const params = {};
    const marcas = unidadesGravar.map((id, i) => { params[`u${i}`] = id; return `@u${i}`; });
    const [{ total }] = await consultar(`SELECT COUNT(*) AS total FROM ASSOCIAL_unidade WHERE id IN (${marcas.join(',')})`, params);
    if (total !== unidadesGravar.length) problemas.unidadeIds = 'Unidade inexistente.';
  }

  lancarSeErros(problemas);
  return { nome, login, email, perfil, cress, unidadeIds: unidadesGravar };
}

async function gravarVinculos(tx, usuarioId, unidadeIds) {
  await tx.consultar('DELETE FROM ASSOCIAL_usuario_unidade WHERE usuario_id = @id', { id: usuarioId });
  for (const unidadeId of unidadeIds) {
    await tx.consultar('INSERT INTO ASSOCIAL_usuario_unidade (usuario_id, unidade_id) VALUES (@id, @unidadeId)', { id: usuarioId, unidadeId });
  }
}

// Garante que sempre reste ao menos um ADMIN ativo depois de `usuarioId` deixar de ser ADMIN ativo.
async function exigirOutroAdminAtivo(tx, usuarioId) {
  const [{ total }] = await tx.consultar(
    `SELECT COUNT(*) AS total FROM ASSOCIAL_usuario u JOIN ASSOCIAL_perfil p ON p.id = u.perfil_id
      WHERE p.codigo = 'ADMIN' AND u.ativo = 1 AND u.id <> @id`, { id: usuarioId });
  if (total === 0) throw erros.conflito('Não é possível: este é o único administrador ativo do sistema.');
}

router.get('/usuarios', soAdmin, async (req, res) => {
  const filtros = ['1 = 1'];
  const params = {};
  const busca = texto(req.query.busca, 100);
  if (busca) { filtros.push('(u.nome LIKE @busca OR u.login LIKE @busca)'); params.busca = `%${busca}%`; }
  if (req.query.perfil) { filtros.push('p.codigo = @perfil'); params.perfil = String(req.query.perfil); }
  if (req.query.ativo !== undefined && req.query.ativo !== '') {
    filtros.push('u.ativo = @ativo'); params.ativo = ehVerdadeiro(req.query.ativo) ? 1 : 0;
  }
  const usuarios = await consultar(`${SQL_USUARIOS} WHERE ${filtros.join(' AND ')} ORDER BY u.ativo DESC, u.nome`, params);
  const mapa = await unidadesDosUsuarios(usuarios.map((u) => u.id));
  for (const u of usuarios) u.unidades = mapa.get(u.id);
  res.json(usuarios);
});

router.get('/usuarios/:id', soAdmin, async (req, res) => {
  res.json(await carregarUsuario(idDaRota(req)));
});

// POST /api/admin/usuarios — cria com senha provisória (exibida UMA vez na resposta).
router.post('/usuarios', soAdmin, async (req, res) => {
  const dados = await validarUsuario(req.body || {}, { criacao: true });
  const senhaProvisoria = svc.gerarSenhaProvisoria();
  const hash = await bcrypt.hash(senhaProvisoria, svc.CUSTO_BCRYPT);

  const id = await transacao(async (tx) => {
    const [existe] = await tx.consultar('SELECT 1 AS x FROM ASSOCIAL_usuario WHERE login = @login', { login: dados.login });
    if (existe) throw erros.validacao({ login: 'Este login já está em uso.' });
    const [novo] = await tx.consultar(
      `INSERT INTO ASSOCIAL_usuario (login, nome, email, senha_hash, perfil_id, cress, deve_trocar_senha, ativo, criado_por)
       OUTPUT INSERTED.id
       VALUES (@login, @nome, @email, @hash, (SELECT id FROM ASSOCIAL_perfil WHERE codigo = @perfil), @cress, 1, 1, @por)`,
      { login: dados.login, nome: dados.nome, email: dados.email, hash, perfil: dados.perfil, cress: dados.cress, por: req.usuario.id });
    await gravarVinculos(tx, novo.id, dados.unidadeIds);
    await registrarAuditoria(req, 'CRIAR', 'usuario', novo.id, { login: dados.login, perfil: dados.perfil }, tx);
    return novo.id;
  });
  res.status(201).json({ id, login: dados.login, senhaProvisoria });
});

router.put('/usuarios/:id', soAdmin, async (req, res) => {
  const id = idDaRota(req);
  const dados = await validarUsuario(req.body || {}, { criacao: false });
  await transacao(async (tx) => {
    const [atual] = await tx.consultar(
      'SELECT p.codigo AS perfil, u.ativo FROM ASSOCIAL_usuario u JOIN ASSOCIAL_perfil p ON p.id = u.perfil_id WHERE u.id = @id', { id });
    if (!atual) throw erros.naoEncontrado('Usuário não encontrado.');
    if (atual.perfil !== dados.perfil) {
      if (id === req.usuario.id) throw erros.conflito('Você não pode alterar o seu próprio perfil.');
      if (atual.perfil === PERFIS.ADMIN && atual.ativo) await exigirOutroAdminAtivo(tx, id);
    }
    const antes = [...(await unidadesDosUsuarios([id], tx)).get(id).map((x) => x.id)].sort().join(',');
    await tx.consultar(
      `UPDATE ASSOCIAL_usuario SET nome = @nome, email = @email, cress = @cress,
              perfil_id = (SELECT id FROM ASSOCIAL_perfil WHERE codigo = @perfil),
              alterado_por = @por, alterado_em = SYSUTCDATETIME()
        WHERE id = @id`,
      { id, nome: dados.nome, email: dados.email, cress: dados.cress, perfil: dados.perfil, por: req.usuario.id });
    await gravarVinculos(tx, id, dados.unidadeIds);
    // mudou perfil ou unidades: o acesso precisa ser reavaliado, então derruba as sessões (menos a própria)
    const mudouAcesso = atual.perfil !== dados.perfil || antes !== [...dados.unidadeIds].sort().join(',');
    const detalhes = { perfil: dados.perfil };
    if (mudouAcesso) detalhes.sessoesEncerradas = await svc.encerrarSessoes(tx, id, id === req.usuario.id ? req.sessionID : undefined);
    await registrarAuditoria(req, 'ALTERAR', 'usuario', id, detalhes, tx);
  });
  res.json(await carregarUsuario(id));
});

// PATCH /api/admin/usuarios/:id/ativo { ativo }
router.patch('/usuarios/:id/ativo', soAdmin, async (req, res) => {
  const id = idDaRota(req);
  const ativo = ehVerdadeiro(req.body?.ativo);
  await transacao(async (tx) => {
    const [atual] = await tx.consultar(
      'SELECT p.codigo AS perfil, u.ativo FROM ASSOCIAL_usuario u JOIN ASSOCIAL_perfil p ON p.id = u.perfil_id WHERE u.id = @id', { id });
    if (!atual) throw erros.naoEncontrado('Usuário não encontrado.');
    if (!ativo) {
      if (id === req.usuario.id) throw erros.conflito('Você não pode desativar o próprio usuário.');
      if (atual.perfil === PERFIS.ADMIN && atual.ativo) await exigirOutroAdminAtivo(tx, id);
    }
    await tx.consultar(
      'UPDATE ASSOCIAL_usuario SET ativo = @ativo, alterado_por = @por, alterado_em = SYSUTCDATETIME() WHERE id = @id',
      { id, ativo: ativo ? 1 : 0, por: req.usuario.id });
    const detalhes = { ativo };
    if (!ativo) detalhes.sessoesEncerradas = await svc.encerrarSessoes(tx, id);
    await registrarAuditoria(req, 'ALTERAR', 'usuario', id, detalhes, tx);
  });
  res.json({ id, ativo });
});

// POST /api/admin/usuarios/:id/redefinir-senha — nova senha provisória, exibida uma única vez.
router.post('/usuarios/:id/redefinir-senha', soAdmin, async (req, res) => {
  const id = idDaRota(req);
  const alvo = await consultarUm('SELECT id FROM ASSOCIAL_usuario WHERE id = @id', { id });
  if (!alvo) throw erros.naoEncontrado('Usuário não encontrado.');
  const senhaProvisoria = svc.gerarSenhaProvisoria();
  const hash = await bcrypt.hash(senhaProvisoria, svc.CUSTO_BCRYPT);
  await transacao(async (tx) => {
    await tx.consultar(
      `UPDATE ASSOCIAL_usuario SET senha_hash = @hash, deve_trocar_senha = 1, alterado_por = @por, alterado_em = SYSUTCDATETIME()
        WHERE id = @id`, { id, hash, por: req.usuario.id });
    // o admin que redefine a PRÓPRIA senha mantém a sessão atual (será levado à troca obrigatória)
    const sessoesEncerradas = await svc.encerrarSessoes(tx, id, id === req.usuario.id ? req.sessionID : undefined);
    await registrarAuditoria(req, 'ALTERAR', 'usuario', id, { campo: 'senha', acao: 'redefinicao', sessoesEncerradas }, tx);
  });
  res.json({ id, senhaProvisoria });
});

// =====================================================================
// Unidades
// =====================================================================

function validarUnidade(corpo) {
  const problemas = {};
  const sigla = (texto(corpo.sigla, 5) || '').toUpperCase();
  if (!/^[A-Z0-9]{2,5}$/.test(sigla)) problemas.sigla = 'Use de 2 a 5 letras ou números.';
  const nome = texto(corpo.nome, 100);
  if (!nome) problemas.nome = 'Informe o nome.';
  const endereco = texto(corpo.endereco, 200);
  const ordem = corpo.ordem === undefined || corpo.ordem === null || corpo.ordem === '' ? 0 : Number(corpo.ordem);
  if (!Number.isInteger(ordem) || ordem < 0 || ordem > 9999) problemas.ordem = 'Informe um número inteiro de 0 a 9999.';
  lancarSeErros(problemas);
  return { sigla, nome, endereco, ordem };
}

const SQL_UNIDADES = 'SELECT id, sigla, nome, endereco, ativo, ordem FROM ASSOCIAL_unidade';

router.get('/unidades', async (req, res) => {
  res.json(await consultar(`${SQL_UNIDADES} ORDER BY ativo DESC, ordem, sigla`));
});

router.post('/unidades', async (req, res) => {
  const d = validarUnidade(req.body || {});
  const id = await transacao(async (tx) => {
    const [dup] = await tx.consultar('SELECT 1 AS x FROM ASSOCIAL_unidade WHERE sigla = @sigla', { sigla: d.sigla });
    if (dup) throw erros.validacao({ sigla: 'Já existe uma unidade com esta sigla.' });
    const [novo] = await tx.consultar(
      `INSERT INTO ASSOCIAL_unidade (sigla, nome, endereco, ordem, criado_por) OUTPUT INSERTED.id
       VALUES (@sigla, @nome, @endereco, @ordem, @por)`, { ...d, por: req.usuario.id });
    await registrarAuditoria(req, 'CRIAR', 'unidade', novo.id, { sigla: d.sigla }, tx);
    return novo.id;
  });
  res.status(201).json({ id });
});

router.put('/unidades/:id', async (req, res) => {
  const id = idDaRota(req);
  const d = validarUnidade(req.body || {});
  await transacao(async (tx) => {
    const [dup] = await tx.consultar('SELECT 1 AS x FROM ASSOCIAL_unidade WHERE sigla = @sigla AND id <> @id', { sigla: d.sigla, id });
    if (dup) throw erros.validacao({ sigla: 'Já existe uma unidade com esta sigla.' });
    const r = await tx.consultar(
      `UPDATE ASSOCIAL_unidade SET sigla = @sigla, nome = @nome, endereco = @endereco, ordem = @ordem,
              alterado_por = @por, alterado_em = SYSUTCDATETIME()
       OUTPUT INSERTED.id WHERE id = @id`, { ...d, id, por: req.usuario.id });
    if (!r.length) throw erros.naoEncontrado('Unidade não encontrada.');
    await registrarAuditoria(req, 'ALTERAR', 'unidade', id, { sigla: d.sigla }, tx);
  });
  res.json(await consultarUm(`${SQL_UNIDADES} WHERE id = @id`, { id }));
});

router.patch('/unidades/:id/ativo', async (req, res) => {
  const id = idDaRota(req);
  const ativo = ehVerdadeiro(req.body?.ativo);
  const r = await consultar(
    `UPDATE ASSOCIAL_unidade SET ativo = @ativo, alterado_por = @por, alterado_em = SYSUTCDATETIME()
     OUTPUT INSERTED.id WHERE id = @id`, { id, ativo: ativo ? 1 : 0, por: req.usuario.id });
  if (!r.length) throw erros.naoEncontrado('Unidade não encontrada.');
  await registrarAuditoria(req, 'ALTERAR', 'unidade', id, { ativo });
  res.json({ id, ativo });
});

// =====================================================================
// Tabelas de apoio (whitelist TABELAS_APOIO)
// =====================================================================

function tabelaApoio(req) {
  if (!TABELAS_APOIO.includes(req.params.tabela)) throw erros.naoEncontrado('Tabela de apoio inexistente.');
  return req.params.tabela;
}

function validarApoio(tabela, corpo) {
  const problemas = {};
  const nome = texto(corpo.nome, tabela === 'frase_registro' ? 300 : 150); // a frase-sugestão do registro é um texto mais longo
  if (!nome) problemas.nome = 'Informe o nome.';
  const ordem = corpo.ordem === undefined || corpo.ordem === null || corpo.ordem === '' ? 0 : Number(corpo.ordem);
  if (!Number.isInteger(ordem) || ordem < 0 || ordem > 9999) problemas.ordem = 'Informe um número inteiro de 0 a 9999.';
  const dados = { nome, ordem, exigeTexto: ehVerdadeiro(corpo.exigeTexto) ? 1 : 0 };
  if (tabela === 'faixa_etaria') {
    const idade = (v, campo) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 130) { problemas[campo] = 'Informe uma idade de 0 a 130.'; return null; }
      return n;
    };
    dados.idadeMin = idade(corpo.idadeMin, 'idadeMin');
    dados.idadeMax = idade(corpo.idadeMax, 'idadeMax');
    if (dados.idadeMin !== null && dados.idadeMax !== null && dados.idadeMin > dados.idadeMax) {
      problemas.idadeMax = 'A idade máxima deve ser maior ou igual à mínima.';
    }
  }
  lancarSeErros(problemas);
  return dados;
}

async function listarApoio(tabela, id) {
  const emUso = await svc.sqlEmUso(tabela, 't');
  const filtro = id ? 'WHERE t.id = @id' : '';
  const cols = svc.colunasApoio(tabela).split(', ').map((c) => `t.${c}`).join(', ');
  return consultar(
    `SELECT ${cols}, CASE WHEN ${emUso} THEN 1 ELSE 0 END AS em_uso FROM ASSOCIAL_${tabela} t ${filtro} ORDER BY t.ativo DESC, t.ordem, t.nome`,
    id ? { id } : {});
}

router.get('/apoio', (req, res) => {
  res.json(TABELAS_APOIO);
});

router.get('/apoio/:tabela', async (req, res) => {
  res.json(await listarApoio(tabelaApoio(req)));
});

router.post('/apoio/:tabela', async (req, res) => {
  const tabela = tabelaApoio(req);
  const d = validarApoio(tabela, req.body || {});
  const id = await transacao(async (tx) => {
    const [dup] = await tx.consultar(`SELECT 1 AS x FROM ASSOCIAL_${tabela} WHERE nome = @nome`, { nome: d.nome });
    if (dup) throw erros.validacao({ nome: 'Já existe uma opção com este nome.' });
    const extra = tabela === 'faixa_etaria' ? { cols: ', idade_min, idade_max', vals: ', @idadeMin, @idadeMax' } : { cols: '', vals: '' };
    const [novo] = await tx.consultar(
      `INSERT INTO ASSOCIAL_${tabela} (nome, ordem, exige_texto${extra.cols}) OUTPUT INSERTED.id VALUES (@nome, @ordem, @exigeTexto${extra.vals})`, d);
    await registrarAuditoria(req, 'CRIAR', tabela, novo.id, { nome: d.nome }, tx);
    return novo.id;
  });
  res.status(201).json({ id });
});

router.put('/apoio/:tabela/:id', async (req, res) => {
  const tabela = tabelaApoio(req);
  const id = idDaRota(req);
  const d = validarApoio(tabela, req.body || {});
  await transacao(async (tx) => {
    const [dup] = await tx.consultar(`SELECT 1 AS x FROM ASSOCIAL_${tabela} WHERE nome = @nome AND id <> @id`, { nome: d.nome, id });
    if (dup) throw erros.validacao({ nome: 'Já existe uma opção com este nome.' });
    const extra = tabela === 'faixa_etaria' ? ', idade_min = @idadeMin, idade_max = @idadeMax' : '';
    const r = await tx.consultar(
      `UPDATE ASSOCIAL_${tabela} SET nome = @nome, ordem = @ordem, exige_texto = @exigeTexto${extra} OUTPUT INSERTED.id WHERE id = @id`,
      { ...d, id });
    if (!r.length) throw erros.naoEncontrado('Opção não encontrada.');
    await registrarAuditoria(req, 'ALTERAR', tabela, id, { nome: d.nome }, tx);
  });
  res.json((await listarApoio(tabela, id))[0]);
});

router.patch('/apoio/:tabela/:id/ativo', async (req, res) => {
  const tabela = tabelaApoio(req);
  const id = idDaRota(req);
  const ativo = ehVerdadeiro(req.body?.ativo);
  const r = await consultar(`UPDATE ASSOCIAL_${tabela} SET ativo = @ativo OUTPUT INSERTED.id WHERE id = @id`, { id, ativo: ativo ? 1 : 0 });
  if (!r.length) throw erros.naoEncontrado('Opção não encontrada.');
  await registrarAuditoria(req, 'ALTERAR', tabela, id, { ativo });
  res.json({ id, ativo });
});

// Exclui só se ninguém referencia; senão 409 orientando a desativar.
router.delete('/apoio/:tabela/:id', async (req, res) => {
  const tabela = tabelaApoio(req);
  const id = idDaRota(req);
  const [item] = await listarApoio(tabela, id);
  if (!item) throw erros.naoEncontrado('Opção não encontrada.');
  if (item.emUso) {
    throw erros.conflito('Esta opção já foi usada em registros e não pode ser excluída. Desative-a para que deixe de aparecer nos formulários.');
  }
  await consultar(`DELETE FROM ASSOCIAL_${tabela} WHERE id = @id`, { id });
  await registrarAuditoria(req, 'EXCLUIR', tabela, id, { nome: item.nome });
  res.status(204).end();
});

// =====================================================================
// Configurações
// =====================================================================

// Coordenação e ADMIN veem e editam todas as configurações (P1).
const configPublica = (c) => ({
  chave: c.chave,
  valor: c.valor,
  descricao: c.descricao,
  rotulo: svc.CONFIG_REGRAS[c.chave]?.rotulo || c.chave,
  tipo: svc.CONFIG_REGRAS[c.chave]?.tipo || 'texto',
  editavel: true,
  alteradoEm: c.alteradoEm,
});

router.get('/configuracoes', async (req, res) => {
  const linhas = await consultar('SELECT chave, valor, descricao, alterado_em FROM ASSOCIAL_configuracao ORDER BY chave');
  res.json(linhas.map(configPublica));
});

router.put('/configuracoes/:chave', async (req, res) => {
  const chave = String(req.params.chave);
  const atual = await consultarUm('SELECT chave, valor FROM ASSOCIAL_configuracao WHERE chave = @chave', { chave });
  if (!atual) throw erros.naoEncontrado('Configuração não encontrada.');
  const r = svc.validarConfig(chave, req.body?.valor);
  if (r.erro) throw erros.validacao({ valor: r.erro });
  await consultar(
    'UPDATE ASSOCIAL_configuracao SET valor = @valor, alterado_por = @por, alterado_em = SYSUTCDATETIME() WHERE chave = @chave',
    { chave, valor: r.valor, por: req.usuario.id });
  await registrarAuditoria(req, 'ALTERAR', 'configuracao', chave, { de: atual.valor, para: r.valor });
  res.json({ chave, valor: r.valor });
});

// =====================================================================
// Perguntas e opções (P2) — coordenação e ADMIN. Contrato: docs/API-CATALOGO.md
// =====================================================================

// As rotas fixas (/ordem) vêm antes das com :id.
router.get('/perguntas', async (req, res) => {
  res.json(await catalogoAdmin.listar(req.query.formulario));
});

router.post('/perguntas', async (req, res) => {
  res.status(201).json(await catalogoAdmin.criarPergunta(req, req.body || {}));
});

router.put('/perguntas/ordem', async (req, res) => {
  await catalogoAdmin.ordenarPerguntas(req, req.body || {});
  res.status(204).end();
});

router.put('/perguntas/:id', async (req, res) => {
  res.json(await catalogoAdmin.atualizarPergunta(req, idDaRota(req), req.body || {}));
});

router.patch('/perguntas/:id/ativa', async (req, res) => {
  res.json(await catalogoAdmin.definirAtiva(req, idDaRota(req), ehVerdadeiro(req.body?.ativa)));
});

router.delete('/perguntas/:id', async (req, res) => {
  await catalogoAdmin.excluirPergunta(req, idDaRota(req));
  res.status(204).end();
});

router.post('/perguntas/:id/opcoes', async (req, res) => {
  res.status(201).json(await catalogoAdmin.criarOpcao(req, idDaRota(req), req.body || {}));
});

router.put('/perguntas/:id/opcoes/ordem', async (req, res) => {
  await catalogoAdmin.ordenarOpcoes(req, idDaRota(req), req.body || {});
  res.status(204).end();
});

router.put('/perguntas/:id/opcoes/:opcaoId', async (req, res) => {
  const opcaoId = inteiroPositivo(req.params.opcaoId);
  if (!opcaoId) throw erros.naoEncontrado();
  res.json(await catalogoAdmin.atualizarOpcao(req, idDaRota(req), opcaoId, req.body || {}));
});

router.patch('/perguntas/:id/opcoes/:opcaoId/ativa', async (req, res) => {
  const opcaoId = inteiroPositivo(req.params.opcaoId);
  if (!opcaoId) throw erros.naoEncontrado();
  res.json(await catalogoAdmin.definirOpcaoAtiva(req, idDaRota(req), opcaoId, ehVerdadeiro(req.body?.ativa)));
});

router.delete('/perguntas/:id/opcoes/:opcaoId', async (req, res) => {
  const opcaoId = inteiroPositivo(req.params.opcaoId);
  if (!opcaoId) throw erros.naoEncontrado();
  await catalogoAdmin.excluirOpcao(req, idDaRota(req), opcaoId);
  res.status(204).end();
});

// =====================================================================
// Auditoria
// =====================================================================

router.get('/auditoria/opcoes', soAdmin, async (req, res) => {
  const [acoes, tabelas, usuarios] = await Promise.all([
    consultar('SELECT DISTINCT acao FROM ASSOCIAL_auditoria ORDER BY acao'),
    consultar('SELECT DISTINCT tabela FROM ASSOCIAL_auditoria WHERE tabela IS NOT NULL ORDER BY tabela'),
    consultar('SELECT id, nome, login FROM ASSOCIAL_usuario ORDER BY nome'),
  ]);
  res.json({ acoes: acoes.map((a) => a.acao), tabelas: tabelas.map((t) => t.tabela), usuarios });
});

// GET /api/admin/auditoria?usuarioId&acao&tabela&dataInicio&dataFim&pagina&porPagina
router.get('/auditoria', soAdmin, async (req, res) => {
  const filtros = ['1 = 1'];
  const params = {};
  const usuarioId = inteiroPositivo(req.query.usuarioId);
  if (usuarioId) { filtros.push('a.usuario_id = @usuarioId'); params.usuarioId = usuarioId; }
  const acao = texto(req.query.acao, 20);
  if (acao) { filtros.push('a.acao = @acao'); params.acao = acao; }
  const tabela = texto(req.query.tabela, 60);
  if (tabela) { filtros.push('a.tabela = @tabela'); params.tabela = tabela; }
  const inicio = req.query.dataInicio ? normalizarData(req.query.dataInicio) : undefined;
  const fim = req.query.dataFim ? normalizarData(req.query.dataFim) : undefined;
  lancarSeErros({
    ...(req.query.dataInicio && !inicio ? { dataInicio: 'Data inválida.' } : {}),
    ...(req.query.dataFim && !fim ? { dataFim: 'Data inválida.' } : {}),
  });
  if (inicio) { filtros.push('a.criado_em >= @inicio'); params.inicio = [tipos.Date, inicio]; }
  if (fim) { filtros.push('a.criado_em < DATEADD(day, 1, @fim)'); params.fim = [tipos.Date, fim]; }

  const porPagina = Math.min(inteiroPositivo(req.query.porPagina) || 50, 200);
  const pagina = inteiroPositivo(req.query.pagina) || 1;
  const onde = filtros.join(' AND ');

  const [{ total }] = await consultar(`SELECT COUNT(*) AS total FROM ASSOCIAL_auditoria a WHERE ${onde}`, params);
  const itens = await consultar(
    `SELECT a.id, a.usuario_id, u.nome AS usuario_nome, u.login AS usuario_login, a.acao, a.tabela, a.registro_id,
            a.detalhes, a.ip, a.criado_em
       FROM ASSOCIAL_auditoria a LEFT JOIN ASSOCIAL_usuario u ON u.id = a.usuario_id
      WHERE ${onde}
      ORDER BY a.criado_em DESC, a.id DESC
      OFFSET @desloc ROWS FETCH NEXT @limite ROWS ONLY`,
    { ...params, desloc: (pagina - 1) * porPagina, limite: porPagina });
  res.json({ itens, total, pagina, porPagina });
});

module.exports = router;
