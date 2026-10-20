// Utilitários compartilhados das telas de relatórios.
import { h } from '../ui.js';
import { ErroApi } from '../api.js';

// Baixa um arquivo gerado pela API (.docx/.csv). O api.js só entende JSON, então aqui o fetch é direto,
// mas com o mesmo cabeçalho anti-CSRF e o mesmo formato de erro (ErroApi).
export async function baixarArquivo(url, { metodo = 'GET', corpo, consulta } = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(consulta || {})) if (v !== undefined && v !== null && v !== '') params.append(k, v);
  const destino = params.toString() ? `${url}?${params}` : url;

  let resposta;
  try {
    resposta = await fetch(destino, {
      method: metodo,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'fetch', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ErroApi(0, 'SEM_CONEXAO', 'Sem conexão com o servidor. Verifique sua internet.');
  }

  if (!resposta.ok) {
    const dados = (resposta.headers.get('content-type') || '').includes('application/json')
      ? await resposta.json().catch(() => null)
      : null;
    const erro = dados?.erro || {};
    if (resposta.status === 401) location.href = `/login.html?proximo=${encodeURIComponent(location.pathname + location.search)}`;
    throw new ErroApi(resposta.status, erro.codigo || 'ERRO', erro.mensagem || 'Não foi possível gerar o arquivo.', erro.detalhes);
  }

  const blob = await resposta.blob();
  const cab = resposta.headers.get('content-disposition') || '';
  const nome = decodeURIComponent((/filename\*=UTF-8''([^;]+)/i.exec(cab) || [])[1] || (/filename="([^"]+)"/i.exec(cab) || [])[1] || 'relatorio');
  const link = h('a', { href: URL.createObjectURL(blob), download: nome });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  return nome;
}

let contador = 0;
export const novoId = (prefixo) => `${prefixo}-${(contador += 1)}`;

// Campo de texto de uma linha: devolve { elemento, entrada }.
export function campoLinha(rotulo, { valor = '', tipo = 'text', nome, max = 300, ajuda } = {}) {
  const id = novoId('rel');
  const entrada = h('input', { class: 'input', id, name: nome, type: tipo, value: valor, maxlength: tipo === 'date' ? false : String(max) });
  const elemento = h('div', { class: 'campo' }, h('label', { for: id }, rotulo), entrada, ajuda && h('span', { class: 'ajuda' }, ajuda));
  return { elemento, entrada };
}

// Área de texto editável com botão "Restaurar texto padrão".
export function campoTexto(rotulo, padrao, { linhas = 6, nome } = {}) {
  const id = novoId('rel');
  const entrada = h('textarea', { class: 'textarea rel-area-texto', id, name: nome, rows: String(linhas), maxlength: '20000' });
  entrada.value = padrao ?? '';
  const restaurar = h('button', {
    type: 'button', class: 'btn btn-texto btn-pequeno',
    onclick: () => { entrada.value = padrao ?? ''; },
  }, 'Restaurar texto padrão');
  const elemento = h('div', { class: 'campo' }, h('div', { class: 'rel-texto-cab' }, h('label', { for: id }, rotulo), restaurar), entrada);
  return { elemento, entrada };
}

// Texto alterado em relação ao padrão?
export const alterado = (entrada, padrao) => entrada.value !== (padrao ?? '');

export function mensagemErro(e) {
  if (e instanceof ErroApi && e.detalhes) {
    const d = Object.values(e.detalhes);
    if (d.length) return `${e.message} ${d.join(' ')}`;
  }
  return e.message || 'Ocorreu um erro inesperado.';
}
