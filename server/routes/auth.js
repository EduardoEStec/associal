'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { consultar, consultarUm } = require('../db');
const { erros, ErroApp } = require('../lib/erros');
const { registrarAuditoria } = require('../lib/auditoria');
const { texto, lancarSeErros } = require('../lib/validacao');
const { requireAuthSenhaPendente } = require('../middlewares/auth');

const router = express.Router();

const CUSTO_BCRYPT = 12;
// Hash descartável para igualar o tempo de resposta quando o login não existe.
const HASH_FALSO = bcrypt.hashSync('associal-hash-falso', CUSTO_BCRYPT);

// Rate-limit simples: 10 tentativas FALHAS por IP a cada 15 min.
const limitarLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next) => next(erros.muitasRequisicoes('Muitas tentativas de login. Aguarde 15 minutos.')),
});

function usuarioPublico(u) {
  return {
    id: u.id,
    login: u.login,
    nome: u.nome,
    email: u.email,
    cress: u.cress,
    perfil: u.perfil,
    deveTrocarSenha: !!u.deveTrocarSenha,
    unidades: u.unidades,
  };
}

const regenerarSessao = (req) => new Promise((ok, falha) => req.session.regenerate((e) => (e ? falha(e) : ok())));
const salvarSessao = (req) => new Promise((ok, falha) => req.session.save((e) => (e ? falha(e) : ok())));
const destruirSessao = (req) => new Promise((ok) => req.session.destroy(ok));

// POST /api/auth/login  { login, senha }
router.post('/login', limitarLogin, async (req, res) => {
  const login = texto(req.body?.login, 60);
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
  const falhas = {};
  if (!login) falhas.login = 'Informe o usuário.';
  if (!senha) falhas.senha = 'Informe a senha.';
  lancarSeErros(falhas);

  const usuario = await consultarUm(
    'SELECT id, senha_hash FROM usuario WHERE login = @login AND ativo = 1',
    { login },
  );
  const hash = usuario && usuario.senhaHash !== '!' ? usuario.senhaHash : HASH_FALSO;
  const confere = await bcrypt.compare(senha, hash);

  if (!usuario || usuario.senhaHash === '!' || !confere) {
    await registrarAuditoria(req, 'LOGIN_FALHA', 'usuario', usuario?.id ?? null, { login });
    throw new ErroApp(401, 'CREDENCIAIS_INVALIDAS', 'Usuário ou senha incorretos.');
  }

  await regenerarSessao(req); // evita fixação de sessão
  req.session.usuarioId = usuario.id;
  await salvarSessao(req);
  await consultar('UPDATE usuario SET ultimo_login_em = SYSUTCDATETIME() WHERE id = @id', { id: usuario.id });

  req.usuario = { id: usuario.id };
  await registrarAuditoria(req, 'LOGIN', 'usuario', usuario.id);
  res.json({ ok: true });
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  if (req.session?.usuarioId) {
    req.usuario = { id: req.session.usuarioId };
    await registrarAuditoria(req, 'LOGOUT', 'usuario', req.session.usuarioId);
  }
  await destruirSessao(req);
  res.clearCookie('associal.sid');
  res.json({ ok: true });
});

// GET /api/auth/me — usuário logado, perfil e unidades permitidas
router.get('/me', requireAuthSenhaPendente, (req, res) => {
  res.json({ usuario: usuarioPublico(req.usuario) });
});

// POST /api/auth/senha  { senhaAtual, novaSenha } — troca da própria senha
router.post('/senha', requireAuthSenhaPendente, async (req, res) => {
  const senhaAtual = typeof req.body?.senhaAtual === 'string' ? req.body.senhaAtual : '';
  const novaSenha = typeof req.body?.novaSenha === 'string' ? req.body.novaSenha : '';
  const falhas = {};
  if (!senhaAtual) falhas.senhaAtual = 'Informe a senha atual.';
  if (novaSenha.length < 8) falhas.novaSenha = 'A nova senha deve ter ao menos 8 caracteres.';
  else if (novaSenha === senhaAtual) falhas.novaSenha = 'A nova senha deve ser diferente da atual.';
  lancarSeErros(falhas);

  const registro = await consultarUm('SELECT senha_hash FROM usuario WHERE id = @id', { id: req.usuario.id });
  const confere = registro && registro.senhaHash !== '!' && (await bcrypt.compare(senhaAtual, registro.senhaHash));
  if (!confere) throw erros.validacao({ senhaAtual: 'Senha atual incorreta.' });

  const novoHash = await bcrypt.hash(novaSenha, CUSTO_BCRYPT);
  await consultar(
    `UPDATE usuario SET senha_hash = @hash, deve_trocar_senha = 0,
            alterado_por = @id, alterado_em = SYSUTCDATETIME()
      WHERE id = @id`,
    { hash: novoHash, id: req.usuario.id },
  );
  await registrarAuditoria(req, 'ALTERAR', 'usuario', req.usuario.id, { campo: 'senha' });
  res.json({ ok: true });
});

module.exports = router;
module.exports.CUSTO_BCRYPT = CUSTO_BCRYPT;
