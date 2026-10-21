// Aba "Indicadores" da ficha: índice de progresso (0 a 100) por dimensão, evolução inicial → reavaliação → final,
// gráfico simples e semáforo (melhorou / igual / piorou). Regra de cálculo: server/services/indice-progresso.js.
import { api } from '../api.js';
import { icone } from '../layout.js';
import { h, formatarData } from '../ui.js';

const NS = 'http://www.w3.org/2000/svg';
const DIMENSOES = ['ALIMENTACAO', 'RENDA', 'ECONOMIA', 'AUTONOMIA'];
const NOME_PONTO = { INICIAL: 'Inicial', REAVALIACAO: 'Reavaliação', FINAL: 'Final' };
const CLASSE_PONTO = { INICIAL: 'p-inicial', REAVALIACAO: 'p-reavaliacao', FINAL: 'p-final' };
const SELOS = {
  melhorou: ['badge-sucesso', 'subir', 'Melhorou'],
  igual: ['badge-info', 'igual', 'Igual'],
  piorou: ['badge-perigo', 'descer', 'Piorou'],
  sem_dados: ['badge', null, 'Sem dados'],
};
const NIVEL_REGISTRO = { MELHORANDO: 75, IGUAL: 50, PIORANDO: 25 };
const ROTULO_REGISTRO = { MELHORANDO: 'melhorando', IGUAL: 'igual', PIORANDO: 'piorando' };

const numero = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
const sinal = (n) => (n === null || n === undefined ? '' : `${n > 0 ? '+' : ''}${numero(n)}`);

export function selo(chave) {
  const [classe, simbolo, texto] = SELOS[chave] || SELOS.sem_dados;
  return h('span', { class: `badge ${classe}` }, simbolo ? icone(simbolo) : null, texto);
}

function svg(tag, atributos = {}, texto) {
  const no = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(atributos)) no.setAttribute(k, v);
  if (texto !== undefined) no.textContent = texto;
  return no;
}

// Linha de uma dimensão: barra de 0 a 100 com um marcador por ponto (inicial, reavaliação, final)
function linhaDimensao(dados, dim, rotulo) {
  const pontos = dados.pontos.map((p) => ({ tipo: p.tipo, nivel: p.dimensoes[dim].nivel }));
  const comNivel = pontos.filter((p) => p.nivel !== null);
  const comp = dados.comparacao?.dimensoes[dim];
  const resumo = comNivel.length
    ? pontos.map((p) => `${NOME_PONTO[p.tipo]} ${numero(p.nivel)}`).join(' → ')
    : 'Sem dados suficientes';
  return h('li', { class: 'ind-linha' },
    h('div', { class: 'ind-linha-topo' },
      h('strong', {}, rotulo),
      comp ? selo(comp.selo) : null),
    h('div', {
      class: 'ind-barra', role: 'img',
      'aria-label': `${rotulo}: ${resumo}${comp && comp.diferenca !== null ? ` (${sinal(comp.diferenca)} pontos)` : ''}`,
    },
    h('div', { class: 'ind-trilho' }),
    ...comNivel.map((p) => h('span', { class: `ind-marcador ${CLASSE_PONTO[p.tipo]}`, style: `left: ${Math.max(0, Math.min(100, p.nivel))}%`, title: `${NOME_PONTO[p.tipo]}: ${numero(p.nivel)}` }))),
    h('div', { class: 'ind-valores texto-pequeno' },
      pontos.map((p) => h('span', { class: 'ind-valor' },
        h('span', { class: `ind-chave ${CLASSE_PONTO[p.tipo]}`, 'aria-hidden': 'true' }), `${NOME_PONTO[p.tipo]} `, h('strong', {}, numero(p.nivel)))),
      comp && comp.diferenca !== null ? h('span', { class: 'texto-suave' }, `${sinal(comp.diferenca)} pontos`) : null));
}

// Gráfico de linha do índice geral no tempo (+ situação percebida nos contatos, tracejada)
function grafico(dados) {
  const pts = dados.pontos.filter((p) => p.geral.nivel !== null);
  if (pts.length < 2) return null;
  const L = 320; const A = 180; const mE = 34; const mD = 12; const mT = 12; const mB = 26;
  const tempos = pts.map((p) => new Date(`${p.dataRef}T00:00:00Z`).getTime());
  const t0 = Math.min(...tempos); const t1 = Math.max(...tempos);
  const x = (t) => mE + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (L - mE - mD);
  const y = (n) => mT + (1 - n / 100) * (A - mT - mB);

  const g = svg('svg', { viewBox: `0 0 ${L} ${A}`, class: 'ind-grafico', role: 'img', 'aria-label': 'Evolução do índice geral de progresso' });
  g.append(svg('title', {}, 'Evolução do índice geral de progresso'));
  g.append(svg('desc', {}, pts.map((p) => `${NOME_PONTO[p.tipo]} em ${formatarData(p.dataRef)}: ${numero(p.geral.nivel)}`).join('; ')));
  for (const v of [0, 25, 50, 75, 100]) {
    g.append(svg('line', { x1: mE, x2: L - mD, y1: y(v), y2: y(v), class: 'ind-grade' }));
    g.append(svg('text', { x: mE - 6, y: y(v) + 3, class: 'ind-eixo', 'text-anchor': 'end' }, String(v)));
  }

  const dentro = dados.situacoesRegistros.filter((s) => {
    const t = new Date(`${s.data}T00:00:00Z`).getTime();
    return t >= t0 && t <= t1 && NIVEL_REGISTRO[s.situacao];
  });
  if (dentro.length >= 2) {
    g.append(svg('polyline', {
      class: 'ind-linha-registros', fill: 'none',
      points: dentro.map((s) => `${x(new Date(`${s.data}T00:00:00Z`).getTime())},${y(NIVEL_REGISTRO[s.situacao])}`).join(' '),
    }));
  }
  g.append(svg('polyline', { class: 'ind-linha-geral', fill: 'none', points: pts.map((p, i) => `${x(tempos[i])},${y(p.geral.nivel)}`).join(' ') }));
  pts.forEach((p, i) => {
    g.append(svg('circle', { cx: x(tempos[i]), cy: y(p.geral.nivel), r: 5, class: `ind-ponto ${CLASSE_PONTO[p.tipo]}` }));
    g.append(svg('text', { x: x(tempos[i]), y: A - 8, class: 'ind-eixo', 'text-anchor': i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle' }, formatarData(p.dataRef).slice(0, 5)));
  });

  const legenda = h('ul', { class: 'ind-legenda texto-pequeno' },
    h('li', {}, h('span', { class: 'ind-tracejo ind-tracejo-geral', 'aria-hidden': 'true' }), 'Índice geral'),
    dentro.length >= 2 ? h('li', {}, h('span', { class: 'ind-tracejo ind-tracejo-registros', 'aria-hidden': 'true' }),
      `Situação nos contatos (${dentro.map((s) => ROTULO_REGISTRO[s.situacao]).join(', ')})`) : null);
  return h('figure', { class: 'card ind-figura' }, h('h3', {}, 'Evolução no tempo'), g, legenda);
}

function cartaoResumo(dados) {
  const ultimo = dados.pontos[dados.pontos.length - 1];
  const geral = dados.comparacao?.geral;
  const quantos = dados.pontos.length;
  return h('div', { class: 'card ind-resumo' },
    h('div', { class: 'ind-resumo-numero' },
      h('span', { class: 'ind-grande', 'aria-label': `Índice geral ${numero(ultimo.geral.nivel)} de 100` }, numero(ultimo.geral.nivel)),
      h('span', { class: 'texto-suave' }, 'de 100')),
    h('div', { class: 'ind-resumo-texto' },
      h('strong', {}, `Índice geral — ${NOME_PONTO[ultimo.tipo].toLowerCase()}`),
      geral
        ? h('div', { class: 'linha' }, selo(geral.selo), h('span', {}, geral.diferenca === null ? '' : `${sinal(geral.diferenca)} pontos desde o ${NOME_PONTO[dados.comparacao.de].toLowerCase()}`))
        : h('p', { class: 'texto-pequeno texto-suave' }, 'O semáforo aparece quando houver um segundo ponto de comparação (reavaliação ou questionário final).'),
      h('p', { class: 'texto-pequeno texto-suave' }, `${quantos} ponto${quantos === 1 ? '' : 's'} de medição · média de ${geral?.dimensoesComparadas ?? ultimo.geral.dimensoes} dimensões`)));
}

function cartaoReavaliacao(dados, { id, escrita }) {
  const r = dados.reavaliacao;
  const encerrado = dados.status !== 'EM_ANDAMENTO';
  const pode = escrita && !encerrado;
  let texto; let botao = null;
  if (r.situacao === 'CONCLUIDA') {
    texto = 'Reavaliação rápida concluída.';
    botao = h('a', { class: 'btn btn-secundario', href: `#/a/${id}/q/REAVALIACAO` }, pode ? 'Revisar / corrigir' : 'Ver respostas');
  } else if (r.situacao === 'PENDENTE' || r.situacao === 'AGENDADA') {
    texto = r.situacao === 'PENDENTE'
      ? `Reavaliação rápida pendente (prevista para ${formatarData(r.dataPrevista)}): cerca de 9 perguntas, menos de 3 minutos. Dá um terceiro ponto ao gráfico.`
      : `Reavaliação rápida prevista para ${formatarData(r.dataPrevista)}: cerca de 9 perguntas, menos de 3 minutos.`;
    if (pode) botao = h('a', { class: `btn ${r.situacao === 'PENDENTE' ? '' : 'btn-secundario'}`, href: `#/a/${id}/q/REAVALIACAO` }, r.existe ? 'Continuar reavaliação' : 'Aplicar reavaliação');
  } else if (r.situacao === 'DISPENSADA') texto = 'O questionário final já foi concluído: a reavaliação rápida não é mais necessária.';
  else texto = encerrado ? 'Acompanhamento encerrado.' : 'A reavaliação rápida fica disponível depois do questionário inicial.';
  return h('div', { class: `card ind-reavaliacao${r.situacao === 'PENDENTE' ? ' ind-pendente' : ''}` },
    h('p', {}, texto), botao);
}

export async function renderIndicadores({ id, d, escrita }) {
  const dados = await api.get(`/api/familias/acompanhamentos/${id}/indicadores`);
  const partes = [h('h2', { class: 'ind-titulo' }, 'Indicadores de progresso')];

  if (dados.pontos.length === 0) {
    partes.push(h('div', { class: 'card card-vazio' },
      h('p', {}, 'Os indicadores aparecem depois de concluir o questionário inicial.'),
      d.questionarios.inicial.concluido ? null : h('a', { class: 'btn', href: `#/a/${id}/q/INICIAL` }, 'Ir para o questionário inicial')));
    partes.push(cartaoReavaliacao(dados, { id, escrita }));
    return partes;
  }

  partes.push(cartaoResumo(dados));
  partes.push(h('div', { class: 'card' },
    h('h3', {}, 'Por dimensão'),
    h('ul', { class: 'ind-linhas' }, DIMENSOES.map((dim) => linhaDimensao(dados, dim, dados.rotulos[dim])))));
  partes.push(grafico(dados));
  partes.push(cartaoReavaliacao(dados, { id, escrita }));
  partes.push(h('details', { class: 'card ind-como' },
    h('summary', {}, 'Como o índice é calculado'),
    h('p', { class: 'texto-pequeno' }, 'Cada resposta vira uma pontuação de 0 a 100 (a posição da resposta na escala; sim = 100, não = 0). A dimensão é a média dos itens respondidos e só aparece se pelo menos metade deles tiver resposta. O índice geral é a média das dimensões. As respostas de "melhorou?" pesam metade no questionário inicial.'),
    h('p', { class: 'texto-pequeno' }, `A renda é comparada por pessoa (renda ÷ número de pessoas) em faixas do salário mínimo de referência (R$ ${numero(dados.salarioMinimo)}): até ¼, de ¼ a ½, de ½ a 1 e acima de 1.`),
    h('p', { class: 'texto-pequeno' }, `Semáforo: melhorou ou piorou quando a diferença é de ${dados.tolerancia} pontos ou mais; abaixo disso, igual. Regra versão ${dados.versaoRegra}.`),
    dados.pontos.some((p) => p.desatualizado) ? h('p', { class: 'aviso aviso-aviso' }, 'Há pontos calculados com uma versão anterior da regra. Peça à TI para recalcular os índices.') : null));
  return partes.filter(Boolean);
}

