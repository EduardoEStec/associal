// Visitas e Ações — agenda por mês, lista, filtros, cadastro e fotos.
import { iniciarPagina } from '../layout.js';
import { api } from '../api.js';
import { h, toast, carregando, formatarData, formatarNumero } from '../ui.js';
import { STATUS, abrirFormulario, nomeDoTipo } from '../acoes/formulario.js';
import { abrirDetalhe, CLASSE_STATUS } from '../acoes/detalhe.js';

const { usuario, conteudo } = await iniciarPagina('acoes');

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const ano = new Date().getFullYear();

const filtros = { inicio: `${ano}-01-01`, fim: `${ano}-12-31`, unidadeId: '', status: '', tipoAcaoId: '', temaId: '', q: '' };
let visao = 'agenda';
try { visao = localStorage.getItem('acoes.visao') === 'lista' ? 'lista' : 'agenda'; } catch { /* sem storage */ }
let acoes = [];

let apoio;
try {
  apoio = await api.get('/api/apoio');
} catch (e) {
  conteudo.replaceChildren(h('h1', {}, 'Visitas e Ações'), h('div', { class: 'aviso aviso-perigo' }, e.message));
  throw e;
}

const area = h('div', { class: 'acoes-area', 'aria-live': 'polite' });

function opcoes(lista, vazio) {
  return [h('option', { value: '' }, vazio), ...lista.map((i) => h('option', { value: i.id }, i.nome ?? `${i.sigla} — ${i.nome}`))];
}

function controle(rotulo, entrada) {
  return h('div', { class: 'campo' }, h('label', { for: entrada.id }, rotulo), entrada);
}

function montarFiltros() {
  const ligar = (el, chave, evento = 'change') => el.addEventListener(evento, () => { filtros[chave] = el.value; recarregar(); });
  const inicio = h('input', { class: 'input', type: 'date', id: 'f-inicio', value: filtros.inicio });
  const fim = h('input', { class: 'input', type: 'date', id: 'f-fim', value: filtros.fim });
  const unidade = h('select', { class: 'select', id: 'f-unidade' }, opcoes(usuario.unidades.map((u) => ({ id: u.id, nome: `${u.sigla} — ${u.nome}` })), 'Todas'));
  const status = h('select', { class: 'select', id: 'f-status' }, h('option', { value: '' }, 'Todas'),
    Object.entries(STATUS).map(([k, v]) => h('option', { value: k }, v)));
  const tipo = h('select', { class: 'select', id: 'f-tipo' }, opcoes(apoio.tipoAcao, 'Todos'));
  const tema = h('select', { class: 'select', id: 'f-tema' }, opcoes(apoio.tema, 'Todos'));
  const busca = h('input', { class: 'input', type: 'search', id: 'f-q', placeholder: 'Instituição, endereço ou descrição', maxlength: '100' });
  ligar(inicio, 'inicio'); ligar(fim, 'fim'); ligar(unidade, 'unidadeId'); ligar(status, 'status');
  ligar(tipo, 'tipoAcaoId'); ligar(tema, 'temaId');
  let espera;
  busca.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => { filtros.q = busca.value.trim(); recarregar(); }, 350); });

  const limpar = h('button', {
    type: 'button', class: 'btn btn-texto btn-pequeno',
    onclick: () => {
      Object.assign(filtros, { inicio: `${ano}-01-01`, fim: `${ano}-12-31`, unidadeId: '', status: '', tipoAcaoId: '', temaId: '', q: '' });
      inicio.value = filtros.inicio; fim.value = filtros.fim; busca.value = '';
      for (const s of [unidade, status, tipo, tema]) s.value = '';
      recarregar();
    },
  }, 'Limpar filtros');

  return h(
    'details', { class: 'card acoes-filtros', open: window.matchMedia('(min-width: 720px)').matches },
    h('summary', {}, 'Filtros'),
    h('div', { class: 'grade grade-3' },
      controle('De', inicio), controle('Até', fim),
      usuario.unidades.length > 1 && controle('Unidade', unidade),
      controle('Situação', status), controle('Tipo', tipo), controle('Tema', tema)),
    controle('Buscar', busca), limpar,
  );
}

function cartao(a) {
  const [, mes, dia] = String(a.dataAcao).slice(0, 10).split('-');
  return h(
    'button', { type: 'button', class: 'acoes-item', onclick: () => abrirDetalhe({ id: a.id, apoio, usuario, aoMudar: recarregar }) },
    h('span', { class: 'acoes-item-data', 'aria-label': formatarData(a.dataAcao) }, h('strong', {}, dia), h('small', {}, MESES[Number(mes) - 1].slice(0, 3))),
    h('span', { class: 'acoes-item-corpo' },
      h('strong', {}, a.instituicaoLocal || nomeDoTipo(a)),
      h('span', { class: 'acoes-item-meta' },
        h('span', { class: `badge ${CLASSE_STATUS[a.status]}` }, STATUS[a.status]),
        h('span', { class: 'badge' }, nomeDoTipo(a)),
        usuario.unidades.length > 1 && h('span', { class: 'badge badge-info' }, a.unidadeSigla)),
      a.temas.length > 0 && h('small', {}, a.temas.map((t) => t.nome).join(' · ')),
      h('small', {}, [
        a.qtdParticipantes !== null && `${formatarNumero(a.qtdParticipantes)} participante${a.qtdParticipantes === 1 ? '' : 's'}`,
        a.qtdFotos > 0 && `${a.qtdFotos} foto${a.qtdFotos === 1 ? '' : 's'}`,
      ].filter(Boolean).join(' · '))),
  );
}

function renderAgenda() {
  const grupos = new Map();
  for (const a of acoes) {
    const chave = String(a.dataAcao).slice(0, 7);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(a);
  }
  return [...grupos].map(([chave, itens]) => {
    const [a, m] = chave.split('-');
    return h('section', { class: 'acoes-mes' },
      h('h2', {}, `${MESES[Number(m) - 1]} de ${a}`, h('small', {}, ` · ${itens.length} ação${itens.length === 1 ? '' : 'ões'}`)),
      h('div', { class: 'acoes-itens' }, itens.map(cartao)));
  });
}

function renderLista() {
  return h('div', { class: 'tabela-wrap' }, h(
    'table', { class: 'tabela tabela-responsiva' },
    h('thead', {}, h('tr', {}, ['Data', 'Instituição / local', 'Tipo', 'Situação', 'Unidade', 'Participantes'].map((t) => h('th', {}, t)))),
    h('tbody', {}, acoes.map((a) => h(
      'tr', { class: 'acoes-linha', tabindex: '0', onclick: () => abrirDetalhe({ id: a.id, apoio, usuario, aoMudar: recarregar }),
        onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); } },
      h('td', { 'data-rotulo': 'Data' }, formatarData(a.dataAcao)),
      h('td', { 'data-rotulo': 'Local' }, a.instituicaoLocal || '—'),
      h('td', { 'data-rotulo': 'Tipo' }, nomeDoTipo(a)),
      h('td', { 'data-rotulo': 'Situação' }, h('span', { class: `badge ${CLASSE_STATUS[a.status]}` }, STATUS[a.status])),
      h('td', { 'data-rotulo': 'Unidade' }, a.unidadeSigla),
      h('td', { 'data-rotulo': 'Participantes' }, a.qtdParticipantes === null ? '—' : formatarNumero(a.qtdParticipantes)))))));
}

function renderizar() {
  if (!acoes.length) {
    area.replaceChildren(h('div', { class: 'card card-vazio' }, h('p', {}, 'Nenhuma ação encontrada para os filtros escolhidos.')));
    return;
  }
  const realizadas = acoes.filter((a) => a.status === 'REALIZADA');
  const participantes = realizadas.reduce((s, a) => s + (a.qtdParticipantes || 0), 0);
  area.replaceChildren(
    h('p', { class: 'acoes-resumo' }, `${acoes.length} ação${acoes.length === 1 ? '' : 'ões'} · ${realizadas.length} realizada${realizadas.length === 1 ? '' : 's'} · ${formatarNumero(participantes)} participantes`),
    ...(visao === 'agenda' ? renderAgenda() : [renderLista()]),
  );
}

let sequencia = 0;
async function recarregar() {
  const minha = ++sequencia;
  try {
    const resposta = await api.get('/api/acoes', { ...filtros, ordem: visao === 'agenda' ? 'asc' : 'desc' });
    if (minha !== sequencia) return;
    acoes = resposta;
    renderizar();
  } catch (e) {
    if (minha !== sequencia) return;
    area.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, e.message));
    toast.erro(e.message);
  }
}

function botaoVisao(chave, rotulo) {
  const b = h('button', {
    type: 'button', class: 'btn btn-pequeno btn-secundario', 'aria-pressed': String(visao === chave),
    onclick: () => {
      visao = chave;
      try { localStorage.setItem('acoes.visao', chave); } catch { /* sem storage */ }
      for (const outro of b.parentElement.children) outro.setAttribute('aria-pressed', String(outro === b));
      recarregar();
    },
  }, rotulo);
  return b;
}

conteudo.replaceChildren(
  h('div', { class: 'pagina-titulo' },
    h('h1', {}, 'Visitas e Ações'),
    h('button', { type: 'button', class: 'btn', onclick: () => abrirFormulario({ apoio, usuario, acao: null, aoSalvar: recarregar }) }, 'Nova ação')),
  montarFiltros(),
  h('div', { class: 'acoes-visoes', role: 'group', 'aria-label': 'Modo de exibição' }, botaoVisao('agenda', 'Agenda por mês'), botaoVisao('lista', 'Lista')),
  area,
);
area.append(carregando());
await recarregar();
