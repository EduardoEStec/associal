// Aba Perguntas e opções: a coordenação (e o ADMIN) configura os formulários — questionário inicial, questionário final
// (modelos oficiais), pesquisa de satisfação e novo atendimento. O questionário no formato anterior só pode ser consultado e
// renomeado. Perguntas oficiais só mudam de texto; perguntas adicionais podem ser criadas, ordenadas, desativadas e excluídas
// (sem respostas). Opções novas em pergunta oficial que pontua dizem como pontuam no índice de progresso.
import { api } from '../api.js';
import { h, toast, confirmar, carregando } from '../ui.js';
import { campo, caixa, modalFormulario, vazio } from './comum.js';

const FORMULARIOS = [
  { valor: 'QUESTIONARIO_INICIAL', rotulo: 'Questionário inicial' },
  { valor: 'QUESTIONARIO_FINAL', rotulo: 'Questionário final' },
  { valor: 'PESQUISA', rotulo: 'Pesquisa de satisfação' },
  { valor: 'ATENDIMENTO', rotulo: 'Novo atendimento' },
  { valor: 'QUESTIONARIO', rotulo: 'Questionário (formato anterior, só consulta)' },
];
const LEGADO = 'QUESTIONARIO';
const ROTULO_TIPO = {
  TEXTO: 'Texto livre', NUMERO: 'Número', SIM_NAO: 'Sim ou não', ESCOLHA: 'Escolha uma opção', MULTIPLA: 'Escolha várias opções',
  MOEDA: 'Valor em reais', NPS: 'Nota de 0 a 10', LIKERT: 'Concordância (1 a 5)',
};
const ROTULO_APOIO = { destino_economia: 'Destino da economia', beneficio: 'Benefícios recebidos' };
const NAO_PONTUA = '__nao_pontua__';

const selecao = (rotulo, nome, opcoes, valor) => campo(rotulo, nome, { tipo: 'select', opcoes, valor });
const emUso = (n) => (n > 0 ? `${n} ${n === 1 ? 'resposta' : 'respostas'}` : null);

export async function montarPerguntas(raiz) {
  let formulario = FORMULARIOS[0].valor;
  const area = h('div', {});

  const recarregar = () => carregar();
  const falha = (e) => toast.erro(e.message);

  async function carregar() {
    area.replaceChildren(carregando());
    try {
      const dados = await api.get('/api/admin/perguntas', { formulario });
      area.replaceChildren(...dados.secoes.map((s) => secao(dados, s)));
    } catch (e) { area.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, e.message)); }
  }

  // ---------- seção ----------

  function secao(dados, s) {
    const extras = s.perguntas.filter((p) => !p.oficial);
    return h('section', { class: 'card perg-secao' },
      h('div', { class: 'perg-secao-topo' },
        h('h2', {}, dados.secoes.length > 1 ? `${s.numero}. ${s.titulo}` : s.titulo),
        formulario === LEGADO ? null : h('button', { type: 'button', class: 'btn btn-pequeno', onclick: () => abrirPergunta(dados, s, null) }, 'Nova pergunta')),
      s.perguntas.length ? h('ul', { class: 'perg-lista' }, s.perguntas.map((p) => linha(dados, s, p, extras))) : vazio('Nenhuma pergunta nesta seção.'));
  }

  function linha(dados, s, p, extras) {
    const indice = extras.indexOf(p);
    const selos = [
      h('span', { class: 'badge' }, p.codigo),
      p.oficial ? h('span', { class: 'badge badge-sucesso' }, 'Oficial') : h('span', { class: 'badge badge-info' }, 'Adicional'),
      p.obrigatoria ? h('span', { class: 'badge' }, 'Obrigatória') : null,
      !p.ativa ? h('span', { class: 'badge badge-perigo' }, 'Desativada') : null,
      h('span', { class: 'texto-pequeno texto-suave' }, ROTULO_TIPO[p.tipo] || p.tipo),
      emUso(p.respostas) ? h('span', { class: 'texto-pequeno texto-suave' }, emUso(p.respostas)) : null,
    ];
    const opcoesBox = h('div', { class: 'perg-opcoes', hidden: true });
    const temOpcoes = (p.tipo === 'ESCOLHA' || p.tipo === 'MULTIPLA') && p.opcoes.length > 0;
    const botaoOpcoes = temOpcoes
      ? h('button', {
        type: 'button', class: 'btn btn-pequeno btn-secundario', 'aria-expanded': 'false',
        onclick: (e) => {
          opcoesBox.hidden = !opcoesBox.hidden;
          e.currentTarget.setAttribute('aria-expanded', String(!opcoesBox.hidden));
          if (!opcoesBox.hidden) desenharOpcoes(p, opcoesBox);
        },
      }, `Opções (${p.opcoes.length})`) : null;

    return h('li', { class: `perg-item${p.ativa ? '' : ' admin-inativo'}` },
      h('div', { class: 'perg-selos' }, selos),
      h('p', { class: 'perg-texto' }, p.texto),
      p.apoio ? h('p', { class: 'texto-pequeno texto-suave' }, `As opções vêm da lista "${ROTULO_APOIO[p.apoio] || p.apoio}" (aba Listas).`) : null,
      h('div', { class: 'admin-acoes' },
        h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', onclick: () => abrirPergunta(dados, s, p) }, 'Editar'),
        botaoOpcoes,
        !p.oficial ? h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', disabled: indice <= 0, 'aria-label': 'Subir pergunta', onclick: () => mover(s, extras, indice, -1) }, 'Subir') : null,
        !p.oficial ? h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', disabled: indice >= extras.length - 1, 'aria-label': 'Descer pergunta', onclick: () => mover(s, extras, indice, 1) }, 'Descer') : null,
        !p.oficial ? h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', onclick: () => alternar(p) }, p.ativa ? 'Desativar' : 'Ativar') : null,
        !p.oficial && !p.respostas ? h('button', { type: 'button', class: 'btn btn-pequeno btn-perigo', onclick: () => excluir(p) }, 'Excluir') : null),
      opcoesBox);
  }

  async function mover(s, extras, indice, delta) {
    const ids = extras.map((x) => x.id);
    [ids[indice], ids[indice + delta]] = [ids[indice + delta], ids[indice]];
    try { await api.put('/api/admin/perguntas/ordem', { formulario, secao: s.numero, ids }); recarregar(); } catch (e) { falha(e); }
  }
  async function alternar(p) {
    try { await api.patch(`/api/admin/perguntas/${p.id}/ativa`, { ativa: !p.ativa }); toast.sucesso(p.ativa ? 'Pergunta desativada.' : 'Pergunta ativada.'); recarregar(); } catch (e) { falha(e); }
  }
  async function excluir(p) {
    if (!(await confirmar(`Excluir a pergunta "${p.texto}"? Só é possível porque ela ainda não tem respostas.`, { perigo: true, textoOk: 'Excluir' }))) return;
    try { await api.delete(`/api/admin/perguntas/${p.id}`); toast.sucesso('Pergunta excluída.'); recarregar(); } catch (e) { falha(e); }
  }

  // ---------- pergunta (criar / editar) ----------

  function abrirPergunta(dados, s, p) {
    const editando = !!p;
    const questionario = formulario === LEGADO;
    const tipoSel = editando ? null : selecao('Tipo de resposta', 'tipo', dados.tipos.map((t) => ({ valor: t, rotulo: ROTULO_TIPO[t] })), 'TEXTO');
    const secaoSel = !editando || !p.oficial
      ? (dados.secoes.length > 1 ? selecao('Seção', 'secao', dados.secoes.map((x) => ({ valor: x.numero, rotulo: `${x.numero}. ${x.titulo}` })), p?.secao ?? s.numero) : null)
      : null;
    const opcoesTxt = h('textarea', { class: 'textarea', name: 'opcoes', id: 'perg-opcoes-novas', rows: 5, maxlength: 4000, placeholder: 'Uma opção por linha' });
    const blocoOpcoes = h('div', { class: 'campo', hidden: true }, h('label', { for: 'perg-opcoes-novas' }, 'Opções (uma por linha, no mínimo duas)'), opcoesTxt);
    const form = h('form', {},
      campo(questionario ? 'Pergunta (no questionário inicial)' : 'Pergunta', 'texto', { valor: p?.texto, obrigatorio: true, maxlength: 500 }),
      questionario ? campo('Pergunta no questionário final ("hoje")', 'textoFinal', { valor: p?.textoFinal ?? p?.texto, maxlength: 500, ajuda: 'Se for igual à do inicial, repita o texto.' }) : null,
      campo('Ajuda para quem aplica (opcional)', 'ajuda', { valor: p?.ajuda, maxlength: 300 }),
      tipoSel,
      secaoSel,
      blocoOpcoes,
      !p?.oficial && formulario !== 'PESQUISA'
        ? h('div', { class: 'opcoes' }, caixa('Resposta obrigatória (exigida ao concluir/salvar)', 'obrigatoria', p?.obrigatoria)) : null,
      p?.oficial ? h('p', { class: 'texto-pequeno texto-suave' }, 'Pergunta oficial: só o texto pode ser alterado. Ela continua alimentando o índice de progresso e os relatórios.') : null,
      formulario === 'PESQUISA' && !p?.oficial ? h('p', { class: 'texto-pequeno texto-suave' }, 'Na pesquisa a família pode não querer responder, então as perguntas adicionais são sempre opcionais.') : null);
    if (tipoSel) {
      const atualizar = () => { blocoOpcoes.hidden = !['ESCOLHA', 'MULTIPLA'].includes(tipoSel.querySelector('select').value); };
      tipoSel.querySelector('select').addEventListener('change', atualizar);
      atualizar();
    }
    modalFormulario({
      titulo: editando ? 'Editar pergunta' : 'Nova pergunta',
      form,
      aoSalvar: async (f) => {
        const corpo = { texto: f.elements.texto.value, ajuda: f.elements.ajuda.value };
        if (f.elements.textoFinal) corpo.textoFinal = f.elements.textoFinal.value;
        if (f.elements.obrigatoria) corpo.obrigatoria = f.elements.obrigatoria.checked;
        if (f.elements.secao) corpo.secao = Number(f.elements.secao.value);
        if (editando) {
          await api.put(`/api/admin/perguntas/${p.id}`, corpo);
        } else {
          corpo.formulario = formulario;
          corpo.tipo = f.elements.tipo.value;
          if (['ESCOLHA', 'MULTIPLA'].includes(corpo.tipo)) corpo.opcoes = opcoesTxt.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
          if (!corpo.secao) corpo.secao = s.numero;
          await api.post('/api/admin/perguntas', corpo);
        }
        toast.sucesso('Pergunta salva.');
        recarregar();
      },
    });
  }

  // ---------- opções ----------

  function desenharOpcoes(p, caixaOpcoes) {
    const base = p.opcoes.filter((o) => o.base && o.pontua);
    // só pergunta oficial que entra no índice/comparação pede "vale como" (ex.: fonte de renda não pontua)
    const oficialDeEscolha = p.oficial && ['ESCOLHA', 'MULTIPLA'].includes(p.tipo) && base.length > 0;
    const dicas = oficialDeEscolha
      ? 'Ao acrescentar uma opção, indique com qual opção oficial ela vale no índice de progresso e na comparação inicial × final (ou que não pontua). Opções já usadas não podem ser excluídas: desative-as.'
      : 'Opções já usadas em respostas não podem ser excluídas: desative-as para que deixem de aparecer.';

    const itens = p.opcoes.map((o, i) => h('li', { class: `perg-opcao${o.ativa ? '' : ' admin-inativo'}` },
      h('div', { class: 'perg-opcao-texto' },
        h('strong', {}, o.texto),
        o.textoFinal && o.textoFinal !== o.texto ? h('span', { class: 'texto-pequeno texto-suave' }, ` (no final: ${o.textoFinal})`) : null,
        h('div', { class: 'perg-selos' },
          o.base ? h('span', { class: 'badge badge-sucesso' }, 'Oficial') : h('span', { class: 'badge badge-info' }, 'Acrescentada'),
          oficialDeEscolha && !o.base ? h('span', { class: 'texto-pequeno texto-suave' }, o.pontua ? `vale como "${o.equivaleTexto}"` : 'não pontua no índice') : null,
          !o.ativa ? h('span', { class: 'badge badge-perigo' }, 'Desativada') : null,
          o.pedeDetalhe ? h('span', { class: 'texto-pequeno texto-suave' }, 'pede texto livre') : null,
          emUso(o.respostas) ? h('span', { class: 'texto-pequeno texto-suave' }, emUso(o.respostas)) : null)),
      h('div', { class: 'admin-acoes' },
        h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', disabled: i === 0, 'aria-label': 'Subir opção', onclick: () => moverOpcao(p, i, -1) }, 'Subir'),
        h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', disabled: i === p.opcoes.length - 1, 'aria-label': 'Descer opção', onclick: () => moverOpcao(p, i, 1) }, 'Descer'),
        h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', onclick: () => abrirOpcao(p, base, o) }, 'Editar'),
        h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', onclick: () => alternarOpcao(p, o) }, o.ativa ? 'Desativar' : 'Ativar'),
        !o.base && !o.respostas ? h('button', { type: 'button', class: 'btn btn-pequeno btn-perigo', onclick: () => excluirOpcao(p, o) }, 'Excluir') : null)));

    caixaOpcoes.replaceChildren(
      h('p', { class: 'texto-pequeno texto-suave' }, dicas),
      h('ul', { class: 'perg-lista-opcoes' }, itens),
      h('button', { type: 'button', class: 'btn btn-pequeno', onclick: () => abrirOpcao(p, base, null) }, 'Nova opção'));
  }

  async function moverOpcao(p, i, delta) {
    const ids = p.opcoes.map((o) => o.id);
    [ids[i], ids[i + delta]] = [ids[i + delta], ids[i]];
    try { await api.put(`/api/admin/perguntas/${p.id}/opcoes/ordem`, { ids }); await recarregarMantendo(p); } catch (e) { falha(e); }
  }
  async function alternarOpcao(p, o) {
    try { await api.patch(`/api/admin/perguntas/${p.id}/opcoes/${o.id}/ativa`, { ativa: !o.ativa }); await recarregarMantendo(p); } catch (e) { falha(e); }
  }
  async function excluirOpcao(p, o) {
    if (!(await confirmar(`Excluir a opção "${o.texto}"?`, { perigo: true, textoOk: 'Excluir' }))) return;
    try { await api.delete(`/api/admin/perguntas/${p.id}/opcoes/${o.id}`); toast.sucesso('Opção excluída.'); await recarregarMantendo(p); } catch (e) { falha(e); }
  }

  // Recarrega a lista e reabre as opções da mesma pergunta.
  async function recarregarMantendo(p) {
    await carregar();
    const botao = [...area.querySelectorAll('.perg-item')].find((li) => li.querySelector('.perg-texto')?.textContent === p.texto)?.querySelector('button[aria-expanded]');
    botao?.click();
  }

  function abrirOpcao(p, base, o) {
    const oficialDeEscolha = p.oficial && ['ESCOLHA', 'MULTIPLA'].includes(p.tipo) && base.length > 0;
    const questionario = formulario === LEGADO;
    const editaValeComo = oficialDeEscolha && (!o || !o.base);
    const valeComo = editaValeComo
      ? selecao('Vale, no índice de progresso e na comparação, como', 'valeComo',
        [{ valor: '', rotulo: 'Escolha…' }, ...base.map((b) => ({ valor: b.codigo, rotulo: b.texto })), { valor: NAO_PONTUA, rotulo: 'Não pontua (fica fora do índice e da comparação)' }],
        o ? (o.pontua ? (o.equivaleCodigo ?? '') : NAO_PONTUA) : '')
      : null;
    // "Outra/Outros": ao marcar a opção, o formulário mostra um campo de texto obrigatório
    const pedeTexto = !(o && o.base) && formulario.startsWith('QUESTIONARIO_')
      ? h('div', { class: 'opcoes' }, caixa('Pede um texto livre (opção "Outra/Outros")', 'pedeDetalhe', o?.pedeDetalhe)) : null;
    const form = h('form', {},
      campo(questionario ? 'Texto da opção (questionário inicial)' : 'Texto da opção', 'texto', { valor: o?.texto, obrigatorio: true, maxlength: 200 }),
      questionario ? campo('Texto no questionário final (opcional)', 'textoFinal', { valor: o?.textoFinal, maxlength: 200, ajuda: 'Deixe em branco para usar o mesmo texto.' }) : null,
      valeComo,
      pedeTexto,
      o && o.base ? h('p', { class: 'texto-pequeno texto-suave' }, 'Opção oficial: só o texto pode ser alterado; ela continua definindo a escala do índice.') : null);
    modalFormulario({
      titulo: o ? 'Editar opção' : 'Nova opção',
      form,
      aoSalvar: async (f) => {
        const corpo = { texto: f.elements.texto.value };
        if (f.elements.textoFinal) corpo.textoFinal = f.elements.textoFinal.value;
        if (f.elements.pedeDetalhe) corpo.pedeDetalhe = f.elements.pedeDetalhe.checked;
        if (f.elements.valeComo) {
          const v = f.elements.valeComo.value;
          if (v === NAO_PONTUA) corpo.naoPontua = true; else if (v) corpo.equivaleA = v;
        }
        if (o) await api.put(`/api/admin/perguntas/${p.id}/opcoes/${o.id}`, corpo); else await api.post(`/api/admin/perguntas/${p.id}/opcoes`, corpo);
        toast.sucesso('Opção salva.');
        await recarregarMantendo(p);
      },
    });
  }

  // ---------- topo ----------

  const seletor = selecao('Formulário', 'formulario', FORMULARIOS, formulario);
  seletor.querySelector('select').addEventListener('change', (e) => { formulario = e.target.value; carregar(); });
  raiz.append(
    h('div', { class: 'admin-barra' }, seletor),
    h('p', { class: 'texto-pequeno' }, 'Aqui você muda o texto das perguntas, acrescenta opções e cria perguntas novas nos questionários inicial e final, na pesquisa e no atendimento. Nada que já tem resposta é apagado: só se desativa. Cada alteração fica registrada na auditoria.'),
    area);
  await carregar();
}
