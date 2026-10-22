// Listas suspensas no visual do app: cada <select> vira um combobox acessível (gatilho + painel logo abaixo do campo).
// Melhoria progressiva: o <select> original continua no DOM (oculto) como fonte da verdade — ao escolher, o value dele
// é atualizado e os eventos 'input' e 'change' são disparados, então o código que já ouve o <select> não muda.
//
// Aplicado sozinho a todos os <select> da página (inclusive os criados depois). Exceções: <select multiple>, com
// size > 1 ou com o atributo data-nativo ficam nativos. Carregado por js/layout.js.

import { abrirExclusivo, liberar } from './painel-unico.js';

const CHECK = '<svg class="icone sb-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
const SETA = '<svg class="icone sb-seta" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const MAIS_QUE_ISSO_TEM_BUSCA = 8;
const ALTURA_MAXIMA = 260;
const ALTURA_MINIMA = 100;
const FOLGA = 8;

let contador = 0;
let iniciado = false;

const semAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const original = (prop) => Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);

function criar(tag, classe, atributos = {}) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, v);
  return el;
}

// Lê <option>/<optgroup> do select num vetor plano: { grupo } ou { indice, valor, rotulo, desabilitada }.
function lerItens(select) {
  const itens = [];
  const opcao = (o, grupoDesabilitado) => ({
    indice: o.index, valor: o.value, rotulo: o.textContent.trim(), desabilitada: o.disabled || grupoDesabilitado, oculta: o.hidden,
  });
  for (const filho of select.children) {
    if (filho.tagName === 'OPTGROUP') {
      itens.push({ grupo: filho.label });
      for (const o of filho.children) if (o.tagName === 'OPTION') itens.push(opcao(o, filho.disabled));
    } else if (filho.tagName === 'OPTION') {
      itens.push(opcao(filho, false));
    }
  }
  return itens;
}

function aprimorar(select) {
  if (select.dataset.sb || select.multiple || select.size > 1 || 'nativo' in select.dataset) return;
  select.dataset.sb = '1';
  const n = (contador += 1);

  const envoltorio = criar('div', 'sb');
  const valor = criar('span', 'sb-valor');
  const gatilho = criar('button', 'sb-gatilho', {
    type: 'button', id: `sb-${n}`, role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': `sb-lista-${n}`,
  });
  gatilho.append(valor);
  gatilho.insertAdjacentHTML('beforeend', SETA);
  select.replaceWith(envoltorio);
  envoltorio.append(select, gatilho);
  select.classList.add('sb-nativo');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  // foco vindo do <select> (label, modal, validação) vai para o gatilho
  select.addEventListener('focus', () => gatilho.focus());

  let painel = null;
  let lista = null;
  let busca = null;
  let navegaveis = []; // [{ el, item }] das opções que podem receber foco/seleção
  let ativa = -1;
  let digitado = '';
  let esperaDigitacao;
  let ultimoTeclado = 0;

  // ---------- gatilho (texto, estado, rótulo) ----------
  function atualizar() {
    const opcao = select.options[select.selectedIndex];
    const texto = opcao ? opcao.textContent.trim() : '';
    valor.textContent = texto || ' ';
    gatilho.classList.toggle('sb-vazio', !!opcao && opcao.value === '' && /^(selecione|escolha)/i.test(texto));
    gatilho.disabled = select.disabled;
    gatilho.setAttribute('aria-required', String(select.required));
    const rotulos = [...(select.labels || [])].map((l, i) => l.id || (l.id = `sb-rot-${n}-${i}`));
    if (select.getAttribute('aria-label')) gatilho.setAttribute('aria-label', select.getAttribute('aria-label'));
    else gatilho.setAttribute('aria-labelledby', [...rotulos, gatilho.id].join(' '));
    if (painel) desenhar(busca ? busca.value : '');
  }
  // value/selectedIndex atribuídos pelo código da página (ex.: botão "Limpar") não disparam evento: reflete na hora
  for (const prop of ['value', 'selectedIndex']) {
    const base = original(prop);
    Object.defineProperty(select, prop, {
      configurable: true,
      get() { return base.get.call(this); },
      set(v) { base.set.call(this, v); atualizar(); },
    });
  }
  new MutationObserver(atualizar).observe(select, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'required', 'label', 'selected', 'hidden'],
  });
  select.form?.addEventListener('reset', () => setTimeout(atualizar));

  // ---------- painel ----------
  function desenhar(filtro) {
    const termo = semAcento(filtro.trim());
    lista.replaceChildren();
    navegaveis = [];
    let grupo = null;
    let grupoEl = null;
    for (const item of lerItens(select)) {
      if (item.grupo !== undefined) {
        grupo = item;
        grupoEl = null;
        continue;
      }
      if (item.oculta || (termo && !semAcento(item.rotulo).includes(termo))) continue;
      let pai = lista;
      if (grupo) {
        if (!grupoEl) {
          grupoEl = criar('div', 'sb-grupo', { role: 'group', 'aria-label': grupo.grupo });
          grupoEl.append(Object.assign(criar('div', 'sb-grupo-titulo', { role: 'presentation' }), { textContent: grupo.grupo }));
          lista.append(grupoEl);
        }
        pai = grupoEl;
      }
      const selecionada = item.indice === select.selectedIndex;
      const el = criar('div', 'sb-opcao', { role: 'option', id: `sb-${n}-${item.indice}`, 'aria-selected': String(selecionada) });
      if (item.desabilitada) el.setAttribute('aria-disabled', 'true');
      el.append(Object.assign(criar('span', 'sb-texto'), { textContent: item.rotulo || ' ' }));
      if (selecionada) el.insertAdjacentHTML('beforeend', CHECK);
      if (!item.desabilitada) {
        el.addEventListener('mousedown', (e) => e.preventDefault()); // mantém o foco no gatilho/busca
        el.addEventListener('mousemove', () => ativar(navegaveis.findIndex((x) => x.el === el), false));
        el.addEventListener('click', () => escolher(item));
        navegaveis.push({ el, item });
      }
      pai.append(el);
    }
    if (!lista.children.length) lista.append(Object.assign(criar('div', 'sb-vazio-msg'), { textContent: 'Nenhuma opção encontrada.' }));
    ativar(Math.max(0, navegaveis.findIndex((x) => x.item.indice === select.selectedIndex)), true);
    posicionar();
  }

  function ativar(indice, rolar) {
    if (ativa >= 0 && navegaveis[ativa]) navegaveis[ativa].el.classList.remove('ativa');
    ativa = navegaveis.length ? indice : -1;
    const atual = navegaveis[ativa];
    if (!atual) { (busca || gatilho).removeAttribute('aria-activedescendant'); return; }
    atual.el.classList.add('ativa');
    (busca || gatilho).setAttribute('aria-activedescendant', atual.el.id);
    if (rolar) atual.el.scrollIntoView({ block: 'nearest' });
  }

  function mover(passo) {
    if (!navegaveis.length) return;
    ativar((ativa + passo + navegaveis.length) % navegaveis.length, true);
  }

  function posicionar(fecharSeSumir = false) {
    if (!painel) return;
    if (!gatilho.isConnected) { fechar(false); return; }
    const r = gatilho.getBoundingClientRect();
    if (fecharSeSumir && (r.bottom < 0 || r.top > innerHeight)) { fechar(false); return; }
    let limite = innerHeight;
    const menu = document.querySelector('.app-menu'); // menu inferior do celular cobre o rodapé
    if (menu) {
      const m = menu.getBoundingClientRect();
      if (m.top > innerHeight / 2 && m.height < innerHeight / 2) limite = m.top;
    }
    const abaixo = limite - r.bottom - FOLGA;
    const acima = r.top - FOLGA;
    const natural = lista.scrollHeight + (busca ? busca.parentElement.offsetHeight : 0) + 2;
    const paraCima = abaixo < Math.min(natural, ALTURA_MAXIMA) && acima > abaixo;
    const largura = Math.min(r.width, innerWidth - 2 * FOLGA);
    painel.style.width = `${largura}px`;
    painel.style.left = `${Math.min(Math.max(FOLGA, r.left), innerWidth - largura - FOLGA)}px`;
    painel.style.setProperty('--sb-altura', `${Math.max(ALTURA_MINIMA, Math.min(ALTURA_MAXIMA, paraCima ? acima : abaixo))}px`);
    painel.classList.toggle('cima', paraCima);
    if (paraCima) { painel.style.top = 'auto'; painel.style.bottom = `${innerHeight - r.top + 4}px`; }
    else { painel.style.bottom = 'auto'; painel.style.top = `${r.bottom + 4}px`; }
  }

  function aoRolar(e) {
    if (!painel || painel.contains(e.target)) return;
    posicionar(true);
  }
  function aoRedimensionar() { posicionar(); } // a barra de endereço do celular redimensiona ao rolar: só reposiciona
  function aoClicarFora(e) {
    if (!painel.contains(e.target) && !gatilho.contains(e.target)) fechar(false);
  }

  function abrir() {
    if (painel || select.disabled) return;
    abrirExclusivo(fechar);
    const r = gatilho.getBoundingClientRect();
    if (innerHeight - r.bottom < 200 && r.top < 200) gatilho.scrollIntoView({ block: 'center' });

    painel = criar('div', 'sb-painel');
    lista = criar('div', 'sb-lista', { role: 'listbox', id: `sb-lista-${n}`, tabindex: '-1' });
    if (gatilho.getAttribute('aria-labelledby')) lista.setAttribute('aria-labelledby', gatilho.getAttribute('aria-labelledby'));
    if (lerItens(select).filter((i) => i.grupo === undefined).length > MAIS_QUE_ISSO_TEM_BUSCA) {
      busca = criar('input', 'sb-busca', { type: 'text', placeholder: 'Buscar…', 'aria-label': 'Buscar opção', autocomplete: 'off', spellcheck: 'false' });
      busca.addEventListener('input', () => desenhar(busca.value));
      busca.addEventListener('keydown', aoTeclar);
      const caixa = criar('div', 'sb-busca-caixa');
      caixa.append(busca);
      painel.append(caixa);
    }
    painel.append(lista);
    document.body.append(painel);
    gatilho.setAttribute('aria-expanded', 'true');
    desenhar('');
    requestAnimationFrame(() => painel?.classList.add('aberto'));
    document.addEventListener('pointerdown', aoClicarFora, true);
    addEventListener('scroll', aoRolar, true);
    addEventListener('resize', aoRedimensionar);
    if (busca && matchMedia('(pointer: fine)').matches) busca.focus({ preventScroll: true }); // no celular não abre o teclado sozinho
  }

  function fechar(devolverFoco = true) {
    if (!painel) return;
    document.removeEventListener('pointerdown', aoClicarFora, true);
    removeEventListener('scroll', aoRolar, true);
    removeEventListener('resize', aoRedimensionar);
    painel.remove();
    painel = lista = busca = null;
    navegaveis = [];
    ativa = -1;
    gatilho.setAttribute('aria-expanded', 'false');
    gatilho.removeAttribute('aria-activedescendant');
    liberar(fechar);
    if (devolverFoco) gatilho.focus({ preventScroll: true });
  }

  function escolher(item) {
    const mudou = item.indice !== select.selectedIndex;
    fechar(true);
    if (!mudou) return;
    select.selectedIndex = item.indice;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---------- teclado ----------
  function digitar(tecla) {
    clearTimeout(esperaDigitacao);
    digitado += semAcento(tecla);
    esperaDigitacao = setTimeout(() => { digitado = ''; }, 600);
    const itens = painel ? navegaveis.map((x) => x.item) : lerItens(select).filter((i) => i.grupo === undefined && !i.desabilitada && !i.oculta);
    if (!itens.length) return;
    const atual = painel ? ativa : itens.findIndex((i) => i.indice === select.selectedIndex);
    for (let passo = digitado.length > 1 ? 0 : 1; passo <= itens.length; passo++) {
      const i = (atual + passo + itens.length) % itens.length;
      if (!semAcento(itens[i].rotulo).startsWith(digitado)) continue;
      if (painel) ativar(i, true);
      else if (itens[i].indice !== select.selectedIndex) escolher(itens[i]);
      return;
    }
  }

  function aoTeclar(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    const naBusca = e.target === busca;
    ultimoTeclado = performance.now();
    if (!painel) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(k)) { e.preventDefault(); abrir(); }
      else if (k.length === 1) digitar(k);
      return;
    }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(true); } // não fecha o modal por baixo
    else if (k === 'Tab') fechar(true);
    else if (k === 'ArrowDown') { e.preventDefault(); mover(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); mover(-1); }
    else if (k === 'Home' && !naBusca) { e.preventDefault(); ativar(0, true); }
    else if (k === 'End' && !naBusca) { e.preventDefault(); ativar(navegaveis.length - 1, true); }
    else if (k === 'Enter' || (k === ' ' && !naBusca)) { e.preventDefault(); if (navegaveis[ativa]) escolher(navegaveis[ativa].item); }
    else if (k.length === 1 && !naBusca) digitar(k);
  }

  gatilho.addEventListener('keydown', aoTeclar);
  gatilho.addEventListener('click', () => {
    if (performance.now() - ultimoTeclado < 400) return; // clique sintético de Enter/Espaço: o teclado já tratou
    if (painel) fechar(true); else abrir();
  });
  atualizar();
}

function varrer(no) {
  if (no.nodeType !== 1) return;
  if (no.tagName === 'SELECT') aprimorar(no);
  no.querySelectorAll('select').forEach(aprimorar);
}

export function iniciarSelectsBonitos() {
  if (iniciado) return;
  iniciado = true;
  varrer(document.body);
  new MutationObserver((mutacoes) => {
    for (const m of mutacoes) m.addedNodes.forEach(varrer);
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarSelectsBonitos);
else iniciarSelectsBonitos();
