'use strict';

// Montagem automática das rotas: cada arquivo `routes/<modulo>.js` vira `/api/<modulo>`.
// Assim, quem cria um módulo só adiciona o arquivo — sem editar este (evita conflitos).
//
//   - O arquivo deve exportar um express.Router().
//   - Todas as rotas, EXCETO /api/auth, já passam por `requireAuth` (sessão válida).
//   - Restrição de perfil e de unidade é responsabilidade do módulo
//     (requirePerfil / clausulaUnidades — ver docs/CONVENCOES.md).

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { requireAuth } = require('../middlewares/auth');
const catalogo = require('../services/catalogo');

const PUBLICAS = new Set(['auth']); // auth controla o próprio acesso (login é público)

const router = express.Router();

for (const arquivo of fs.readdirSync(__dirname).sort()) {
  if (arquivo === 'index.js' || !arquivo.endsWith('.js')) continue;
  const nome = path.basename(arquivo, '.js');
  const modulo = require(path.join(__dirname, arquivo));
  if (PUBLICAS.has(nome)) router.use(`/${nome}`, modulo);
  else router.use(`/${nome}`, requireAuth, catalogo.middleware, modulo); // catálogo de perguntas (P2) em memória e atualizado
}

module.exports = router;
