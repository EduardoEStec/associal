// Menu do usuário no cabeçalho: botão (nome + perfil + avatar + chevron) que abre um painel no visual da lista suspensa (.sb-painel).
// Itens: Trocar de usuário e Sair. Teclado: Enter/Espaço/setas abrem, setas navegam, Esc fecha e devolve o foco.

import { abrirExclusivo, liberar } from './painel-unico.js';

const FOLGA = 8;

function el(tag, classe, attrs = {}) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// opcoes: { nome, perfil, unidades (texto), avatar (iniciais), icone(nome), aoTrocar(), aoSair() }
export function montarMenuUsuario(opcoes) {
  const gatilho = el('button', 'app-usuario-botao', {
    type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Menu do usuário: ${opcoes.nome}`,
  });
  const nome = el('span', 'nome');
  nome.append(opcoes.nome);
  const sub = el('small');
  sub.textContent = [opcoes.perfil, opcoes.unidades].filter(Boolean).join(' · ');
  nome.append(sub);
  const avatar = el('span', 'app-avatar', { 'aria-hidden': 'true' });
  avatar.textContent = opcoes.avatar;
  const seta = opcoes.icone('chevron');
  seta.classList.add('app-usuario-seta');
  gatilho.append(nome, avatar, seta);

  let painel = null;
  let itens = [];
  let ativo = -1;

  function ativar(i) {
    if (ativo >= 0 && itens[ativo]) itens[ativo].classList.remove('ativa');
    ativo = i;
    if (itens[i]) { itens[i].classList.add('ativa'); itens[i].focus({ preventScroll: true }); }
  }

  function posicionar() {
    if (!painel) return;
    const r = gatilho.getBoundingClientRect();
    const largura = Math.min(300, innerWidth - 2 * FOLGA);
    painel.style.width = `${largura}px`;
    painel.style.top = `${r.bottom + 4}px`;
    painel.style.left = `${Math.min(Math.max(FOLGA, r.right - largura), innerWidth - largura - FOLGA)}px`;
  }

  function aoClicarFora(e) {
    if (!painel.contains(e.target) && !gatilho.contains(e.target)) fechar(false);
  }

  function abrir(primeiro = true) {
    if (painel) return;
    abrirExclusivo(fechar);
    painel = el('div', 'sb-painel um-painel', { role: 'menu', 'aria-label': 'Menu do usuário' });
    const cab = el('div', 'um-cabecalho');
    const n = el('strong'); n.textContent = opcoes.nome;
    const p = el('span'); p.textContent = opcoes.perfil;
    cab.append(n, p);
    if (opcoes.unidades) { const u = el('span'); u.textContent = opcoes.unidades; cab.append(u); }
    const lista = el('div', 'sb-lista');
    itens = [['trocar', 'Trocar de usuário', opcoes.aoTrocar], ['sair', 'Sair', opcoes.aoSair]].map(([ic, texto, acao]) => {
      const b = el('button', 'sb-opcao um-item', { type: 'button', role: 'menuitem', tabindex: '-1' });
      b.append(opcoes.icone(ic), texto);
      b.addEventListener('click', () => { fechar(false); acao(); });
      b.addEventListener('mousemove', () => { if (itens[ativo] !== b) ativar(itens.indexOf(b)); });
      lista.append(b);
      return b;
    });
    painel.append(cab, lista);
    document.body.append(painel);
    gatilho.setAttribute('aria-expanded', 'true');
    posicionar();
    requestAnimationFrame(() => painel?.classList.add('aberto'));
    document.addEventListener('pointerdown', aoClicarFora, true);
    document.addEventListener('keydown', aoTeclar, true);
    addEventListener('resize', posicionar);
    addEventListener('scroll', posicionar, true);
    ativo = -1;
    ativar(primeiro ? 0 : itens.length - 1);
  }

  function fechar(devolverFoco = true) {
    if (!painel) return;
    document.removeEventListener('pointerdown', aoClicarFora, true);
    document.removeEventListener('keydown', aoTeclar, true);
    removeEventListener('resize', posicionar);
    removeEventListener('scroll', posicionar, true);
    painel.remove();
    painel = null;
    itens = [];
    ativo = -1;
    gatilho.setAttribute('aria-expanded', 'false');
    liberar(fechar);
    if (devolverFoco) gatilho.focus({ preventScroll: true });
  }

  function aoTeclar(e) {
    if (!painel) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(true); }
    else if (k === 'Tab') fechar(true);
    else if (k === 'ArrowDown') { e.preventDefault(); ativar((ativo + 1) % itens.length); }
    else if (k === 'ArrowUp') { e.preventDefault(); ativar((ativo - 1 + itens.length) % itens.length); }
    else if (k === 'Home') { e.preventDefault(); ativar(0); }
    else if (k === 'End') { e.preventDefault(); ativar(itens.length - 1); }
  }

  gatilho.addEventListener('click', () => { if (painel) fechar(true); else abrir(true); });
  gatilho.addEventListener('keydown', (e) => {
    if (painel) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); abrir(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); abrir(false); }
  });
  return gatilho;
}
