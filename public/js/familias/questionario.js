// Questionário familiar dos modelos oficiais (M1): INICIAL e FINAL têm perguntas diferentes, uma seção por etapa,
// pensado para aplicar no celular com a família. Rascunho salvo automaticamente no servidor.
// Perguntas, textos, opções e perguntas adicionais vêm do catálogo (GET /api/familias/questionario/modelo).
// Questionário no formato anterior (LEGADO) abre em ./questionario-legado.js (concluído = somente leitura).
import { api, ErroApi } from '../api.js';
import { h, toast, carregando, confirmar, mostrarErrosCampos, formatarData, formatarCpf } from '../ui.js';
import { consumirRetorno } from '../retorno-atendimento.js';
import { formatarTelefone } from '../telefone.js';
import { cabecalhoPagina, podeEscrever, isoDia, montar, textoOuTraco } from './util.js';
import { renderQuestionarioLegado } from './questionario-legado.js';

const AUTOSAVE_MS = 1500;
const NOME_TIPO = { INICIAL: 'Questionário inicial', REAVALIACAO: 'Reavaliação rápida', FINAL: 'Questionário final' };

const paraTexto = (v) => (v === null || v === undefined ? '' : String(v));
const vazio = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

// Idade em anos (data 'AAAA-MM-DD' ou número)
function idadeDe(pessoa) {
  if (pessoa.idade !== null && pessoa.idade !== undefined) return Number(pessoa.idade);
  if (!pessoa.dataNascimento) return null;
  const nasc = new Date(pessoa.dataNascimento);
  if (Number.isNaN(nasc.getTime())) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getUTCFullYear();
  if (hoje.getMonth() < nasc.getUTCMonth() || (hoje.getMonth() === nasc.getUTCMonth() && hoje.getDate() < nasc.getUTCDate())) idade -= 1;
  return idade >= 0 ? idade : null;
}

// Sugestão da faixa etária predominante a partir da ficha da família (a assistente confirma)
function faixaPredominante(ficha) {
  const idades = [ficha.responsavel, ...(ficha.membros || [])].map(idadeDe).filter((i) => i !== null);
  if (!idades.length) return null;
  const grupos = { CRIANCAS_ADOLESCENTES: 0, ADULTOS: 0, IDOSOS: 0 };
  for (const i of idades) grupos[i < 18 ? 'CRIANCAS_ADOLESCENTES' : i < 60 ? 'ADULTOS' : 'IDOSOS'] += 1;
  return Object.entries(grupos).sort((a, b) => b[1] - a[1])[0][0];
}

export async function renderQuestionario(ctx, acId, tipoUrl) {
  const { usuario, conteudo, navegar } = ctx;
  const pedido = String(tipoUrl).toUpperCase();
  const tipo = ['FINAL', 'REAVALIACAO'].includes(pedido) ? pedido : 'INICIAL';
  montar(conteudo, carregando());

  const dados = await api.get(`/api/familias/acompanhamentos/${acId}/questionarios/${tipo}`);
  if (dados.modelo === 'LEGADO') return renderQuestionarioLegado(ctx, acId, tipoUrl);

  const reavaliacao = tipo === 'REAVALIACAO';
  const [modelo, ficha] = await Promise.all([
    api.get('/api/familias/questionario/modelo', { tipo }),
    api.get(`/api/familias/acompanhamentos/${acId}`),
  ]);

  const editavel = dados.podeEditar && podeEscrever(usuario);
  const jaConcluido = dados.concluido;
  const autosalvar = editavel && !jaConcluido; // concluído é validado por inteiro: só salva manualmente

  const resp = { ...dados.respostas }; // código da pergunta -> valor
  const detalhes = { ...dados.detalhes }; // código da pergunta -> complemento ("Outras: ...")
  let dataAplicacao = isoDia(dados.dataAplicacao) || dados.sugestoes.dataAplicacao;
  if (!dados.existe) {
    if (tipo === 'INICIAL') {
      if (vazio(resp['1.1'])) resp['1.1'] = dados.sugestoes.qtdIntegrantes;
      const faixa = faixaPredominante(ficha);
      const opcaoFaixa = modelo.blocos.flatMap((b) => b.perguntas).find((p) => p.codigo === '1.2');
      if (vazio(resp['1.2']) && faixa && opcaoFaixa?.opcoes.some((o) => o.valor === faixa)) resp['1.2'] = faixa;
    }
  }

  const blocos = modelo.blocos;
  const total = blocos.length;
  let passo = 0;
  let errosPendentes = {};

  // Campo de erro -> passo (para levar o usuário ao primeiro erro)
  const passoDoCampo = { dataAplicacao: 0 };
  blocos.forEach((b, i) => b.perguntas.forEach((p) => {
    passoDoCampo[`extras.${p.codigo}`] = i;
    passoDoCampo[`detalhes.${p.codigo}`] = i;
  }));

  // ---------- salvamento ----------
  const status = h('span', { class: 'q-status', role: 'status', 'aria-live': 'polite' });
  let temporizador = null;
  let salvando = null;
  let sujo = false;

  const corpo = (concluir) => ({ dataAplicacao, respostas: resp, detalhes, concluir });
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
    salvando = api.put(`/api/familias/acompanhamentos/${acId}/questionarios/${tipo}`, corpo(false));
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

  function definir(codigo, valor) {
    if (vazio(valor)) delete resp[codigo]; else resp[codigo] = valor;
    delete errosPendentes[`extras.${codigo}`];
    agendar();
  }
  function definirDetalhe(codigo, valor) {
    if (valor.trim()) detalhes[codigo] = valor; else delete detalhes[codigo];
    delete errosPendentes[`detalhes.${codigo}`];
    agendar();
  }

  // ---------- construtores de pergunta ----------
  let contadorId = 0;
  const novoId = (codigo) => `q-${codigo.replace(/\./g, '-')}-${contadorId++}`;

  function envolver(p, filhos, { grupo = false } = {}) {
    const idRotulo = novoId('rotulo');
    const rotulo = h('span', { class: 'rotulo q-texto', id: idRotulo },
      p.extra ? null : h('span', { class: 'q-codigo' }, `${p.codigo}.`), p.extra ? p.texto : ` ${p.texto}`);
    return h('div', { class: 'campo q-pergunta', role: grupo ? 'group' : null, 'aria-labelledby': grupo ? idRotulo : null },
      rotulo, p.ajuda ? h('span', { class: 'ajuda' }, p.ajuda) : null, filhos);
  }

  function opcaoRadio(name, valor, rotulo, marcado, aoMudar) {
    const input = h('input', { type: 'radio', name, value: valor });
    input.checked = marcado;
    input.addEventListener('change', () => { if (input.checked) aoMudar(valor); });
    return h('label', { class: 'opcao q-opcao' }, input, h('span', {}, rotulo));
  }

  // Complemento das opções que pedem detalhe ("Outras: ____"): aparece (e é obrigatório ao concluir) quando a opção está
  // marcada; ao desmarcar, o texto é limpo
  const pedeDetalheMarcado = (p) => {
    const v = resp[p.codigo];
    const marcadas = Array.isArray(v) ? v : (v ? [v] : []);
    return p.opcoes.some((o) => o.pedeDetalhe && marcadas.includes(o.valor));
  };

  function campoDetalhe(p, escolhidas) {
    const entrada = h('input', {
      class: 'input q-input', type: 'text', id: novoId(`${p.codigo}-detalhe`), name: `detalhes.${p.codigo}`, maxlength: 200,
      placeholder: 'Qual?', 'aria-required': 'true',
    });
    entrada.value = paraTexto(detalhes[p.codigo]);
    entrada.addEventListener('input', () => definirDetalhe(p.codigo, entrada.value));
    const caixa = h('div', { class: 'campo q-detalhe' }, h('label', { for: entrada.id, class: 'obrigatorio' }, 'Descreva a outra opção'), entrada);
    const atualizar = () => {
      caixa.hidden = !p.opcoes.some((o) => o.pedeDetalhe && escolhidas().includes(o.valor));
      if (caixa.hidden && entrada.value) { entrada.value = ''; definirDetalhe(p.codigo, ''); }
    };
    atualizar();
    return { caixa, atualizar };
  }

  const visiveis = (p, atuais) => p.opcoes.filter((o) => o.ativa !== false || atuais.includes(o.valor));

  function perguntaEscolha(p) {
    const name = `extras.${p.codigo}`;
    const atual = () => (resp[p.codigo] ? [resp[p.codigo]] : []);
    const detalhe = p.opcoes.some((o) => o.pedeDetalhe) ? campoDetalhe(p, atual) : null;
    const lista = h('div', { class: 'opcoes' }, visiveis(p, atual()).map((o) => opcaoRadio(name, o.valor, o.rotulo, resp[p.codigo] === o.valor, (v) => {
      definir(p.codigo, v);
      detalhe?.atualizar();
    })));
    return envolver(p, [lista, detalhe?.caixa], { grupo: true });
  }

  function perguntaMultipla(p) {
    const name = `extras.${p.codigo}`;
    const marcados = new Set(resp[p.codigo] || []);
    const detalhe = p.opcoes.some((o) => o.pedeDetalhe) ? campoDetalhe(p, () => [...marcados]) : null;
    const caixas = visiveis(p, [...marcados]).map((o) => {
      const input = h('input', { type: 'checkbox', name, value: o.valor });
      input.checked = marcados.has(o.valor);
      input.addEventListener('change', () => {
        if (input.checked) marcados.add(o.valor); else marcados.delete(o.valor);
        definir(p.codigo, [...marcados]);
        detalhe?.atualizar();
      });
      return h('label', { class: 'opcao q-opcao' }, input, h('span', {}, o.rotulo));
    });
    return envolver(p, [h('div', { class: 'opcoes' }, caixas), detalhe?.caixa], { grupo: true });
  }

  function perguntaNumero(p) {
    const input = h('input', {
      class: 'input q-input', id: novoId(p.codigo), name: `extras.${p.codigo}`, type: 'number',
      inputmode: p.min !== undefined ? 'numeric' : 'decimal', min: p.min, max: p.max, step: p.min !== undefined ? 1 : 'any', autocomplete: 'off',
    });
    input.value = paraTexto(resp[p.codigo]);
    input.addEventListener('input', () => definir(p.codigo, input.value === '' ? null : input.value));
    return envolver(p, input);
  }

  function perguntaTexto(p) {
    const area = h('textarea', { class: 'textarea q-input', id: novoId(p.codigo), name: `extras.${p.codigo}`, rows: 4, maxlength: 2000 });
    area.value = paraTexto(resp[p.codigo]);
    area.addEventListener('input', () => definir(p.codigo, area.value));
    return envolver(p, area);
  }

  function perguntaBooleano(p) {
    const name = `extras.${p.codigo}`;
    const v = resp[p.codigo];
    return envolver(p, h('div', { class: 'opcoes q-sim-nao' },
      opcaoRadio(name, 'true', 'Sim', v === true, () => definir(p.codigo, true)),
      opcaoRadio(name, 'false', 'Não', v === false, () => definir(p.codigo, false))), { grupo: true });
  }

  function pergunta(p) {
    switch (p.tipo) {
      case 'numero': return perguntaNumero(p);
      case 'texto': return perguntaTexto(p);
      case 'escolha': return perguntaEscolha(p);
      case 'multipla': return perguntaMultipla(p);
      case 'booleano': return perguntaBooleano(p);
      default: return null;
    }
  }

  // Cabeçalho do formulário em papel: unidade, assistente, datas, meta e dados do responsável
  function cartaoCabecalho() {
    const c = dados.cabecalho;
    const item = (rotulo, valor) => h('div', { class: 'fam-dado' }, h('dt', {}, rotulo), h('dd', {}, textoOuTraco(valor)));
    return h('div', { class: 'card q-ident' },
      h('dl', { class: 'fam-dados' },
        item('Unidade', c.unidade),
        item('Assistente social responsável', c.assistente),
        item('Data de início do acompanhamento', c.dataInicio ? formatarData(c.dataInicio) : null),
        tipo === 'INICIAL' ? item('Data prevista para conclusão', c.dataPrevista ? formatarData(c.dataPrevista) : null) : null,
        item('Responsável familiar', c.responsavel.nome),
        item('CPF / CadÚnico', [c.responsavel.cpf && formatarCpf(c.responsavel.cpf), c.responsavel.nis].filter(Boolean).join(' · ')),
        item('Contato', c.responsavel.telefone ? formatarTelefone(c.responsavel.telefone) : null),
        item('Endereço / território', c.responsavel.endereco)),
      tipo === 'INICIAL' && c.meta ? h('p', { class: 'texto-pequeno q-meta' }, h('strong', {}, 'Meta: '), c.meta) : null,
      h('p', { class: 'texto-pequeno texto-suave' }, 'Esses dados vêm do cadastro da família. Para corrigi-los, use "Editar família".'));
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
      if (!reavaliacao) form.append(cartaoCabecalho());
      const data = h('input', { class: 'input', type: 'date', id: 'q-data', name: 'dataAplicacao', max: dados.sugestoes.dataAplicacao });
      data.value = dataAplicacao;
      data.addEventListener('input', () => { dataAplicacao = data.value; delete errosPendentes.dataAplicacao; agendar(); });
      form.append(h('div', { class: 'campo' },
        h('label', { for: 'q-data', class: 'obrigatorio' }, tipo === 'FINAL' ? 'Data final de aplicação do questionário' : 'Data de aplicação do questionário'), data));
    }
    bloco.perguntas.forEach((p) => form.append(pergunta(p)));

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

  function mostrarErrosDoServidor(detalhesDeErro) {
    errosPendentes = detalhesDeErro;
    const primeiro = Math.min(...Object.keys(detalhesDeErro).map((c) => (passoDoCampo[c] ?? 0)));
    toast.erro(`Faltam respostas ou há campos inválidos (etapa ${primeiro + 1}).`);
    passo = primeiro;
    renderPasso();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function concluir() {
    if (!jaConcluido) {
      const ok = await confirmar('Concluir o questionário? Você ainda poderá corrigir as respostas enquanto o acompanhamento estiver em andamento.', { titulo: 'Concluir questionário', textoOk: 'Concluir' });
      if (!ok) return;
    }
    // "Outra/Outros" marcada sem o texto: nem envia
    const faltando = {};
    for (const b of blocos) for (const p of b.perguntas) {
      if (pedeDetalheMarcado(p) && !String(detalhes[p.codigo] || '').trim()) faltando[`detalhes.${p.codigo}`] = 'Informe qual é a outra opção.';
    }
    if (Object.keys(faltando).length) { mostrarErrosDoServidor(faltando); return; }
    botaoAvancar.disabled = true;
    clearTimeout(temporizador);
    while (salvando) await salvando.catch(() => {});
    try {
      await api.put(`/api/familias/acompanhamentos/${acId}/questionarios/${tipo}`, corpo(true));
      sujo = false;
      toast.sucesso(jaConcluido ? 'Alterações salvas.' : 'Questionário concluído.');
      const voltarPara = consumirRetorno(acId); // veio do botão Formulário do atendimento
      if (voltarPara) location.href = voltarPara; else navegar(reavaliacao ? `#/a/${acId}/indicadores` : `#/a/${acId}`);
    } catch (e) {
      if (e instanceof ErroApi && e.status === 400 && e.detalhes) {
        mostrarErrosDoServidor(e.detalhes);
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
    reavaliacao && editavel
      ? h('p', { class: 'texto-pequeno texto-suave' }, 'Reavaliação rápida da metade do acompanhamento: só as perguntas de situação atual que têm par no questionário inicial (cerca de 3 minutos).')
      : null,
    h('div', { class: 'card q-cabecalho' }, titulo, barra, pontos),
    area,
    h('div', { class: 'q-nav' }, status, h('div', { class: 'q-nav-botoes' }, botaoVoltar, botaoAvancar)),
  );
  renderPasso();
  if (autosalvar) mostrarStatus(dados.existe ? 'Rascunho carregado.' : 'O rascunho é salvo automaticamente.');
}
