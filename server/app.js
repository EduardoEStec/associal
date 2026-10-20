'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const config = require('./config');
const SqlSessionStore = require('./lib/session-store');
const rotas = require('./routes');
const { apiNaoEncontrada, protecaoCsrf, tratarErros } = require('./middlewares/erros');

function criarApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  // Cabeçalhos de segurança (CSP restritiva: sem scripts inline — use /public/js/*.js)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null, // o sistema pode rodar em HTTP na rede interna
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  const duracaoMs = config.sessao.duracaoHoras * 60 * 60 * 1000;
  app.use(
    session({
      name: 'associal.sid',
      secret: config.sessao.segredo,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: config.sessao.armazenamento === 'memoria' ? undefined : new SqlSessionStore({ duracaoMs }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.sessao.cookieSeguro,
        maxAge: duracaoMs,
      },
    }),
  );

  // API
  app.use('/api', express.json({ limit: '1mb' }), protecaoCsrf);
  app.get('/api/saude', (req, res) => res.json({ ok: true })); // healthcheck (público)
  app.use('/api', rotas);
  app.use('/api', apiNaoEncontrada);

  // Páginas estáticas (PWA incluído)
  const publico = path.join(config.raiz, 'public');
  app.use(
    express.static(publico, {
      extensions: ['html'],
      setHeaders(res, arquivo) {
        // service worker e manifest sempre revalidados
        if (/sw\.js$|manifest\.webmanifest$/.test(arquivo)) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  app.use(tratarErros);
  return app;
}

function garantirDiretorioUploads() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

module.exports = { criarApp, garantirDiretorioUploads };
