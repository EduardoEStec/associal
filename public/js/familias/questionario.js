// Questionário familiar em 5 etapas (um bloco por passo), pensado para aplicar no celular com a família.
// Rascunho salvo automaticamente no servidor; o mesmo roteiro serve para INICIAL e FINAL ("hoje").
import { api, ErroApi } from '../api.js';
import { h, toast, carregando, confirmar, mostrarErrosCampos } from '../ui.js';
import { consumirRetorno } from '../retorno-atendimento.js';
import { carregarApoio, cabecalhoPagina, podeEscrever, isoDia, montar } from './util.js';

const AUTOSAVE_MS = 1500;
const LIMITES_FAIXA = {
  ATE_100: [-Infinity, 100], DE_101_200: [100, 200], DE_201_300: [200, 300], ACIMA_300: [300, Infinity],
};
const CHAVE_APOIO = { beneficio: 'beneficio', destino_economia: 'destinoEconomia' };

const paraTexto = (v) => (v === null || v === undefined ? '' : String(v));
const numeroBr = (v) => Number(String(v).replace(',', '.'));

export async function renderQuestionario(ctx, acId, tipoUrl) {
  const { usuario, conteudo, navegar } = ctx;
  const pedido = String(tipoUrl).toUpperCase();
  const tipo = ['FINAL', 'REAVALIACAO'].includes(pedido) ? pedido : 'INICIAL';
  const reavaliacao = tipo === 'REAVALIACAO';
  const NOME_TIPO = { INICIAL: 'Questionário inicial', REAVALIACAO: 'Reavaliação rápida', FINAL: 'Questionário final' };
  montar(conteudo, carregando());

  const [modelo, dados, apoio, ficha] = await Promise.all([
    api.get('/api/familias/questionario/modelo', { tipo }),
    api.get(`/api/familias/acompanhamentos/${acId}/questionarios/${tipo}`),
    carregarApoio(),
    api.get(`/api/familias/acompanhamentos/${acId}`),
  ]);

  const editavel = dados.podeEditar && podeEscrever(usuario);
  const jaConcluido = dados.concluido;
  const autosalvar = editavel && !jaConcluido; // concluído é validado por inteiro: só salva manualmente

  const resp = { ...dados.respostas };
  resp.dataAplicacao = isoDia(dados.dataAplicacao) || dados.sugestoes.dataAplicacao;
  if (resp.qtdMembrosFamilia === null) resp.qtdMembrosFamilia = dados.sugestoes.qtdMembrosFamilia;

  const blocos = modelo.blocos;
  const total = blocos.length;
  let passo = 0;
  let errosPendentes = {};

  // Campo -> passo (para levar o usuário ao primeiro erro)
  const passoDoCampo = { dataAplicacao: 0 };
  blocos.forEach((b, i) => b.perguntas.forEach((p) => {
    [p.campo, p.campoOutro, p.detalhe?.campo, p.detalhe?.campoOutro].filter(Boolean).forEach((c) => { passoDoCampo[c] = i; });
  }));

  // ---------- salvamento ----------
  const status = h('span', { class: 'q-status', role: 'status', 'aria-live': 'polite' });
  let temporizador = null;
  let salvando = null;
  let sujo = false;

  function mostrarStatus(texto, erro = false) {
    status.textContent = texto;
    status.classList.toggle('q-status-erro', erro);
  }
  function agendar() {
    sujo = true;
    if (!autosalvar) return;
    clearTimeout(temporizador);
    mostrarStatus('Alterações não salvas…');
    temporizador = setTimeout(() => { descarregar(); }, AUTOSAVE_MS);
  }
  // Salva o rascunho (serializado: nunca duas requisições ao mesmo tempo)
  async function descarregar() {
    clearTimeout(temporizador);
    if (!autosalvar) return;
    while (salvando) await salvando.catch(() => {});
    if (!sujo) return;
    sujo = false;
    mostrarStatus('Salvando…');
    salvando = api.put(`/api/familias/acompanhamentos/${acId}/questionarios/${tipo}`, { ...resp, concluir: false });
    try {
      await salvando;
      mostrarStatus(`Rascunho salvo às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (e) {
      sujo = true;
      mostrarStatus(e.status === 0 ? 'Sem conexão: não salvo. Tente de novo.' : `Não foi possível salvar: ${e.message}`, true);
    } finally {
      salvando = null;
    }
  }
  const aoOcultar = () => { if (document.visibilityState === 'hidden') descarregar(); };
  document.addEventListener('visibilitychange', aoOcultar);
  ctx.aoSair = async () => {
    document.removeEventListener('visibilitychange', aoOcultar);
    await descarregar();
  };

  function definir(campo, valor) {
    resp[campo] = valor;
    delete errosPendentes[campo];
    agendar();
  }

  // ---------- construtores de pergunta ----------
  let contadorId = 0;
  const novoId = (campo) => `q-${campo}-${contadorId++}`;

  function envolver(p, filhos, { grupo = false } = {}) {
    const idRotulo = novoId('rotulo');
    const rotulo = h('span', { class: 'rotulo q-texto', id: idRotulo }, h('span', { class: 'q-codigo' }, `${p.codigo}.`), ` ${p.texto}`);
    return h('div', { class: 'campo q-pergunta', role: grupo ? 'group' : null, 'aria-labelledby': grupo ? idRotulo : null },
      rotulo, p.ajuda ? h('span', { class: 'ajuda' }, p.ajuda) : null, filhos);
  }

  function opcaoRadio(campo, valor, rotulo, marcado, aoMudar) {
    const input = h('input', { type: 'radio', name: campo, value: valor });
    input.checked = marcado;
    input.addEventListener('change', () => { if (input.checked) aoMudar(valor); });
    return h('label', { class: 'opcao q-opcao' }, input, h('span', {}, rotulo));
  }

  function campoNumero(p) {
    const moeda = p.tipo === 'moeda';
    const id = novoId(p.campo);
    const valor = resp[p.campo];
    const input = h('input', {
      class: 'input q-input', id, name: p.campo, type: moeda ? 'text' : 'number',
      inputmode: moeda ? 'decimal' : 'numeric', min: p.min, max: p.max, autocomplete: 'off',
      placeholder: moeda ? 'R$ 0,00' : null,
    });
    input.value = moeda && valor !== null && valor !== '' && !Number.isNaN(Number(valor))
      ? String(valor).replace('.', ',') : paraTexto(valor);
    input.addEventListener('input', () => definir(p.campo, input.value === '' ? null : input.value));
    return input;
  }

  function campoBooleano(p, aoMudar) {
    const v = resp[p.campo];
    return h('div', { class: 'opcoes q-sim-nao' },
      opcaoRadio(p.campo, 'true', 'Sim', v === true, () => { definir(p.campo, true); aoMudar?.(true); }),
      opcaoRadio(p.campo, 'false', 'Não', v === false, () => { definir(p.campo, false); aoMudar?.(false); }));
  }

  function campoEscolha(p) {
    return h('div', { class: 'opcoes' },
      p.opcoes.map((o) => opcaoRadio(p.campo, o.valor, o.rotulo, resp[p.campo] === o.valor, (x) => definir(p.campo, x))));
  }

  function campoTexto(p) {
    const area = h('textarea', { class: 'textarea q-input', id: novoId(p.campo), name: p.campo, rows: 4, maxlength: 4000 });
    area.value = paraTexto(resp[p.campo]);
    area.addEventListener('input', () => definir(p.campo, area.value));
    return area;
  }

  // Múltipla escolha de tabela de apoio + texto "outro" quando a opção exige
  function campoMultipla({ campo, apoioNome, campoOutro, rotuloOutro }) {
    const lista = apoio[CHAVE_APOIO[apoioNome]] || [];
    const marcados = new Set(resp[campo] || []);
    const outro = h('input', { class: 'input q-input', type: 'text', id: novoId(campoOutro || campo), name: campoOutro || `${campo}Outro`, maxlength: 200, placeholder: rotuloOutro });
    outro.value = paraTexto(resp[campoOutro]);
    outro.addEventListener('input', () => definir(campoOutro, outro.value));
    const campoOutroWrap = h('div', { class: 'campo' }, h('label', { for: outro.id }, rotuloOutro), outro);

    const atualizarOutro = () => {
      const exige = lista.some((o) => o.exigeTexto && marcados.has(o.id));
      campoOutroWrap.hidden = !exige;
    };
    const caixas = lista.map((o) => {
      const input = h('input', { type: 'checkbox', name: campo, value: String(o.id) });
      input.checked = marcados.has(o.id);
      input.addEventListener('change', () => {
        if (input.checked) marcados.add(o.id); else marcados.delete(o.id);
        definir(campo, [...marcados]);
        atualizarOutro();
      });
      return h('label', { class: 'opcao q-opcao' }, input, h('span', {}, o.nome));
    });
    atualizarOutro();
    return h('div', {}, h('div', { class: 'opcoes' }, caixas), campoOutroWrap);
  }

  function perguntaCompleta(p) {
    switch (p.tipo) {
      case 'numero': return envolver(p, campoNumero(p));
      case 'moeda': return envolver(p, campoNumero(p));
      case 'texto': return envolver(p, campoTexto(p));
      case 'escolha': {
        const opcoes = campoEscolha(p);
        if (!p.detalhe) return envolver(p, opcoes, { grupo: true });
        // 3b: faixa + valor aproximado (o valor escolhe a faixa automaticamente)
        const valor = campoNumero({ campo: p.detalhe.campo, tipo: 'moeda' });
        valor.addEventListener('input', () => {
          const n = numeroBr(valor.value);
          if (valor.value === '' || Number.isNaN(n)) return;
          const faixa = Object.entries(LIMITES_FAIXA).find(([, [min, max]]) => n > min && n <= max)?.[0];
          if (faixa) {
            definir(p.campo, faixa);
            opcoes.querySelector(`input[value="${faixa}"]`).checked = true;
          }
        });
        const wrap = h('div', { class: 'campo' }, h('label', { for: valor.id }, p.detalhe.rotulo), valor,
          h('span', { class: 'ajuda' }, 'Ao digitar o valor, a faixa acima é escolhida sozinha.'));
        return envolver(p, [opcoes, wrap], { grupo: true });
      }
      case 'booleano': {
        if (!p.detalhe) return envolver(p, campoBooleano(p), { grupo: true });
        // 1d: sim/não + quais auxílios
        const detalhe = h('div', { class: 'q-detalhe' },
          h('p', { class: 'rotulo' }, p.detalhe.rotulo),
          campoMultipla({ campo: p.detalhe.campo, apoioNome: p.detalhe.apoio, campoOutro: p.detalhe.campoOutro, rotuloOutro: 'Qual outro auxílio?' }));
        detalhe.hidden = resp[p.campo] !== true;
        return envolver(p, [campoBooleano(p, (v) => { detalhe.hidden = !v; }), detalhe], { grupo: true });
      }
      case 'multipla':
        return envolver(p, campoMultipla({ campo: p.campo, apoioNome: p.apoio, campoOutro: p.campoOutro, rotuloOutro: 'Qual outro destino?' }), { grupo: true });
      default: return null;
    }
  }

  // ---------- passos ----------
  const area = h('div', { class: 'q-passo' });
  const barra = h('div', { class: 'q-barra', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': total });
  const preenchimento = h('div', { class: 'q-barra-cheia' });
  barra.append(preenchimento);
  const titulo = h('h2', { class: 'q-titulo-passo', tabindex: '-1' });
  const pontos = h('ol', { class: 'q-pontos', 'aria-label': 'Etapas do questionário' });
  const botaoVoltar = h('button', { type: 'button', class: 'btn btn-secundario q-botao' }, '← Voltar');
  const botaoAvancar = h('button', { type: 'button', class: 'btn q-botao' }, 'Próximo →');

  blocos.forEach((b, i) => {
    pontos.append(h('li', {}, h('button', {
      type: 'button', class: 'q-ponto', 'aria-label': `Ir para a etapa ${i + 1}: ${b.titulo}`, onclick: () => irPara(i),
    }, String(i + 1))));
  });

  function renderPasso() {
    const bloco = blocos[passo];
    const form = h('form', { novalidate: true, class: 'q-form' });
    form.addEventListener('submit', (e) => e.preventDefault());

    if (passo === 0) {
      const data = h('input', { class: 'input', type: 'date', id: 'q-data', name: 'dataAplicacao', max: dados.sugestoes.dataAplicacao });
      data.value = resp.dataAplicacao;
      data.addEventListener('input', () => definir('dataAplicacao', data.value));
      form.append(h('div', { class: 'campo' }, h('label', { for: 'q-data', class: 'obrigatorio' }, 'Data de aplicação do questionário'), data));
    }
    bloco.perguntas.forEach((p) => form.append(perguntaCompleta(p)));

    const fs = h('fieldset', { class: 'q-conjunto', disabled: !editavel }, form);
    area.replaceChildren(fs);

    titulo.textContent = `Etapa ${passo + 1} de ${total} — ${bloco.titulo}`;
    barra.setAttribute('aria-valuenow', String(passo + 1));
    barra.setAttribute('aria-valuetext', titulo.textContent);
    preenchimento.style.width = `${((passo + 1) / total) * 100}%`;
    pontos.querySelectorAll('.q-ponto').forEach((b, i) => {
      b.classList.toggle('q-ponto-atual', i === passo);
      if (i === passo) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    botaoVoltar.hidden = passo === 0;
    const ultimo = passo === total - 1;
    botaoAvancar.textContent = !ultimo ? 'Próximo →' : (editavel ? (jaConcluido ? 'Salvar alterações' : 'Concluir questionário') : 'Fechar');

    const errosDoPasso = Object.fromEntries(Object.entries(errosPendentes).filter(([c]) => passoDoCampo[c] === passo));
    if (Object.keys(errosDoPasso).length) mostrarErrosCampos(form, errosDoPasso);
  }

  async function irPara(i) {
    if (i === passo) return;
    passo = i;
    renderPasso();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    titulo.focus({ preventScroll: true });
    descarregar();
  }

  botaoVoltar.addEventListener('click', () => irPara(Math.max(0, passo - 1)));
  botaoAvancar.addEventListener('click', async () => {
    if (passo < total - 1) { irPara(passo + 1); return; }
    if (!editavel) { navegar(`#/a/${acId}`); return; }
    await concluir();
  });

  async function concluir() {
    if (!jaConcluido) {
      const ok = await confirmar('Concluir o questionário? Você ainda poderá corrigir as respostas enquanto o acompanhamento estiver em andamento.', { titulo: 'Concluir questionário', textoOk: 'Concluir' });
      if (!ok) return;
    }
    botaoAvancar.disabled = true;
    clearTimeout(temporizador);
    while (salvando) await salvando.catch(() => {});
    try {
      await api.put(`/api/familias/acompanhamentos/${acId}/questionarios/${tipo}`, { ...resp, concluir: true });
      sujo = false;
      toast.sucesso(jaConcluido ? 'Alterações salvas.' : 'Questionário concluído.');
      const voltarPara = consumirRetorno(acId); // veio do botão Formulário do atendimento
      if (voltarPara) location.href = voltarPara; else navegar(reavaliacao ? `#/a/${acId}/indicadores` : `#/a/${acId}`);
    } catch (e) {
      if (e instanceof ErroApi && e.status === 400 && e.detalhes) {
        errosPendentes = e.detalhes;
        const primeiro = Math.min(...Object.keys(e.detalhes).map((c) => (passoDoCampo[c] ?? 0)));
        toast.erro(`Faltam respostas ou há campos inválidos (etapa ${primeiro + 1}).`);
        passo = primeiro;
        renderPasso();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        toast.erro(e.message);
      }
    } finally {
      botaoAvancar.disabled = false;
    }
  }

  // ---------- montagem ----------
  const nomeFamilia = ficha.responsavel.nome;
  const aviso = !editavel
    ? h('div', { class: 'aviso aviso-aviso' }, dados.bloqueio || 'Você pode consultar este questionário, mas não alterá-lo.')
    : null;

  montar(conteudo, 
    cabecalhoPagina(NOME_TIPO[tipo], { voltar: { href: reavaliacao ? `#/a/${acId}/indicadores` : `#/a/${acId}`, texto: nomeFamilia } }),
    aviso,
    tipo !== 'INICIAL' && editavel
      ? h('p', { class: 'texto-pequeno texto-suave' }, reavaliacao
        ? 'Reavaliação rápida da metade do acompanhamento: só as perguntas de situação atual (cerca de 3 minutos).'
        : 'As perguntas estão no presente ("hoje"): compare com o questionário inicial.') : null,
    h('div', { class: 'card q-cabecalho' }, titulo, barra, pontos),
    area,
    h('div', { class: 'q-nav' }, status, h('div', { class: 'q-nav-botoes' }, botaoVoltar, botaoAvancar)),
  );
  renderPasso();
  if (autosalvar) mostrarStatus(dados.existe ? 'Rascunho carregado.' : 'O rascunho é salvo automaticamente.');
}
