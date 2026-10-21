'use strict';

// Recalcula o instantâneo do índice de progresso (acompanhamento_indice) de TODOS os questionários concluídos.
// Use depois de mudar a regra (VERSAO_REGRA em server/services/indice-progresso.js), de atualizar o salário mínimo de
// referência ou para preencher o índice de questionários concluídos antes da F5.
//
//   node scripts/recalcular-indices.js           recalcula no banco apontado pelo .env
//
// TRAVA: por padrão só roda no SQL Server em container Linux local (o Docker de teste). Para o SQL Server real, depois do
// backup e da aplicação das migrações, passe --banco-real de propósito.

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../server/db');
const { recalcularTodos } = require('../server/services/indice-dados');

(async () => {
  try {
    if (!process.argv.includes('--banco-real')) {
      const [info] = await db.consultar("SELECT (SELECT host_platform FROM sys.dm_os_host_info) AS plataforma, CAST(SERVERPROPERTY('MachineName') AS NVARCHAR(100)) AS maquina");
      const local = ['localhost', '127.0.0.1', '::1'].includes(String(process.env.DB_SERVER).toLowerCase());
      if (info.plataforma !== 'Linux' || !local) {
        console.error(`RECUSADO: o banco não parece ser o container Docker de teste (DB_SERVER=${process.env.DB_SERVER}, plataforma=${info.plataforma}). Use --banco-real se for de propósito.`);
        process.exitCode = 2;
        return;
      }
    }
    const n = await db.transacao((tx) => recalcularTodos(tx));
    console.log(`Índice recalculado para ${n} questionário(s) concluído(s).`);
  } catch (e) {
    console.error('Falhou:', e.message);
    process.exitCode = 1;
  } finally {
    await db.fechar().catch(() => {});
  }
})();
