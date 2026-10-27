// Fotos do registro de acompanhamento (modelo oficial 2): só com o aceite da família e sempre com a data do acompanhamento.
import { api } from '../api.js';
import { h, toast, abrirModal, confirmar, formatarData } from '../ui.js';
import { redimensionarFoto, nomeJpeg } from '../acoes/imagem.js';

const POR_ENVIO = 10;

// Seleção de fotos novas (câmera/galeria) com legenda e data de cada uma.
// -> { elemento, selecionadas: () => [{ arquivo, legenda, data }], definirDataPadrao(iso), limpar }
export function seletorFotosRegistro({ dataPadrao, max }) {
  const itens = [];
  const lista = h('div', { class: 'fam-pre-fotos' });
  let padrao = dataPadrao;

  function adicionar(arquivos) {
    for (const arquivo of arquivos) {
      if (!arquivo.type.startsWith('image/')) { toast.aviso(`"${arquivo.name}" não é uma imagem.`); continue; }
      const url = URL.createObjectURL(arquivo);
      const legenda = h('input', { class: 'input', type: 'text', maxlength: '300', placeholder: 'Legenda (opcional)', 'aria-label': 'Legenda da foto' });
      const data = h('input', { class: 'input', type: 'date', max, value: padrao, 'aria-label': 'Data da foto', required: true });
      const no = h('div', { class: 'fam-pre-foto' },
        h('img', { src: url, alt: 'Pré-visualização da foto' }),
        h('div', { class: 'fam-pre-foto-campos' }, legenda, h('label', { class: 'texto-pequeno texto-suave' }, 'Data da foto', data)),
        h('button', {
          type: 'button', class: 'btn btn-texto btn-pequeno',
          onclick: () => { URL.revokeObjectURL(url); itens.splice(itens.findIndex((i) => i.no === no), 1); no.remove(); },
        }, 'Remover'));
      itens.push({ arquivo, legenda, data, no });
      lista.append(no);
    }
  }

  const entrada = (capture) => h('input', {
    type: 'file', accept: 'image/*', multiple: true, capture: capture ? 'environment' : false, hidden: true,
    onchange: (e) => { adicionar([...e.target.files]); e.target.value = ''; },
  });
  const camera = entrada(true);
  const galeria = entrada(false);
  const elemento = h('div', { class: 'fam-seletor-fotos' },
    h('div', { class: 'barra-acoes fam-barra-fotos' },
      h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => camera.click() }, 'Tirar foto'),
      h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => galeria.click() }, 'Escolher da galeria')),
    camera, galeria, lista);
  return {
    elemento,
    selecionadas: () => itens.map((i) => ({ arquivo: i.arquivo, legenda: i.legenda.value.trim(), data: i.data.value || padrao })),
    // a data de cada foto acompanha a data do registro até a pessoa mudá-la
    definirDataPadrao(iso) {
      for (const i of itens) if (i.data.value === padrao) i.data.value = iso;
      padrao = iso;
    },
    limpar: () => { itens.length = 0; lista.replaceChildren(); },
  };
}

// Envia as fotos escolhidas em lotes (reduzidas no navegador).
export async function enviarFotosRegistro(urlBase, selecionadas, aoProgresso) {
  let feitas = 0;
  for (let i = 0; i < selecionadas.length; i += POR_ENVIO) {
    const lote = selecionadas.slice(i, i + POR_ENVIO);
    const dados = new FormData();
    for (const [j, { arquivo, legenda, data }] of lote.entries()) {
      dados.append('fotos', await redimensionarFoto(arquivo), nomeJpeg(arquivo.name, i + j));
      dados.append('legendas', legenda);
      dados.append('datas', data || '');
    }
    await api.upload(`${urlBase}/fotos`, dados);
    feitas += lote.length;
    aoProgresso?.(feitas, selecionadas.length);
  }
}

function ampliar(foto) {
  abrirModal({
    titulo: `Foto de ${formatarData(foto.dataFoto)}`,
    conteudo: h('div', {},
      h('img', { class: 'fam-foto-grande', src: foto.url, alt: foto.legenda || `Foto do acompanhamento de ${formatarData(foto.dataFoto)}` }),
      foto.legenda ? h('p', { class: 'texto-pequeno' }, foto.legenda) : null),
    botoes: [{ texto: 'Fechar', classe: 'btn btn-secundario' }],
  });
}

// Miniaturas das fotos já anexadas, cada uma com a data. `remover(foto)` só aparece quando informado (registro editável).
export function galeriaRegistro(fotos, { remover } = {}) {
  if (!fotos.length) return null;
  return h('ul', { class: 'fam-fotos' }, fotos.map((f) => {
    const item = h('li', { class: 'fam-foto' },
      h('button', { type: 'button', class: 'fam-foto-botao', onclick: () => ampliar(f), 'aria-label': `Ampliar foto de ${formatarData(f.dataFoto)}${f.legenda ? `: ${f.legenda}` : ''}` },
        h('img', { src: f.url, alt: f.legenda || 'Foto do acompanhamento', loading: 'lazy' })),
      h('span', { class: 'fam-foto-data texto-pequeno' }, formatarData(f.dataFoto)),
      remover ? h('button', {
        type: 'button', class: 'btn btn-texto btn-pequeno',
        onclick: async () => {
          if (!(await confirmar('Excluir esta foto do registro?', { textoOk: 'Excluir', perigo: true }))) return;
          try { await remover(f); item.remove(); } catch (e) { toast.erro(e.message); }
        },
      }, 'Excluir') : null);
    return item;
  }));
}
