'use strict';

// Índice de progresso da família (F5, proposta seção 5): funções PURAS (sem banco), como compararFamilia.
// Cada resposta do questionário vira uma pontuação de 0 a 100; cada dimensão é a média ponderada dos itens
// respondidos; o índice geral é a média das dimensões com nível. O semáforo compara dois pontos no tempo.
//
// Mudou a fórmula? Aumente VERSAO_REGRA: o instantâneo (acompanhamento_indice) guarda a versão com que cada
// número foi calculado e `scripts/recalcular-indices.js` refaz os já gravados.
//
// Versão 1: questionário no formato anterior (LEGADO), 4 dimensões sobre as colunas fixas antigas.
// Versão 2 (M1): modelos oficiais inicial e final. O índice usa só os itens com PAR equivalente nos dois questionários
//   (docs/modelos/MAPEAMENTO.md): ALIMENTACAO (4 pares) e RENDA (1 par). ECONOMIA e AUTONOMIA não têm par nos modelos oficiais
//   e ficam sem nível (null) — as perguntas comparativas do final (1.4, 2.8, 3.4) entram na comparação por pares, não no índice.

const estado = require('./catalogo-estado');
const m1 = require('./modelos-m1');

const VERSAO_REGRA_LEGADO = 1;
const VERSAO_REGRA = 2;
const versaoDoModelo = (modelo) => (modelo === 'M1' ? VERSAO_REGRA : VERSAO_REGRA_LEGADO);
const TOLERANCIA_PADRAO = 5;
const SALARIO_MINIMO_PADRAO = 1621;

const DIMENSOES = Object.freeze(['ALIMENTACAO', 'RENDA', 'ECONOMIA', 'AUTONOMIA']);
const ROTULO_DIMENSAO = Object.freeze({
  GERAL: 'Índice geral',
  ALIMENTACAO: 'Alimentação',
  RENDA: 'Renda e trabalho',
  ECONOMIA: 'Economia e poupança',
  AUTONOMIA: 'Autonomia',
});
const ORDEM_TIPO = Object.freeze({ INICIAL: 0, REAVALIACAO: 1, FINAL: 2 });

// tipo: escala (posição na escala ordenada) | sim (sim = 100) | rendaPerCapita | proporcaoRenda
// percepcao: item "melhorou?"; no INICIAL mede "como está", sem referência de mudança, e pesa metade.
const ITENS = Object.freeze({
  ALIMENTACAO: [
    { campo: 'acessoAlimentosInNatura', tipo: 'escala' },
    { campo: 'frequenciaFrutasVerduras', tipo: 'escala' },
    { campo: 'qualidadeAlimentacao', tipo: 'escala', percepcao: true },
    { campo: 'saudeNutricional', tipo: 'escala', percepcao: true },
  ],
  RENDA: [
    { campo: 'rendaMensalMedia', tipo: 'rendaPerCapita' },
    { campo: 'qtdMembrosComRenda', tipo: 'proporcaoRenda' },
  ],
  ECONOMIA: [
    { campo: 'conseguePoupar', tipo: 'sim' },
    { campo: 'economiaMensalFaixa', tipo: 'escala' },
    { campo: 'capacidadePoupanca', tipo: 'escala' },
    { campo: 'gestaoFinanceira', tipo: 'escala', percepcao: true },
  ],
  AUTONOMIA: [
    { campo: 'empoderadaDecisoes', tipo: 'sim' },
    { campo: 'melhoriaPlanejamento', tipo: 'sim' },
  ],
});

const arredondar = (n, casas = 2) => { const f = 10 ** casas; return Math.round(n * f) / f; };
const numero = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// Renda per capita ÷ salário mínimo: até ¼ → 0 · ¼ a ½ → 1/3 · ½ a 1 → 2/3 · acima de 1 → 100 (a linha de ½ SM é a de baixa renda do CadÚnico)
const FAIXAS_RENDA = Object.freeze([[0.25, 0], [0.5, 100 / 3], [1, 200 / 3]]);
function faixaRenda(razao) {
  for (const [limite, pontos] of FAIXAS_RENDA) if (razao <= limite) return pontos;
  return 100;
}

function pontuarItem(item, r, { salarioMinimo }) {
  const v = r[item.campo];
  switch (item.tipo) {
    case 'escala': {
      // posição na escala oficial; opção acrescentada vale como a base indicada, e "não pontua" fica de fora (como não respondida)
      const pos = estado.posicaoNaEscala(item.campo, v);
      return pos ? (pos.indice / (pos.total - 1)) * 100 : null;
    }
    case 'sim':
      return v === true ? 100 : v === false ? 0 : null;
    case 'rendaPerCapita': {
      const renda = numero(v);
      const membros = numero(r.qtdMembrosFamilia);
      if (renda === null || membros === null || membros <= 0 || !(salarioMinimo > 0)) return null;
      return faixaRenda(renda / membros / salarioMinimo);
    }
    case 'proporcaoRenda': {
      const com = numero(v);
      const membros = numero(r.qtdMembrosFamilia);
      if (com === null || membros === null || membros <= 0) return null;
      return Math.min(100, (com / membros) * 100);
    }
    default: return null;
  }
}

// Regra v2 (M1). `respostas`: { modelo: 'M1', mapa: { "<código da pergunta>": resposta } } do questionário do `tipo`.
function calcularIndiceM1(respostas, { tipo = 'FINAL' } = {}) {
  const formulario = m1.formularioDoTipo(tipo);
  const lado = tipo === 'INICIAL' ? 'inicial' : 'final';
  const mapa = respostas.mapa || {};
  const dimensoes = {};
  for (const dim of DIMENSOES) {
    const pares = m1.PARES.filter((p) => p.indice === dim);
    const detalhe = [];
    for (const par of pares) {
      const codigo = par[lado];
      const valor = mapa[codigo];
      const pontos = valor === undefined || valor === null ? null : estado.pontosM1(formulario, codigo, valor);
      if (pontos !== null) detalhe.push({ campo: par.chave, pontos: arredondar(pontos), peso: 1 });
    }
    // só existe com pelo menos metade dos itens da dimensão respondidos; senão fica vazio (nunca zero)
    const suficiente = pares.length > 0 && detalhe.length >= pares.length / 2;
    dimensoes[dim] = {
      nivel: suficiente ? arredondar(detalhe.reduce((s, d) => s + d.pontos, 0) / detalhe.length) : null,
      itensValidos: detalhe.length,
      itensTotal: pares.length,
      itens: detalhe,
    };
  }
  const niveis = DIMENSOES.map((d) => dimensoes[d].nivel).filter((n) => n !== null);
  return {
    versaoRegra: VERSAO_REGRA,
    tipo,
    dimensoes,
    geral: {
      nivel: niveis.length ? arredondar(niveis.reduce((s, n) => s + n, 0) / niveis.length) : null,
      dimensoes: niveis.length,
      dimensoesTotal: DIMENSOES.filter((d) => dimensoes[d].itensTotal > 0).length,
    },
    parametros: { regra: 'M1' },
  };
}

// `respostas`: o objeto de montarRespostas (campos do questionário LEGADO) ou { modelo: 'M1', mapa } (regra v2).
// `tipo`: INICIAL | REAVALIACAO | FINAL.
// Devolve { versaoRegra, tipo, dimensoes: {DIM: {nivel, itensValidos, itensTotal, itens[]}}, geral: {nivel, dimensoes}, parametros }.
function calcularIndice(respostas, { tipo = 'FINAL', salarioMinimo = SALARIO_MINIMO_PADRAO } = {}) {
  if (respostas && respostas.modelo === 'M1') return calcularIndiceM1(respostas, { tipo });
  const r = respostas || {};
  const dimensoes = {};

  for (const dim of DIMENSOES) {
    const itens = ITENS[dim];
    let soma = 0;
    let pesos = 0;
    const detalhe = [];
    for (const item of itens) {
      const pontos = pontuarItem(item, r, { salarioMinimo });
      if (pontos === null) continue;
      const peso = item.percepcao && tipo === 'INICIAL' ? 0.5 : 1;
      soma += pontos * peso;
      pesos += peso;
      detalhe.push({ campo: item.campo, pontos: arredondar(pontos), peso });
    }
    // só existe com pelo menos metade dos itens da dimensão respondidos; senão fica vazio (nunca zero)
    const suficiente = detalhe.length >= itens.length / 2 && pesos > 0;
    dimensoes[dim] = {
      nivel: suficiente ? arredondar(soma / pesos) : null,
      itensValidos: detalhe.length,
      itensTotal: itens.length,
      itens: detalhe,
    };
  }

  const niveis = DIMENSOES.map((d) => dimensoes[d].nivel).filter((n) => n !== null);
  const renda = numero(r.rendaMensalMedia);
  const membros = numero(r.qtdMembrosFamilia);
  return {
    versaoRegra: VERSAO_REGRA_LEGADO,
    tipo,
    dimensoes,
    geral: {
      nivel: niveis.length ? arredondar(niveis.reduce((s, n) => s + n, 0) / niveis.length) : null,
      dimensoes: niveis.length,
    },
    parametros: {
      salarioMinimo,
      rendaPerCapita: renda !== null && membros > 0 ? arredondar(renda / membros) : null,
    },
  };
}

// Semáforo entre dois níveis: diferença ≥ +tolerância → melhorou; ≤ −tolerância → piorou; entre os dois → igual.
function classificarVariacao(antes, depois, tolerancia = TOLERANCIA_PADRAO) {
  if (antes === null || antes === undefined || depois === null || depois === undefined) {
    return { diferenca: null, selo: 'sem_dados' };
  }
  const diferenca = arredondar(depois - antes);
  const selo = diferenca >= tolerancia ? 'melhorou' : diferenca <= -tolerancia ? 'piorou' : 'igual';
  return { diferenca, selo };
}

// Compara dois pontos (resultados de calcularIndice). O geral da comparação usa só as dimensões que têm
// nível nos DOIS pontos, para uma dimensão a mais ou a menos não parecer progresso.
function compararPontos(antes, depois, tolerancia = TOLERANCIA_PADRAO) {
  const dimensoes = {};
  const comuns = [];
  for (const dim of DIMENSOES) {
    const a = antes.dimensoes[dim].nivel;
    const d = depois.dimensoes[dim].nivel;
    dimensoes[dim] = { antes: a, depois: d, ...classificarVariacao(a, d, tolerancia) };
    if (a !== null && d !== null) comuns.push(dim);
  }
  const media = (ponto) => arredondar(comuns.reduce((s, dim) => s + ponto.dimensoes[dim].nivel, 0) / comuns.length);
  const geral = comuns.length
    ? { antes: media(antes), depois: media(depois), dimensoesComparadas: comuns.length }
    : { antes: null, depois: null, dimensoesComparadas: 0 };
  return { geral: { ...geral, ...classificarVariacao(geral.antes, geral.depois, tolerancia) }, dimensoes };
}

// Evolução de uma família: `pontos` = [{ tipo, dataRef, ...calcularIndice }] em qualquer ordem.
// Compara o primeiro (inicial) com o mais recente e cada ponto com o anterior.
function montarEvolucao(pontos, tolerancia = TOLERANCIA_PADRAO) {
  const ordenados = [...pontos].sort((a, b) => String(a.dataRef).localeCompare(String(b.dataRef)) || ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo]);
  if (ordenados.length < 2) return { pontos: ordenados, comparacao: null, passos: [] };
  const passos = ordenados.slice(1).map((p, i) => ({ de: ordenados[i].tipo, para: p.tipo, ...compararPontos(ordenados[i], p, tolerancia) }));
  return {
    pontos: ordenados,
    comparacao: { de: ordenados[0].tipo, para: ordenados[ordenados.length - 1].tipo, ...compararPontos(ordenados[0], ordenados[ordenados.length - 1], tolerancia) },
    passos,
  };
}

// Reavaliação rápida: quando é devida e em que situação está (pura).
//   NAO_SE_APLICA (encerrado ou sem inicial concluído) · CONCLUIDA · DISPENSADA (final já feito) · PENDENTE (já passou da data) · AGENDADA
function situacaoReavaliacao({ status, inicialConcluido, reavaliacaoConcluida, finalConcluido, dataInicio, reavaliacaoDias, hoje }) {
  const inicio = dataInicio instanceof Date ? dataInicio.toISOString() : String(dataInicio);
  const base = new Date(`${inicio.slice(0, 10)}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + reavaliacaoDias);
  const dataPrevista = base.toISOString().slice(0, 10);
  let situacao;
  if (reavaliacaoConcluida) situacao = 'CONCLUIDA';
  else if (status !== 'EM_ANDAMENTO' || !inicialConcluido) situacao = 'NAO_SE_APLICA';
  else if (finalConcluido) situacao = 'DISPENSADA';
  else situacao = String(hoje) >= dataPrevista ? 'PENDENTE' : 'AGENDADA';
  return { situacao, dataPrevista };
}

module.exports = {
  VERSAO_REGRA,
  VERSAO_REGRA_LEGADO,
  versaoDoModelo,
  TOLERANCIA_PADRAO,
  SALARIO_MINIMO_PADRAO,
  DIMENSOES,
  ROTULO_DIMENSAO,
  ORDEM_TIPO,
  calcularIndice,
  calcularIndiceM1,
  classificarVariacao,
  compararPontos,
  montarEvolucao,
  situacaoReavaliacao,
};
