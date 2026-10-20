'use strict';

// MÓDULO 4 — Relatórios (.docx) e exportação CSV. Montado em /api/relatorios (exige sessão).
//   GET  /opcoes                              unidades, semestre atual, assinatura
//   GET  /individual/acompanhamentos          famílias acompanhadas (para escolher)
//   GET  /individual/:id/previa               textos padrão para editar
//   POST /individual/:id                      gera o .docx (com os textos editados)
//   GET  /semestral/previa                    números, relatos e fotos candidatos
//   POST /semestral                           gera o .docx
//   GET  /foto/:id                            miniatura de foto (autenticada, com checagem de unidade)
//   GET  /exportar/atendimentos.csv | acoes.csv

const express = require('express');
const { erros } = require('../lib/erros');
const { inteiroPositivo, texto } = require('../lib/validacao');
const { registrarAuditoria } = require('../lib/auditoria');
const servico = require('../services/relatorios');
const dados = require('../services/relatorios-dados');

const router = express.Router();

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CSV = 'text/csv; charset=utf-8';
const TIPOS_FOTO = { 'image/jpeg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp' };

function idDaRota(req) {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw erros.naoEncontrado();
  return id;
}

router.get('/opcoes', (req, res) => {
  const u = req.usuario;
  res.json({
    unidades: u.unidades,
    semestre: servico.semestreAtual(),
    hoje: servico.hoje(),
    usuario: { nome: u.nome, cress: u.cress || '', perfil: u.perfil },
    consolidaTodas: u.perfil !== 'ASSISTENTE',
  });
});

// ---------- individual ----------

router.get('/individual/acompanhamentos', async (req, res) => {
  const unidadeId = req.query.unidadeId ? inteiroPositivo(req.query.unidadeId) : null;
  if (req.query.unidadeId && !unidadeId) throw erros.validacao({ unidadeId: 'Unidade inválida.' });
  const busca = texto(req.query.busca, 100);
  res.json(await dados.listarAcompanhamentos(req, { unidadeId, busca }));
});

router.get('/individual/:id/previa', async (req, res) => {
  res.json(await servico.previaIndividual(req, idDaRota(req)));
});

router.post('/individual/:id', async (req, res) => {
  const id = idDaRota(req);
  const { buffer, nomeArquivo } = await servico.gerarIndividual(req, id);
  await registrarAuditoria(req, 'CONSULTAR', 'relatorio_individual', id, { formato: 'docx' });
  servico.enviarPara(res, buffer, nomeArquivo, DOCX);
});

// ---------- semestral ----------

router.get('/semestral/previa', async (req, res) => {
  res.json(await servico.previaSemestral(req, req.query));
});

router.post('/semestral', async (req, res) => {
  const { buffer, nomeArquivo, resumo } = await servico.gerarSemestral(req);
  await registrarAuditoria(req, 'CONSULTAR', 'relatorio_semestral', null, { formato: 'docx', ...resumo });
  servico.enviarPara(res, buffer, nomeArquivo, DOCX);
});

// ---------- fotos (seleção dos anexos) ----------

router.get('/foto/:id', async (req, res) => {
  const foto = await dados.carregarFotoDoUsuario(req, idDaRota(req));
  if (!foto) throw erros.naoEncontrado();
  res.setHeader('Content-Type', TIPOS_FOTO[foto.mimeType] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(foto.caminho);
});

// ---------- exportação (transição das planilhas) ----------

async function exportar(req, res, gerador, prefixo) {
  const { periodo, buffer } = await gerador(req, req.query);
  await registrarAuditoria(req, 'CONSULTAR', `exportacao_${prefixo}`, null, { formato: 'csv' });
  servico.enviarPara(res, buffer, `${prefixo}_${periodo.dataInicio}_a_${periodo.dataFim}.csv`, CSV);
}

router.get('/exportar/atendimentos.csv', (req, res) => exportar(req, res, servico.csvAtendimentos, 'atendimentos'));
router.get('/exportar/acoes.csv', (req, res) => exportar(req, res, servico.csvAcoes, 'acoes'));

module.exports = router;
