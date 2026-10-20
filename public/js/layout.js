// Layout comum: cabeçalho, menu inferior (celular) / lateral (desktop) conforme o perfil.
//
// Uso em cada página (public/js/paginas/<pagina>.js):
//
//   import { iniciarPagina } from '../layout.js';
//   const { usuario, conteudo } = await iniciarPagina('atendimentos');
//   conteudo.append(...);   // o <main id="conteudo"> da página
//
// `chave` precisa existir em ITENS_MENU (abaixo). Páginas novas: adicione o item aqui.

import { api, ErroApi } from './api.js';
import { h, toast, abrirModal, mostrarErrosCampos } from './ui.js';
import { registrarServiceWorker } from './pwa.js';
import './select-bonito.js'; // troca os <select> por listas suspensas no visual do app

const SVG = {
  inicio: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  atendimentos: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  acoes: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  familias: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  relatorios: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  painel: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>',
  admin: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  alerta: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  relogio: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  mais: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
};

export function icone(nome) {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">${SVG[nome] || ''}</svg>`;
  return span.firstChild;
}

const TODOS = ['ASSISTENTE', 'COORDENADOR', 'ADMIN'];

// Ordem = ordem do menu. `perfis` define quem vê o item (e quem pode abrir a página).
export const ITENS_MENU = [
  { chave: 'inicio', rotulo: 'Início', href: '/index.html', perfis: TODOS },
  { chave: 'atendimentos', rotulo: 'Atendimentos', href: '/atendimentos.html', perfis: TODOS },
  { chave: 'acoes', rotulo: 'Ações', href: '/acoes.html', perfis: TODOS },
  { chave: 'familias', rotulo: 'Famílias', href: '/familias.html', perfis: TODOS },
  { chave: 'relatorios', rotulo: 'Relatórios', href: '/relatorios.html', perfis: TODOS },
  { chave: 'painel', rotulo: 'Painel', href: '/painel.html', perfis: ['COORDENADOR', 'ADMIN'] },
  // COORDENADOR só enxerga a aba Configurações (prazo do questionário final); a página e a API restringem o resto.
  { chave: 'admin', rotulo: 'Administração', href: '/admin.html', perfis: ['ADMIN', 'COORDENADOR'] },
];

const ROTULO_PERFIL = { ASSISTENTE: 'Assistente Social', COORDENADOR: 'Coordenador', ADMIN: 'Administrador' };
const MAX_ITENS_CELULAR = 5;

function iniciais(nome) {
  const partes = String(nome || '?').trim().split(/\s+/);
  return ((partes[0] || '?')[0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

function montarCabecalho(usuario) {
  const unidades = usuario.unidades.length === 1 ? usuario.unidades[0].nome : '';
  return h(
    'header', { class: 'app-cabecalho' },
    h('a', { class: 'app-marca', href: '/index.html', 'aria-label': 'ASSOCIAL — início' },
      h('img', { class: 'app-logo', src: '/img/logo-associal.png', alt: '', width: 40, height: 40 }),
      h('span', { class: 'app-marca-nome' }, 'ASSOCIAL')),
    h(
      'div', { class: 'app-usuario' },
      h('div', { class: 'nome' }, usuario.nome, h('small', {}, [ROTULO_PERFIL[usuario.perfil], unidades].filter(Boolean).join(' · '))),
      h('span', { class: 'app-avatar', 'aria-hidden': 'true' }, iniciais(usuario.nome)),
      h('button', { type: 'button', class: 'btn btn-texto btn-pequeno', onclick: sair }, 'Sair'),
    ),
  );
}

function montarMenu(chaveAtual, itens) {
  const nav = h('nav', { class: 'app-menu', 'aria-label': 'Menu principal' },
    // Logo no topo do menu lateral (visível só no desktop)
    h('a', { class: 'app-menu-marca', href: '/index.html' },
      h('img', { src: '/img/logo-associal.png', alt: '', width: 48, height: 48 }),
      h('span', { class: 'app-menu-marca-texto' }, h('strong', {}, 'ASSOCIAL'), 'Serviço Social')));
  const excesso = itens.length > MAX_ITENS_CELULAR;
  const visiveisNoCelular = excesso ? MAX_ITENS_CELULAR - 1 : itens.length;

  itens.forEach((item, i) => {
    const link = h(
      'a',
      {
        href: item.href,
        class: i >= visiveisNoCelular ? 'menu-extra' : null,
        'aria-current': item.chave === chaveAtual ? 'page' : null,
      },
      icone(item.chave),
      h('span', {}, item.rotulo),
    );
    nav.append(link);
  });

  if (excesso) {
    const extras = itens.slice(visiveisNoCelular);
    nav.append(
      h(
        'button',
        {
          type: 'button',
          class: 'menu-mais-botao',
          onclick: () => abrirModal({
            titulo: 'Mais opções',
            conteudo: h('div', { class: 'menu-mais' }, extras.map((it) => h('a', { href: it.href }, icone(it.chave), it.rotulo))),
            botoes: [{ texto: 'Fechar', classe: 'btn btn-secundario' }],
          }),
        },
        icone('mais'),
        h('span', {}, 'Mais'),
      ),
    );
  }
  return nav;
}

async function sair() {
  try { await api.post('/api/auth/logout'); } catch { /* sai mesmo assim */ }
  location.href = '/login.html';
}

// Troca de senha obrigatória (primeiro acesso / senha redefinida). Resolve quando concluída.
function exigirTrocaSenha() {
  return new Promise((resolve) => {
    const form = h(
      'form', { novalidate: true },
      h('p', {}, 'Por segurança, defina uma nova senha para continuar.'),
      h('div', { class: 'campo' }, h('label', { for: 'senhaAtual' }, 'Senha atual'),
        h('input', { class: 'input', id: 'senhaAtual', name: 'senhaAtual', type: 'password', autocomplete: 'current-password', required: true })),
      h('div', { class: 'campo' }, h('label', { for: 'novaSenha' }, 'Nova senha'),
        h('input', { class: 'input', id: 'novaSenha', name: 'novaSenha', type: 'password', autocomplete: 'new-password', minlength: 8, required: true }),
        h('span', { class: 'ajuda' }, 'Mínimo de 8 caracteres.')),
    );
    const modal = abrirModal({
      titulo: 'Defina sua nova senha',
      conteudo: form,
      fechavel: false,
      botoes: [{
        texto: 'Salvar nova senha',
        acao: async () => {
          try {
            await api.post('/api/auth/senha', { senhaAtual: form.senhaAtual.value, novaSenha: form.novaSenha.value });
            toast.sucesso('Senha alterada.');
            resolve();
            return true;
          } catch (e) {
            if (e instanceof ErroApi && e.detalhes) mostrarErrosCampos(form, e.detalhes);
            else toast.erro(e.message);
            return false; // mantém o modal aberto
          }
        },
      }],
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault(); // Enter envia pelo botão do modal
      modal.elemento.querySelector('.modal-rodape button').click();
    });
  });
}

// Inicializa a página: valida sessão/perfil, injeta cabeçalho + menu e devolve { usuario, conteudo }.
export async function iniciarPagina(chave) {
  registrarServiceWorker();
  const { usuario } = await api.get('/api/auth/me'); // 401 => api.js redireciona ao login

  const itens = ITENS_MENU.filter((it) => it.perfis.includes(usuario.perfil));
  const itemAtual = ITENS_MENU.find((it) => it.chave === chave);
  if (itemAtual && !itemAtual.perfis.includes(usuario.perfil)) {
    location.replace('/index.html');
    return new Promise(() => {}); // interrompe o script da página
  }

  const conteudo = document.getElementById('conteudo');
  conteudo.classList.add('conteudo');
  document.body.prepend(montarCabecalho(usuario));
  document.body.append(montarMenu(chave, itens));
  document.body.classList.add('com-layout');

  if (usuario.deveTrocarSenha) await exigirTrocaSenha();
  return { usuario, conteudo, itens };
}
