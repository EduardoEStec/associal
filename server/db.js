'use strict';

// Pool único do `mssql` + helpers. TODA query deve ser parametrizada:
//
//   const linhas = await consultar(
//     'SELECT id, nome FROM pessoa WHERE cpf = @cpf', { cpf });
//
// Parâmetros: { nome: valor } (tipo inferido) ou { nome: [tipos.Decimal(10, 2), valor] }
// (tipo explícito — obrigatório para decimais e datas só-data: [tipos.Date, '2026-03-01']).
// As colunas voltam em camelCase (data_atendimento -> dataAtendimento).

const sql = require('mssql');
const config = require('./config');

let poolPromise = null;

function obterPool() {
  if (!poolPromise) {
    const { db } = config;
    const pool = new sql.ConnectionPool({
      server: db.server,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.database,
      options: {
        encrypt: db.encrypt,
        trustServerCertificate: db.trustServerCertificate,
        enableArithAbort: true,
      },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      connectionTimeout: 15000,
      requestTimeout: 30000,
    });
    pool.on('error', (err) => console.error('[db] erro no pool:', err.message));
    poolPromise = pool.connect().catch((err) => {
      poolPromise = null; // permite nova tentativa na próxima requisição
      throw err;
    });
  }
  return poolPromise;
}

const paraCamel = (chave) => chave.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function converterLinha(linha) {
  const saida = {};
  for (const [k, v] of Object.entries(linha)) saida[paraCamel(k)] = v;
  return saida;
}

const ehTipoExplicito = (v) =>
  Array.isArray(v) && v.length === 2 && (typeof v[0] === 'function' || (v[0] && v[0].type));

function vincular(request, parametros) {
  for (const [nome, valor] of Object.entries(parametros || {})) {
    if (ehTipoExplicito(valor)) request.input(nome, valor[0], valor[1]);
    else request.input(nome, valor === undefined ? null : valor);
  }
  return request;
}

// Cria { consultar, executar } sobre uma fábrica de Request (pool ou transação).
function criarExecutor(criarRequest) {
  async function executar(texto, parametros) {
    const request = vincular(await criarRequest(), parametros);
    const resultado = await request.query(texto);
    return {
      linhas: (resultado.recordset || []).map(converterLinha),
      conjuntos: (resultado.recordsets || []).map((rs) => rs.map(converterLinha)),
      afetadas: resultado.rowsAffected,
    };
  }
  async function consultar(texto, parametros) {
    return (await executar(texto, parametros)).linhas;
  }
  async function consultarUm(texto, parametros) {
    return (await consultar(texto, parametros))[0] || null;
  }
  return { consultar, consultarUm, executar };
}

const base = criarExecutor(async () => (await obterPool()).request());

// Executa `fn(tx)` em transação; `tx` tem consultar/consultarUm/executar.
// Commit se resolver, rollback se lançar.
async function transacao(fn) {
  const pool = await obterPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const resultado = await fn(criarExecutor(async () => new sql.Request(tx)));
    await tx.commit();
    return resultado;
  } catch (err) {
    try { await tx.rollback(); } catch { /* transação já encerrada */ }
    throw err;
  }
}

async function fechar() {
  if (poolPromise) {
    const pool = await poolPromise.catch(() => null);
    poolPromise = null;
    if (pool) await pool.close();
  }
}

module.exports = {
  tipos: sql,
  obterPool,
  consultar: base.consultar,
  consultarUm: base.consultarUm,
  executar: base.executar,
  transacao,
  fechar,
};
