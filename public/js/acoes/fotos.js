// Seleção (câmera/galeria) e envio de fotos de uma ação.
import { h, toast } from '../ui.js';
import { api } from '../api.js';
import { redimensionarFoto, nomeJpeg } from './imagem.js';

const POR_ENVIO = 10;

// Componente: botões "Tirar foto" / "Galeria" + miniaturas com legenda.
// -> { elemento, selecionadas: () => [{ arquivo, legenda }], limpar }
export function seletorFotos() {
  const itens = [];
  const lista = h('div', { class: 'acoes-pre-fotos' });

  function adicionar(arquivos) {
    for (const arquivo of arquivos) {
      if (!arquivo.type.startsWith('image/')) { toast.aviso(`"${arquivo.name}" não é uma imagem.`); continue; }
      const url = URL.createObjectURL(arquivo);
      const legenda = h('input', { class: 'input', type: 'text', maxlength: '300', placeholder: 'Legenda (opcional)', 'aria-label': 'Legenda da foto' });
      const no = h(
        'div', { class: 'acoes-pre-foto' },
        h('img', { src: url, alt: 'Pré-visualização da foto' }),
        legenda,
        h('button', {
          type: 'button', class: 'btn btn-texto btn-pequeno',
          onclick: () => { URL.revokeObjectURL(url); itens.splice(itens.findIndex((i) => i.no === no), 1); no.remove(); },
        }, 'Remover'),
      );
      itens.push({ arquivo, legenda, no });
      lista.append(no);
    }
  }

  const entrada = (capture) => h('input', {
    type: 'file', accept: 'image/*', multiple: true, capture: capture ? 'environment' : false, hidden: true,
    onchange: (e) => { adicionar([...e.target.files]); e.target.value = ''; },
  });
  const camera = entrada(true);
  const galeria = entrada(false);

  const elemento = h(
    'div', { class: 'acoes-seletor-fotos' },
    h(
      'div', { class: 'barra-acoes acoes-barra-fotos' },
      h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => camera.click() }, 'Tirar foto'),
      h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => galeria.click() }, 'Escolher da galeria'),
    ),
    camera, galeria, lista,
  );
  return {
    elemento,
    selecionadas: () => itens.map((i) => ({ arquivo: i.arquivo, legenda: i.legenda.value.trim() })),
    limpar: () => { itens.length = 0; lista.replaceChildren(); },
  };
}

// Reduz e envia as fotos em lotes. `aoProgresso(feitas, total)` é opcional.
export async function enviarFotos(acaoId, selecionadas, aoProgresso) {
  let feitas = 0;
  for (let i = 0; i < selecionadas.length; i += POR_ENVIO) {
    const lote = selecionadas.slice(i, i + POR_ENVIO);
    const dados = new FormData();
    for (const [j, { arquivo, legenda }] of lote.entries()) {
      const blob = await redimensionarFoto(arquivo);
      dados.append('fotos', blob, nomeJpeg(arquivo.name, i + j));
      dados.append('legendas', legenda);
    }
    await api.upload(`/api/acoes/${acaoId}/fotos`, dados);
    feitas += lote.length;
    aoProgresso?.(feitas, selecionadas.length);
  }
}
