'use strict';

// Relatório semestral (F6, proposta 7.4): seções "Acompanhamento e evolução das famílias" e "Satisfação das famílias".
// Textos padrão editáveis na tela, dados das tabelas do .docx e CSV. Reaproveita as agregações do painel (painel-familias.js),
// com o mesmo n mínimo (pesquisa_n_minimo): abaixo dele só o número absoluto, sem percentuais, nota geral ou semáforo.

const painel = require('./painel-familias');
const { ehCoordenacao } = require('../lib/dominios');

const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
const num = (n, casas = 1) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: casas }));
const pct = (n) => (n === null || n === undefined ? '—' : `${num(n)}%`);
const sinal = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${num(n)}`);
const lista = (itens) => itens.join(', ').replace(/, ([^,]*)$/, ' e $1');
const SELO = painel.SELOS;

// Dados do período para as duas seções. `unidadeIds`: unidades já validadas do relatório.
async function coletar(req, { dataInicio, dataFim }, unidadeIds) {
  const periodo = { inicio: dataInicio, fim: dataFim };
  const [progresso, satisfacao] = await Promise.all([
    painel.progresso(req, periodo, unidadeIds, { comAnterior: false }),
    // comentários das famílias só para a coordenação (e ADMIN); a assistente recebe os números, sem os textos
    painel.satisfacao(req, periodo, unidadeIds, { comComentarios: ehCoordenacao(req.usuario), comAnterior: false }),
  ]);
  return { progresso, satisfacao, comentarios: satisfacao.comentarios || [] };
}

// ---------- textos padrão (editáveis) ----------

function textoProgresso(p) {
  const g = p.geral;
  const linhas = [];
  if (g.n === 0) {
    linhas.push('No período não houve famílias com duas ou mais medições do índice de progresso (questionário inicial e uma nova medição, como a reavaliação ou o questionário final), por isso a evolução ainda não pode ser apresentada.');
  } else if (!g.suficiente) {
    linhas.push(`No período, ${plural(g.n, 'família teve', 'famílias tiveram')} duas ou mais medições do índice de progresso (de 0 a 100), das quais ${g.melhoraram} melhoraram, ${g.iguais} ficaram iguais e ${g.pioraram} pioraram. O número é inferior ao mínimo de ${p.nMinimo} famílias para divulgar percentuais, por isso eles não são apresentados.`);
  } else {
    linhas.push(`No período, ${plural(g.n, 'família teve', 'famílias tiveram')} duas ou mais medições do índice de progresso (de 0 a 100, que reúne alimentação, renda e trabalho, economia e poupança e autonomia). Dessas, ${g.melhoraram} (${pct(g.pctMelhoraram)}) melhoraram, ${g.iguais} (${pct(g.pctIguais)}) ficaram iguais e ${g.pioraram} (${pct(g.pctPioraram)}) pioraram, considerando melhora ou piora uma variação de ${p.tolerancia} pontos ou mais.`);
    if (g.indiceMedioInicial !== null) linhas.push(`O índice médio dessas famílias passou de ${num(g.indiceMedioInicial)} no início do acompanhamento para ${num(g.indiceMedioAtual)} na última medição (variação de ${sinal(g.variacaoMedia)} pontos).`);
    const destaque = p.dimensoes.filter((d) => d.suficiente && d.pctMelhoraram !== null).sort((a, b) => b.pctMelhoraram - a.pctMelhoraram)[0];
    if (destaque) linhas.push(`A dimensão com maior proporção de famílias que melhoraram foi ${destaque.nome.toLowerCase()} (${pct(destaque.pctMelhoraram)}).`);
  }
  const a = p.acompanhamentos;
  const encerrados = [];
  if (a.concluidos) encerrados.push(`${plural(a.concluidos, 'acompanhamento foi concluído', 'acompanhamentos foram concluídos')}`);
  if (a.desligados) encerrados.push(`${plural(a.desligados, 'acompanhamento foi encerrado por desligamento', 'acompanhamentos foram encerrados por desligamento')}`);
  linhas.push(`${encerrados.length ? `No período, ${lista(encerrados)}. ` : 'No período, nenhum acompanhamento foi encerrado. '}${plural(a.emAndamento, 'família seguia', 'famílias seguiam')} em acompanhamento ao final do período${a.tempoMedioDias !== null ? ` e o tempo médio dos acompanhamentos encerrados foi de ${plural(a.tempoMedioDias, 'dia', 'dias')}` : ''}.`);
  if (a.contatos && a.contatos.total > 0) {
    linhas.push(`Foram registrados ${plural(a.contatos.total, 'contato', 'contatos')} com ${plural(a.contatos.familiasComContato, 'família', 'famílias')}${a.contatos.mediaPorFamilia !== null ? `, em média ${num(a.contatos.mediaPorFamilia)} por família` : ''}.`);
  }
  const m = p.metas;
  if (m.total > 0) {
    linhas.push(`As famílias definiram ${plural(m.total, 'meta', 'metas')}: ${m.atingidas} atingida(s), ${m.naoAtingidas} não atingida(s), ${m.emAndamento} em andamento e ${m.canceladas} cancelada(s)${m.pctAtingidas !== null ? `. Das metas encerradas (atingidas ou não), ${pct(m.pctAtingidas)} foram atingidas` : ''}.`);
  }
  return linhas.join('\n');
}

function textoSatisfacao(s) {
  const g = s.geral;
  if (g.respostas === 0 && g.recusas === 0) return 'No período não foram aplicadas pesquisas de satisfação às famílias acompanhadas.';
  const linhas = [];
  linhas.push(`No período, ${plural(g.respostas, 'pesquisa de satisfação foi respondida', 'pesquisas de satisfação foram respondidas')}`
    + `${g.recusas ? ` e ${plural(g.recusas, 'família preferiu não responder', 'famílias preferiram não responder')}` : ''}`
    + `${g.taxaCobertura !== null ? `, alcançando ${pct(g.taxaCobertura)} das famílias em acompanhamento` : ''}.`);
  if (!g.suficiente) {
    linhas.push(`O número de respostas é inferior ao mínimo de ${s.nMinimo} para divulgar nota geral e percentuais; os resultados serão apresentados quando houver mais respostas.`);
    return linhas.join('\n');
  }
  linhas.push(`A nota geral das famílias (NPS, de −100 a 100) foi ${num(g.nps, 0)}${g.semaforo ? `, resultado classificado como "${SELO[g.semaforo].toLowerCase()}"` : ''}, e o índice de satisfação foi de ${num(g.indice, 0)}%. `
    + `${pct(g.concordancia)} das respostas às afirmações foram de concordância (notas 4 e 5).`);
  const com = s.perguntas.filter((p) => p.concordancia !== null);
  if (com.length >= 2) {
    linhas.push(`A afirmação com menor concordância foi "${com[0].texto}" (${pct(com[0].concordancia)}); a com maior concordância foi "${com[com.length - 1].texto}" (${pct(com[com.length - 1].concordancia)}).`);
  }
  return linhas.join('\n');
}

function textosPadrao({ progresso, satisfacao }) {
  return { progresso: textoProgresso(progresso), satisfacao: textoSatisfacao(satisfacao) };
}

// ---------- dados do template (.docx) ----------

const nomeSelo = (s) => (s ? SELO[s] : '—');

function dadosTemplate({ progresso, satisfacao, comentarios }) {
  const p = progresso;
  const s = satisfacao;
  const g = p.geral;
  const linhaSelos = (nome, l) => ({
    nome, familias: String(l.n), melhoraram: String(l.melhoraram), iguais: String(l.iguais), pioraram: String(l.pioraram),
    percentual: l.suficiente ? pct(l.pctMelhoraram) : 'n < mín.',
  });
  return {
    temProgresso: g.n > 0 || p.metas.total > 0 || p.acompanhamentos.concluidos + p.acompanhamentos.desligados + p.acompanhamentos.emAndamento > 0,
    temTabelaProgresso: g.n > 0,
    progressoDimensoes: [...p.dimensoes.map((d) => linhaSelos(d.nome, d)), linhaSelos('Índice geral', g)],
    progressoUnidades: p.unidades.filter((u) => u.n > 0).map((u) => ({
      ...linhaSelos(u.nome || u.sigla, u),
      indice: u.indiceMedioInicial === null ? '—' : `${num(u.indiceMedioInicial)} → ${num(u.indiceMedioAtual)}`,
    })),
    temMetas: p.metas.total > 0,
    metasDimensoes: p.metas.porDimensao.filter((d) => d.total > 0).map((d) => ({
      nome: d.nome, total: String(d.total), emAndamento: String(d.emAndamento), atingidas: String(d.atingidas), naoAtingidas: String(d.naoAtingidas), canceladas: String(d.canceladas),
    })),

    temSatisfacao: s.geral.respostas > 0 || s.geral.recusas > 0,
    temTabelaSatisfacao: s.geral.suficiente,
    satisfacaoPerguntas: s.perguntas.filter((q) => q.concordancia !== null).map((q) => ({ nome: q.texto, respostas: String(q.n), concordancia: pct(q.concordancia), media: num(q.media) })),
    satisfacaoUnidades: s.unidades.filter((u) => u.respostas > 0 || u.recusas > 0).map((u) => ({
      nome: u.nome || u.sigla, respostas: String(u.respostas), recusas: String(u.recusas),
      nps: u.nps === null ? 'n < mín.' : num(u.nps, 0), satisfacao: u.indice === null ? 'n < mín.' : `${num(u.indice, 0)}%`,
      situacao: nomeSelo(u.semaforo),
    })),
    temComentariosSatisfacao: comentarios.length > 0,
    comentariosSatisfacao: comentarios.map((c) => ({ texto: c.texto, sigla: c.sigla })),
  };
}

// Escolha dos comentários (ids "<pesquisaId>.<T1|T2>") para o .docx: só os que existem no escopo e não estão ocultos; até 5.
function escolherComentarios(candidatos, escolhidos) {
  if (!Array.isArray(escolhidos)) return [];
  const porId = new Map(candidatos.map((c) => [c.id, c]));
  const saida = [];
  for (const item of escolhidos.slice(0, 20)) {
    const base = porId.get(String(item?.id));
    if (!base) continue;
    const texto = typeof item.texto === 'string' ? item.texto.trim().slice(0, 1000) : base.texto;
    if (texto) saida.push({ texto, sigla: base.sigla });
    if (saida.length >= 5) break;
  }
  return saida;
}

// ---------- CSV ----------

function linhasCsvProgresso(p) {
  const l = (recorte, dimensao, x) => [recorte, dimensao, x.n, x.melhoraram, x.iguais, x.pioraram, x.pctMelhoraram === null ? '' : x.pctMelhoraram, x.semaforo ? SELO[x.semaforo] : (x.n > 0 ? 'n insuficiente' : '')];
  const linhas = [l('Todas as unidades', 'Índice geral', p.geral), ...p.dimensoes.map((d) => l('Todas as unidades', d.nome, d))];
  for (const u of p.unidades) {
    linhas.push(l(u.sigla, 'Índice geral', u), ...u.porDimensao.map((d) => l(u.sigla, d.nome, d)));
  }
  return linhas;
}
const CABECALHO_CSV_PROGRESSO = ['Recorte', 'Dimensão', 'Famílias comparadas', 'Melhoraram', 'Ficaram iguais', 'Pioraram', '% que melhoraram', 'Situação'];

function linhasCsvSatisfacao(s) {
  const linha = (nome, x) => [nome, x.respostas, x.recusas, x.nps ?? '', x.indice ?? '', x.concordancia ?? '', x.taxaRecusa ?? '', x.taxaCobertura ?? '', x.semaforo ? SELO[x.semaforo] : (x.respostas > 0 ? 'n insuficiente' : '')];
  return [linha('Todas as unidades', s.geral), ...s.unidades.map((u) => linha(u.sigla, u))];
}
const CABECALHO_CSV_SATISFACAO = ['Unidade', 'Respostas', 'Recusas', 'Nota geral (NPS)', 'Índice de satisfação (%)', 'Concordância (%)', 'Taxa de recusa (%)', 'Cobertura (%)', 'Situação'];

module.exports = {
  coletar, textosPadrao, textoProgresso, textoSatisfacao, dadosTemplate, escolherComentarios,
  linhasCsvProgresso, linhasCsvSatisfacao, CABECALHO_CSV_PROGRESSO, CABECALHO_CSV_SATISFACAO,
};
