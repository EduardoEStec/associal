'use strict';

// MÓDULO 5 — Painel do Coordenador. Montado em /api/painel (já exige sessão).
// Agregações em server/services/painel.js. Tudo filtrado por unidade (clausulaUnidades).

const express = require('express');
const { requirePerfil } = require('../middlewares/auth');
const { PERFIS } = require('../lib/dominios');
const servico = require('../services/painel');
const familiasPainel = require('../services/painel-familias');

const router = express.Router();

// Resumo da tela inicial: todos os perfis (cada um vê só as suas unidades).
router.get('/resumo-inicio', async (req, res) => {
  res.json(await servico.resumoInicio(req));
});

router.use(requirePerfil(PERFIS.COORDENADOR, PERFIS.ADMIN));

// GET /api/painel/mensal?ano=2026&mes=3  |  ?inicio=2026-01-01&fim=2026-06-30  [&unidadeId=]
router.get('/mensal', async (req, res) => {
  const periodo = servico.lerPeriodo(req.query);
  res.json(await servico.indicadoresPorUnidade(req, periodo, servico.lerUnidadeFiltro(req)));
});

// GET /api/painel/evolucao?inicio=&fim=[&unidadeId=]  (padrão: últimos 6 meses até o mês corrente)
router.get('/evolucao', async (req, res) => {
  let periodo;
  if (req.query.inicio || req.query.fim || req.query.ano || req.query.mes) {
    periodo = servico.lerPeriodo(req.query);
  } else {
    const hoje = servico.hojeBrasil();
    let ano = Number(hoje.slice(0, 4));
    let mes = Number(hoje.slice(5, 7)) - 5;
    if (mes < 1) { mes += 12; ano -= 1; }
    periodo = { inicio: servico.limitesDoMes(ano, mes).inicio, fim: servico.limitesDoMes(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))).fim };
  }
  res.json(await servico.evolucaoMensal(req, periodo, servico.lerUnidadeFiltro(req)));
});

// GET /api/painel/perfil?inicio=&fim=[&unidadeId=]
router.get('/perfil', async (req, res) => {
  const periodo = servico.lerPeriodo(req.query);
  res.json(await servico.perfilPublico(req, periodo, servico.lerUnidadeFiltro(req)));
});

// GET /api/painel/progresso?inicio=&fim=[&unidadeId=] — progresso das famílias (índice da F5), metas, situação dos acompanhamentos
router.get('/progresso', async (req, res) => {
  const unidadeId = servico.lerUnidadeFiltro(req);
  res.json(await familiasPainel.progresso(req, servico.lerPeriodo(req.query), unidadeId ? [unidadeId] : null));
});

// GET /api/painel/satisfacao?inicio=&fim=[&unidadeId=] — NPS, concordância, taxas, semáforo e comentários (só COORDENADOR/ADMIN, que são os únicos perfis deste router)
router.get('/satisfacao', async (req, res) => {
  const unidadeId = servico.lerUnidadeFiltro(req);
  res.json(await familiasPainel.satisfacao(req, servico.lerPeriodo(req.query), unidadeId ? [unidadeId] : null, { comComentarios: true }));
});

// GET /api/painel/alertas[?unidadeId=]
router.get('/alertas', async (req, res) => {
  res.json(await servico.alertas(req, servico.lerUnidadeFiltro(req)));
});

module.exports = router;
