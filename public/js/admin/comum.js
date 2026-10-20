// Helpers compartilhados pelas abas da administração.
import { h, abrirModal, mostrarErrosCampos, toast } from '../ui.js';
import { ErroApi } from '../api.js';

let contador = 0;

// Um .campo com rótulo + controle. tipo: 'text' | 'email' | 'number' | 'select' | 'textarea'
export function campo(rotulo, nome, { tipo = 'text', valor = '', opcoes = [], ajuda, obrigatorio, ...extras } = {}) {
  const id = `adm-${nome}-${++contador}`;
  let controle;
  if (tipo === 'select') {
    controle = h('select', { class: 'select', id, name: nome, ...extras },
      opcoes.map((o) => h('option', { value: o.valor, selected: String(o.valor) === String(valor) }, o.rotulo)));
  } else {
    controle = h('input', { class: 'input', id, name: nome, type: tipo, value: valor ?? '', required: obrigatorio, ...extras });
  }
  return h('div', { class: 'campo' },
    h('label', { for: id }, rotulo), controle, ajuda ? h('span', { class: 'ajuda' }, ajuda) : null);
}

export function caixa(rotulo, nome, marcado, valor) {
  return h('label', { class: 'opcao' },
    h('input', { type: 'checkbox', name: nome, value: valor ?? '', checked: !!marcado }), h('span', {}, rotulo));
}

// Modal com formulário. `aoSalvar(form)` faz a chamada à API; erro de validação marca os campos e mantém aberto.
export function modalFormulario({ titulo, form, textoSalvar = 'Salvar', aoSalvar }) {
  form.noValidate = true;
  form.addEventListener('submit', (e) => e.preventDefault());
  const modal = abrirModal({
    titulo,
    conteudo: form,
    botoes: [
      { texto: 'Cancelar', classe: 'btn btn-secundario' },
      {
        texto: textoSalvar,
        classe: 'btn',
        acao: async () => {
          try {
            await aoSalvar(form);
            return true;
          } catch (e) {
            if (e instanceof ErroApi && e.detalhes) mostrarErrosCampos(form, e.detalhes);
            else toast.erro(e.message);
            return false;
          }
        },
      },
    ],
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
      e.preventDefault();
      modal.elemento.querySelector('.modal-rodape button:last-child').click();
    }
  });
  return modal;
}

// Tabela responsiva. colunas: [{ rotulo, valor(linha) -> Node|texto }]
export function tabela(colunas, linhas, { classeLinha } = {}) {
  return h('div', { class: 'tabela-wrap' },
    h('table', { class: 'tabela tabela-responsiva' },
      h('thead', {}, h('tr', {}, colunas.map((c) => h('th', {}, c.rotulo)))),
      h('tbody', {}, linhas.map((l) =>
        h('tr', { class: classeLinha?.(l) }, colunas.map((c) => h('td', { 'data-rotulo': c.rotulo }, c.valor(l))))))));
}

export const vazio = (msg) => h('div', { class: 'card card-vazio' }, h('p', {}, msg));
export const badgeAtivo = (ativo) => h('span', { class: `badge ${ativo ? 'badge-sucesso' : ''}` }, ativo ? 'Ativo' : 'Inativo');
