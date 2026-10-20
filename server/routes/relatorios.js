'use strict';

// MÓDULO 4 — Relatórios .docx. ESQUELETO: implemente aqui as rotas do módulo.
// Montado automaticamente em /api/relatorios (já exige sessão). Veja docs/CONVENCOES.md.
// Modelos Word originais: C:\Users\Eduardo Oliveira\Documents\ASSOCIAL\ (copie para /server/modelos).

const express = require('express');
const { unidadesPermitidas } = require('../middlewares/auth');

const router = express.Router();

router.get('/_status', (req, res) => {
  res.json({ modulo: 'relatorios', implementado: false, unidades: unidadesPermitidas(req) });
});

module.exports = router;
