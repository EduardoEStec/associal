// Aba "Satisfação" do Painel (F6): NPS, concordância por afirmação, taxas de resposta e recusa, semáforo e comentários.
import { api } from '../api.js';
import { icone } from '../layout.js';
import { h, toast, formatarData } from '../ui.js';
import { barrasPercentuais, distribuicao } from './graficos.js';
import { pct, num, rotuloPeriodo, formatarNumero, seloSemaforo, kpi, tabela, exportarCsv, cabecalhoComCsv, notaNMinimo } from './comum.js';

const ROTULO_PERGUNTA = (p) => p.texto || p.codigo;

function cartaoComentarios(lista, aoOcultar) {
  if (!lista.length) {
    return h('section', { class: 'card' }, h('h2', {}, 'Comentários das famílias'), h('p', { class: 'texto-suave' }, 'Nenhum comentário no período.'));
  }
  const itens = lista.map((c) => {
    const li = h('li', { class: 'comentario' },
      h('div', { class: 'comentario-topo' },
        h('span', { class: 'badge' }, c.sigla), h('span', { class: 'badge badge-info' }, c.pergunta), h('span', { class: 'texto-pequeno texto-suave' }, formatarData(c.data))),
      h('p', { class: 'comentario-texto' }, c.texto),
      h('div', { class: 'comentario-acoes' },
        h('a', { class: 'btn btn-texto btn-pequeno', href: `/familias.html#/a/${c.acompanhamentoId}/acompanhamento` }, 'Ver a ficha da família'),
        h('button', { type: 'button', class: 'btn btn-texto btn-pequeno', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api.put(`/api/familias/acompanhamentos/${c.acompanhamentoId}/pesquisas/${c.pesquisaId}/comentario-oculto`, { oculto: true });
            toast.sucesso('Comentário ocultado dos relatórios e desta lista.');
            li.remove();
            aoOcultar(c);
          } catch (err) { e.currentTarget.disabled = false; toast.erro(err.message); }
        } }, icone('x'), 'Ocultar nos relatórios')));
    return li;
  });
  return h('section', { class: 'card' },
    h('h2', {}, 'Comentários das famílias'),
    h('p', { class: 'texto-suave texto-pequeno' }, 'Visíveis só para a coordenação e o administrador. O comentário ocultado deixa de aparecer aqui e nos relatórios (a resposta continua na ficha da família).'),
    h('ul', { class: 'comentarios' }, itens));
}

export function renderSatisfacao(secao, d) {
  const g = d.geral;
  // unidades sem pesquisa, recusa nem família em acompanhamento ficam de fora da tabela
  const unidades = d.unidades.filter((u) => u.respostas > 0 || u.recusas > 0 || u.elegiveis > 0);
  const nps = g.nps;
  const comparacao = d.anterior && d.anterior.geral.respostas > 0
    ? `Período anterior (${rotuloPeriodo(d.anterior.periodo)}): ${formatarNumero(d.anterior.geral.respostas)} ${d.anterior.geral.respostas === 1 ? 'resposta' : 'respostas'}`
      + `${d.anterior.geral.nps === null ? ' (n insuficiente)' : `, nota geral ${num(d.anterior.geral.nps, 0)}, concordância ${pct(d.anterior.geral.concordancia)}`}.`
    : 'Período anterior: sem respostas.';

  const kpis = h('div', { class: 'grade grade-4 kpis' },
    kpi('Respostas', formatarNumero(g.respostas), `${formatarNumero(g.recusas)} ${g.recusas === 1 ? 'recusa' : 'recusas'}`),
    kpi('Nota geral (NPS)', nps === null ? '—' : num(nps, 0), nps === null ? `n abaixo de ${d.nMinimo}` : `${formatarNumero(g.promotoras)} promotoras · ${formatarNumero(g.neutras)} neutras · ${formatarNumero(g.detratoras)} detratoras`,
      h('div', {}, seloSemaforo(g.semaforo, { insuficiente: !g.suficiente }))),
    kpi('Índice de satisfação', g.indice === null ? '—' : `${num(g.indice, 0)}%`, 'média das 6 afirmações, de 0 a 100'),
    kpi('Concordância', pct(g.concordancia), 'respostas 4 ou 5 nas afirmações'),
    kpi('Taxa de recusa', pct(g.taxaRecusa), 'recusas ÷ famílias que receberam a pesquisa'),
    kpi('Cobertura', pct(g.taxaCobertura), `${formatarNumero(g.familiasComPesquisa)} de ${formatarNumero(g.elegiveis)} famílias em acompanhamento`));

  const afirmacoes = barrasPercentuais({
    titulo: 'Concordância por afirmação (da pior para a melhor)',
    itens: d.perguntas.map((p) => ({ nome: ROTULO_PERGUNTA(p), valor: p.concordancia, detalhe: p.n ? `${formatarNumero(p.n)} respostas${p.media === null ? '' : ` · média ${num(p.media)} de 5`}` : undefined })),
    vazio: 'Nenhuma resposta no período.',
  });
  const faixasNps = distribuicao({
    titulo: 'Nota geral: como as famílias responderam',
    itens: g.respostas ? [{ nome: 'Promotoras (9 e 10)', quantidade: g.promotoras }, { nome: 'Neutras (7 e 8)', quantidade: g.neutras }, { nome: 'Detratoras (0 a 6)', quantidade: g.detratoras }] : [],
    total: g.promotoras + g.neutras + g.detratoras, vazio: 'Nenhuma resposta no período.',
  });

  const colunas = [
    { rotulo: 'Unidade', celula: (l) => l.sigla },
    { rotulo: 'Respostas', num: true, celula: (l) => formatarNumero(l.respostas) },
    { rotulo: 'Recusas', num: true, celula: (l) => formatarNumero(l.recusas) },
    { rotulo: 'Nota geral (NPS)', num: true, celula: (l) => (l.nps === null ? '—' : num(l.nps, 0)) },
    { rotulo: 'Satisfação', num: true, celula: (l) => (l.indice === null ? '—' : `${num(l.indice, 0)}%`) },
    { rotulo: 'Concordância', num: true, celula: (l) => pct(l.concordancia) },
    { rotulo: 'Taxa de recusa', num: true, celula: (l) => pct(l.taxaRecusa) },
    { rotulo: 'Cobertura', num: true, celula: (l) => pct(l.taxaCobertura) },
    { rotulo: 'Situação', celula: (l) => seloSemaforo(l.semaforo, { insuficiente: l.respostas > 0 && !l.suficiente }) },
  ];
  const tabUnidades = h('section', { class: 'card' },
    cabecalhoComCsv('Por unidade', () => exportarCsv(`satisfacao_unidades_${d.periodo.inicio}_${d.periodo.fim}.csv`,
      ['Unidade', 'Respostas', 'Recusas', 'Nota geral (NPS)', 'Satisfação', 'Concordância', 'Taxa de recusa', 'Cobertura', 'Situação'],
      [...unidades, { ...g, sigla: 'TOTAL' }].map((l) => [l.sigla, l.respostas, l.recusas, l.nps ?? '', l.indice ?? '', l.concordancia ?? '', l.taxaRecusa ?? '', l.taxaCobertura ?? '', l.semaforo || '']))),
    tabela(colunas, [...unidades, { ...g, sigla: 'TOTAL' }], { classeLinha: (l) => (l.sigla === 'TOTAL' ? 'linha-total' : null) }));

  const comentarios = cartaoComentarios(d.comentarios || [], () => {});
  secao.replaceChildren(
    h('p', { class: 'texto-suave texto-pequeno' }, `Período: ${rotuloPeriodo(d.periodo)}. ${comparacao}`),
    kpis,
    notaNMinimo(d.nMinimo),
    h('div', { class: 'grade grade-2' }, afirmacoes, faixasNps),
    tabUnidades,
    comentarios,
    h('p', { class: 'texto-suave texto-pequeno' },
      `Semáforo: limiares provisórios (verde com nota geral a partir de ${d.semaforos.limiares.npsVerde} e concordância a partir de ${d.semaforos.limiares.concordanciaVerde}%; `
      + `amarelo a partir de ${d.semaforos.limiares.npsAmarelo} e ${d.semaforos.limiares.concordanciaAmarelo}%), editáveis em Administração > Configurações, a validar com a coordenação.`));
}
