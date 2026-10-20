'use strict';

// Autenticação, perfis e ESCOPO POR UNIDADE (LGPD).
//
// Regra de ouro: toda rota que lê/grava dados de atendimento, ação, família ou
// acompanhamento DEVE restringir por unidade no back-end usando os helpers abaixo.
// Nunca confie em unidade vinda do front.

const { consultar } = require('../db');
const { erros } = require('../lib/erros');
const { PERFIS } = require('../lib/dominios');

async function carregarUsuario(id) {
  const [usuario] = await consultar(
    `SELECT u.id, u.login, u.nome, u.email, u.cress, u.deve_trocar_senha, p.codigo AS perfil
       FROM usuario u JOIN perfil p ON p.id = u.perfil_id
      WHERE u.id = @id AND u.ativo = 1`,
    { id },
  );
  if (!usuario) return null;

  // COORDENADOR e ADMIN enxergam todas as unidades ativas; ASSISTENTE só as vinculadas.
  const unidades = usuario.perfil === PERFIS.ASSISTENTE
    ? await consultar(
      `SELECT un.id, un.sigla, un.nome
         FROM usuario_unidade uu JOIN unidade un ON un.id = uu.unidade_id
        WHERE uu.usuario_id = @id AND un.ativo = 1
        ORDER BY un.ordem, un.nome`,
      { id },
    )
    : await consultar('SELECT id, sigla, nome FROM unidade WHERE ativo = 1 ORDER BY ordem, nome');

  return { ...usuario, unidades };
}

function criarRequireAuth({ permitirSenhaPendente }) {
  return async (req, res, next) => {
    try {
      const id = req.session?.usuarioId;
      if (!id) throw erros.naoAutenticado();
      const usuario = await carregarUsuario(id);
      if (!usuario) {
        // usuário removido/inativado: derruba a sessão
        await new Promise((resolve) => req.session.destroy(resolve));
        throw erros.naoAutenticado();
      }
      if (usuario.deveTrocarSenha && !permitirSenhaPendente) {
        const e = erros.proibido('Defina uma nova senha para continuar.');
        e.codigo = 'TROCAR_SENHA';
        throw e;
      }
      req.usuario = usuario;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Exige sessão válida e senha já trocada. Popula req.usuario.
const requireAuth = criarRequireAuth({ permitirSenhaPendente: false });
// Somente para /api/auth/me, /api/auth/senha e /api/auth/logout.
const requireAuthSenhaPendente = criarRequireAuth({ permitirSenhaPendente: true });

// Uso: router.get('/', requireAuth, requirePerfil('COORDENADOR', 'ADMIN'), handler)
const requirePerfil = (...perfis) => (req, res, next) => {
  if (!req.usuario) return next(erros.naoAutenticado());
  if (!perfis.includes(req.usuario.perfil)) return next(erros.proibido());
  next();
};

// IDs das unidades que o usuário logado pode acessar.
function unidadesPermitidas(req) {
  return (req.usuario?.unidades || []).map((u) => u.id);
}

// Fragmento SQL "coluna IN (@un0, @un1...)" restrito às unidades permitidas.
// Preenche `params` com os parâmetros usados. Sem unidades => "1 = 0" (nada visível).
//
//   const params = {};
//   const where = clausulaUnidades(req, 'a.unidade_id', params);
//   await consultar(`SELECT ... FROM atendimento a WHERE ${where}`, params);
function clausulaUnidades(req, coluna, params, prefixo = 'un') {
  const ids = unidadesPermitidas(req);
  if (ids.length === 0) return '1 = 0';
  const nomes = ids.map((id, i) => {
    params[`${prefixo}${i}`] = id;
    return `@${prefixo}${i}`;
  });
  return `${coluna} IN (${nomes.join(', ')})`;
}

// Garante que o usuário pode operar na unidade informada (ex.: ao gravar).
function exigirUnidade(req, unidadeId) {
  const id = Number(unidadeId);
  if (!Number.isInteger(id) || !unidadesPermitidas(req).includes(id)) {
    throw erros.proibido('Você não tem acesso a esta unidade.');
  }
  return id;
}

// Resolve a unidade de um novo registro: usa a informada (validando permissão) ou,
// se o usuário só tem uma unidade, essa.
function resolverUnidade(req, unidadeIdInformada) {
  if (unidadeIdInformada !== undefined && unidadeIdInformada !== null && unidadeIdInformada !== '') {
    return exigirUnidade(req, unidadeIdInformada);
  }
  const ids = unidadesPermitidas(req);
  if (ids.length === 1) return ids[0];
  throw erros.validacao({ unidadeId: 'Selecione a unidade.' });
}

module.exports = {
  requireAuth,
  requireAuthSenhaPendente,
  requirePerfil,
  unidadesPermitidas,
  clausulaUnidades,
  exigirUnidade,
  resolverUnidade,
};
