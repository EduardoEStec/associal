'use strict';

// MÓDULO 2 — Visitas e Ações. ESQUELETO: implemente aqui as rotas do módulo.
// Montado automaticamente em /api/acoes (já exige sessão). Veja docs/CONVENCOES.md.
// Fotos: multer gravando em config.uploadDir; servir só via rota autenticada + filtro de unidade.

const express = require('express');
const { unidadesPermitidas } = require('../middlewares/auth');

const router = express.Router();

router.get('/_status', (req, res) => {
  res.json({ modulo: 'acoes', implementado: false, unidades: unidadesPermitidas(req) });
});

module.exports = router;
