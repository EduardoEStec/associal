// Administração: abas Usuários · Unidades · Listas · Perguntas e opções · Configurações · Auditoria.
import { iniciarPagina } from '../layout.js';
import { h } from '../ui.js';
import { montarUsuarios } from '../admin/usuarios.js';
import { montarUnidades } from '../admin/unidades.js';
import { montarListas } from '../admin/listas.js';
import { montarPerguntas } from '../admin/perguntas.js';
import { montarConfiguracoes } from '../admin/configuracoes.js';
import { montarAuditoria } from '../admin/auditoria.js';

const { usuario, conteudo } = await iniciarPagina('admin');

// ADMIN vê tudo. O COORDENADOR gerencia tudo menos as contas de usuário e a auditoria (o servidor também restringe).
const GESTAO = ['ADMIN', 'COORDENADOR'];
const todas = [
  { chave: 'usuarios', rotulo: 'Usuários', montar: montarUsuarios, perfis: ['ADMIN'] },
  { chave: 'unidades', rotulo: 'Unidades', montar: montarUnidades, perfis: GESTAO },
  { chave: 'listas', rotulo: 'Listas', montar: montarListas, perfis: GESTAO },
  { chave: 'perguntas', rotulo: 'Perguntas e opções', montar: montarPerguntas, perfis: GESTAO },
  { chave: 'configuracoes', rotulo: 'Configurações', montar: montarConfiguracoes, perfis: GESTAO },
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
