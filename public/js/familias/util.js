// Utilidades do módulo Famílias: rótulos, selos de situação e cache de listas de apoio.
import { api } from '../api.js';
import { h, formatarMoeda } from '../ui.js';

let cacheApoio = null;
export async function carregarApoio() {
  if (!cacheApoio) cacheApoio = api.get('/api/apoio').catch((e) => { cacheApoio = null; throw e; });
  return cacheApoio;
}

export const ROTULO_STATUS = { EM_ANDAMENTO: 'Em andamento', CONCLUIDO: 'Concluído', DESLIGADO: 'Desligado' };
export const CLASSE_STATUS = { EM_ANDAMENTO: 'badge-info', CONCLUIDO: 'badge-sucesso', DESLIGADO: 'badge' };

export const podeEscrever = (usuario) => usuario.perfil === 'ASSISTENTE' || usuario.perfil === 'COORDENADOR';

export function seloStatus(status) {
  return h('span', { class: `badge ${CLASSE_STATUS[status] || 'badge'}` }, ROTULO_STATUS[status] || status);
}

const pluralDias = (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

// Selo do questionário final — o texto (e o símbolo) carregam o significado, não só a cor.
export function seloFinal(item) {
  const { finalSituacao: s, diasParaFinal: d } = item;
  if (!s) return h('span', { class: 'texto-suave' }, '—');
  const mapa = {
    CONCLUIDO: ['badge-sucesso', '✔ Final concluído'],
    EM_DIA: ['badge-info', d === null ? '● Em dia' : `● Em dia · vence em ${pluralDias(d)}`],
    VENCENDO: ['badge-aviso', d === 0 ? '▲ Vence hoje' : `▲ Vence em ${pluralDias(d)}`],
    VENCIDO: ['badge-perigo', `✖ Vencido há ${pluralDias(Math.abs(d))}`],
  };
  const [classe, texto] = mapa[s] || ['badge', s];
  return h('span', { class: `badge ${classe}` }, texto);
}

export function rotuloSimNao(v) {
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  return '—';
}

export function textoOuTraco(v) {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

export function formatarValor(item, lado) {
  const v = item[lado];
  if (v === null || v === undefined || v === '') return '—';
  switch (item.tipo) {
    case 'moeda': return formatarMoeda(v);
    case 'booleano': return rotuloSimNao(v);
    case 'escolha': return item[`${lado}Rotulo`] || String(v);
    case 'multipla': return Array.isArray(v) && v.length ? v.join(', ') : '—';
    default: return String(v);
  }
}

export function cabecalhoPagina(titulo, { voltar, acoes } = {}) {
  return h(
    'div', { class: 'pagina-titulo' },
    h('div', {},
      voltar ? h('a', { href: voltar.href, class: 'fam-voltar' }, `← ${voltar.texto}`) : null,
      h('h1', {}, titulo)),
    acoes ? h('div', { class: 'linha' }, acoes) : null,
  );
}

// Campos <input>/<select> com rótulo, no padrão .campo
export function campo({ id, rotulo, obrigatorio, ajuda, controle }) {
  return h(
    'div', { class: 'campo' },
    h('label', { for: id, class: obrigatorio ? 'obrigatorio' : null }, rotulo),
    controle,
    ajuda ? h('span', { class: 'ajuda' }, ajuda) : null,
  );
}

export function selectApoio({ id, name, lista, valor, vazio = 'Selecione' }) {
  const sel = h('select', { class: 'select', id, name }, h('option', { value: '' }, vazio),
    (lista || []).map((o) => h('option', { value: String(o.id) }, o.nome)));
  sel.value = valor === null || valor === undefined ? '' : String(valor);
  return sel;
}

export const isoDia = (v) => (v ? String(v).slice(0, 10) : '');
