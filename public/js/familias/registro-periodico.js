// "Registro periódico (.docx)": prévia editável do documento no formato do modelo oficial 2 (tabela por mês, observações do
// profissional e fotos com data). A tabela vem dos registros; a assistente edita a identificação, as observações e a escolha das fotos.
import { api } from '../api.js';
import { h, toast, abrirModal, carregando, formatarData, comEspera } from '../ui.js';
import { baixarArquivo, campoLinha, mensagemErro } from '../relatorios/comum.js';

const CAMPOS = [
  ['responsavel', 'Responsável familiar'],
  ['cpfNis', 'CPF/CadÚnico'],
  ['contato', 'Contato'],
  ['endereco', 'Endereço'],
  ['profissional', 'Profissional responsável'],
];

export async function abrirRegistroPeriodico({ id }) {
  const corpo = h('div', { class: 'fam-regper' }, carregando());
  const botaoGerar = h('button', { type: 'button', class: 'btn', disabled: true }, 'Gerar .docx');
  abrirModal({
    titulo: 'Registro periódico',
    conteudo: corpo,
    botoes: [
      { texto: 'Fechar', classe: 'btn btn-secundario' },
    ],
  });

  let previa;
  try {
    previa = await api.get(`/api/relatorios/registro-periodico/${id}`);
  } catch (e) {
    corpo.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, mensagemErro(e)));
    return;
  }

  const identificacao = Object.fromEntries(CAMPOS.map(([chave, rotulo]) => [chave, campoLinha(rotulo, { valor: previa.identificacao[chave], nome: chave })]));
  const observacoes = new Map();
  const blocosRegistros = previa.registros.map((r) => {
    const area = h('textarea', { class: 'textarea', id: `rp-obs-${r.id}`, name: `observacao-${r.id}`, rows: 3, maxlength: 4000 });
    area.value = r.observacao;
    observacoes.set(r.id, area);
    return h('div', { class: 'campo fam-regper-registro' },
      h('label', { for: `rp-obs-${r.id}` }, `${r.mes} – ${formatarData(r.data)} – ${r.contato}`),
      h('p', { class: 'texto-pequeno texto-suave' }, [r.uso && `Armazém: ${r.uso.toLowerCase()}`, r.orientacoes && `Orientações: ${r.orientacoes}`].filter(Boolean).join(' · ') || 'Sem uso do Armazém ou orientações registrados.'),
      area);
  });

  const fotos = new Map();
  const blocoFotos = previa.fotos.length
    ? h('fieldset', { class: 'secao' }, h('legend', {}, 'Fotos no anexo'),
      h('div', { class: 'fam-regper-fotos' }, previa.fotos.map((f) => {
        const marca = h('input', { type: 'checkbox', checked: true, id: `rp-foto-${f.id}` });
        fotos.set(f.id, marca);
        return h('label', { class: 'fam-regper-foto', for: `rp-foto-${f.id}` },
          h('img', { src: f.url, alt: f.legenda || `Foto de ${formatarData(f.data)}`, loading: 'lazy' }),
          h('span', { class: 'opcao' }, marca, h('span', {}, formatarData(f.data))));
      })))
    : null;

  botaoGerar.disabled = false;
  botaoGerar.addEventListener('click', () => comEspera(botaoGerar, async () => {
    try {
      const nome = await baixarArquivo(`/api/relatorios/registro-periodico/${id}/docx`, {
        metodo: 'POST',
        corpo: {
          identificacao: Object.fromEntries(Object.entries(identificacao).map(([k, c]) => [k, c.entrada.value])),
          observacoes: Object.fromEntries([...observacoes].map(([rid, a]) => [rid, a.value])),
          fotos: [...fotos].filter(([, m]) => m.checked).map(([fid]) => fid),
        },
      });
      toast.sucesso(`Documento gerado: ${nome}`);
    } catch (e) {
      toast.erro(mensagemErro(e));
    }
  }));

  corpo.replaceChildren(
    h('p', { class: 'texto-pequeno' }, 'O documento segue o modelo oficial: uma linha por registro (mês, contato realizado, uso do Armazém, orientações e coluna de assinatura da família). Revise as observações antes de baixar.'),
    ...previa.avisos.map((a) => h('div', { class: 'aviso aviso-aviso rel-aviso-item' }, a)),
    h('fieldset', { class: 'secao' }, h('legend', {}, 'Identificação'), h('div', { class: 'fam-regper-ident' }, Object.values(identificacao).map((c) => c.elemento))),
    h('fieldset', { class: 'secao' }, h('legend', {}, 'Observações do profissional'), blocosRegistros.length ? blocosRegistros : h('p', { class: 'texto-pequeno' }, 'Nenhum registro de contato neste acompanhamento.')),
    blocoFotos,
    h('div', { class: 'barra-acoes' }, botaoGerar));
}
