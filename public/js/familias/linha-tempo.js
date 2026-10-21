// Aba "Linha do tempo" da ficha: atendimentos, questionários, registros, encaminhamentos e encerramento em ordem.
import { api } from '../api.js';
import { icone } from '../layout.js';
import { h, toast, formatarData } from '../ui.js';
import { seloSituacao } from './acompanhamento.js';
import { campo } from './util.js';

const TAMANHO = 30;
const ICONE = {
  INICIO: 'familias', QUESTIONARIO: 'relatorios', REGISTRO: 'mensagem', ATENDIMENTO: 'atendimentos',
  ENCAMINHAMENTO: 'seta', PRAZO: 'calendario', ENCERRAMENTO: 'check',
};
const FILTROS = [
  ['', 'Tudo'],
  ['REGISTRO', 'Contatos e visitas'],
  ['ATENDIMENTO,ENCAMINHAMENTO', 'Atendimentos e encaminhamentos'],
  ['QUESTIONARIO', 'Questionários'],
];

function itemLinha(e) {
  const selos = [];
  if (e.antesDoInicio) selos.push(h('span', { class: 'badge' }, 'Antes do acompanhamento'));
  if (e.tipo === 'PRAZO') selos.push(h('span', { class: `badge ${e.vencido ? 'badge-perigo' : 'badge-info'}` }, icone(e.vencido ? 'alerta' : 'relogio'), e.vencido ? 'Vencido' : 'Previsto'));
  if (e.tipo === 'REGISTRO' && e.situacao) selos.push(seloSituacao(e.situacao));
  return h('li', { class: `fam-evento fam-evento-${e.tipo.toLowerCase()}${e.antesDoInicio || e.futuro ? ' fam-evento-suave' : ''}` },
    h('span', { class: 'fam-evento-marca' }, icone(ICONE[e.tipo] || 'mais')),
    h('div', { class: 'fam-evento-corpo' },
      h('div', { class: 'fam-evento-topo' }, h('time', { datetime: e.data }, formatarData(e.data)), selos),
      h('p', { class: 'fam-evento-titulo' }, e.titulo),
      e.detalhe ? h('p', { class: 'fam-evento-detalhe' }, e.detalhe) : null,
      e.resumo ? h('p', { class: 'fam-evento-resumo' }, e.resumo) : null,
      e.proximoContatoEm ? h('p', { class: 'texto-pequeno texto-suave' }, `Próximo contato combinado: ${formatarData(e.proximoContatoEm)}`) : null,
      e.autor ? h('p', { class: 'texto-pequeno texto-suave fam-evento-autor' }, e.autor) : null));
}

export async function renderLinhaTempo({ id }) {
  const estado = { tipos: '', pagina: 1 };
  const lista = h('ol', { class: 'fam-linha', 'aria-label': 'Eventos da família, do mais recente ao mais antigo' });
  const rodape = h('div', { class: 'fam-linha-rodape' });
  const aviso = h('div', { 'aria-live': 'polite' });

  const filtro = h('select', { class: 'select', id: 'lt-filtro' }, FILTROS.map(([valor, rotulo]) => h('option', { value: valor }, rotulo)));
  filtro.addEventListener('change', () => { estado.tipos = filtro.value; estado.pagina = 1; carregar(true); });

  async function carregar(zerar) {
    try {
      const r = await api.get(`/api/familias/acompanhamentos/${id}/linha-do-tempo`, { tipos: estado.tipos, pagina: estado.pagina, tamanho: TAMANHO });
      if (zerar) lista.replaceChildren();
      lista.append(...r.itens.map(itemLinha));
      aviso.replaceChildren(
        r.textoRestrito ? h('div', { class: 'aviso' }, 'Os textos dos registros e dos atendimentos não são exibidos para o seu perfil.') : '',
        r.total === 0 ? h('div', { class: 'card card-vazio' }, h('p', {}, 'Nenhum evento para este filtro.')) : '');
      const mostrados = (estado.pagina - 1) * TAMANHO + r.itens.length;
      rodape.replaceChildren(r.total > mostrados
        ? h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => { estado.pagina += 1; carregar(false); } }, `Mostrar mais (${r.total - mostrados})`)
        : (r.total > 0 ? h('p', { class: 'texto-pequeno texto-suave' }, `${r.total} ${r.total === 1 ? 'evento' : 'eventos'}`) : ''));
    } catch (e) {
      toast.erro(e.message);
      aviso.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, e.message));
    }
  }
  await carregar(true);

  return [
    h('div', { class: 'fam-aba-topo' },
      h('h2', {}, 'Linha do tempo'),
      h('div', { class: 'fam-linha-filtro' }, campo({ id: 'lt-filtro', rotulo: 'Mostrar', controle: filtro }))),
    aviso, lista, rodape,
  ];
}
