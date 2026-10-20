'use strict';

// MÓDULO 1 — Atendimento Social. ESQUELETO: implemente aqui as rotas do módulo.
// Montado automaticamente em /api/atendimentos (já exige sessão). Veja docs/CONVENCOES.md.

const express = require('express');
const { consultar } = require('../db');
const { clausulaUnidades, unidadesPermitidas } = require('../middlewares/auth');

const router = express.Router();

// Exemplo do padrão de filtro por unidade (pode ser removido pelo módulo).
router.get('/_status', async (req, res) => {
  const params = {};
  const where = clausulaUnidades(req, 'a.unidade_id', params);
  const [{ total }] = await consultar(`SELECT COUNT(*) AS total FROM atendimento a WHERE ${where}`, params);
  res.json({ modulo: 'atendimentos', implementado: false, unidades: unidadesPermitidas(req), total });
});

module.exports = router;
