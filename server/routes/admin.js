'use strict';

// Administração: usuários, unidades, tabelas de apoio, configurações. SOMENTE ADMIN
// (COORDENADOR edita apenas a configuração prazo_questionario_final_dias — decidir no módulo).
// Montado automaticamente em /api/admin (já exige sessão). Veja docs/CONVENCOES.md.
// Senhas: bcrypt (CUSTO_BCRYPT em routes/auth.js), nunca em texto puro.

const express = require('express');
const { requirePerfil } = require('../middlewares/auth');
const { PERFIS } = require('../lib/dominios');

const router = express.Router();

router.use(requirePerfil(PERFIS.ADMIN));

router.get('/_status', (req, res) => {
  res.json({ modulo: 'admin', implementado: false });
});

module.exports = router;
