// Detalhe da ação (modal): dados, mudança de situação, galeria de fotos.
import { h, abrirModal, confirmar, toast, comEspera, formatarData, formatarNumero, mostrarErrosCampos } from '../ui.js';
import { api, ErroApi } from '../api.js';
import { STATUS, abrirFormulario } from './formulario.js';
import { seletorFotos, enviarFotos } from './fotos.js';

export const CLASSE_STATUS = { PLANEJADA: 'badge-info', REALIZADA: 'badge-sucesso', CANCELADA: 'badge-perigo' };

function linha(rotulo, valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  return h('div', { class: 'acoes-info' }, h('dt', {}, rotulo), h('dd', {}, valor));
}

function ampliar(foto) {
  abrirModal({
    titulo: foto.legenda || 'Foto',
    conteudo: h('img', { class: 'acoes-foto-grande', src: foto.url, alt: foto.legenda || 'Foto da ação' }),
    botoes: [{ texto: 'Fechar', classe: 'btn btn-secundario' }],
  });
}

function editarLegenda(acaoId, foto, aoMudar) {
  const entrada = h('input', { class: 'input', type: 'text', maxlength: '300', value: foto.legenda || '', 'aria-label': 'Legenda' });
  abrirModal({
    titulo: 'Legenda da foto',
    conteudo: h('div', { class: 'campo' }, entrada),
    botoes: [
      { texto: 'Cancelar', classe: 'btn btn-secundario' },
      {
        texto: 'Salvar',
        acao: async () => {
          try {
            await api.patch(`/api/acoes/${acaoId}/fotos/${foto.id}`, { legenda: entrada.value });
            aoMudar();
          } catch (e) { toast.erro(e.message); return false; }
        },
      },
    ],
  });
}

function adicionarFotos(acaoId, aoMudar) {
  const seletor = seletorFotos();
  const progresso = h('p', { class: 'ajuda' });
  abrirModal({
    titulo: 'Adicionar fotos',
    conteudo: h('div', {}, seletor.elemento, progresso),
    botoes: [
      { texto: 'Cancelar', classe: 'btn btn-secundario' },
      {
        texto: 'Enviar',
        acao: async () => {
          const escolhidas = seletor.selecionadas();
          if (!escolhidas.length) { toast.aviso('Escolha ao menos uma foto.'); return false; }
          try {
            await enviarFotos(acaoId, escolhidas, (f, t) => { progresso.textContent = `Enviando ${f} de ${t}...`; });
            toast.sucesso('Fotos enviadas.');
            aoMudar();
          } catch (e) { toast.erro(e.message); return false; }
        },
      },
    ],
  });
}

// Pede a quantidade de participantes (necessária para "Realizada").
function pedirParticipantes(valorAtual) {
  return new Promise((resolve) => {
    const form = h('form', {}, h('div', { class: 'campo' },
      h('label', { for: 'ac-qtd-real', class: 'obrigatorio' }, 'Quantidade de participantes'),
      h('input', { class: 'input', id: 'ac-qtd-real', name: 'qtdParticipantes', type: 'text', inputmode: 'numeric', maxlength: '6', value: valorAtual ?? '' })));
    const m = abrirModal({
      titulo: 'Marcar como realizada',
      conteudo: form,
      botoes: [
        { texto: 'Cancelar', classe: 'btn btn-secundario', acao: () => resolve(null) },
        {
          texto: 'Confirmar',
          acao: () => {
            const v = form.elements.qtdParticipantes.value.trim();
            if (!/^\d+$/.test(v)) { mostrarErrosCampos(form, { qtdParticipantes: 'Informe um número inteiro maior ou igual a zero.' }); return false; }
            resolve(Number(v));
          },
        },
      ],
    });
    void m;
  });
}

// Abre o detalhe. `aoMudar()` recarrega a listagem da página.
export async function abrirDetalhe({ id, apoio, usuario, aoMudar }) {
  let modal;
  async function renderizar() {
    let acao;
    try { acao = await api.get(`/api/acoes/${id}`); } catch (e) { toast.erro(e.message); modal?.fechar(); return; }
    const conteudo = montar(acao);
    if (!modal) {
      modal = abrirModal({ titulo: acao.instituicaoLocal || acao.tipoAcaoNome, conteudo, fechavel: true });
      modal.elemento.classList.add('modal-larga');
    } else {
      modal.elemento.querySelector('.acoes-detalhe')?.replaceWith(conteudo);
    }
  }
  const recarregar = () => { aoMudar(); renderizar(); };

  async function mudarStatus(acao, status) {
    let corpo = { status };
    if (status === 'REALIZADA') {
      const qtd = await pedirParticipantes(acao.qtdParticipantes);
      if (qtd === null) return;
      corpo.qtdParticipantes = qtd;
    } else if (status === 'CANCELADA' && !(await confirmar('Cancelar esta ação?', { textoOk: 'Cancelar ação', perigo: true }))) return;
    try {
      await api.patch(`/api/acoes/${acao.id}/status`, corpo);
      toast.sucesso('Situação atualizada.');
      recarregar();
    } catch (e) { toast.erro(e instanceof ErroApi ? (e.detalhes && Object.values(e.detalhes)[0]) || e.message : e.message); }
  }

  function montar(acao) {
    const botoesStatus = Object.keys(STATUS).filter((s) => s !== acao.status).map((s) =>
      h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', onclick: () => mudarStatus(acao, s) },
        { REALIZADA: 'Marcar como realizada', CANCELADA: 'Cancelar ação', PLANEJADA: 'Voltar para planejada' }[s]));

    const galeria = acao.fotos.length
      ? h('div', { class: 'acoes-galeria' }, acao.fotos.map((f) => h(
        'figure', { class: 'acoes-miniatura' },
        h('button', { type: 'button', class: 'acoes-miniatura-botao', onclick: () => ampliar(f), 'aria-label': `Ampliar foto${f.legenda ? `: ${f.legenda}` : ''}` },
          h('img', { src: f.url, alt: f.legenda || 'Foto da ação', loading: 'lazy' })),
        h('figcaption', {}, f.legenda || h('em', {}, 'Sem legenda')),
        h('div', { class: 'acoes-miniatura-acoes' },
          h('button', { type: 'button', class: 'btn btn-texto btn-pequeno', onclick: () => editarLegenda(acao.id, f, recarregar) }, 'Legenda'),
          h('button', {
            type: 'button', class: 'btn btn-texto btn-pequeno',
            onclick: async () => {
              if (!(await confirmar('Excluir esta foto?', { textoOk: 'Excluir', perigo: true }))) return;
              try { await api.delete(`/api/acoes/${acao.id}/fotos/${f.id}`); recarregar(); } catch (e) { toast.erro(e.message); }
            },
          }, 'Excluir')),
      )))
      : h('p', { class: 'ajuda' }, 'Nenhuma foto ainda.');

    return h(
      'div', { class: 'acoes-detalhe' },
      h('div', { class: 'acoes-detalhe-topo' },
        h('span', { class: `badge ${CLASSE_STATUS[acao.status]}` }, STATUS[acao.status]),
        h('span', { class: 'badge' }, acao.tipoAcaoNome)),
      h('dl', { class: 'acoes-infos' },
        linha('Data', formatarData(acao.dataAcao)),
        linha('Unidade', `${acao.unidadeSigla} — ${acao.unidadeNome}`),
        linha('Instituição / local', acao.instituicaoLocal),
        linha('Endereço', acao.endereco),
        linha('Temas', acao.temas.length ? acao.temas.map((t) => t.nome).join(', ') : null),
        linha('Participantes', acao.qtdParticipantes === null ? null : formatarNumero(acao.qtdParticipantes)),
        linha('Descrição', acao.descricao),
        linha('Registrada por', acao.criadoPorNome)),
      h('div', { class: 'barra-acoes acoes-barra-status' }, botoesStatus),
      h('h3', {}, `Fotos (${acao.fotos.length})`),
      galeria,
      h('div', { class: 'barra-acoes' },
        h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => adicionarFotos(acao.id, recarregar) }, 'Adicionar fotos'),
        h('button', {
          type: 'button', class: 'btn btn-secundario',
          onclick: () => abrirFormulario({ apoio, usuario, acao, aoSalvar: () => { aoMudar(); renderizar(); } }),
        }, 'Editar'),
        acao.podeExcluir && h('button', {
          type: 'button', class: 'btn btn-perigo',
          onclick: async (e) => {
            if (!(await confirmar('Excluir esta ação e todas as suas fotos? Não é possível desfazer.', { textoOk: 'Excluir', perigo: true }))) return;
            await comEspera(e.target, async () => {
              try { await api.delete(`/api/acoes/${acao.id}`); toast.sucesso('Ação excluída.'); modal.fechar(); aoMudar(); } catch (err) { toast.erro(err.message); }
            });
          },
        }, 'Excluir')),
    );
  }

  await renderizar();
}
