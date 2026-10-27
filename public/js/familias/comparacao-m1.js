// Comparação inicial × final dos modelos oficiais (M1): por PARES equivalentes de perguntas, mais as perguntas do final
// que já são comparativas ("comparando com o início..."). Seta + texto + cor (nunca só cor).
import { h, formatarData } from '../ui.js';
import { cabecalhoPagina, montar } from './util.js';

const TENDENCIA = {
  melhorou: { classe: 'cmp-melhorou', simbolo: '▲', texto: 'Melhorou' },
  igual: { classe: 'cmp-igual', simbolo: '＝', texto: 'Igual' },
  piorou: { classe: 'cmp-piorou', simbolo: '▼', texto: 'Piorou' },
  neutro: { classe: 'cmp-neutro', simbolo: '≠', texto: 'Mudou' },
  sem_dados: { classe: 'cmp-neutro', simbolo: '—', texto: 'Sem dados' },
};

function selo(t, rotulo = null) {
  const info = TENDENCIA[t] || TENDENCIA.neutro;
  return h('span', { class: `cmp-selo ${info.classe}` }, h('span', { 'aria-hidden': 'true' }, `${info.simbolo} `), rotulo || info.texto);
}

const resposta = (lado) => (lado.rotulo ? lado.rotulo : '—');

function tabelaDeRespostas(titulo, lista) {
  if (!lista.length) return null;
  return [
    h('h3', {}, titulo),
    h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela tabela-responsiva cmp-tabela' },
      h('caption', { class: 'sr-only' }, titulo),
      h('thead', {}, h('tr', {}, h('th', {}, 'Pergunta'), h('th', {}, 'Resposta'))),
      h('tbody', {}, lista.map((x) => h('tr', {},
        h('td', { 'data-rotulo': 'Pergunta' }, h('span', { class: 'q-codigo' }, `${x.codigo}. `), x.pergunta),
        h('td', { 'data-rotulo': 'Resposta' }, h('div', { class: 'cmp-texto' }, x.resposta || '—'))))))),
  ];
}

export function renderComparacaoM1({ conteudo }, acId, c) {
  const r = c.resumo;
  const cartao = (valor, rotulo, classe) => h('div', { class: `card cmp-total ${classe}` }, h('strong', {}, String(valor)), h('span', {}, rotulo));
  const dataI = formatarData(c.inicial.dataAplicacao);
  const dataF = formatarData(c.final.dataAplicacao);

  const pares = h('div', { class: 'tabela-wrap' },
    h('table', { class: 'tabela tabela-responsiva cmp-tabela' },
      h('caption', { class: 'sr-only' }, 'Perguntas equivalentes no questionário inicial e no final'),
      h('thead', {}, h('tr', {}, h('th', {}, 'Pergunta'), h('th', {}, `Inicial (${dataI})`), h('th', {}, `Final (${dataF})`), h('th', {}, 'Resultado'))),
      h('tbody', {}, c.itens.map((i) => h('tr', {},
        h('td', { 'data-rotulo': 'Pergunta' },
          h('span', { class: 'q-codigo' }, `${i.inicial.codigo} ↔ ${i.final.codigo}. `), i.rotulo,
          i.aproximado ? h('div', { class: 'texto-pequeno texto-suave' }, 'Equivalência aproximada: o questionário inicial pergunta se o acesso é regular; o final, a frequência por semana.') : null),
        h('td', { 'data-rotulo': 'Inicial' }, resposta(i.inicial)),
        h('td', { 'data-rotulo': 'Final' }, resposta(i.final)),
        h('td', { 'data-rotulo': 'Resultado' }, selo(i.tendencia, i.tendencia === 'neutro' ? 'Mudou' : null)))))));

  const comparativas = h('div', { class: 'tabela-wrap' },
    h('table', { class: 'tabela tabela-responsiva cmp-tabela' },
      h('caption', { class: 'sr-only' }, 'Perguntas do questionário final que comparam com o início'),
      h('thead', {}, h('tr', {}, h('th', {}, 'Pergunta do questionário final'), h('th', {}, 'Resposta da família'), h('th', {}, 'Resultado'))),
      h('tbody', {}, c.comparativas.map((x) => h('tr', {},
        h('td', { 'data-rotulo': 'Pergunta' }, h('span', { class: 'q-codigo' }, `${x.codigo}. `), x.pergunta),
        h('td', { 'data-rotulo': 'Resposta' }, resposta(x.final)),
        h('td', { 'data-rotulo': 'Resultado' }, selo(x.tendencia)))))));

  const extrasI = c.extrasAdicionais?.inicial || [];
  const extrasF = c.extrasAdicionais?.final || [];

  montar(conteudo,
    cabecalhoPagina(`Comparação — ${c.responsavel.nome}`, {
      voltar: { href: `#/a/${acId}`, texto: c.responsavel.nome || 'Família' },
      acoes: [h('button', { type: 'button', class: 'btn btn-secundario cmp-imprimir', onclick: () => window.print() }, 'Imprimir')],
    }),
    h('div', { class: 'grade grade-3 cmp-totais' },
      cartao(r.melhorou, r.melhorou === 1 ? 'resposta melhorou' : 'respostas melhoraram', 'cmp-melhorou'),
      cartao(r.igual, r.igual === 1 ? 'resposta igual' : 'respostas iguais', 'cmp-igual'),
      cartao(r.piorou, r.piorou === 1 ? 'resposta piorou' : 'respostas pioraram', 'cmp-piorou')),
    h('p', { class: 'texto-pequeno texto-suave' },
      'Os questionários inicial e final têm perguntas diferentes: a comparação é feita por pares de perguntas equivalentes '
      + `(${c.itens.length}) e pelas ${c.comparativas.length} perguntas do final que já comparam com o início. `
      + 'A fonte de renda só mostra se mudou. O relatório final familiar reúne tudo isso em um documento para impressão.'),
    h('h2', {}, 'Pares equivalentes'),
    pares,
    h('h2', {}, 'Percepção da família sobre a mudança'),
    comparativas,
    tabelaDeRespostas('Outras respostas do questionário inicial', c.outras.inicial),
    tabelaDeRespostas('Outras respostas do questionário final', c.outras.final),
    extrasI.length ? tabelaDeRespostas('Perguntas adicionais do questionário inicial', extrasI) : null,
    extrasF.length ? tabelaDeRespostas('Perguntas adicionais do questionário final', extrasF) : null,
  );
}
