'use strict';

// Carrega o .env (se existir) e expõe a configuração da aplicação.
const path = require('node:path');
require('dotenv').config({ quiet: true });

const bool = (valor, padrao = false) =>
  valor === undefined || valor === '' ? padrao : ['1', 'true', 'sim', 'yes'].includes(String(valor).toLowerCase());

const raiz = path.resolve(__dirname, '..');

const config = {
  raiz,
  ambiente: process.env.NODE_ENV || 'development',
  porta: Number(process.env.PORT) || 3000,

  db: {
    server: process.env.DB_SERVER || 'localhost',
    port: Number(process.env.DB_PORT) || 1433,
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ASSOCIAL',
    encrypt: bool(process.env.DB_ENCRYPT, false),
    trustServerCertificate: bool(process.env.DB_TRUST_SERVER_CERTIFICATE, true),
  },

  sessao: {
    segredo: process.env.SESSION_SECRET || '',
    // 'sql' (tabela dbo.ASSOCIAL_sessao, padrão) ou 'memoria' (apenas desenvolvimento/testes sem banco)
    armazenamento: process.env.SESSION_STORE || 'sql',
    duracaoHoras: Number(process.env.SESSION_HORAS) || 12,
    cookieSeguro: bool(process.env.COOKIE_SECURE, false), // true quando atrás de HTTPS
  },

  // Quando atrás de proxy reverso (nginx, Traefik...): TRUST_PROXY=1
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false,

  uploadDir: path.resolve(raiz, process.env.UPLOAD_DIR || 'uploads'),
};

if (!config.sessao.segredo) {
  if (config.ambiente === 'production') {
    throw new Error('SESSION_SECRET é obrigatório em produção (defina no .env).');
  }
  config.sessao.segredo = 'segredo-somente-para-desenvolvimento';
}

module.exports = config;
