// Atendimentos — perguntas adicionais criadas pela coordenação (Administração > Perguntas e opções).
// Monta a seção do formulário a partir de GET /api/apoio/perguntas/ATENDIMENTO. As respostas vão em `extras`
// ({ "<código da pergunta>": valor }): texto, número, true/false, código da opção ou lista de códigos.
import { h } from '../ui.js';

const nomeDe = (d) => `extras.${d.codigo}`;

function rotulo(d, id) {
  return h('label', { for: id, class: d.obrigatoria ? 'obrigatorio' : false }, d.texto);
}

function grupo(d, filhos) {
  return h('div', { class: 'campo', role: 'group', 'aria-label': d.texto },
    h('span', { class: `rotulo${d.obrigatoria ? ' obrigatorio' : ''}` }, d.texto), d.ajuda ? h('span', { class: 'ajuda' }, d.ajuda) : null, filhos);
}

function opcoesVisiveis(d, escolhidos) {
  return d.opcoes.filter((o) => o.ativa !== false || escolhidos.includes(o.valor));
}

export function montarExtras(defs, existentes = {}) {
  const campos = new Map(); // código -> { elemento, ler(), aplicar(valor) }

  for (const d of defs) {
    const nome = nomeDe(d);
    const id = `extra-${d.codigo}`;
    let elemento;
    let ler;
    let aplicar;

    if (d.tipo === 'TEXTO' || d.tipo === 'NUMERO') {
      const entrada = d.tipo === 'TEXTO'
        ? h('textarea', { class: 'textarea', name: nome, id, rows: 3, maxlength: 1000 })
        : h('input', { class: 'input', type: 'number', step: 'any', inputmode: 'decimal', name: nome, id });
      elemento = h('div', { class: 'campo' }, rotulo(d, id), entrada, d.ajuda ? h('span', { class: 'ajuda' }, d.ajuda) : null);
      ler = () => (entrada.value.trim() === '' ? null : entrada.value);
      aplicar = (v) => { entrada.value = v === null || v === undefined ? '' : String(v); };
    } else if (d.tipo === 'SIM_NAO') {
      const radios = [[true, 'Sim'], [false, 'Não']].map(([v, texto]) => ({
        v, entrada: h('input', { type: 'radio', name: nome, value: String(v) }), texto,
      }));
      elemento = grupo(d, h('div', { class: 'opcoes' }, radios.map((r) => h('label', { class: 'opcao' }, r.entrada, r.texto))));
      ler = () => radios.find((r) => r.entrada.checked)?.v ?? null;
      aplicar = (v) => radios.forEach((r) => { r.entrada.checked = r.v === v; });
    } else if (d.tipo === 'ESCOLHA') {
      const atuais = existentes[d.codigo] ? [existentes[d.codigo]] : [];
      const radios = opcoesVisiveis(d, atuais).map((o) => ({ o, entrada: h('input', { type: 'radio', name: nome, value: o.valor }) }));
      elemento = grupo(d, h('div', { class: 'opcoes atend-opcoes-grade' }, radios.map((r) => h('label', { class: 'opcao' }, r.entrada, r.o.rotulo))));
      ler = () => radios.find((r) => r.entrada.checked)?.o.valor ?? null;
      aplicar = (v) => radios.forEach((r) => { r.entrada.checked = r.o.valor === v; });
    } else {
      const atuais = existentes[d.codigo] || [];
      const caixas = opcoesVisiveis(d, atuais).map((o) => ({ o, entrada: h('input', { type: 'checkbox', name: nome, value: o.valor }) }));
      elemento = grupo(d, h('div', { class: 'opcoes atend-opcoes-grade' }, caixas.map((c) => h('label', { class: 'opcao' }, c.entrada, c.o.rotulo))));
      ler = () => caixas.filter((c) => c.entrada.checked).map((c) => c.o.valor);
      aplicar = (v) => caixas.forEach((c) => { c.entrada.checked = (v || []).includes(c.o.valor); });
    }
    campos.set(d.codigo, { elemento, ler, aplicar });
  }

  const secao = h('fieldset', { class: 'secao' }, h('legend', {}, 'Informações adicionais'), [...campos.values()].map((c) => c.elemento));
  secao.hidden = defs.length === 0;

  return {
    secao,
    ler: () => Object.fromEntries([...campos].map(([codigo, c]) => [codigo, c.ler()])),
    aplicar: (mapa) => { for (const [codigo, c] of campos) c.aplicar((mapa || {})[codigo]); },
  };
}
