'use strict';

const config = require('./config');
const db = require('./db');
const { criarApp, garantirDiretorioUploads } = require('./app');

garantirDiretorioUploads();
const app = criarApp();

const servidor = app.listen(config.porta, () => {
  console.log(`ASSOCIAL no ar: http://localhost:${config.porta} (${config.ambiente})`);
  // Sondagem do banco apenas informativa: o app sobe mesmo sem banco disponível.
  db.consultar('SELECT 1 AS ok')
    .then(() => console.log(`[db] conectado em ${config.db.server}:${config.db.port}/${config.db.database}`))
    .catch((err) => console.warn(`[db] indisponível no momento (${err.message}). Rotas /api autenticadas responderão 503.`));
});

async function encerrar(sinal) {
  console.log(`\n${sinal} recebido, encerrando...`);
  servidor.close(async () => {
    await db.fechar().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
