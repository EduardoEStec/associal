'use strict';

// MÓDULO 3 — Acompanhamento Familiar. Montado em /api/familias (já exige sessão).
// Contrato documentado em docs/API-FAMILIAS.md. Regras de negócio em server/services/familias*.js
// e server/services/questionario*.js. LGPD: família só é exposta via acompanhamento de unidade permitida.

const express = require('express');
const { requirePerfil } = require('../middlewares/auth');
const familias = require('../services/familias');
const questionarioDados = require('../services/questionario-dados');
const { montarModelo } = require('../services/questionario');
const registros = require('../services/acompanhamento-registros');

const router = express.Router();

// Escrita: assistentes e coordenação (ADMIN é TI e não opera dados de famílias).
const escrita = requirePerfil('ASSISTENTE', 'COORDENADOR');

// ----- rotas fixas (antes de /:id) -----

// GET /api/familias/questionario/modelo?tipo=INICIAL|FINAL — perguntas, textos e opções
router.get('/questionario/modelo', (req, res) => {
  res.json(montarModelo(String(req.query.tipo || 'INICIAL').toUpperCase() === 'FINAL' ? 'FINAL' : 'INICIAL'));
});

// GET /api/familias/comparacao?inicio=&fim=&unidadeId= — consolidado inicial × final
router.get('/comparacao', async (req, res) => {
  res.json(await questionarioDados.comparacaoConsolidada(req, req.query));
});

// ----- acompanhamentos -----

router.get('/acompanhamentos/:id', async (req, res) => {
  res.json(await familias.detalhar(req, req.params.id));
});

router.put('/acompanhamentos/:id', escrita, async (req, res) => {
  await familias.atualizar(req, req.params.id, req.body || {});
  res.json(await familias.detalhar(req, req.params.id));
});

router.post('/acompanhamentos/:id/encerrar', escrita, async (req, res) => {
  await familias.encerrar(req, req.params.id, req.body || {});
  res.json(await familias.detalhar(req, req.params.id));
});

router.get('/acompanhamentos/:id/questionarios/:tipo', async (req, res) => {
  res.json(await questionarioDados.obter(req, req.params.id, req.params.tipo));
});

router.put('/acompanhamentos/:id/questionarios/:tipo', escrita, async (req, res) => {
  res.json(await questionarioDados.salvar(req, req.params.id, req.params.tipo, req.body || {}));
});

router.get('/acompanhamentos/:id/comparacao', async (req, res) => {
  res.json(await questionarioDados.comparacaoFamilia(req, req.params.id));
});

// ----- registros de acompanhamento e linha do tempo (F2) -----

router.get('/acompanhamentos/:id/registros', async (req, res) => {
  res.json(await registros.listarRegistros(req, req.params.id));
});

router.post('/acompanhamentos/:id/registros', escrita, async (req, res) => {
  res.status(201).json(await registros.criarRegistro(req, req.params.id, req.body || {}));
});

router.put('/acompanhamentos/:id/registros/:registroId', escrita, async (req, res) => {
  await registros.atualizarRegistro(req, req.params.id, req.params.registroId, req.body || {});
  res.json(await registros.listarRegistros(req, req.params.id));
});

router.post('/acompanhamentos/:id/registros/:registroId/anular', escrita, async (req, res) => {
  await registros.anularRegistro(req, req.params.id, req.params.registroId, req.body || {});
  res.json(await registros.listarRegistros(req, req.params.id));
});

router.get('/acompanhamentos/:id/linha-do-tempo', async (req, res) => {
  res.json(await registros.linhaDoTempo(req, req.params.id, req.query));
});

// ----- lista e cadastro -----

// GET /api/familias?unidadeId=&status=&finalSituacao=&q=&pagina=&tamanho=
router.get('/', async (req, res) => {
  res.json(await familias.listar(req, req.query));
});

// POST /api/familias — cria família + acompanhamento
router.post('/', escrita, async (req, res) => {
  const resultado = await familias.criar(req, req.body || {});
  res.status(201).json(resultado);
});

module.exports = router;
