// Pesquisa de satisfação (F3): a assistente aplica pessoalmente, no celular, lendo as perguntas à família.
// Passo a passo: aviso de consentimento -> 9 perguntas (uma por tela, botões grandes) -> revisão -> obrigada.
// Rota: #/a/<id>/pesquisa/<FINAL|SEMESTRAL|AVULSA>. Salva rascunho a cada passo; retoma de onde parou.
import { api, ErroApi } from '../api.js';
import { h, toast, carregando, confirmar, hojeIso } from '../ui.js';
import { cabecalhoPagina, podeEscrever, campo, montar } from './util.js';

export const ROTULO_MOMENTO = { FINAL: 'ao encerrar o acompanhamento', SEMESTRAL: 'semestral', AVULSA: 'avulsa' };
export const ROTULO_LIKERT = { 1: 'Discordo totalmente', 2: 'Discordo', 3: 'Nem concordo nem discordo', 4: 'Concordo', 5: 'Concordo totalmente' };
export const ROTULO_MODO = {
  FAMILIA_FALOU: 'A família respondeu em voz alta e eu anotei',
  FAMILIA_PREENCHEU: 'A família preencheu sozinha no aparelho',
  COM_AJUDA: 'Outra pessoa da família ajudou a responder',
};

export async function renderPesquisa({ usuario, conteudo, navegar }, acId, momentoPedido) {
  const momento = ['FINAL', 'SEMESTRAL', 'AVULSA'].includes(momentoPedido) ? momentoPedido : 'AVULSA';
  montar(conteudo, carregando());
  const [ficha, lista] = await Promise.all([
    api.get(`/api/familias/acompanhamentos/${acId}`),
    api.get(`/api/familias/acompanhamentos/${acId}/pesquisas`),
  ]);
  const voltar = `#/a/${acId}/acompanhamento`;
  const cabecalho = cabecalhoPagina('Pesquisa de satisfação', { voltar: { href: voltar, texto: ficha.responsavel.nome } });

  if (!podeEscrever(usuario)) {
    montar(conteudo, cabecalho, h('div', { class: 'aviso aviso-aviso' }, 'Seu perfil não pode aplicar a pesquisa de satisfação.'),
      h('a', { class: 'btn', href: voltar }, 'Voltar'));
    return;
  }

  const modelo = lista.modelo;
  const perguntas = modelo.perguntas;
  const NP = perguntas.length;
  const PASSO_REVISAO = NP + 1;
  const PASSO_FIM = NP + 2;

  // ---- estado (retoma o rascunho do mesmo momento, se houver) ----
  const resp = {}; // codigo -> { valorNum, valorTexto, preferNaoResponder }
  let rascunhoId = null;
  let modo = null;
  let data = hojeIso();
  let consentimento = false;
  let passo = 0;

  const rascunho = lista.pesquisas.find((p) => p.situacao === 'RASCUNHO' && p.momento === momento);
  if (rascunho) {
    const cheia = await api.get(`/api/familias/acompanhamentos/${acId}/pesquisas/${rascunho.id}`);
    rascunhoId = cheia.id; modo = cheia.modo; data = String(cheia.dataAplicacao).slice(0, 10); consentimento = cheia.consentimentoLido;
    for (const it of cheia.itens) resp[it.codigo] = { valorNum: it.valorNum, valorTexto: it.valorTexto, preferNaoResponder: it.preferNaoResponder };
    const primeira = perguntas.findIndex((p) => !resposta(p.codigo, p.tipo));
    passo = consentimento ? (primeira === -1 ? PASSO_REVISAO : primeira + 1) : 0;
  }

  function resposta(codigo, tipo) {
    const r = resp[codigo];
    if (!r) return false;
    if (r.preferNaoResponder) return true;
    return tipo === 'TEXTO' ? !!r.valorTexto : Number.isInteger(r.valorNum);
  }
  const itensParaEnviar = () => Object.entries(resp).map(([codigo, r]) => ({
    codigo, valorNum: r.valorNum ?? null, valorTexto: r.valorTexto ?? null, preferNaoResponder: !!r.preferNaoResponder,
  }));

  const area = h('div', { class: 'pesq-passo' });
  const status = h('span', { class: 'q-status', 'aria-live': 'polite' });
  const titulo = h('h2', { class: 'q-titulo-passo', tabindex: '-1' });
  const barra = h('div', { class: 'q-barra', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': PASSO_REVISAO });
  const cheia = h('div', { class: 'q-barra-cheia' });
  barra.append(cheia);
  const botaoVoltar = h('button', { type: 'button', class: 'btn btn-secundario q-botao pesq-botao' }, '← Voltar');
  const botaoSalvarSair = h('button', { type: 'button', class: 'btn btn-texto pesq-sair' }, 'Salvar e sair');
  const botaoAvancar = h('button', { type: 'button', class: 'btn q-botao pesq-botao' }, 'Próxima →');
  const nav = h('div', { class: 'q-nav pesq-nav' }, status, h('div', { class: 'q-nav-botoes' }, botaoVoltar, botaoAvancar));
  const topo = h('div', { class: 'card q-cabecalho pesq-cabecalho' }, titulo, barra);
  const linhaSair = h('div', { class: 'pesq-sair-linha' }, botaoSalvarSair);

  // ---- salvar ----
  let salvando = Promise.resolve();
  function corpoRascunho() {
    return { momento, situacao: 'RASCUNHO', consentimentoLido: true, dataAplicacao: data, modo, itens: itensParaEnviar() };
  }
  async function salvarRascunho() {
    salvando = salvando.catch(() => {}).then(async () => {
      try {
        status.textContent = 'Salvando…'; status.classList.remove('q-status-erro');
        if (rascunhoId === null) rascunhoId = (await api.post(`/api/familias/acompanhamentos/${acId}/pesquisas`, corpoRascunho())).id;
        else await api.put(`/api/familias/acompanhamentos/${acId}/pesquisas/${rascunhoId}`, corpoRascunho());
        status.textContent = 'Rascunho salvo.';
      } catch (e) {
        status.textContent = 'Não foi possível salvar o rascunho.'; status.classList.add('q-status-erro');
        throw e;
      }
    });
    return salvando;
  }

  // ---- telas ----
  function telaAviso() {
    const recusar = async () => {
      const ok = await confirmar('Registrar que a família preferiu não responder à pesquisa? Isso não afeta o atendimento.', { titulo: 'Família prefere não responder', textoOk: 'Registrar' });
      if (!ok) return;
      try {
        await api.post(`/api/familias/acompanhamentos/${acId}/pesquisas`, { momento, situacao: 'RECUSADA', dataAplicacao: hojeIso() });
        toast.sucesso('Registrado: a família preferiu não responder.');
        navegar(voltar);
      } catch (e) { toast.erro(e.message); }
    };
    const aceitar = async () => {
      consentimento = true;
      try { await salvarRascunho(); } catch (e) { consentimento = false; toast.erro(e.message); return; }
      irPara(1);
    };
    return h('div', { class: 'card pesq-cartao' },
      h('p', { class: 'pesq-contexto' }, `Família de ${ficha.responsavel.nome} · pesquisa ${ROTULO_MOMENTO[momento]}`),
      h('p', { class: 'pesq-instrucao' }, 'Leia em voz alta para a família:'),
      h('blockquote', { class: 'pesq-aviso' }, modelo.aviso),
      h('p', { class: 'texto-pequeno texto-suave' }, 'Texto provisório: a redação final será definida pela coordenação e pelo jurídico.'),
      h('div', { class: 'pesq-acoes-grandes' },
        h('button', { type: 'button', class: 'btn pesq-botao-grande', onclick: aceitar }, 'A família concorda em responder'),
        h('button', { type: 'button', class: 'btn btn-secundario pesq-botao-grande', onclick: recusar }, 'A família prefere não responder')));
  }

  function telaPergunta(p, indice) {
    const r = resp[p.codigo] || (resp[p.codigo] = {});
    const marcar = (valor) => { r.valorNum = valor; r.preferNaoResponder = false; atualizarBotao(); renderCampo(); };
    const campoEl = h('div', { class: 'pesq-campo' });
    const atualizarBotao = () => { botaoAvancar.disabled = !(p.tipo === 'TEXTO' || resposta(p.codigo, p.tipo)); };

    function renderCampo() {
      if (p.tipo === 'NPS') {
        campoEl.replaceChildren(
          h('div', { class: 'pesq-nps', role: 'radiogroup', 'aria-label': 'Nota de 0 a 10' },
            Array.from({ length: 11 }, (_, n) => h('button', {
              type: 'button', role: 'radio', 'aria-checked': r.valorNum === n ? 'true' : 'false',
              class: `pesq-nota${r.valorNum === n ? ' pesq-escolhida' : ''}`, onclick: () => marcar(n),
            }, String(n)))),
          h('div', { class: 'pesq-nps-pontas' }, h('span', {}, '0 = nada provável'), h('span', {}, '10 = com certeza')),
          recusaBotao());
      } else if (p.tipo === 'LIKERT') {
        campoEl.replaceChildren(
          h('div', { class: 'opcoes pesq-likert', role: 'radiogroup', 'aria-label': 'Concordância' },
            [1, 2, 3, 4, 5].map((n) => h('label', { class: 'opcao q-opcao' },
              h('input', { type: 'radio', name: `r-${p.codigo}`, value: String(n), checked: r.valorNum === n, onchange: () => marcar(n) }),
              h('span', {}, ROTULO_LIKERT[n])))),
          recusaBotao());
      } else {
        const texto = h('textarea', { class: 'textarea pesq-texto', rows: 6, maxlength: 1000, 'aria-label': p.texto, placeholder: 'Escreva o que a família disse (opcional)' });
        texto.value = r.preferNaoResponder ? '' : (r.valorTexto || '');
        texto.addEventListener('input', () => { r.valorTexto = texto.value.trim() || null; r.preferNaoResponder = false; });
        campoEl.replaceChildren(texto, h('p', { class: 'texto-pequeno texto-suave' }, 'Pode deixar em branco se a família não quiser comentar.'));
      }
    }
    function recusaBotao() {
      return h('button', {
        type: 'button', class: `btn btn-secundario pesq-recusa${r.preferNaoResponder ? ' pesq-escolhida' : ''}`, 'aria-pressed': r.preferNaoResponder ? 'true' : 'false',
        onclick: () => { r.preferNaoResponder = !r.preferNaoResponder; if (r.preferNaoResponder) { r.valorNum = null; r.valorTexto = null; } atualizarBotao(); renderCampo(); },
      }, r.preferNaoResponder ? 'A família preferiu não responder (toque para desfazer)' : 'Prefere não responder');
    }
    renderCampo();
    atualizarBotao();
    return h('div', { class: 'card pesq-cartao' },
      h('p', { class: 'pesq-instrucao' }, 'Leia a pergunta em voz alta:'),
      h('p', { class: 'pesq-pergunta' }, p.texto),
      campoEl);
  }

  function telaRevisao() {
    const itens = perguntas.map((p, i) => {
      const r = resp[p.codigo];
      let valor;
      if (r?.preferNaoResponder) valor = 'Prefere não responder';
      else if (p.tipo === 'NPS') valor = Number.isInteger(r?.valorNum) ? `${r.valorNum} de 10` : '—';
      else if (p.tipo === 'LIKERT') valor = Number.isInteger(r?.valorNum) ? ROTULO_LIKERT[r.valorNum] : '—';
      else valor = r?.valorTexto || '(sem comentário)';
      return h('li', { class: 'pesq-rev-item' },
        h('button', { type: 'button', class: 'pesq-rev-botao', onclick: () => irPara(i + 1), 'aria-label': `Corrigir: ${p.texto}` },
          h('span', { class: 'pesq-rev-pergunta' }, p.texto), h('strong', { class: 'pesq-rev-valor' }, valor)));
    });
    const dataEl = h('input', { class: 'input', type: 'date', id: 'pq-data', name: 'dataAplicacao', max: hojeIso(), value: data });
    dataEl.addEventListener('input', () => { data = dataEl.value || hojeIso(); });
    const grupoModo = h('div', { class: 'opcoes', role: 'radiogroup', 'aria-labelledby': 'pq-modo-rotulo' },
      Object.entries(ROTULO_MODO).map(([v, rotulo]) => h('label', { class: 'opcao' },
        h('input', { type: 'radio', name: 'modo', value: v, checked: modo === v, onchange: () => { modo = v; atualizarBotao(); } }),
        h('span', {}, rotulo))));
    const atualizarBotao = () => { botaoAvancar.disabled = !modo; };
    atualizarBotao();
    return h('div', { class: 'pesq-revisao' },
      h('div', { class: 'card pesq-cartao' }, h('p', { class: 'pesq-instrucao' }, 'Confira as respostas (toque para corrigir):'), h('ul', { class: 'pesq-rev' }, itens)),
      h('div', { class: 'card pesq-cartao' },
        h('div', { class: 'campo' }, h('span', { class: 'rotulo obrigatorio', id: 'pq-modo-rotulo' }, 'Como a pesquisa foi respondida?'), grupoModo),
        campo({ id: 'pq-data', rotulo: 'Data da aplicação', controle: dataEl })));
  }

  function telaFim() {
    return h('div', { class: 'card pesq-cartao pesq-fim' },
      h('h2', {}, 'Pesquisa registrada'),
      h('p', { class: 'pesq-pergunta' }, 'Agradeça à família pela participação.'),
      h('p', { class: 'texto-suave' }, 'A resposta ficou na linha do tempo da família.'),
      h('div', { class: 'pesq-acoes-grandes' },
        h('a', { class: 'btn pesq-botao-grande', href: voltar }, 'Voltar à ficha')));
  }

  // ---- navegação ----
  function desenhar() {
    nav.hidden = passo === 0 || passo === PASSO_FIM;
    topo.hidden = passo === PASSO_FIM;
    linhaSair.hidden = passo === 0 || passo === PASSO_FIM;
    botaoVoltar.hidden = passo <= 1;
    botaoAvancar.disabled = false;
    if (passo === 0) {
      titulo.textContent = 'Antes de começar';
      area.replaceChildren(telaAviso());
    } else if (passo <= NP) {
      titulo.textContent = `Pergunta ${passo} de ${NP}`;
      area.replaceChildren(telaPergunta(perguntas[passo - 1], passo - 1));
      botaoAvancar.textContent = 'Próxima →';
    } else if (passo === PASSO_REVISAO) {
      titulo.textContent = 'Revisão';
      area.replaceChildren(telaRevisao());
      botaoAvancar.textContent = 'Concluir pesquisa';
    } else {
      area.replaceChildren(telaFim());
    }
    barra.setAttribute('aria-valuenow', String(Math.min(passo, PASSO_REVISAO)));
    barra.setAttribute('aria-valuetext', titulo.textContent);
    cheia.style.width = `${(Math.min(passo, PASSO_REVISAO) / PASSO_REVISAO) * 100}%`;
  }
  function irPara(i) {
    passo = i;
    desenhar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    titulo.focus({ preventScroll: true });
  }

  botaoVoltar.addEventListener('click', () => irPara(Math.max(1, passo - 1)));
  botaoSalvarSair.addEventListener('click', async () => {
    try { await salvarRascunho(); toast.sucesso('Rascunho salvo. Você pode continuar depois.'); navegar(voltar); } catch (e) { toast.erro(e.message); }
  });
  botaoAvancar.addEventListener('click', async () => {
    if (passo <= NP) {
      botaoAvancar.disabled = true;
      try { await salvarRascunho(); } catch (e) { toast.erro(e.message); botaoAvancar.disabled = false; return; }
      irPara(passo + 1);
      return;
    }
    // concluir
    botaoAvancar.disabled = true;
    try {
      const corpo = { ...corpoRascunho(), situacao: 'CONCLUIDA' };
      if (rascunhoId === null) rascunhoId = (await api.post(`/api/familias/acompanhamentos/${acId}/pesquisas`, corpo)).id;
      else await api.put(`/api/familias/acompanhamentos/${acId}/pesquisas/${rascunhoId}`, corpo);
      irPara(PASSO_FIM);
    } catch (e) {
      if (e instanceof ErroApi && e.status === 400 && e.detalhes) {
        const faltou = perguntas.findIndex((p) => e.detalhes[`itens.${p.codigo}`]);
        toast.erro(faltou >= 0 ? `Falta responder a pergunta ${faltou + 1}.` : (Object.values(e.detalhes)[0] || e.message));
        if (faltou >= 0) irPara(faltou + 1);
      } else toast.erro(e.message);
      botaoAvancar.disabled = false;
    }
  });

  montar(conteudo, cabecalho,
    rascunhoId !== null ? h('div', { class: 'aviso aviso-aviso' }, 'Continuando a pesquisa que ficou salva como rascunho.') : null,
    topo, area, nav, linhaSair);
  desenhar();
}
