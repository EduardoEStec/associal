'use strict';

// Define a senha (bcrypt) de um usuário e obriga a trocá-la no próximo login.
//
//   npm run admin:senha                       -> redefine "admin" com senha aleatória (impressa uma vez)
//   npm run admin:senha -- admin MinhaSenha1  -> redefine "admin" com a senha informada
//   npm run admin:senha -- maria              -> redefine "maria" com senha aleatória
//
// Também é usado por db:migrate para a senha inicial do ADMIN (ADMIN_SENHA_INICIAL no .env).

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');

const CUSTO_BCRYPT = 12;

function gerarSenhaAleatoria() {
  return crypto.randomBytes(12).toString('base64url'); // 16 caracteres
}

// `consultar(sql, params)` é o helper de server/db.js. Retorna a senha em texto (para exibir) ou null.
async function definirSenha(consultar, login, senha) {
  const [usuario] = await consultar('SELECT id FROM ASSOCIAL_usuario WHERE login = @login', { login });
  if (!usuario) return null;
  const nova = senha || gerarSenhaAleatoria();
  if (nova.length < 8) throw new Error('A senha deve ter ao menos 8 caracteres.');
  const hash = await bcrypt.hash(nova, CUSTO_BCRYPT);
  await consultar(
    `UPDATE ASSOCIAL_usuario SET senha_hash = @hash, deve_trocar_senha = 1, alterado_em = SYSUTCDATETIME()
      WHERE id = @id`,
    { hash, id: usuario.id },
  );
  return nova;
}

module.exports = { definirSenha, gerarSenhaAleatoria };

if (require.main === module) {
  const db = require('../server/db');
  const [login = 'admin', senha] = process.argv.slice(2);
  definirSenha(db.consultar, login, senha)
    .then((nova) => {
      if (!nova) {
        console.error(`Usuário "${login}" não encontrado.`);
        process.exitCode = 1;
      } else {
        console.log(`Senha de "${login}" definida: ${nova}`);
        console.log('Anote agora: ela não será exibida novamente. O usuário deverá trocá-la no primeiro acesso.');
      }
    })
    .catch((err) => {
      console.error('Falha:', err.message);
      process.exitCode = 1;
    })
    .finally(() => db.fechar());
}
