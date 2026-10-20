'use strict';

// API de Pessoas (dados pessoais, únicos por CPF). Contrato: docs/API-PESSOAS.md
// LGPD: nenhuma resposta traz atendimentos/acompanhamentos, nem contadores ou datas deles.

const express = require('express');
const { consultar, consultarUm, transacao } = require('../db');
const { requirePerfil, clausulaUnidades } = require('../middlewares/auth');
const { erros } = require('../lib/erros');
const { registrarAuditoria } = require('../lib/auditoria');
const { normalizarCpf, cpfValido, lancarSeErros, inteiroPositivo, texto } = require('../lib/validacao');
const svc = require('../services/pessoas');

const router = express.Router();

// GET /api/pessoas/buscar?cpf=...  |  ?nome=...
router.get('/buscar', async (req, res) => {
  if (req.query.cpf !== undefined) {
    const cpf = normalizarCpf(req.query.cpf);
    if (!cpf || !cpfValido(cpf)) throw erros.validacao({ cpf: 'CPF inválido.' });
    const pessoa = await svc.buscarPorCpf(cpf);
    if (!pessoa) return res.json({ encontrada: false });
    svc.lembrarLocalizada(req, pessoa.id);
    return res.json({ encontrada: true, pessoa });
  }

  const nome = texto(req.query.nome, 150);
  if (!nome || nome.length < 3) throw erros.validacao({ nome: 'Digite ao menos 3 letras.' });
  const params = { nome: `%${nome.replace(/[%_[]/g, (c) => `[${c}]`)}%` };
  const whereA = clausulaUnidades(req, 'a.unidade_id', params, 'ua');
  const whereC = clausulaUnidades(req, 'ac.unidade_id', params, 'uc');
  const pessoas = await consultar(
    `SELECT TOP (20) ${svc.COLUNAS_PESSOA}
       FROM pessoa p
      WHERE p.nome LIKE @nome
        AND (EXISTS (SELECT 1 FROM atendimento a WHERE a.pessoa_id = p.id AND ${whereA})
          OR EXISTS (SELECT 1 FROM acompanhamento ac JOIN familia f ON f.id = ac.familia_id
                      WHERE f.responsavel_pessoa_id = p.id AND ${whereC}))
      ORDER BY p.nome`,
    params,
  );
  res.json({ pessoas });
});

// POST /api/pessoas
router.post('/', requirePerfil('ASSISTENTE', 'COORDENADOR'), async (req, res) => {
  const { dados, problemas } = svc.validarDadosPessoa(req.body);
  await svc.validarApoioPessoa(dados, problemas);
  lancarSeErros(problemas);

  if (dados.cpf && await svc.buscarPorCpf(dados.cpf)) {
    throw erros.conflito('Já existe uma pessoa cadastrada com este CPF.', { cpf: 'CPF já cadastrado.' });
  }
  const id = await transacao(async (tx) => {
    const novoId = await svc.criarPessoa(tx, dados, req.usuario.id);
    await registrarAuditoria(req, 'CRIAR', 'pessoa', novoId, undefined, tx);
    return novoId;
  });
  svc.lembrarLocalizada(req, id);
  res.status(201).json({ id });
});

// PUT /api/pessoas/:id — só dados pessoais; pessoa em unidade permitida ou recém-localizada por CPF
router.put('/:id', requirePerfil('ASSISTENTE', 'COORDENADOR'), async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw erros.naoEncontrado();
  const existe = await consultarUm('SELECT id FROM pessoa WHERE id = @id', { id });
  if (!existe) throw erros.naoEncontrado();
  if (!svc.foiLocalizada(req, id) && !(await svc.pessoaNoEscopo(req, id))) throw erros.naoEncontrado();

  const { dados, problemas } = svc.validarDadosPessoa(req.body);
  await svc.validarApoioPessoa(dados, problemas);
  lancarSeErros(problemas);

  if (dados.cpf) {
    const outra = await svc.buscarPorCpf(dados.cpf);
    if (outra && outra.id !== id) {
      throw erros.conflito('Já existe outra pessoa com este CPF.', { cpf: 'CPF já cadastrado.' });
    }
  }
  await transacao(async (tx) => {
    await svc.atualizarPessoa(tx, id, dados, req.usuario.id);
    await registrarAuditoria(req, 'ALTERAR', 'pessoa', id, undefined, tx);
  });
  res.json({ id });
});

module.exports = router;
