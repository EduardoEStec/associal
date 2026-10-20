'use strict';

const { ErroApp } = require('../lib/erros');

// Rotas /api inexistentes
function apiNaoEncontrada(req, res) {
  res.status(404).json({ erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' } });
}

// Exige o cabeçalho X-Requested-With em métodos que alteram dados (defesa CSRF:
// um formulário/site de terceiros não consegue enviar cabeçalhos customizados).
// O public/js/api.js já envia esse cabeçalho.
function protecaoCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') === 'fetch') return next();
  res.status(403).json({ erro: { codigo: 'PROIBIDO', mensagem: 'Requisição não autorizada.' } });
}

// Último middleware: formato único de erro { erro: { codigo, mensagem, detalhes? } }
// eslint-disable-next-line no-unused-vars
function tratarErros(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof ErroApp) {
    const erro = { codigo: err.codigo, mensagem: err.message };
    if (err.detalhes) erro.detalhes = err.detalhes;
    return res.status(err.status).json({ erro });
  }

  // JSON malformado / corpo grande demais
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: { codigo: 'JSON_INVALIDO', mensagem: 'Corpo da requisição inválido.' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ erro: { codigo: 'MUITO_GRANDE', mensagem: 'Requisição grande demais.' } });
  }

  // Erros de conexão com o banco
  const semBanco = ['ESOCKET', 'ELOGIN', 'ETIMEOUT', 'ECONNCLOSED', 'ENOTOPEN', 'EINVALIDSTATE'].includes(err.code);
  if (semBanco) {
    console.error('[db] indisponível:', err.message);
    return res.status(503).json({
      erro: { codigo: 'BANCO_INDISPONIVEL', mensagem: 'Banco de dados indisponível. Tente novamente em instantes.' },
    });
  }

  // Violação de unicidade (CPF duplicado etc.)
  if (err.number === 2627 || err.number === 2601) {
    return res.status(409).json({ erro: { codigo: 'CONFLITO', mensagem: 'Já existe um registro com estes dados.' } });
  }
  // Violação de FK / CHECK
  if (err.number === 547) {
    return res.status(409).json({
      erro: { codigo: 'CONFLITO', mensagem: 'Operação não permitida: dados relacionados ou valor inválido.' },
    });
  }

  console.error('[erro]', req.method, req.originalUrl, err);
  res.status(500).json({ erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente novamente.' } });
}

module.exports = { apiNaoEncontrada, protecaoCsrf, tratarErros };
