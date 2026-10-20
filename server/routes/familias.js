'use strict';

// MÓDULO 3 — Acompanhamento Familiar. ESQUELETO: implemente aqui as rotas do módulo.
// Montado automaticamente em /api/familias (já exige sessão). Veja docs/CONVENCOES.md.
// Atenção LGPD: familia/familia_membro não têm unidade — só exponha-os via acompanhamento
// de uma unidade permitida (clausulaUnidades(req, 'ac.unidade_id', params)).

const express = require('express');
const { unidadesPermitidas } = require('../middlewares/auth');

const router = express.Router();

router.get('/_status', (req, res) => {
  res.json({ modulo: 'familias', implementado: false, unidades: unidadesPermitidas(req) });
});

module.exports = router;
