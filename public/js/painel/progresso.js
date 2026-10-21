// Aba "Progresso das famílias" do Painel (F6): índice de progresso (F5), metas (F4) e situação dos acompanhamentos.
import { h, formatarData } from '../ui.js';
import { barras, distribuicao } from './graficos.js';
import { pct, num, sinal, rotuloPeriodo, formatarNumero, seloSemaforo, kpi, tabela, exportarCsv, cabecalhoComCsv, notaNMinimo } from './comum.js';

// Cores do gráfico: melhoraram (verde = s3), iguais (azul = s2), pioraram (laranja forte = s0).
const SERIES = (linhas) => [
  { nome: 'Melhoraram', valores: linhas.map((l) => l.melhoraram), cor: 3 },
  { nome: 'Ficaram iguais', valores: linhas.map((l) => l.iguais), cor: 2 },
  { nome: 'Pioraram', valores: linhas.map((l) => l.pioraram), cor: 0 },
];

const colunasSelos = (primeira) => [
  { rotulo: primeira, celula: (l) => l.nome || l.sigla },
  { rotulo: 'Famílias', num: true, celula: (l) => formatarNumero(l.n) },
  { rotulo: 'Melhoraram', num: true, celula: (l) => formatarNumero(l.melhoraram) },
  { rotulo: 'Iguais', num: true, celula: (l) => formatarNumero(l.iguais) },
  { rotulo: 'Pioraram', num: true, celula: (l) => formatarNumero(l.pioraram) },
  { rotulo: '% melhoraram', num: true, celula: (l) => pct(l.pctMelhoraram) },
  { rotulo: 'Situação', celula: (l) => seloSemaforo(l.semaforo, { insuficiente: l.n > 0 && !l.suficiente }) },
];

function linhaCsv(l, nome) {
  return [nome, l.n, l.melhoraram, l.iguais, l.pioraram, l.pctMelhoraram ?? '', l.semaforo || ''];
}

export function renderProgresso(secao, d) {
  const g = d.geral;
  // unidades sem nenhuma família comparada ficam de fora das tabelas e do gráfico (só poluem)
  const unidades = d.unidades.filter((u) => u.n > 0);
  const comparacao = d.anterior && d.anterior.geral.n > 0
    ? `Período anterior (${rotuloPeriodo(d.anterior.periodo)}): ${formatarNumero(d.anterior.geral.n)} ${d.anterior.geral.n === 1 ? 'família' : 'famílias'}`
      + `${d.anterior.geral.pctMelhoraram === null ? ' (n insuficiente para percentual)' : `, ${pct(d.anterior.geral.pctMelhoraram)} melhoraram`}.`
    : 'Período anterior: sem famílias comparadas.';

  const kpis = h('div', { class: 'grade grade-4 kpis' },
    kpi('Famílias comparadas', formatarNumero(g.n), `n; precisam de 2 ou mais pontos e o último dentro do período`),
    kpi('Melhoraram', g.suficiente ? pct(g.pctMelhoraram) : formatarNumero(g.melhoraram), g.suficiente ? `${formatarNumero(g.melhoraram)} de ${formatarNumero(g.n)}` : `n abaixo de ${d.nMinimo}: só o número absoluto`,
      h('div', {}, seloSemaforo(g.semaforo, { insuficiente: !g.suficiente }))),
    kpi('Ficaram iguais', g.suficiente ? pct(g.pctIguais) : formatarNumero(g.iguais), `variação menor que ${d.tolerancia} pontos`),
    kpi('Pioraram', g.suficiente ? pct(g.pctPioraram) : formatarNumero(g.pioraram)),
    kpi('Índice médio (0 a 100)', g.indiceMedioAtual === null ? '—' : num(g.indiceMedioAtual), g.indiceMedioInicial === null ? 'sem dados' : `inicial ${num(g.indiceMedioInicial)} · variação ${sinal(g.variacaoMedia)}`));

  const graficoUnidades = unidades.length
    ? h('div', { class: 'card' }, h('h3', {}, 'Por unidade'),
      barras({ titulo: 'Famílias que melhoraram, ficaram iguais e pioraram por unidade', categorias: unidades.map((u) => u.sigla), series: SERIES(unidades) }))
    : null;

  const tabDimensoes = h('section', { class: 'card' },
    cabecalhoComCsv('Por dimensão', () => exportarCsv(`progresso_dimensoes_${d.periodo.inicio}_${d.periodo.fim}.csv`,
      ['Dimensão', 'Famílias', 'Melhoraram', 'Iguais', 'Pioraram', '% melhoraram', 'Situação'], [...d.dimensoes.map((x) => linhaCsv(x, x.nome))])),
    tabela(colunasSelos('Dimensão'), d.dimensoes));

  const tabUnidades = h('section', { class: 'card' },
    cabecalhoComCsv('Por unidade', () => exportarCsv(`progresso_unidades_${d.periodo.inicio}_${d.periodo.fim}.csv`,
      ['Unidade', 'Famílias', 'Melhoraram', 'Iguais', 'Pioraram', '% melhoraram', 'Situação', 'Índice médio inicial', 'Índice médio atual'],
      unidades.map((u) => [...linhaCsv(u, u.sigla), u.indiceMedioInicial ?? '', u.indiceMedioAtual ?? '']))),
    tabela([...colunasSelos('Unidade'), { rotulo: 'Índice inicial → atual', num: true, celula: (l) => (l.indiceMedioInicial === null ? '—' : `${num(l.indiceMedioInicial)} → ${num(l.indiceMedioAtual)}`) }], unidades));

  const m = d.metas;
  const metasCard = h('section', { class: 'card' },
    cabecalhoComCsv('Metas das famílias', () => exportarCsv(`metas_${d.periodo.inicio}_${d.periodo.fim}.csv`,
      ['Dimensão', 'Metas', 'Em andamento', 'Atingidas', 'Não atingidas', 'Canceladas', '% atingidas (das encerradas)'],
      [...m.porDimensao.map((x) => [x.nome, x.total, x.emAndamento, x.atingidas, x.naoAtingidas, x.canceladas, x.pctAtingidas ?? '']),
        ['Total', m.total, m.emAndamento, m.atingidas, m.naoAtingidas, m.canceladas, m.pctAtingidas ?? '']])),
    h('p', { class: 'texto-suave texto-pequeno' }, `Metas definidas até ${formatarData(d.periodo.fim)}, na situação daquele dia. ${formatarNumero(m.familiasComMeta)} ${m.familiasComMeta === 1 ? 'família tem' : 'famílias têm'} meta.`),
    h('div', { class: 'grade grade-4 kpis' },
      kpi('Em andamento', formatarNumero(m.emAndamento)), kpi('Atingidas', formatarNumero(m.atingidas), m.pctAtingidas === null ? `n de metas encerradas abaixo de ${d.nMinimo}` : `${pct(m.pctAtingidas)} das encerradas`),
      kpi('Não atingidas', formatarNumero(m.naoAtingidas)), kpi('Canceladas', formatarNumero(m.canceladas))),
    tabela([
      { rotulo: 'Dimensão', celula: (l) => l.nome },
      { rotulo: 'Metas', num: true, celula: (l) => formatarNumero(l.total) },
      { rotulo: 'Em andamento', num: true, celula: (l) => formatarNumero(l.emAndamento) },
      { rotulo: 'Atingidas', num: true, celula: (l) => formatarNumero(l.atingidas) },
      { rotulo: 'Não atingidas', num: true, celula: (l) => formatarNumero(l.naoAtingidas) },
      { rotulo: 'Canceladas', num: true, celula: (l) => formatarNumero(l.canceladas) },
      { rotulo: '% atingidas', num: true, celula: (l) => pct(l.pctAtingidas) },
    ], m.porDimensao));

  const a = d.acompanhamentos;
  const acompanhamentos = h('div', { class: 'grade grade-4 kpis' },
    kpi('Em andamento', formatarNumero(a.emAndamento), 'ao fim do período'),
    kpi('Iniciados no período', formatarNumero(a.iniciados)),
    kpi('Concluídos', formatarNumero(a.concluidos), 'encerrados no período'),
    kpi('Desligados', formatarNumero(a.desligados), a.tempoMedioDias === null ? undefined : `tempo médio dos encerrados: ${formatarNumero(a.tempoMedioDias)} dias`));

  secao.replaceChildren(
    h('p', { class: 'texto-suave texto-pequeno' }, `Período: ${rotuloPeriodo(d.periodo)}. ${comparacao}`),
    kpis,
    notaNMinimo(d.nMinimo),
    h('div', { class: 'grade grade-2' }, graficoUnidades, distribuicao({
      titulo: 'Famílias por faixa do índice (último ponto no período)', itens: d.distribuicao.faixas.map((f) => ({ nome: f.faixa, quantidade: f.n })), total: d.distribuicao.n,
      vazio: 'Nenhuma família com índice calculado no período.',
    })),
    tabDimensoes,
    tabUnidades,
    metasCard,
    h('h2', {}, 'Situação dos acompanhamentos'), acompanhamentos,
    h('p', { class: 'texto-suave texto-pequeno' },
      'Semáforo: limiares provisórios (verde a partir de '
      + `${d.semaforos.limiares.progressoVerde}% que melhoraram, amarelo a partir de ${d.semaforos.limiares.progressoAmarelo}%), editáveis em Administração > Configurações. Só entram famílias com índice calculado (questionários concluídos).`));
}
