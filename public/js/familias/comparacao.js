// Comparação inicial × final de uma família: lado a lado, com seta + texto + cor (nunca só cor).
import { api } from '../api.js';
import { h, carregando, formatarData, formatarMoeda, formatarNumero } from '../ui.js';
import { cabecalhoPagina, formatarValor, montar } from './util.js';
import { renderComparacaoM1 } from './comparacao-m1.js';

const TENDENCIA = {
  melhorou: { classe: 'cmp-melhorou', simbolo: '▲', texto: 'Melhorou' },
  igual: { classe: 'cmp-igual', simbolo: '＝', texto: 'Igual' },
  piorou: { classe: 'cmp-piorou', simbolo: '▼', texto: 'Piorou' },
  neutro: { classe: 'cmp-neutro', simbolo: '≠', texto: 'Mudou' },
  sem_dados: { classe: 'cmp-neutro', simbolo: '—', texto: 'Sem dados' },
};

const TITULOS_BLOCO = { 1: 'Dados da família', 2: 'Alimentação', 3: 'Economia da família', 4: 'Empoderamento', 5: 'Percepção sobre o Armazém' };

function seloTendencia(t, item) {
  const info = TENDENCIA[t] || TENDENCIA.neutro;
  // "Igual" para texto/neutro não faz sentido: textos nunca são "iguais"/"piores"
  const texto = t === 'neutro' && (item.tipo === 'texto' || item.tipo === 'multipla') ? 'Ver respostas' : info.texto;
  const simbolo = t === 'neutro' && (item.tipo === 'texto' || item.tipo === 'multipla') ? '' : info.simbolo;
  return h('span', { class: `cmp-selo ${info.classe}` }, simbolo ? h('span', { 'aria-hidden': 'true' }, `${simbolo} `) : null, texto);
}

function celulaValor(item, lado) {
  const principal = formatarValor(item, lado);
  const extras = [];
  if (item.campo === 'recebeAuxilio') {
    const lista = item[lado === 'inicial' ? 'detalheInicial' : 'detalheFinal'] || [];
    const outro = item[lado === 'inicial' ? 'inicialOutro' : 'finalOutro'];
    const todos = [...lista, outro].filter(Boolean);
    if (todos.length) extras.push(todos.join(', '));
  }
  if (item.campo === 'economiaMensalFaixa') {
    const v = item[lado === 'inicial' ? 'inicialValor' : 'finalValor'];
    if (v !== null && v !== undefined) extras.push(formatarMoeda(v));
  }
  if (item.tipo === 'multipla') {
    const outro = item[lado === 'inicial' ? 'inicialOutro' : 'finalOutro'];
    if (outro) extras.push(`Outro: ${outro}`);
  }
  return h('div', { class: item.tipo === 'texto' ? 'cmp-texto' : null },
    principal, extras.map((e) => h('div', { class: 'texto-pequeno texto-suave' }, e)));
}

function variacao(item) {
  if (item.variacao === undefined || item.variacao === null) return null;
  const sinal = item.variacao > 0 ? '+' : '';
  const valor = item.tipo === 'moeda' ? formatarMoeda(item.variacao) : formatarNumero(item.variacao);
  const pct = item.variacaoPercentual !== null && item.variacaoPercentual !== undefined
    ? ` (${sinal}${formatarNumero(item.variacaoPercentual)}%)` : '';
  return h('div', { class: 'texto-pequeno texto-suave' }, `${sinal}${valor}${pct}`);
}

export async function renderComparacao({ conteudo }, acId) {
  montar(conteudo, carregando());
  const c = await api.get(`/api/familias/acompanhamentos/${acId}/comparacao`);
  if (c.completo && c.modelo === 'M1') { renderComparacaoM1({ conteudo }, acId, c); return; }
  const voltar = { href: `#/a/${acId}`, texto: c.responsavel.nome || 'Família' };

  if (!c.completo) {
    montar(conteudo, 
      cabecalhoPagina('Comparação inicial × final', { voltar }),
      h('div', { class: 'aviso aviso-aviso' }, c.motivo),
      h('a', { class: 'btn', href: `#/a/${acId}` }, 'Voltar à família'));
    return;
  }

  const r = c.resumo;
  const cartao = (valor, rotulo, classe) => h('div', { class: `card cmp-total ${classe}` }, h('strong', {}, String(valor)), h('span', {}, rotulo));

  const destaques = [];
  if (c.renda) {
    destaques.push(h('div', { class: 'card' }, h('h3', {}, 'Renda mensal média'),
      h('p', { class: 'cmp-grande' }, `${formatarMoeda(c.renda.antes)} → ${formatarMoeda(c.renda.depois)}`),
      h('p', { class: 'texto-pequeno texto-suave' }, `Variação: ${c.renda.variacao > 0 ? '+' : ''}${formatarMoeda(c.renda.variacao)}`
        + (c.renda.variacaoPercentual !== null ? ` (${c.renda.variacaoPercentual > 0 ? '+' : ''}${formatarNumero(c.renda.variacaoPercentual)}%)` : ''))));
  }
  if (c.economia) {
    destaques.push(h('div', { class: 'card' }, h('h3', {}, 'Economia mensal no Armazém'),
      h('p', { class: 'cmp-grande' }, `${formatarMoeda(c.economia.antes)} → ${formatarMoeda(c.economia.depois)}`),
      h('p', { class: 'texto-pequeno texto-suave' }, `Variação: ${c.economia.variacao > 0 ? '+' : ''}${formatarMoeda(c.economia.variacao)}`)));
  }
  if (c.passouAPoupar) {
    destaques.push(h('div', { class: 'card' }, h('h3', {}, 'Poupança'), h('p', { class: 'cmp-selo cmp-melhorou' }, '▲ A família passou a conseguir poupar')));
  }

  const secoes = [];
  for (const numero of [1, 2, 3, 4, 5]) {
    const itens = c.itens.filter((i) => i.bloco === numero);
    if (!itens.length) continue;
    secoes.push(
      h('h2', {}, `${numero}. ${TITULOS_BLOCO[numero]}`),
      h('div', { class: 'tabela-wrap' },
        h('table', { class: 'tabela tabela-responsiva cmp-tabela' },
          h('caption', { class: 'sr-only' }, TITULOS_BLOCO[numero]),
          h('thead', {}, h('tr', {}, h('th', {}, 'Pergunta'), h('th', {}, `Inicial (${formatarData(c.inicial.dataAplicacao)})`),
            h('th', {}, `Final (${formatarData(c.final.dataAplicacao)})`), h('th', {}, 'Resultado'))),
          h('tbody', {}, itens.map((i) => h('tr', {},
            h('td', { 'data-rotulo': 'Pergunta' }, h('span', { class: 'q-codigo' }, `${i.codigo}. `), i.pergunta),
            h('td', { 'data-rotulo': 'Inicial' }, celulaValor(i, 'inicial')),
            h('td', { 'data-rotulo': 'Final' }, celulaValor(i, 'final')),
            h('td', { 'data-rotulo': 'Resultado' }, seloTendencia(i.tendencia, i), variacao(i))))))));
  }

  // perguntas adicionais criadas pela coordenação: lado a lado, sem indicador de melhora
  if ((c.extras || []).length) {
    secoes.push(
      h('h2', {}, 'Perguntas adicionais'),
      h('div', { class: 'tabela-wrap' },
        h('table', { class: 'tabela tabela-responsiva cmp-tabela' },
          h('caption', { class: 'sr-only' }, 'Perguntas adicionais'),
          h('thead', {}, h('tr', {}, h('th', {}, 'Pergunta'), h('th', {}, `Inicial (${formatarData(c.inicial.dataAplicacao)})`), h('th', {}, `Final (${formatarData(c.final.dataAplicacao)})`))),
          h('tbody', {}, c.extras.map((x) => h('tr', {},
            h('td', { 'data-rotulo': 'Pergunta' }, x.pergunta),
            h('td', { 'data-rotulo': 'Inicial' }, x.inicial || '—'),
            h('td', { 'data-rotulo': 'Final' }, x.final || '—')))))));
  }

  montar(conteudo, 
    cabecalhoPagina(`Comparação — ${c.responsavel.nome}`, {
      voltar,
      acoes: [h('button', { type: 'button', class: 'btn btn-secundario cmp-imprimir', onclick: () => window.print() }, 'Imprimir')],
    }),
    h('div', { class: 'grade grade-3 cmp-totais' },
      cartao(r.melhorou, r.melhorou === 1 ? 'pergunta melhorou' : 'perguntas melhoraram', 'cmp-melhorou'),
      cartao(r.igual, r.igual === 1 ? 'pergunta igual' : 'perguntas iguais', 'cmp-igual'),
      cartao(r.piorou, r.piorou === 1 ? 'pergunta piorou' : 'perguntas pioraram', 'cmp-piorou')),
    h('p', { class: 'texto-pequeno texto-suave' }, `Perguntas fechadas com indicador de melhora: ${r.comparaveis}. Respostas abertas e contagens sem juízo de valor aparecem como "Ver respostas" ou "Mudou".`),
    destaques.length ? h('div', { class: 'grade grade-3' }, destaques) : null,
    secoes,
  );
}
