'use strict';

// Erros de aplicação. O middleware de erros (middlewares/erros.js) converte em:
//   { "erro": { "codigo": "VALIDACAO", "mensagem": "...", "detalhes": { campo: "mensagem" } } }

class ErroApp extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

const erros = {
  validacao: (detalhes, mensagem = 'Dados inválidos.') => new ErroApp(400, 'VALIDACAO', mensagem, detalhes),
  naoAutenticado: (mensagem = 'Sessão expirada. Entre novamente.') => new ErroApp(401, 'NAO_AUTENTICADO', mensagem),
  proibido: (mensagem = 'Você não tem permissão para esta operação.') => new ErroApp(403, 'PROIBIDO', mensagem),
  naoEncontrado: (mensagem = 'Registro não encontrado.') => new ErroApp(404, 'NAO_ENCONTRADO', mensagem),
  conflito: (mensagem, detalhes) => new ErroApp(409, 'CONFLITO', mensagem, detalhes),
  muitasRequisicoes: (mensagem = 'Muitas tentativas. Aguarde alguns minutos.') =>
    new ErroApp(429, 'MUITAS_REQUISICOES', mensagem),
  indisponivel: (mensagem = 'Serviço temporariamente indisponível.') => new ErroApp(503, 'INDISPONIVEL', mensagem),
};

// Permite `async (req, res) => {}` nas rotas (Express 4 não captura rejeições sozinho).
const assincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ErroApp, erros, assincrono };
