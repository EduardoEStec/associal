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
import { montarMenuUsuario } from './menu-usuario.js'; // botão do usuário + menu suspenso (Trocar de usuário / Sair)
import { salvarShell, limparShell } from './shell-cache.js'; // lembra o usuário para pré-pintar o casco na próxima página
import './data-bonita.js'; // troca os <input type="date"> por campo digitável + calendário no visual do app

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
  subir: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  descer: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  igual: '<path d="M5 9h14M5 15h14"/>',
  seta: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  estrela: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  alvo: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  trocar: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  mensagem: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
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

function menuDoUsuario(usuario) {
  const unidades = usuario.unidades.length === 1 ? usuario.unidades[0].nome : '';
  return montarMenuUsuario({
    nome: usuario.nome, perfil: ROTULO_PERFIL[usuario.perfil], unidades, avatar: iniciais(usuario.nome),
    icone, aoSair: sair, aoTrocar: trocarUsuario,
  });
}

// Só para página sem casco no HTML (todas as páginas do app já trazem o casco; ver public/*.html)
function montarCabecalho(usuario) {
  return h(
    'header', { class: 'app-cabecalho' },
    h('a', { class: 'app-marca', href: '/index.html', 'aria-label': 'ASSOCIAL — início' },
      h('img', { class: 'app-logo', src: '/img/logo-associal.png', alt: '', width: 40, height: 40 }),
      h('span', { class: 'app-marca-nome' }, 'ASSOCIAL')),
    h('span', { class: 'app-data', id: 'app-data' }, icone('calendario'),
      h('span', { class: 'app-data-longa', id: 'data-hoje-texto' }), h('span', { class: 'app-data-curta', id: 'data-hoje-curta' })),
    h('div', { class: 'app-usuario' }, menuDoUsuario(usuario)),
  );
}

// O botão do usuário substitui o espaço reservado do HTML (mesma caixa, sem pulo)
function hidratarCabecalho(cabecalho, usuario) {
  cabecalho.querySelector('.app-usuario').replaceChildren(menuDoUsuario(usuario));
  confirmarData();
}

// A data do cabeçalho vem pré-pintada (shell-previo.js); aqui só se confirma (ex.: página aberta desde ontem)
function confirmarData() {
  const agora = new Date();
  const textos = {
    'data-hoje-texto': agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }),
    'data-hoje-curta': agora.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
  };
  for (const [id, texto] of Object.entries(textos)) {
    const e = document.getElementById(id);
    if (e && e.textContent !== texto) e.textContent = texto;
  }
}

function abrirMais(extras) {
  abrirModal({
    titulo: 'Mais opções',
    conteudo: h('div', { class: 'menu-mais' }, extras.map((it) => h('a', { href: it.href }, icone(it.chave), it.rotulo))),
    botoes: [{ texto: 'Fechar', classe: 'btn btn-secundario' }],
  });
}

// O menu já está no HTML (com todos os itens); aqui ele só é conferido contra o perfil e ganha o botão "Mais".
function hidratarMenu(nav, chaveAtual, itens) {
  const hrefAtual = ITENS_MENU.find((it) => it.chave === chaveAtual)?.href;
  const permitidos = new Set(itens.map((it) => it.href));
  for (const a of nav.querySelectorAll('a[href]:not(.app-menu-marca)')) {
    const href = a.getAttribute('href');
    if (!permitidos.has(href)) a.remove();
    else if (href === hrefAtual) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const botao = nav.querySelector('.menu-mais-botao');
  const extras = itens.length > MAX_ITENS_CELULAR ? itens.slice(MAX_ITENS_CELULAR - 1) : [];
  if (!botao) return;
  if (extras.length) botao.addEventListener('click', () => abrirMais(extras));
  else botao.remove();
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
        class: i >= visiveisNoCelular ? 'menu-extra-coord' : null,
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
          onclick: () => abrirMais(extras),
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
  limparShell();
  location.href = '/login.html';
}

// Encerra a sessão e abre o login com o campo usuário vazio (o login não guarda o último usuário).
async function trocarUsuario() {
  try { await api.post('/api/auth/logout'); } catch { /* sai mesmo assim */ }
  limparShell();
  location.href = '/login.html?trocar=1';
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

  document.documentElement.dataset.perfil = usuario.perfil;
  salvarShell(usuario);
  const conteudo = document.getElementById('conteudo');
  conteudo.classList.add('conteudo');
  const cabecalho = document.querySelector('.app-cabecalho');
  if (cabecalho) hidratarCabecalho(cabecalho, usuario); else { document.body.prepend(montarCabecalho(usuario)); confirmarData(); }
  const menu = document.querySelector('.app-menu');
  if (menu) hidratarMenu(menu, chave, itens); else document.body.append(montarMenu(chave, itens));
  document.body.classList.add('com-layout');

  if (usuario.deveTrocarSenha) await exigirTrocaSenha();
  return { usuario, conteudo, itens };
}
