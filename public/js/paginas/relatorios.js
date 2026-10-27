// Relatórios — Relatório Final Familiar (.docx; modelo oficial 4), Semestral/Prestação de Contas (.docx) e exportação CSV.
// Convenções: docs/CONVENCOES.md ("Como criar uma página").
import { iniciarPagina } from '../layout.js';
import { api } from '../api.js';
import { h } from '../ui.js';
import { montarIndividual } from '../relatorios/individual.js';
import { montarSemestral } from '../relatorios/semestral.js';
import { montarExportar } from '../relatorios/exportar.js';
import { mensagemErro } from '../relatorios/comum.js';

const { conteudo } = await iniciarPagina('relatorios');
conteudo.replaceChildren(h('div', { class: 'pagina-titulo' }, h('h1', {}, 'Relatórios')));

let opcoes;
try {
  opcoes = await api.get('/api/relatorios/opcoes');
} catch (e) {
  conteudo.append(h('div', { class: 'aviso aviso-perigo' }, mensagemErro(e)));
  throw e;
}

const ABAS = [
  { chave: 'individual', rotulo: 'Relatório final familiar', montar: montarIndividual },
  { chave: 'semestral', rotulo: 'Semestral / Prestação de contas', montar: montarSemestral },
  { chave: 'exportar', rotulo: 'Exportar planilhas (CSV)', montar: montarExportar },
];

const painel = h('div', { id: 'rel-painel', role: 'tabpanel' });
const abas = h('div', { class: 'rel-abas', role: 'tablist', 'aria-label': 'Tipo de relatório' });
const botoes = new Map();

function abrir(chave) {
  const aba = ABAS.find((a) => a.chave === chave) || ABAS[0];
  for (const [k, b] of botoes) b.setAttribute('aria-selected', String(k === aba.chave));
  const raiz = h('div');
  painel.replaceChildren(raiz);
  aba.montar(raiz, opcoes);
}

for (const aba of ABAS) {
  const b = h('button', { type: 'button', class: 'rel-aba', role: 'tab', 'aria-selected': 'false', onclick: () => abrir(aba.chave) }, aba.rotulo);
  botoes.set(aba.chave, b);
  abas.append(b);
}

conteudo.append(abas, painel);

if (opcoes.unidades.length === 0) {
  painel.replaceChildren(h('div', { class: 'aviso aviso-aviso' }, 'Seu usuário não está vinculado a nenhuma unidade. Peça ao administrador para vincular.'));
} else {
  // ?acompanhamento=ID (link vindo da tela de Famílias) abre direto o relatório individual
  const parametros = new URLSearchParams(location.search);
  abrir(parametros.get('aba') || 'individual');
}
