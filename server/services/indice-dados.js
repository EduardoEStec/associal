'use strict';

// Índice de progresso (F5): leitura/gravação do instantâneo (acompanhamento_indice) e a consulta da aba Indicadores.
// As regras de cálculo ficam em ./indice-progresso.js (puras).

const { consultar, tipos } = require('../db');
const { carregarAcompanhamento, hojeIso } = require('./familias');
const { montarRespostas } = require('./questionario');
const regras = require('./indice-progresso');
const extras = require('./extras');
const { formularioDoTipo } = require('./modelos-m1');
const catalogo = require('./catalogo');

const isoData = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const DIMENSOES_GRAVADAS = ['GERAL', ...regras.DIMENSOES];

// { tolerancia, salarioMinimo, reavaliacaoDias } (configuração editável, com padrão se ausente/inválida)
async function lerParametros(executor = { consultar }) {
  const linhas = await executor.consultar(
    "SELECT chave, valor FROM ASSOCIAL_configuracao WHERE chave IN ('indice_tolerancia_pontos', 'salario_minimo_referencia', 'reavaliacao_dias')");
  const mapa = Object.fromEntries(linhas.map((l) => [l.chave, Number(l.valor)]));
  const positivo = (v, padrao) => (Number.isFinite(v) && v > 0 ? v : padrao);
  return {
    tolerancia: positivo(mapa.indice_tolerancia_pontos, regras.TOLERANCIA_PADRAO),
    salarioMinimo: positivo(mapa.salario_minimo_referencia, regras.SALARIO_MINIMO_PADRAO),
    reavaliacaoDias: positivo(mapa.reavaliacao_dias, 45),
  };
}

// Respostas de um questionário (linha de dbo.ASSOCIAL_questionario) no formato que o cálculo espera:
// LEGADO -> campos das colunas fixas; M1 -> { modelo: 'M1', mapa: { "<código>": resposta } } lido de dbo.ASSOCIAL_resposta_extra.
async function respostasDoQuestionario(executor, q) {
  if (q.modelo !== 'M1') return montarRespostas(q);
  const { mapa } = await extras.carregarRespostas(executor, formularioDoTipo(q.tipo), q.id);
  return { modelo: 'M1', mapa };
}

// Calcula e grava (substituindo) o instantâneo de UM questionário concluído. `executor`: transação ou { consultar }.
// `respostas`: campos do questionário (a mesma forma de montarRespostas).
async function gravarInstantaneo(executor, { acompanhamentoId, questionarioId, tipo, dataRef, respostas }) {
  const { salarioMinimo } = await lerParametros(executor);
  const calc = regras.calcularIndice(respostas, { tipo, salarioMinimo });
  await executor.consultar('DELETE FROM ASSOCIAL_acompanhamento_indice WHERE questionario_id = @q', { q: questionarioId });
  const parametros = JSON.stringify(calc.parametros);
  for (const dim of DIMENSOES_GRAVADAS) {
    const d = dim === 'GERAL'
      ? { nivel: calc.geral.nivel, itensValidos: calc.geral.dimensoes, itensTotal: calc.geral.dimensoesTotal ?? regras.DIMENSOES.length }
      : calc.dimensoes[dim];
    await executor.consultar(
      `INSERT INTO ASSOCIAL_acompanhamento_indice (acompanhamento_id, questionario_id, tipo, data_ref, dimensao, nivel, itens_validos, itens_total, versao_regra, parametros)
       VALUES (@ac, @q, @tipo, @data, @dim, @nivel, @validos, @total, @versao, @parametros)`,
      {
        ac: acompanhamentoId, q: questionarioId, tipo, data: [tipos.Date, dataRef], dim,
        nivel: [tipos.Decimal(5, 2), d.nivel], validos: d.itensValidos, total: d.itensTotal,
        versao: calc.versaoRegra, parametros,
      });
  }
  return calc;
}

// Refaz o instantâneo de todos os questionários concluídos (script de recálculo e testes). Devolve a quantidade.
async function recalcularTodos(executor = { consultar }) {
  await catalogo.carregar(); // fora do servidor (script, teste) o catálogo em memória ainda não foi carregado: as respostas M1 dependem dele
  const linhas = await executor.consultar('SELECT * FROM ASSOCIAL_questionario WHERE concluido = 1 ORDER BY id');
  for (const q of linhas) {
    await gravarInstantaneo(executor, {
      acompanhamentoId: q.acompanhamentoId, questionarioId: q.id, tipo: q.tipo, dataRef: isoData(q.dataAplicacao),
      respostas: await respostasDoQuestionario(executor, q),
    });
  }
  return linhas.length;
}

function pontoDeLinhas(q, linhas) {
  const porDim = Object.fromEntries(linhas.map((l) => [l.dimensao, l]));
  const dimensoes = {};
  for (const dim of regras.DIMENSOES) {
    const l = porDim[dim];
    dimensoes[dim] = { nivel: l.nivel === null ? null : Number(l.nivel), itensValidos: l.itensValidos, itensTotal: l.itensTotal };
  }
  const g = porDim.GERAL;
  let parametros = null;
  try { parametros = g.parametros ? JSON.parse(g.parametros) : null; } catch { /* instantâneo sem parâmetros legíveis */ }
  return {
    questionarioId: q.id, tipo: q.tipo, dataRef: isoData(q.dataAplicacao), versaoRegra: g.versaoRegra,
    dimensoes, geral: { nivel: g.nivel === null ? null : Number(g.nivel), dimensoes: g.itensValidos }, parametros,
  };
}

// GET /api/familias/acompanhamentos/:id/indicadores
async function obterIndicadores(req, acompanhamentoId) {
  const ac = await carregarAcompanhamento(req, acompanhamentoId);
  const hoje = hojeIso();
  const params = await lerParametros();

  const questionarios = await consultar('SELECT * FROM ASSOCIAL_questionario WHERE acompanhamento_id = @ac', { ac: ac.id });
  const concluidos = questionarios.filter((q) => q.concluido);
  const instantaneo = concluidos.length
    ? await consultar('SELECT * FROM ASSOCIAL_acompanhamento_indice WHERE acompanhamento_id = @ac', { ac: ac.id })
    : [];

  const pontos = [];
  for (const q of concluidos) {
    const linhas = instantaneo.filter((l) => l.questionarioId === q.id);
    if (linhas.length === DIMENSOES_GRAVADAS.length) {
      const p = pontoDeLinhas(q, linhas);
      pontos.push({ ...p, modelo: q.modelo, desatualizado: p.versaoRegra !== regras.versaoDoModelo(q.modelo) });
      continue;
    }
    // questionário concluído antes da F5 e ainda sem instantâneo: calcula na hora (o script de recálculo grava)
    const calc = regras.calcularIndice(await respostasDoQuestionario({ consultar }, q), { tipo: q.tipo, salarioMinimo: params.salarioMinimo });
    pontos.push({
      modelo: q.modelo,
      questionarioId: q.id, tipo: q.tipo, dataRef: isoData(q.dataAplicacao), versaoRegra: calc.versaoRegra,
      dimensoes: Object.fromEntries(regras.DIMENSOES.map((d) => [d, { nivel: calc.dimensoes[d].nivel, itensValidos: calc.dimensoes[d].itensValidos, itensTotal: calc.dimensoes[d].itensTotal }])),
      geral: calc.geral, parametros: calc.parametros, desatualizado: false, calculadoAgora: true,
    });
  }

  const evolucao = regras.montarEvolucao(pontos, params.tolerancia);

  const situacoes = await consultar(
    `SELECT data_registro, situacao FROM ASSOCIAL_acompanhamento_registro
      WHERE acompanhamento_id = @ac AND houve_contato = 1 AND anulado_em IS NULL AND situacao IN ('MELHORANDO', 'IGUAL', 'PIORANDO')
      ORDER BY data_registro, id`, { ac: ac.id });

  const achar = (t) => questionarios.find((q) => q.tipo === t);
  const reav = regras.situacaoReavaliacao({
    status: ac.status,
    inicialConcluido: !!achar('INICIAL')?.concluido,
    reavaliacaoConcluida: !!achar('REAVALIACAO')?.concluido,
    finalConcluido: !!achar('FINAL')?.concluido,
    dataInicio: ac.dataInicio, reavaliacaoDias: params.reavaliacaoDias, hoje,
  });

  return {
    acompanhamentoId: ac.id,
    status: ac.status,
    versaoRegra: regras.VERSAO_REGRA,
    tolerancia: params.tolerancia,
    salarioMinimo: params.salarioMinimo,
    rotulos: regras.ROTULO_DIMENSAO,
    pontos: evolucao.pontos,
    comparacao: evolucao.comparacao,
    passos: evolucao.passos,
    reavaliacao: { ...reav, existe: !!achar('REAVALIACAO'), concluida: !!achar('REAVALIACAO')?.concluido },
    situacoesRegistros: situacoes.map((s) => ({ data: isoData(s.dataRegistro), situacao: s.situacao })),
  };
}

module.exports = { lerParametros, gravarInstantaneo, recalcularTodos, obterIndicadores };
