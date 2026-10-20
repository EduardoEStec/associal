// Lista de famílias acompanhadas, com filtros e selo do questionário final.
import { api } from '../api.js';
import { h, toast, carregando, formatarData, formatarCpf } from '../ui.js';
import { icone } from '../layout.js';
import { cabecalhoPagina, podeEscrever, seloStatus, seloFinal, campo, montar } from './util.js';

const TAMANHO = 20;

export async function renderLista({ usuario, conteudo }) {
  const estado = { q: '', status: 'EM_ANDAMENTO', finalSituacao: '', unidadeId: '', pagina: 1 };

  const form = h('form', { class: 'card fam-filtros', novalidate: true, role: 'search' });
  const area = h('div', { 'aria-live': 'polite' });

  const entradaBusca = h('input', { class: 'input', id: 'f-q', type: 'search', placeholder: 'Nome ou CPF do responsável', autocomplete: 'off' });
  const selStatus = h('select', { class: 'select', id: 'f-status' },
    h('option', { value: '' }, 'Todas'), h('option', { value: 'EM_ANDAMENTO' }, 'Em andamento'),
    h('option', { value: 'CONCLUIDO' }, 'Concluídas'), h('option', { value: 'DESLIGADO' }, 'Desligadas'));
  selStatus.value = estado.status;
  const selFinal = h('select', { class: 'select', id: 'f-final' },
    h('option', { value: '' }, 'Qualquer'), h('option', { value: 'VENCIDO' }, 'Vencido'),
    h('option', { value: 'VENCENDO' }, 'Vencendo em breve'), h('option', { value: 'EM_DIA' }, 'Em dia'),
    h('option', { value: 'PENDENTE' }, 'Pendente (qualquer prazo)'), h('option', { value: 'CONCLUIDO' }, 'Final concluído'));
  const selUnidade = usuario.unidades.length > 1
    ? h('select', { class: 'select', id: 'f-unidade' }, h('option', { value: '' }, 'Todas'),
      usuario.unidades.map((u) => h('option', { value: String(u.id) }, `${u.sigla} — ${u.nome}`)))
    : null;

  form.append(
    h('div', { class: 'grade grade-4' },
      campo({ id: 'f-q', rotulo: 'Buscar', controle: entradaBusca }),
      campo({ id: 'f-status', rotulo: 'Acompanhamento', controle: selStatus }),
      campo({ id: 'f-final', rotulo: 'Questionário final', controle: selFinal }),
      selUnidade ? campo({ id: 'f-unidade', rotulo: 'Unidade', controle: selUnidade }) : null),
    h('div', { class: 'barra-acoes' },
      h('button', { type: 'button', class: 'btn btn-secundario', onclick: limpar }, 'Limpar'),
      h('button', { type: 'submit', class: 'btn' }, 'Filtrar')),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    estado.q = entradaBusca.value.trim();
    estado.status = selStatus.value;
    estado.finalSituacao = selFinal.value;
    estado.unidadeId = selUnidade ? selUnidade.value : '';
    estado.pagina = 1;
    carregar();
  });
  function limpar() {
    entradaBusca.value = ''; selStatus.value = 'EM_ANDAMENTO'; selFinal.value = ''; if (selUnidade) selUnidade.value = '';
    form.requestSubmit();
  }

  const novo = podeEscrever(usuario)
    ? [h('a', { class: 'btn', href: '#/nova' }, '+ Nova família')]
    : null;
  montar(conteudo, 
    cabecalhoPagina('Acompanhamento Familiar', { acoes: novo }),
    form,
    area,
  );

  async function carregar() {
    area.replaceChildren(carregando());
    try {
      const r = await api.get('/api/familias', {
        q: estado.q, status: estado.status, finalSituacao: estado.finalSituacao, unidadeId: estado.unidadeId,
        pagina: estado.pagina, tamanho: TAMANHO,
      });
      area.replaceChildren(montarResultado(r));
    } catch (e) {
      area.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, e.message));
      toast.erro(e.message);
    }
  }

  function montarResultado(r) {
    if (r.itens.length === 0) {
      return h('div', { class: 'card card-vazio' },
        h('p', {}, h('strong', {}, 'Nenhuma família encontrada.')),
        h('p', { class: 'texto-pequeno' }, 'Ajuste os filtros ou cadastre uma nova família para acompanhar.'));
    }
    const mostrarUnidade = usuario.unidades.length > 1;
    const linhas = r.itens.map((i) => h('tr', {},
      h('td', { 'data-rotulo': 'Responsável' },
        h('a', { href: `#/a/${i.acompanhamentoId}`, class: 'fam-nome' }, i.responsavel.nome),
        h('div', { class: 'texto-pequeno texto-suave' }, i.responsavel.cpf ? formatarCpf(i.responsavel.cpf) : 'sem CPF')),
      mostrarUnidade ? h('td', { 'data-rotulo': 'Unidade' }, i.unidadeSigla) : null,
      h('td', { 'data-rotulo': 'Pessoas' }, String(i.qtdMembros)),
      h('td', { 'data-rotulo': 'Início' }, formatarData(i.dataInicio)),
      h('td', { 'data-rotulo': 'Acompanhamento' }, seloStatus(i.status)),
      h('td', { 'data-rotulo': 'Questionários' },
        h('span', { class: 'fam-passos' },
          h('span', { class: `badge ${i.inicialConcluido ? 'badge-sucesso' : ''}` }, i.inicialConcluido ? [icone('check'), 'Inicial'] : 'Inicial pendente'))),
      h('td', { 'data-rotulo': 'Final' }, seloFinal(i), i.dataPrevistaFinal && i.status === 'EM_ANDAMENTO'
        ? h('div', { class: 'texto-pequeno texto-suave' }, `prazo ${formatarData(i.dataPrevistaFinal)}`) : null),
    ));

    const totalPaginas = Math.max(1, Math.ceil(r.total / r.tamanho));
    return h('div', {},
      h('p', { class: 'texto-pequeno texto-suave' }, `${r.total} ${r.total === 1 ? 'família' : 'famílias'}`),
      h('div', { class: 'tabela-wrap' },
        h('table', { class: 'tabela tabela-responsiva' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Responsável'), mostrarUnidade ? h('th', {}, 'Unidade') : null, h('th', {}, 'Pessoas'),
            h('th', {}, 'Início'), h('th', {}, 'Acompanhamento'), h('th', {}, 'Questionários'), h('th', {}, 'Final'))),
          h('tbody', {}, linhas))),
      totalPaginas > 1
        ? h('div', { class: 'linha-entre fam-paginacao' },
          h('button', { type: 'button', class: 'btn btn-secundario', disabled: r.pagina <= 1, onclick: () => { estado.pagina -= 1; carregar(); } }, '← Anterior'),
          h('span', {}, `Página ${r.pagina} de ${totalPaginas}`),
          h('button', { type: 'button', class: 'btn btn-secundario', disabled: r.pagina >= totalPaginas, onclick: () => { estado.pagina += 1; carregar(); } }, 'Próxima →'))
        : null,
    );
  }

  await carregar();
}
