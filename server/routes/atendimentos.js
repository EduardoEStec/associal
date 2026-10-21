'use strict';

// MÓDULO 1 — Atendimento Social. Montado em /api/atendimentos.
// Toda leitura/escrita é restrita às unidades do usuário (clausulaUnidades) — LGPD.

const express = require('express');
const { consultar, consultarUm, transacao, tipos } = require('../db');
const {
  requirePerfil, clausulaUnidades, resolverUnidade, exigirUnidade,
} = require('../middlewares/auth');
const { erros } = require('../lib/erros');
const { ehCoordenacao } = require('../lib/dominios');
const { registrarAuditoria } = require('../lib/auditoria');
const {
  lancarSeErros, inteiroPositivo, normalizarData, normalizarCpf, texto,
} = require('../lib/validacao');
const pessoas = require('../services/pessoas');
const svc = require('../services/atendimentos');

const router = express.Router();
const PRAZO_AUTOR_MS = 24 * 60 * 60 * 1000;

const podeExcluir = (usuario, atendimento) =>
  ehCoordenacao(usuario)
  || (atendimento.usuarioId === usuario.id && Date.now() - new Date(atendimento.criadoEm).getTime() <= PRAZO_AUTOR_MS);

// Carrega um atendimento restrito às unidades permitidas (404 se de outra unidade).
function carregar(req, id) {
  const params = { id };
  const where = clausulaUnidades(req, 'a.unidade_id', params);
  return consultarUm(
    `SELECT a.id, a.unidade_id, un.sigla AS unidade_sigla, un.nome AS unidade_nome, a.pessoa_id, a.usuario_id,
            u.nome AS atendente, a.data_atendimento, a.faixa_etaria_id, a.nivel_vulnerabilidade_id,
            a.demanda_outra, a.vulnerabilidade_outra, a.encaminhamento_outro, a.resumo, a.criado_em, a.alterado_em
       FROM atendimento a
       JOIN unidade un ON un.id = a.unidade_id
       JOIN usuario u ON u.id = a.usuario_id
      WHERE a.id = @id AND ${where}`,
    params,
  );
}

// GET /api/atendimentos?dataInicio&dataFim&unidadeId&q&demandaId&encaminhamentoId&pagina&porPagina
router.get('/', async (req, res) => {
  const params = {};
  const filtros = [clausulaUnidades(req, 'a.unidade_id', params)];
  const problemas = {};

  const dataInicio = normalizarData(req.query.dataInicio);
  const dataFim = normalizarData(req.query.dataFim);
  if (dataInicio === undefined) problemas.dataInicio = 'Data inválida.';
  if (dataFim === undefined) problemas.dataFim = 'Data inválida.';
  lancarSeErros(problemas);
  if (dataInicio) { filtros.push('a.data_atendimento >= @dataInicio'); params.dataInicio = [tipos.Date, dataInicio]; }
  if (dataFim) { filtros.push('a.data_atendimento <= @dataFim'); params.dataFim = [tipos.Date, dataFim]; }

  if (req.query.unidadeId) {
    const un = inteiroPositivo(req.query.unidadeId);
    if (!un) throw erros.validacao({ unidadeId: 'Unidade inválida.' });
    exigirUnidade(req, un);
    filtros.push('a.unidade_id = @filtroUnidade');
    params.filtroUnidade = un;
  }

  const q = texto(req.query.q, 150);
  if (q) {
    const digitos = normalizarCpf(q);
    if (digitos && digitos.length >= 3 && /^[\d.\-\s]+$/.test(q)) {
      filtros.push('p.cpf LIKE @cpfBusca');
      params.cpfBusca = `${digitos}%`;
    } else {
      filtros.push('p.nome LIKE @nomeBusca');
      params.nomeBusca = `%${q.replace(/[%_[]/g, (c) => `[${c}]`)}%`;
    }
  }
  const demandaId = inteiroPositivo(req.query.demandaId);
  if (demandaId) {
    filtros.push('EXISTS (SELECT 1 FROM atendimento_demanda ad WHERE ad.atendimento_id = a.id AND ad.demanda_id = @demandaId)');
    params.demandaId = demandaId;
  }
  const encaminhamentoId = inteiroPositivo(req.query.encaminhamentoId);
  if (encaminhamentoId) {
    filtros.push('EXISTS (SELECT 1 FROM atendimento_encaminhamento ae WHERE ae.atendimento_id = a.id AND ae.encaminhamento_id = @encaminhamentoId)');
    params.encaminhamentoId = encaminhamentoId;
  }

  const pagina = inteiroPositivo(req.query.pagina) || 1;
  const porPagina = Math.min(inteiroPositivo(req.query.porPagina) || 20, 100);
  const where = filtros.join(' AND ');
  const de = `FROM atendimento a JOIN pessoa p ON p.id = a.pessoa_id JOIN unidade un ON un.id = a.unidade_id WHERE ${where}`;

  const [{ total }] = await consultar(`SELECT COUNT(*) AS total ${de}`, params);
  const itens = await consultar(
    `SELECT a.id, a.data_atendimento, a.unidade_id, un.sigla AS unidade_sigla, p.id AS pessoa_id, p.nome, p.cpf,
            (SELECT STRING_AGG(d.nome, N', ') WITHIN GROUP (ORDER BY d.ordem)
               FROM atendimento_demanda ad JOIN demanda d ON d.id = ad.demanda_id WHERE ad.atendimento_id = a.id) AS demandas,
            (SELECT COUNT(*) FROM atendimento_encaminhamento ae WHERE ae.atendimento_id = a.id) AS qtd_encaminhamentos
     ${de}
     ORDER BY a.data_atendimento DESC, a.id DESC
     OFFSET @desvio ROWS FETCH NEXT @limite ROWS ONLY`,
    { ...params, desvio: (pagina - 1) * porPagina, limite: porPagina },
  );
  res.json({ itens, total, pagina, porPagina });
});

// GET /api/atendimentos/:id — com a pessoa e o histórico (só das unidades permitidas)
router.get('/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw erros.naoEncontrado();
  const atendimento = await carregar(req, id);
  if (!atendimento) throw erros.naoEncontrado();

  const [pessoa, demandas, vulnerabilidades, encaminhamentos] = await Promise.all([
    consultarUm(`SELECT ${pessoas.COLUNAS_PESSOA} FROM pessoa p WHERE p.id = @id`, { id: atendimento.pessoaId }),
    consultar('SELECT demanda_id AS id FROM atendimento_demanda WHERE atendimento_id = @id', { id }),
    consultar('SELECT vulnerabilidade_id AS id FROM atendimento_vulnerabilidade WHERE atendimento_id = @id', { id }),
    consultar('SELECT encaminhamento_id AS id FROM atendimento_encaminhamento WHERE atendimento_id = @id', { id }),
  ]);

  const paramsHist = { pessoaId: atendimento.pessoaId, id };
  const whereHist = clausulaUnidades(req, 'a.unidade_id', paramsHist);
  const historico = await consultar(
    `SELECT a.id, a.data_atendimento, un.sigla AS unidade_sigla,
            (SELECT STRING_AGG(d.nome, N', ') WITHIN GROUP (ORDER BY d.ordem)
               FROM atendimento_demanda ad JOIN demanda d ON d.id = ad.demanda_id WHERE ad.atendimento_id = a.id) AS demandas
       FROM atendimento a JOIN unidade un ON un.id = a.unidade_id
      WHERE a.pessoa_id = @pessoaId AND a.id <> @id AND ${whereHist}
      ORDER BY a.data_atendimento DESC, a.id DESC`,
    paramsHist,
  );

  const { usuarioId, ...resto } = atendimento;
  res.json({
    ...resto,
    demandas: demandas.map((d) => d.id),
    vulnerabilidades: vulnerabilidades.map((d) => d.id),
    encaminhamentos: encaminhamentos.map((d) => d.id),
    pessoa,
    historico,
    podeExcluir: podeExcluir(req.usuario, atendimento),
    podeEditar: true,
  });
});

// Descobre/cria a pessoa do atendimento novo. Retorna o id (dentro da transação).
async function resolverPessoa(req, tx, dados, pessoaIdInformada) {
  const p = dados.pessoa;
  let pessoaId = pessoaIdInformada;

  if (pessoaId) {
    const existe = await tx.consultarUm('SELECT id FROM pessoa WHERE id = @id', { id: pessoaId });
    if (!existe || (!pessoas.foiLocalizada(req, pessoaId) && !(await pessoas.pessoaNoEscopo(req, pessoaId, tx)))) {
      throw erros.validacao({ pessoaId: 'Pessoa não encontrada.' });
    }
  }
  if (p.cpf) {
    const porCpf = await pessoas.buscarPorCpf(p.cpf, tx);
    if (porCpf && pessoaId && porCpf.id !== pessoaId) {
      throw erros.conflito('Este CPF pertence a outra pessoa cadastrada.', { cpf: 'CPF já cadastrado.' });
    }
    pessoaId = porCpf?.id ?? pessoaId;
  }
  if (pessoaId) {
    await pessoas.atualizarPessoa(tx, pessoaId, p, req.usuario.id);
    return pessoaId;
  }
  return pessoas.criarPessoa(tx, p, req.usuario.id);
}

// POST /api/atendimentos
router.post('/', requirePerfil('ASSISTENTE', 'COORDENADOR', 'ADMIN'), async (req, res) => {
  const { dados, problemas } = svc.validarCorpo(req.body);
  await svc.validarApoio(dados, problemas);
  lancarSeErros(problemas);
  const unidadeId = resolverUnidade(req, req.body.unidadeId);
  const faixaEtariaId = await svc.definirFaixaEtaria(dados);

  const id = await transacao(async (tx) => {
    const pessoaId = await resolverPessoa(req, tx, dados, dados.pessoaId);
    const [novo] = await tx.consultar(
      `INSERT INTO atendimento (unidade_id, pessoa_id, usuario_id, data_atendimento, faixa_etaria_id,
                                nivel_vulnerabilidade_id, demanda_outra, vulnerabilidade_outra,
                                encaminhamento_outro, resumo, criado_por)
       OUTPUT INSERTED.id
       VALUES (@unidadeId, @pessoaId, @usuarioId, @dataAtendimento, @faixaEtariaId,
               @nivelVulnerabilidadeId, @demandaOutra, @vulnerabilidadeOutra,
               @encaminhamentoOutro, @resumo, @usuarioId)`,
      { ...svc.paramsAtendimento(dados, faixaEtariaId), unidadeId, pessoaId, usuarioId: req.usuario.id },
    );
    await svc.gravarListas(tx, novo.id, dados);
    await registrarAuditoria(req, 'CRIAR', 'atendimento', novo.id, undefined, tx);
    return novo.id;
  });
  res.status(201).json({ id });
});

// PUT /api/atendimentos/:id — substitui os dados (inclui dados pessoais da pessoa vinculada)
router.put('/:id', requirePerfil('ASSISTENTE', 'COORDENADOR', 'ADMIN'), async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw erros.naoEncontrado();
  const atual = await carregar(req, id);
  if (!atual) throw erros.naoEncontrado();

  const { dados, problemas } = svc.validarCorpo(req.body);
  await svc.validarApoio(dados, problemas, { somenteAtivas: false });
  lancarSeErros(problemas);
  const unidadeId = req.body.unidadeId ? exigirUnidade(req, req.body.unidadeId) : atual.unidadeId;
  const faixaEtariaId = await svc.definirFaixaEtaria(dados);

  if (dados.pessoa.cpf) {
    const outra = await pessoas.buscarPorCpf(dados.pessoa.cpf);
    if (outra && outra.id !== atual.pessoaId) {
      throw erros.conflito('Este CPF pertence a outra pessoa cadastrada.', { cpf: 'CPF já cadastrado.' });
    }
  }

  await transacao(async (tx) => {
    await pessoas.atualizarPessoa(tx, atual.pessoaId, dados.pessoa, req.usuario.id);
    await tx.consultar(
      `UPDATE atendimento
          SET unidade_id = @unidadeId, data_atendimento = @dataAtendimento, faixa_etaria_id = @faixaEtariaId,
              nivel_vulnerabilidade_id = @nivelVulnerabilidadeId, demanda_outra = @demandaOutra,
              vulnerabilidade_outra = @vulnerabilidadeOutra, encaminhamento_outro = @encaminhamentoOutro,
              resumo = @resumo, alterado_por = @usuarioId, alterado_em = SYSUTCDATETIME()
        WHERE id = @id`,
      { ...svc.paramsAtendimento(dados, faixaEtariaId), unidadeId, usuarioId: req.usuario.id, id },
    );
    await svc.gravarListas(tx, id, dados);
    await registrarAuditoria(req, 'ALTERAR', 'atendimento', id, undefined, tx);
  });
  res.json({ id });
});

// DELETE /api/atendimentos/:id — COORDENADOR/ADMIN, ou o próprio autor em até 24h
router.delete('/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw erros.naoEncontrado();
  const atual = await carregar(req, id);
  if (!atual) throw erros.naoEncontrado();
  if (!podeExcluir(req.usuario, atual)) {
    throw erros.proibido('Só o autor (em até 24 horas) ou a coordenação pode excluir este atendimento.');
  }
  await transacao(async (tx) => {
    await tx.consultar('DELETE FROM atendimento WHERE id = @id', { id }); // N:N em cascata
    await registrarAuditoria(req, 'EXCLUIR', 'atendimento', id, undefined, tx);
  });
  res.status(204).end();
});

module.exports = router;
