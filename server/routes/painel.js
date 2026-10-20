'use strict';

// MÓDULO 5 — Painel do Coordenador. ESQUELETO: implemente aqui as rotas do módulo.
// Montado automaticamente em /api/painel (já exige sessão). Veja docs/CONVENCOES.md.

const express = require('express');
const { requirePerfil, unidadesPermitidas } = require('../middlewares/auth');
const { PERFIS } = require('../lib/dominios');

const router = express.Router();

router.use(requirePerfil(PERFIS.COORDENADOR, PERFIS.ADMIN));

router.get('/_status', (req, res) => {
  res.json({ modulo: 'painel', implementado: false, unidades: unidadesPermitidas(req) });
});

module.exports = router;
