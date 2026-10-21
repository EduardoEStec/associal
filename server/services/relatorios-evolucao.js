'use strict';

// Seção "Evolução durante o acompanhamento" do Relatório Individual (F5, proposta 5.6): texto editável e tabela das
// dimensões do índice de progresso (inicial → reavaliação → final, com o selo escrito). Funções puras, sem banco.

const { ROTULO_DIMENSAO, DIMENSOES } = require('./indice-progresso');
const { DIMENSOES: DIMENSOES_META } = require('./metas-regras');

const NOME_PONTO = { INICIAL: 'Inicial', REAVALIACAO: 'Reavaliação', FINAL: 'Final' };
const SELO_TEXTO = { melhorou: 'Melhorou', igual: 'Igual', piorou: 'Piorou', sem_dados: 'Sem dados' };
const STATUS_META = { EM_ANDAMENTO: 'Em andamento', ATINGIDA: 'Atingida', NAO_ATINGIDA: 'Não atingida', CANCELADA: 'Cancelada' };
const LARGURA = 9070; // twips úteis (A4 menos margens de 2,5 cm), como em tests/relatorios/construir-templates.js

const num = (n, casas = 1) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas }));
const sinal = (n) => (n === null || n === undefined ? '' : `${n > 0 ? '+' : ''}${num(n)}`);
const dataBr = (v) => { const [a, m, d] = String(v || '').slice(0, 10).split('-'); return a && m && d ? `${d}/${m}/${a}` : ''; };
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

// `evolucao`: resultado de indice-dados.obterIndicadores + `contatos` ({ total, primeiro, ultimo, intervaloMedioDias })
function temEvolucao(evolucao) {
  return !!evolucao && evolucao.pontos.length >= 2 && !!evolucao.comparacao;
}

// Há o que mostrar na seção: evolução do índice e/ou metas combinadas com a família (F4/F6).
function temConteudo(evolucao) {
  return temEvolucao(evolucao) || (!!evolucao && Array.isArray(evolucao.metas) && evolucao.metas.length > 0);
}

function textoMetas(metas) {
  const conta = (s) => metas.filter((m) => m.status === s).length;
  const partes = [`${conta('ATINGIDA')} atingida(s)`, `${conta('NAO_ATINGIDA')} não atingida(s)`, `${conta('EM_ANDAMENTO')} em andamento`];
  if (conta('CANCELADA')) partes.push(`${conta('CANCELADA')} cancelada(s)`);
  return `Foram combinadas com a família ${plural(metas.length, 'meta', 'metas')}: ${partes.join(', ').replace(/, ([^,]*)$/, ' e $1')}. O detalhamento está na tabela de metas abaixo.`;
}

function gerarTextoEvolucao(evolucao) {
  if (!temConteudo(evolucao)) return '';
  const linhas = [];
  const c = evolucao.contatos;
  if (c && c.total > 0) {
    let l = `Durante o acompanhamento foram registrados ${plural(c.total, 'contato', 'contatos')} com a família`;
    if (c.total > 1) l += `, entre ${dataBr(c.primeiro)} e ${dataBr(c.ultimo)}, em média a cada ${plural(c.intervaloMedioDias, 'dia', 'dias')}`;
    linhas.push(`${l}.`);
  } else linhas.push('Não há contatos registrados no sistema durante o acompanhamento.');

  if (!temEvolucao(evolucao)) {
    if (evolucao.metas.length) linhas.push(textoMetas(evolucao.metas));
    return linhas.join('\n');
  }
  const { comparacao, pontos, tolerancia } = evolucao;
  const g = comparacao.geral;
  const de = NOME_PONTO[comparacao.de].toLowerCase();
  const para = NOME_PONTO[comparacao.para].toLowerCase();
  if (g.diferenca !== null) {
    const veredito = { melhorou: 'indicando melhora', igual: 'sem mudança relevante', piorou: 'indicando piora' }[g.selo];
    linhas.push(`O índice de progresso da família (de 0 a 100, que reúne alimentação, renda e trabalho, economia e poupança e autonomia) passou de ${num(g.antes)} no ${de} para ${num(g.depois)} no ${para}, variação de ${sinal(g.diferenca)} pontos, ${veredito} (considera-se melhora ou piora uma diferença de ${tolerancia} pontos ou mais).`);
  }
  if (pontos.some((p) => p.tipo === 'REAVALIACAO')) linhas.push('A reavaliação rápida, feita na metade do acompanhamento, está incluída na tabela abaixo.');
  const destaques = DIMENSOES.filter((d) => comparacao.dimensoes[d].selo === 'melhorou').map((d) => ROTULO_DIMENSAO[d].toLowerCase());
  if (destaques.length) linhas.push(`Dimensões que melhoraram: ${destaques.join(', ').replace(/, ([^,]*)$/, ' e $1')}.`);
  if (evolucao.metas && evolucao.metas.length) linhas.push(textoMetas(evolucao.metas));
  return linhas.join('\n');
}

// ---------- tabela (XML do Word) ----------

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rpr = (b) => `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${b ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>`;
const celula = (texto, largura, { b = false, jc = 'left', fundo } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${largura}" w:type="dxa"/>${fundo ? `<w:shd w:val="clear" w:color="auto" w:fill="${fundo}"/>` : ''}</w:tcPr>`
  + `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:jc w:val="${jc}"/>${rpr(b)}</w:pPr>`
  + `<w:r>${rpr(b)}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r></w:p></w:tc>`;

// Tabela das dimensões. Retorna '' quando não há evolução.
function tabelaEvolucaoXml(evolucao) {
  if (!temEvolucao(evolucao)) return '';
  const pontos = evolucao.pontos;
  const colunas = [
    { titulo: 'Dimensão', largura: 3, jc: 'left' },
    ...pontos.map((p) => ({ titulo: `${NOME_PONTO[p.tipo]} (${dataBr(p.dataRef)})`, largura: 1.6, jc: 'center' })),
    { titulo: 'Variação', largura: 1.2, jc: 'center' },
    { titulo: 'Situação', largura: 1.5, jc: 'center' },
  ];
  const total = colunas.reduce((s, c) => s + c.largura, 0);
  const larg = colunas.map((c) => Math.round((c.largura / total) * LARGURA));
  const borda = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  const linha = (celulas, cab = false) => `<w:tr><w:trPr><w:cantSplit/>${cab ? '<w:tblHeader/>' : ''}</w:trPr>${celulas.join('')}</w:tr>`;

  const cab = linha(colunas.map((c, i) => celula(c.titulo, larg[i], { b: true, jc: c.jc, fundo: 'D9E2D5' })), true);
  const corpo = [...DIMENSOES, 'GERAL'].map((dim) => {
    const geral = dim === 'GERAL';
    const comp = geral ? evolucao.comparacao.geral : evolucao.comparacao.dimensoes[dim];
    const valores = pontos.map((p) => (geral ? p.geral.nivel : p.dimensoes[dim].nivel));
    const cels = [
      ROTULO_DIMENSAO[dim], ...valores.map((v) => num(v)), comp.diferenca === null ? '—' : sinal(comp.diferenca), SELO_TEXTO[comp.selo],
    ];
    return linha(cels.map((t, i) => celula(t, larg[i], { b: geral, jc: colunas[i].jc })));
  });

  return `<w:tbl><w:tblPr><w:tblW w:w="${LARGURA}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(borda).join('')}</w:tblBorders>`
    + '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    + `<w:tblGrid>${larg.map((l) => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>${cab}${corpo.join('')}</w:tbl>`;
}

// Tabela das metas (dimensão, meta, prazo, situação, encerramento). Retorna '' sem metas.
function tabelaMetasXml(evolucao) {
  const metas = evolucao && Array.isArray(evolucao.metas) ? evolucao.metas : [];
  if (!metas.length) return '';
  const colunas = [
    { titulo: 'Dimensão', largura: 1.5, jc: 'left' }, { titulo: 'Meta', largura: 4.2, jc: 'left' },
    { titulo: 'Prazo', largura: 1.3, jc: 'center' }, { titulo: 'Situação', largura: 1.6, jc: 'center' }, { titulo: 'Encerrada em', largura: 1.5, jc: 'center' },
  ];
  const total = colunas.reduce((s, c) => s + c.largura, 0);
  const larg = colunas.map((c) => Math.round((c.largura / total) * LARGURA));
  const borda = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  const linha = (celulas, cab = false) => `<w:tr><w:trPr><w:cantSplit/>${cab ? '<w:tblHeader/>' : ''}</w:trPr>${celulas.join('')}</w:tr>`;
  const cab = linha(colunas.map((c, i) => celula(c.titulo, larg[i], { b: true, jc: c.jc, fundo: 'D9E2D5' })), true);
  const corpo = metas.map((m) => linha([
    DIMENSOES_META[m.dimensao] || m.dimensao, m.descricao, m.prazo ? dataBr(m.prazo) : '—', STATUS_META[m.status] || m.status, m.concluidaEm ? dataBr(m.concluidaEm) : '—',
  ].map((t, i) => celula(t, larg[i], { jc: colunas[i].jc }))));
  return `<w:tbl><w:tblPr><w:tblW w:w="${LARGURA}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(borda).join('')}</w:tblBorders>`
    + '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    + `<w:tblGrid>${larg.map((l) => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>${cab}${corpo.join('')}</w:tbl>`;
}

const PARAGRAFO_VAZIO = '<w:p><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr></w:p>';

// Tabela do índice + (quando houver) metas, separadas por um parágrafo vazio. Retorna '' quando não há nada.
function tabelasEvolucaoXml(evolucao) {
  return [tabelaEvolucaoXml(evolucao), tabelaMetasXml(evolucao)].filter(Boolean).join(PARAGRAFO_VAZIO);
}

module.exports = { temEvolucao, temConteudo, gerarTextoEvolucao, tabelaEvolucaoXml, tabelaMetasXml, tabelasEvolucaoXml };
