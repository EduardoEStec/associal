// Peças compartilhadas pelas abas do Painel (Progresso e Satisfação): números, selos de semáforo, cartões e CSV.
import { icone } from '../layout.js';
import { h, formatarData, formatarNumero } from '../ui.js';

export const pct = (v) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export const num = (v, casas = 1) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas }));
export const sinal = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${num(v)}`);
export const rotuloPeriodo = (p) => `${formatarData(p.inicio)} a ${formatarData(p.fim)}`;
export { formatarNumero };

const SELO = {
  VERDE: { classe: 'badge-sucesso', icone: 'check', texto: 'Bom' },
  AMARELO: { classe: 'badge-aviso', icone: 'alerta', texto: 'Atenção' },
  VERMELHO: { classe: 'badge-perigo', icone: 'x', texto: 'Crítico' },
};

// Semáforo: sempre ícone + palavra (o significado não depende só da cor). Sem n suficiente: "n insuficiente".
export function seloSemaforo(semaforo, { insuficiente = false } = {}) {
  const s = SELO[semaforo];
  if (!s) return h('span', { class: 'badge' }, insuficiente ? 'n insuficiente' : 'Sem semáforo');
  return h('span', { class: `badge ${s.classe}` }, icone(s.icone), s.texto);
}

export function kpi(rotulo, valor, ajuda, extra) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'kpi-rotulo' }, rotulo),
    h('strong', { class: 'kpi-valor' }, valor),
    extra || null,
    ajuda ? h('span', { class: 'kpi-ajuda' }, ajuda) : null);
}

export function tabela(colunas, linhas, { classeLinha } = {}) {
  return h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela tabela-responsiva' },
    h('thead', {}, h('tr', {}, colunas.map((c) => h('th', { scope: 'col' }, c.rotulo)))),
    h('tbody', {}, linhas.map((l) => h('tr', { class: classeLinha ? classeLinha(l) : null },
      colunas.map((c) => h('td', { 'data-rotulo': c.rotulo, class: c.num ? 'num' : null }, c.celula(l))))))));
}

// CSV para Excel brasileiro: separador ';', decimal ',', BOM UTF-8 (como o CSV do painel de operação).
export function exportarCsv(arquivo, cabecalho, linhas) {
  const esc = (v) => {
    let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
    if (typeof v !== 'number' && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = `﻿${[cabecalho, ...linhas].map((l) => l.map(esc).join(';')).join('\r\n')}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: arquivo });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function cabecalhoComCsv(titulo, aoExportar) {
  return h('div', { class: 'pagina-titulo' }, h('h2', {}, titulo),
    aoExportar ? h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', onclick: aoExportar }, 'Exportar CSV') : null);
}

export const notaNMinimo = (n) => h('p', { class: 'texto-suave texto-pequeno' },
  `Com menos de ${n} registros no recorte aparece só o número absoluto: percentuais, nota geral e semáforo ficam ocultos, porque abaixo disso o número é instável.`);
