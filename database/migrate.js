'use strict';

// Executa os scripts .sql de /database em ordem numérica (001_*.sql, 002_*.sql, ...).
// Todos os scripts são idempotentes, então rodar de novo é seguro.
//
//   npm run db:migrate
//
// 1. Cria o banco (DB_NAME) se não existir.
// 2. Roda cada script, dividindo os lotes nas linhas "GO".
// 3. Se o usuário "admin" ainda não tem senha, define uma (ADMIN_SENHA_INICIAL do .env,
//    ou aleatória, impressa uma única vez).

const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const config = require('../server/config');
const db = require('../server/db');
const { definirSenha } = require('./admin-senha');

const { db: cfg } = config;

function opcoes(banco) {
  return {
    server: cfg.server,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: banco,
    options: { encrypt: cfg.encrypt, trustServerCertificate: cfg.trustServerCertificate },
    connectionTimeout: 15000,
    requestTimeout: 120000,
  };
}

function dividirLotes(conteudo) {
  const lotes = [];
  let atual = [];
  for (const linha of conteudo.split(/\r?\n/)) {
    if (/^\s*GO\s*(--.*)?$/i.test(linha)) {
      lotes.push(atual.join('\n'));
      atual = [];
    } else {
      atual.push(linha);
    }
  }
  lotes.push(atual.join('\n'));
  return lotes.filter((l) => l.trim() !== '');
}

async function garantirBanco() {
  if (!/^[A-Za-z0-9_]+$/.test(cfg.database)) throw new Error(`DB_NAME inválido: ${cfg.database}`);
  const pool = await new sql.ConnectionPool(opcoes('master')).connect();
  try {
    const r = await pool.request().input('nome', cfg.database).query('SELECT DB_ID(@nome) AS id');
    if (r.recordset[0].id === null) {
      // Collation insensível a acentos/caixa: buscas por nome sem se preocupar com acentuação.
      await pool.request().batch(`CREATE DATABASE [${cfg.database}] COLLATE Latin1_General_100_CI_AI`);
      console.log(`Banco ${cfg.database} criado.`);
    } else {
      console.log(`Banco ${cfg.database} já existe.`);
    }
  } finally {
    await pool.close();
  }
}

async function executarScripts() {
  const arquivos = fs.readdirSync(__dirname).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const pool = await new sql.ConnectionPool(opcoes(cfg.database)).connect();
  try {
    for (const arquivo of arquivos) {
      const lotes = dividirLotes(fs.readFileSync(path.join(__dirname, arquivo), 'utf8'));
      process.stdout.write(`> ${arquivo} (${lotes.length} lotes)... `);
      for (const [i, lote] of lotes.entries()) {
        try {
          await pool.request().batch(lote);
        } catch (err) {
          console.error(`\n  Falha no lote ${i + 1} de ${arquivo}: ${err.message}\n--- lote ---\n${lote.slice(0, 600)}`);
          throw err;
        }
      }
      console.log('ok');
    }
  } finally {
    await pool.close();
  }
}

async function senhaInicialAdmin() {
  const [admin] = await db.consultar("SELECT senha_hash FROM usuario WHERE login = 'admin'");
  if (!admin || admin.senhaHash !== '!') return;
  const nova = await definirSenha(db.consultar, 'admin', process.env.ADMIN_SENHA_INICIAL || undefined);
  console.log('\nUsuário ADMIN criado:');
  console.log('  usuário: admin');
  console.log(process.env.ADMIN_SENHA_INICIAL
    ? '  senha:   (a definida em ADMIN_SENHA_INICIAL)'
    : `  senha:   ${nova}   <- anote agora, não será exibida novamente`);
  console.log('  A troca de senha será exigida no primeiro acesso.');
}

(async () => {
  try {
    await garantirBanco();
    await executarScripts();
    await senhaInicialAdmin();
    console.log('\nMigração concluída.');
  } catch (err) {
    console.error('\nMigração falhou:', err.message);
    process.exitCode = 1;
  } finally {
    await db.fechar().catch(() => {});
  }
})();
