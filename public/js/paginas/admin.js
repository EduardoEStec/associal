// Administração: abas Usuários · Unidades · Listas · Configurações · Auditoria.
import { iniciarPagina } from '../layout.js';
import { h } from '../ui.js';
import { montarUsuarios } from '../admin/usuarios.js';
import { montarUnidades } from '../admin/unidades.js';
import { montarListas } from '../admin/listas.js';
import { montarConfiguracoes } from '../admin/configuracoes.js';
import { montarAuditoria } from '../admin/auditoria.js';

const { usuario, conteudo } = await iniciarPagina('admin');

// O COORDENADOR só enxerga Configurações (prazo do questionário final); o servidor também restringe.
const todas = [
  { chave: 'usuarios', rotulo: 'Usuários', montar: montarUsuarios, perfis: ['ADMIN'] },
  { chave: 'unidades', rotulo: 'Unidades', montar: montarUnidades, perfis: ['ADMIN'] },
  { chave: 'listas', rotulo: 'Listas', montar: montarListas, perfis: ['ADMIN'] },
  { chave: 'configuracoes', rotulo: 'Configurações', montar: montarConfiguracoes, perfis: ['ADMIN', 'COORDENADOR'] },
  { chave: 'auditoria', rotulo: 'Auditoria', montar: montarAuditoria, perfis: ['ADMIN'] },
];
const abas = todas.filter((a) => a.perfis.includes(usuario.perfil));

const painel = h('section', { role: 'tabpanel' });
const lista = h('div', { class: 'abas', role: 'tablist', 'aria-label': 'Seções da administração' });
const botoes = new Map();

async function abrir(aba) {
  for (const [chave, botao] of botoes) botao.setAttribute('aria-selected', String(chave === aba.chave));
  history.replaceState(null, '', `#${aba.chave}`);
  painel.replaceChildren();
  await aba.montar(painel, usuario);
}

for (const aba of abas) {
  const botao = h('button', { type: 'button', class: 'aba', role: 'tab', 'aria-selected': 'false', onclick: () => abrir(aba) }, aba.rotulo);
  botoes.set(aba.chave, botao);
  lista.append(botao);
}

conteudo.replaceChildren(h('div', { class: 'pagina-titulo' }, h('h1', {}, 'Administração')), lista, painel);
await abrir(abas.find((a) => `#${a.chave}` === location.hash) || abas[0]);
