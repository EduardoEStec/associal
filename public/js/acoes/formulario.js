// Formulário de criação/edição de ação (modal).
import { h, abrirModal, toast, mostrarErrosCampos, comEspera, hojeIso } from '../ui.js';
import { api, ErroApi } from '../api.js';
import { seletorFotos, enviarFotos } from './fotos.js';

export const STATUS = { PLANEJADA: 'Planejada', REALIZADA: 'Realizada', CANCELADA: 'Cancelada' };
const MAX_TEMAS = 4;

function campo(rotulo, entrada, { obrigatorio = false, ajuda } = {}) {
  const id = entrada.id || `ac-${entrada.name}`;
  entrada.id = id;
  return h(
    'div', { class: 'campo' },
    h('label', { for: id, class: obrigatorio ? 'obrigatorio' : false }, rotulo),
    entrada,
    ajuda && h('span', { class: 'ajuda' }, ajuda),
  );
}

// apoio: { tipoAcao: [...], tema: [...] } de /api/apoio. acao: detalhe existente (edição) ou null.
// aoSalvar(id) é chamado após gravar com sucesso.
export function abrirFormulario({ apoio, usuario, acao, aoSalvar }) {
  const unidades = usuario.unidades;
  const edicao = !!acao;
  const temasSel = new Set((acao?.temas || []).map((t) => t.id));
  const tiposLista = [...apoio.tipoAcao];
  const temasLista = [...apoio.tema];
  // itens hoje inativos mas já vinculados continuam visíveis na edição
  if (acao && !tiposLista.some((t) => t.id === acao.tipoAcaoId)) tiposLista.push({ id: acao.tipoAcaoId, nome: acao.tipoAcaoNome });
  for (const t of acao?.temas || []) if (!temasLista.some((x) => x.id === t.id)) temasLista.push({ id: t.id, nome: t.nome });

  const form = h('form', { class: 'acoes-form', novalidate: true, autocomplete: 'off' });

  const selUnidade = h('select', { class: 'select', name: 'unidadeId' },
    unidades.length > 1 && !edicao && h('option', { value: '' }, 'Selecione...'),
    unidades.map((u) => h('option', { value: u.id, selected: (acao?.unidadeId ?? (unidades.length === 1 ? u.id : null)) === u.id }, `${u.sigla} — ${u.nome}`)));
  const selTipo = h('select', { class: 'select', name: 'tipoAcaoId' },
    h('option', { value: '' }, 'Selecione...'),
    tiposLista.map((t) => h('option', { value: t.id, selected: acao?.tipoAcaoId === t.id }, t.nome)));
  const selStatus = h('select', { class: 'select', name: 'status' },
    Object.entries(STATUS).map(([k, v]) => h('option', { value: k, selected: (acao?.status || 'PLANEJADA') === k }, v)));
  const qtd = h('input', { class: 'input', type: 'text', inputmode: 'numeric', name: 'qtdParticipantes', maxlength: '6', value: acao?.qtdParticipantes ?? '' });

  // Temas como opções de toque, máximo 4
  const grupoTemas = h('div', { class: 'acoes-temas', role: 'group', 'aria-label': 'Temas' });
  const caixasTema = temasLista.map((t) => {
    const cx = h('input', { type: 'checkbox', value: t.id, checked: temasSel.has(t.id) });
    cx.addEventListener('change', atualizarLimite);
    grupoTemas.append(h('label', { class: 'opcao' }, cx, h('span', {}, t.nome)));
    return cx;
  });
  function atualizarLimite() {
    const marcados = caixasTema.filter((c) => c.checked).length;
    for (const c of caixasTema) c.disabled = !c.checked && marcados >= MAX_TEMAS;
    contagem.textContent = `${marcados} de ${MAX_TEMAS} selecionados`;
  }
  const contagem = h('span', { class: 'ajuda' });
  const campoTemas = h('div', { class: 'campo' },
    h('span', { class: 'rotulo' }, 'Temas (até 4)'), grupoTemas, contagem,
    h('input', { type: 'hidden', name: 'temaIds' }));
  atualizarLimite();

  const fotos = seletorFotos();

  form.append(
    h('div', { class: 'grade grade-2' },
      unidades.length > 1 ? campo('Unidade', selUnidade, { obrigatorio: true }) : h('input', { type: 'hidden', name: 'unidadeId', value: unidades[0]?.id ?? '' }),
      campo('Data', h('input', { class: 'input', type: 'date', name: 'dataAcao', value: acao?.dataAcao?.slice(0, 10) || hojeIso() }), { obrigatorio: true }),
      campo('Tipo', selTipo, { obrigatorio: true }),
      campo('Situação', selStatus, { obrigatorio: true })),
    campo('Instituição / local', h('input', { class: 'input', type: 'text', name: 'instituicaoLocal', maxlength: '200', value: acao?.instituicaoLocal || '' })),
    campo('Endereço', h('input', { class: 'input', type: 'text', name: 'endereco', maxlength: '200', value: acao?.endereco || '' })),
    campoTemas,
    campo('Participantes', qtd, { ajuda: 'Obrigatório para marcar como realizada.' }),
    campo('Descrição / observações', h('textarea', { class: 'textarea', name: 'descricao', rows: '4' }, acao?.descricao || '')),
    h('fieldset', { class: 'secao' }, h('legend', {}, edicao ? 'Adicionar fotos' : 'Fotos'), fotos.elemento),
  );

  const botaoSalvar = h('button', { type: 'submit', class: 'btn' }, edicao ? 'Salvar alterações' : 'Salvar ação');
  const modal = abrirModal({
    titulo: edicao ? 'Editar ação' : 'Nova ação',
    conteudo: form,
    fechavel: false,
  });
  form.append(h('div', { class: 'barra-acoes' },
    h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => modal.fechar() }, 'Cancelar'),
    botaoSalvar));
  modal.elemento.classList.add('modal-larga');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const corpo = {
      unidadeId: form.elements.unidadeId.value || undefined,
      dataAcao: form.elements.dataAcao.value,
      tipoAcaoId: form.elements.tipoAcaoId.value,
      status: form.elements.status.value,
      instituicaoLocal: form.elements.instituicaoLocal.value,
      endereco: form.elements.endereco.value,
      qtdParticipantes: form.elements.qtdParticipantes.value.trim(),
      descricao: form.elements.descricao.value,
      temaIds: caixasTema.filter((c) => c.checked).map((c) => Number(c.value)),
    };
    await comEspera(botaoSalvar, async () => {
      let id = acao?.id;
      try {
        if (edicao) await api.put(`/api/acoes/${id}`, corpo);
        else ({ id } = await api.post('/api/acoes', corpo));
      } catch (erro) {
        if (erro instanceof ErroApi && erro.detalhes) mostrarErrosCampos(form, erro.detalhes);
        toast.erro(erro.message);
        return;
      }
      const selecionadas = fotos.selecionadas();
      if (selecionadas.length) {
        botaoSalvar.textContent = 'Enviando fotos...';
        try {
          await enviarFotos(id, selecionadas, (f, t) => { botaoSalvar.textContent = `Enviando fotos ${f}/${t}...`; });
        } catch (erro) {
          toast.erro(`A ação foi salva, mas as fotos não foram enviadas: ${erro.message} Adicione-as pelos detalhes da ação.`);
          modal.fechar();
          aoSalvar(id);
          return;
        }
      }
      toast.sucesso(edicao ? 'Ação atualizada.' : 'Ação registrada.');
      modal.fechar();
      aoSalvar(id);
    });
  });
}
