'use strict';

// Listas de opções para os formulários (somente leitura; a edição é do módulo admin).
//   GET /api/apoio            -> { demanda: [...], encaminhamento: [...], ..., unidades: [...] }
//   GET /api/apoio/:tabela    -> [{ id, nome, ordem, exigeTexto, ... }]
// Só opções ativas, ordenadas. As unidades devolvidas são as PERMITIDAS ao usuário.

const express = require('express');
const { consultar } = require('../db');
const { erros } = require('../lib/erros');
const { TABELAS_APOIO } = require('../lib/dominios');

const router = express.Router();

// Nome da tabela vem da whitelist TABELAS_APOIO — nunca de entrada livre.
function listar(tabela) {
  const extras = tabela === 'faixa_etaria' ? ', idade_min, idade_max' : '';
  return consultar(
    `SELECT id, nome, ordem, exige_texto${extras} FROM ${tabela} WHERE ativo = 1 ORDER BY ordem, nome`,
  );
}

router.get('/', async (req, res) => {
  const entradas = await Promise.all(TABELAS_APOIO.map(async (t) => [t, await listar(t)]));
  const dados = Object.fromEntries(entradas.map(([t, linhas]) => [t.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), linhas]));
  dados.unidades = req.usuario.unidades;
  res.json(dados);
});

router.get('/:tabela', async (req, res) => {
  if (!TABELAS_APOIO.includes(req.params.tabela)) throw erros.naoEncontrado('Tabela de apoio inexistente.');
  res.json(await listar(req.params.tabela));
});

module.exports = router;
