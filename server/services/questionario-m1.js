'use strict';

// Questionários M1 (modelos oficiais 1 e 3): modelo das perguntas para a tela, regras de validação além das do catálogo,
// comparação inicial × final POR PARES equivalentes e consolidação para o relatório semestral. Funções PURAS (sem banco).
//
// As respostas trafegam por código de pergunta ("2.1", "E0001"): { "2.1": "TRABALHO_FORMAL", "2.3": 2, "3.3": ["MORADIA"] }.
// As regras usam o CAMPO estável da pergunta oficial (fonteRenda, rendaFaixa, alimentosSuficientes...), via `porCampo`.

const estado = require('./catalogo-estado');
const m1 = require('./modelos-m1');

const TENDENCIA = Object.freeze({ MELHOROU: 'melhorou', IGUAL: 'igual', PIOROU: 'piorou', NEUTRO: 'neutro', SEM_DADOS: 'sem_dados' });
const TOLERANCIA_PAR = 1; // diferença de pontos (0 a 100) a partir da qual o par conta como melhora/piora

// tipo de pergunta do catálogo -> tipo usado pela tela
const TIPO_TELA = Object.freeze({ TEXTO: 'texto', NUMERO: 'numero', SIM_NAO: 'booleano', ESCOLHA: 'escolha', MULTIPLA: 'multipla' });

const arredondar = (n, casas = 2) => { const f = 10 ** casas; return Math.round(n * f) / f; };

const ehReavaliacao = (tipo) => tipo === 'REAVALIACAO';

// Perguntas ATIVAS que o tipo de questionário aplica (a reavaliação rápida usa só o subconjunto de estado do FINAL).
function perguntasDoTipo(tipo) {
  const formulario = m1.formularioDoTipo(tipo);
  const lista = estado.m1Ativas(formulario);
  return ehReavaliacao(tipo) ? lista.filter((p) => p.oficial && m1.CODIGOS_REAVALIACAO.includes(p.codigo)) : lista;
}

// Modelo entregue à tela (GET /api/familias/questionario/modelo?tipo=)
function montarModeloM1(tipo) {
  const formulario = m1.formularioDoTipo(tipo);
  const perguntas = perguntasDoTipo(tipo);
  const blocos = m1.SECOES[formulario]
    .map((s) => ({
      numero: s.numero,
      titulo: s.titulo,
      perguntas: perguntas.filter((p) => p.secao === s.numero).map((p) => ({
        codigo: p.codigo,
        campo: p.campo,
        extra: !p.oficial,
        tipo: TIPO_TELA[p.tipo],
        texto: p.texto,
        ajuda: p.ajuda || null,
        obrigatoria: !!p.obrigatoria,
        min: p.min,
        max: p.max,
        ...(p.tipo === 'ESCOLHA' || p.tipo === 'MULTIPLA'
          ? { opcoes: [...p.opcoes].sort((a, b) => a.ordem - b.ordem || a.id - b.id).map((o) => ({ valor: o.codigo, rotulo: o.texto, ativa: o.ativa, pedeDetalhe: !!o.pedeDetalhe })) }
          : {}),
      })),
    }))
    .filter((b) => b.perguntas.length > 0);
  return { tipo, modelo: 'M1', formulario, blocos };
}

// Respostas por código -> por campo estável (só as perguntas oficiais)
function porCampo(formulario, mapa) {
  const saida = {};
  for (const p of estado.m1Todas(formulario)) {
    if (p.oficial && p.campo && mapa && mapa[p.codigo] !== undefined) saida[p.campo] = mapa[p.codigo];
  }
  return saida;
}

// Regras que o catálogo genérico não cobre. `mapa`: respostas por código já enviadas. Devolve erros por "extras.<código>".
function validarRegrasM1(tipo, mapa) {
  const erros = {};
  if (tipo === 'INICIAL') {
    const integrantes = Number(mapa['1.1']);
    const comRenda = Number(mapa['2.3']);
    if (Number.isFinite(integrantes) && Number.isFinite(comRenda) && mapa['1.1'] !== null && mapa['2.3'] !== null
      && mapa['1.1'] !== '' && mapa['2.3'] !== '' && comRenda > integrantes) {
      erros['extras.2.3'] = 'Não pode ser maior que o número de integrantes da família.';
    }
  }
  return erros;
}

// ---------------------------------------------------------------------------
// Leitura legível
// ---------------------------------------------------------------------------

function rotuloOpcao(formulario, codigoPergunta, codigoOpcao) {
  if (codigoOpcao === null || codigoOpcao === undefined || codigoOpcao === '') return null;
  const o = estado.perguntaM1(formulario, codigoPergunta)?.opcoes.find((x) => x.codigo === codigoOpcao);
  return o ? o.texto : String(codigoOpcao);
}

const rotuloPergunta = (formulario, codigo) => estado.perguntaM1(formulario, codigo)?.texto || codigo;

function rotuloResposta(formulario, codigoPergunta, valor, detalhe) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (Array.isArray(valor)) {
    const pergunta = estado.perguntaM1(formulario, codigoPergunta);
    return valor.map((v) => {
      const rotulo = rotuloOpcao(formulario, codigoPergunta, v);
      return detalhe && pergunta?.opcoes.find((o) => o.codigo === v)?.pedeDetalhe ? `${rotulo}: ${detalhe}` : rotulo;
    }).join('; ');
  }
  const pergunta = estado.perguntaM1(formulario, codigoPergunta);
  if (pergunta?.tipo === 'SIM_NAO') return valor === true ? 'Sim' : 'Não';
  if (pergunta?.tipo === 'ESCOLHA') {
    const base = rotuloOpcao(formulario, codigoPergunta, valor);
    return detalhe ? `${base}: ${detalhe}` : base;
  }
  return String(valor);
}

// ---------------------------------------------------------------------------
// Comparação inicial × final por pares
// ---------------------------------------------------------------------------

function tendenciaPorPontos(pi, pf, tolerancia = TOLERANCIA_PAR) {
  if (pi === null || pi === undefined || pf === null || pf === undefined) return TENDENCIA.SEM_DADOS;
  const d = pf - pi;
  return d >= tolerancia ? TENDENCIA.MELHOROU : d <= -tolerancia ? TENDENCIA.PIOROU : TENDENCIA.IGUAL;
}

function ladoDoPar(formulario, codigo, mapa, detalhes) {
  const valor = mapa ? mapa[codigo] : undefined;
  return {
    codigo,
    valor: valor === undefined ? null : valor,
    rotulo: rotuloResposta(formulario, codigo, valor, detalhes?.[codigo]),
    pontos: valor === undefined || valor === null ? null : estado.pontosM1(formulario, codigo, valor),
  };
}

// inicial / final: { mapa (por código), detalhes }. Devolve itens por par + perguntas comparativas do final + resumo.
function compararPares(inicial, final) {
  const itens = [];
  const resumo = { melhorou: 0, igual: 0, piorou: 0, neutro: 0, semDados: 0, comparaveis: 0 };
  const contar = (t) => {
    if (t === TENDENCIA.MELHOROU) resumo.melhorou += 1;
    else if (t === TENDENCIA.IGUAL) resumo.igual += 1;
    else if (t === TENDENCIA.PIOROU) resumo.piorou += 1;
    else if (t === TENDENCIA.SEM_DADOS) resumo.semDados += 1;
    else resumo.neutro += 1;
  };

  for (const par of m1.PARES) {
    const i = ladoDoPar(m1.FORMULARIO_INICIAL, par.inicial, inicial?.mapa, inicial?.detalhes);
    const f = ladoDoPar(m1.FORMULARIO_FINAL, par.final, final?.mapa, final?.detalhes);
    let tendencia;
    if (i.valor === null || f.valor === null) tendencia = TENDENCIA.SEM_DADOS;
    else if (i.pontos === null && f.pontos === null) tendencia = i.valor === f.valor ? TENDENCIA.IGUAL : TENDENCIA.NEUTRO; // fonte de renda: mudou, sem juízo
    else tendencia = tendenciaPorPontos(i.pontos, f.pontos);
    itens.push({
      chave: par.chave, rotulo: par.rotulo, aproximado: !!par.aproximado, indice: par.indice,
      perguntaInicial: rotuloPergunta(m1.FORMULARIO_INICIAL, par.inicial), perguntaFinal: rotuloPergunta(m1.FORMULARIO_FINAL, par.final),
      inicial: i, final: f, tendencia,
    });
    contar(tendencia);
  }

  const comparativas = m1.COMPARATIVAS_FINAL.map((c) => {
    const f = ladoDoPar(m1.FORMULARIO_FINAL, c.codigo, final?.mapa, final?.detalhes);
    const tendencia = f.valor === null || f.pontos === null ? TENDENCIA.SEM_DADOS
      : f.pontos > 50 ? TENDENCIA.MELHOROU : f.pontos < 50 ? TENDENCIA.PIOROU : TENDENCIA.IGUAL;
    contar(tendencia);
    return { codigo: c.codigo, rotulo: c.rotulo, pergunta: rotuloPergunta(m1.FORMULARIO_FINAL, c.codigo), final: f, tendencia };
  });
  resumo.comparaveis = resumo.melhorou + resumo.igual + resumo.piorou;
  return { itens, comparativas, resumo };
}

// ---------------------------------------------------------------------------
// Consolidação (relatório semestral): mesmas tabelas "indicadores" e "distribuicoes" do formato anterior
// ---------------------------------------------------------------------------

const percentualTxt = (parte, total) => (total > 0
  ? `${((parte / total) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—');

// pares: [{ inicial: { mapa, detalhes }, final: { mapa, detalhes } }] (os dois no formato M1, concluídos)
function consolidarM1(pares) {
  const total = pares.length;
  const indicadores = [];
  const distribuicoes = [];
  const contagem = (lista) => {
    const c = { melhoraram: 0, iguais: 0, pioraram: 0, semDados: 0 };
    for (const t of lista) {
      if (t === TENDENCIA.MELHOROU) c.melhoraram += 1;
      else if (t === TENDENCIA.PIOROU) c.pioraram += 1;
      else if (t === TENDENCIA.IGUAL) c.iguais += 1;
      else if (t === TENDENCIA.SEM_DADOS) c.semDados += 1;
    }
    return c;
  };

  const comparados = pares.map((p) => compararPares(p.inicial, p.final));
  const porPar = [];
  m1.PARES.forEach((par, idx) => {
    const t = contagem(comparados.map((c) => c.itens[idx].tendencia));
    porPar.push({ chave: par.chave, rotulo: par.rotulo, aproximado: !!par.aproximado, ...t });
    const comTendencia = t.melhoraram + t.iguais + t.pioraram;
    indicadores.push({
      rotulo: `${par.rotulo}${par.aproximado ? ' (equivalência aproximada)' : ''}: famílias que melhoraram`,
      inicial: '—',
      final: comTendencia ? `${percentualTxt(t.melhoraram, comTendencia)} (${t.melhoraram} de ${comTendencia})` : '—',
    });
    const opcoesI = new Map();
    const opcoesF = new Map();
    for (const p of pares) {
      const vi = p.inicial.mapa[par.inicial];
      const vf = p.final.mapa[par.final];
      if (vi !== undefined && vi !== null) opcoesI.set(vi, (opcoesI.get(vi) || 0) + 1);
      if (vf !== undefined && vf !== null) opcoesF.set(vf, (opcoesF.get(vf) || 0) + 1);
    }
    for (const rotuloI of new Set([...opcoesI.keys()])) {
      distribuicoes.push({ pergunta: `${par.rotulo} (início)`, resposta: rotuloOpcao(m1.FORMULARIO_INICIAL, par.inicial, rotuloI), inicial: String(opcoesI.get(rotuloI)), final: '—' });
    }
    for (const cod of opcoesF.keys()) {
      distribuicoes.push({ pergunta: `${par.rotulo} (final)`, resposta: rotuloOpcao(m1.FORMULARIO_FINAL, par.final, cod), inicial: '—', final: String(opcoesF.get(cod)) });
    }
  });

  const porComparativa = m1.COMPARATIVAS_FINAL.map((c, idx) => {
    const t = contagem(comparados.map((x) => x.comparativas[idx].tendencia));
    const comTendencia = t.melhoraram + t.iguais + t.pioraram;
    indicadores.push({
      rotulo: `${c.rotulo}: famílias que relatam melhora`,
      inicial: '—',
      final: comTendencia ? `${percentualTxt(t.melhoraram, comTendencia)} (${t.melhoraram} de ${comTendencia})` : '—',
    });
    return { codigo: c.codigo, rotulo: c.rotulo, ...t };
  });

  // perguntas só do final: economia mensal, avaliação geral, recomendação
  const finalDe = (codigo) => pares.map((p) => p.final.mapa[codigo]);
  const dist = (codigo, rotuloPerg) => {
    const cont = new Map();
    for (const v of finalDe(codigo)) if (v !== undefined && v !== null) cont.set(v, (cont.get(v) || 0) + 1);
    for (const [cod, n] of cont) distribuicoes.push({ pergunta: rotuloPerg, resposta: rotuloOpcao(m1.FORMULARIO_FINAL, codigo, cod), inicial: '—', final: String(n) });
  };
  dist('3.2', 'Economia mensal no armazém (final)');
  dist('4.5', 'Avaliação geral do armazém (final)');
  const recomenda = finalDe('4.6').filter((v) => v === true || v === false);
  indicadores.push({
    rotulo: 'Recomendaria o projeto (sim)',
    inicial: '—',
    final: recomenda.length ? `${percentualTxt(recomenda.filter((v) => v === true).length, recomenda.length)} (${recomenda.filter((v) => v === true).length} de ${recomenda.length})` : '—',
  });
  const despesas = new Map();
  for (const v of finalDe('3.3')) for (const cod of v || []) despesas.set(cod, (despesas.get(cod) || 0) + 1);
  for (const [cod, n] of despesas) distribuicoes.push({ pergunta: 'Despesas priorizadas com a economia (final)', resposta: rotuloOpcao(m1.FORMULARIO_FINAL, '3.3', cod), inicial: '—', final: String(n) });

  return { modelo: 'M1', pares: total, indicadores, distribuicoes, porPar, porComparativa };
}

module.exports = {
  TENDENCIA, TIPO_TELA,
  perguntasDoTipo, montarModeloM1, porCampo, validarRegrasM1,
  rotuloOpcao, rotuloPergunta, rotuloResposta,
  tendenciaPorPontos, compararPares, consolidarM1,
};
