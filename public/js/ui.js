// Componentes de interface em JS: toast, modal, confirmação, helpers de DOM, formatação e máscaras.
// Estilos correspondentes: public/css/componentes.css.
//
//   import { toast, abrirModal, confirmar, h, formatarData } from '/js/ui.js';

// ---------- DOM ----------

// Cria elementos sem innerHTML (seguro contra XSS):
//   h('button', { class: 'btn', onclick: salvar }, 'Salvar')
//   h('div', { class: 'card' }, h('h2', {}, titulo), outroNo)
export function h(tag, atributos = {}, ...filhos) {
  const no = document.createElement(tag);
  for (const [chave, valor] of Object.entries(atributos || {})) {
    if (valor === false || valor === null || valor === undefined) continue;
    if (chave.startsWith('on') && typeof valor === 'function') no.addEventListener(chave.slice(2).toLowerCase(), valor);
    else if (chave === 'class') no.className = valor;
    else if (chave === 'dataset') Object.assign(no.dataset, valor);
    else if (valor === true) no.setAttribute(chave, '');
    else no.setAttribute(chave, valor);
  }
  for (const filho of filhos.flat()) {
    if (filho === null || filho === undefined || filho === false) continue;
    no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return no;
}

// Escapa texto para uso em template strings com innerHTML. Prefira h(); se montar HTML, SEMPRE use esc().
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const carregando = () => h('div', { class: 'carregando', role: 'status', 'aria-label': 'Carregando' });

// ---------- Toast ----------

let areaToasts;
export function toast(mensagem, tipo = 'info', duracaoMs = 4000) {
  if (!areaToasts) {
    areaToasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.append(areaToasts);
  }
  const no = h('div', { class: `toast${tipo !== 'info' ? ` toast-${tipo}` : ''}`, role: 'status' }, mensagem);
  areaToasts.append(no);
  setTimeout(() => no.remove(), duracaoMs);
  return no;
}
toast.sucesso = (m) => toast(m, 'sucesso');
toast.erro = (m) => toast(m, 'erro', 6000);
toast.aviso = (m) => toast(m, 'aviso');

// ---------- Modal ----------

// abrirModal({ titulo, conteudo, botoes, fechavel })
//  conteudo: Node ou texto; botoes: [{ texto, classe, acao }] — `acao` pode devolver false para não fechar.
//  Retorna { fechar, elemento }.
export function abrirModal({ titulo, conteudo, botoes = [], fechavel = true } = {}) {
  const ultimoFoco = document.activeElement;
  const fundo = h('div', { class: 'modal-fundo' });
  const caixa = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo || 'Janela' });
  if (titulo) caixa.append(h('h2', { class: 'modal-titulo' }, titulo));
  caixa.append(conteudo instanceof Node ? conteudo : h('p', {}, conteudo ?? ''));

  function fechar() {
    document.removeEventListener('keydown', aoTeclar);
    fundo.remove();
    ultimoFoco?.focus?.();
  }
  function aoTeclar(e) {
    if (e.key === 'Escape' && fechavel) fechar();
  }

  if (botoes.length) {
    const rodape = h('div', { class: 'modal-rodape' });
    for (const b of botoes) {
      rodape.append(
        h('button', {
          type: 'button',
          class: b.classe || 'btn',
          onclick: async (e) => {
            const resultado = await b.acao?.(e);
            if (resultado !== false) fechar();
          },
        }, b.texto),
      );
    }
    caixa.append(rodape);
  }

  fundo.append(caixa);
  if (fechavel) fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(); });
  document.addEventListener('keydown', aoTeclar);
  document.body.append(fundo);
  (caixa.querySelector('input, select, textarea, button') || caixa).focus?.();
  return { fechar, elemento: caixa };
}

// await confirmar('Excluir este registro?') -> true/false
export function confirmar(mensagem, { titulo = 'Confirmação', textoOk = 'Confirmar', perigo = false } = {}) {
  return new Promise((resolve) => {
    abrirModal({
      titulo,
      conteudo: mensagem,
      fechavel: true,
      botoes: [
        { texto: 'Cancelar', classe: 'btn btn-secundario', acao: () => resolve(false) },
        { texto: textoOk, classe: perigo ? 'btn btn-perigo' : 'btn', acao: () => resolve(true) },
      ],
    });
  });
}

// ---------- Formulários ----------

// Mostra erros de validação da API ({ campo: mensagem }) nos .campo do formulário (pelo name do input).
export function mostrarErrosCampos(formulario, detalhes) {
  formulario.querySelectorAll('.campo.invalido').forEach((c) => {
    c.classList.remove('invalido');
    c.querySelector('.erro-campo')?.remove();
  });
  let primeiro = null;
  for (const [campo, mensagem] of Object.entries(detalhes || {})) {
    const entrada = formulario.elements[campo];
    const campoEl = (entrada instanceof RadioNodeList ? entrada[0] : entrada)?.closest('.campo');
    if (!campoEl) continue;
    campoEl.classList.add('invalido');
    campoEl.append(h('span', { class: 'erro-campo', role: 'alert' }, mensagem));
    primeiro ||= campoEl;
  }
  primeiro?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// Desabilita o botão durante uma operação assíncrona.
export async function comEspera(botao, fn) {
  botao.disabled = true;
  try { return await fn(); } finally { botao.disabled = false; }
}

// ---------- Formatação (datas no padrão BR; a API usa 'YYYY-MM-DD') ----------

// '2026-03-05' ou '2026-03-05T00:00:00.000Z' -> '05/03/2026' (sem conversão de fuso para colunas DATE)
export function formatarData(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : '';
}

// '05/03/2026' -> '2026-03-05' (ou '' se incompleta/inválida)
export function dataParaIso(br) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br || '');
  if (!m) return '';
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : '';
}

// Datetime (UTC vindo da API) -> '05/03/2026 14:30' no fuso do navegador
export function formatarDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function hojeIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const formatarMoeda = (n) =>
  n === null || n === undefined ? '' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatarNumero = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('pt-BR'));

export const apenasDigitos = (v) => String(v ?? '').replace(/\D/g, '');

export function formatarCpf(v) {
  const d = apenasDigitos(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

export function formatarCep(v) {
  return apenasDigitos(v).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
}

// Validação de CPF (mesma regra do back-end; o back-end é quem decide)
export function cpfValido(cpf) {
  const d = apenasDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const tam of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tam; i++) soma += Number(d[i]) * (tam + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(d[tam])) return false;
  }
  return true;
}

// Aplica máscara enquanto o usuário digita: mascarar(input, formatarCpf)
export function mascarar(input, formatador) {
  input.addEventListener('input', () => { input.value = formatador(input.value); });
}
