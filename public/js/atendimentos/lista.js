// Atendimentos — listagem com filtros, busca e paginação (cards no celular / tabela no desktop).
import { api } from '../api.js';
import { h, toast, carregando, formatarData, formatarCpf } from '../ui.js';

const filtrosSalvos = { dataInicio: '', dataFim: '', unidadeId: '', q: '', demandaId: '', encaminhamentoId: '' };

function opcoesSelect(lista, textoTodos) {
  return [h('option', { value: '' }, textoTodos), ...lista.map((o) => h('option', { value: o.id }, o.nome))];
}

function campo(rotulo, entrada, id) {
  return h('div', { class: 'campo' }, h('label', { for: id }, rotulo), entrada);
}

export async function renderLista({ usuario, conteudo, apoio }) {
  let pagina = 1;

  const f = {
    q: h('input', { class: 'input', id: 'f-q', type: 'search', placeholder: 'Nome ou CPF', autocomplete: 'off' }),
    dataInicio: h('input', { class: 'input', id: 'f-ini', type: 'date' }),
    dataFim: h('input', { class: 'input', id: 'f-fim', type: 'date' }),
    unidadeId: h('select', { class: 'select', id: 'f-uni' }, ...opcoesSelect(usuario.unidades, 'Todas as minhas unidades')),
    demandaId: h('select', { class: 'select', id: 'f-dem' }, ...opcoesSelect(apoio.demanda, 'Todas as demandas')),
    encaminhamentoId: h('select', { class: 'select', id: 'f-enc' }, ...opcoesSelect(apoio.encaminhamento, 'Todos os encaminhamentos')),
  };
  for (const [chave, el] of Object.entries(f)) el.value = filtrosSalvos[chave];

  const resultado = h('div', {});
  const formFiltros = h('form', { class: 'card atend-filtros', role: 'search' },
    h('div', { class: 'grade grade-3' },
      campo('Buscar', f.q, 'f-q'),
      campo('De', f.dataInicio, 'f-ini'),
      campo('Até', f.dataFim, 'f-fim'),
      usuario.unidades.length > 1 ? campo('Unidade', f.unidadeId, 'f-uni') : null,
      campo('Demanda', f.demandaId, 'f-dem'),
      campo('Encaminhamento', f.encaminhamentoId, 'f-enc'),
    ),
    h('div', { class: 'barra-acoes' },
      h('button', { type: 'button', class: 'btn btn-secundario', onclick: limpar }, 'Limpar'),
      h('button', { type: 'submit', class: 'btn' }, 'Filtrar')),
  );
  formFiltros.addEventListener('submit', (e) => { e.preventDefault(); pagina = 1; carregar(); });

  function limpar() {
    for (const el of Object.values(f)) el.value = '';
    pagina = 1;
    carregar();
  }

  conteudo.replaceChildren(
    h('div', { class: 'pagina-titulo' },
      h('h1', {}, 'Atendimentos'),
      h('a', { class: 'btn', href: '#novo' }, '+ Novo atendimento')),
    formFiltros,
    resultado,
  );

  async function carregar() {
    for (const [chave, el] of Object.entries(f)) filtrosSalvos[chave] = el.value;
    resultado.replaceChildren(carregando());
    try {
      const consulta = { ...filtrosSalvos, pagina };
      const dados = await api.get('/api/atendimentos', consulta);
      resultado.replaceChildren(montarResultado(dados));
    } catch (e) {
      resultado.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, e.message));
      toast.erro(e.message);
    }
  }

  function montarResultado({ itens, total, porPagina }) {
    if (!itens.length) {
      return h('div', { class: 'card card-vazio' }, h('p', {}, 'Nenhum atendimento encontrado para os filtros informados.'));
    }
    const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
    const linhas = itens.map((a) => {
      const tr = h('tr', { class: 'atend-linha-clicavel' },
        h('td', { 'data-rotulo': 'Data' }, formatarData(a.dataAtendimento)),
        h('td', { 'data-rotulo': 'Nome' }, h('a', { href: `#${a.id}` }, a.nome)),
        h('td', { 'data-rotulo': 'CPF' }, a.cpf ? formatarCpf(a.cpf) : '—'),
        h('td', { 'data-rotulo': 'Unidade' }, a.unidadeSigla),
        h('td', { 'data-rotulo': 'Demandas' }, a.demandas || '—'),
        h('td', { 'data-rotulo': 'Encaminh.' }, a.qtdEncaminhamentos ? h('span', { class: 'badge badge-info' }, a.qtdEncaminhamentos) : '—'),
      );
      tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = `#${a.id}`; });
      return tr;
    });
    return h('div', {},
      h('p', { class: 'atend-resumo' }, `${total} atendimento${total === 1 ? '' : 's'}`),
      h('div', { class: 'tabela-wrap' },
        h('table', { class: 'tabela tabela-responsiva' },
          h('thead', {}, h('tr', {}, ...['Data', 'Nome', 'CPF', 'Unidade', 'Demandas', 'Encaminh.'].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...linhas))),
      totalPaginas > 1 ? h('div', { class: 'atend-paginacao' },
        h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', disabled: pagina <= 1, onclick: () => { pagina -= 1; carregar(); } }, 'Anterior'),
        h('span', {}, `Página ${pagina} de ${totalPaginas}`),
        h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', disabled: pagina >= totalPaginas, onclick: () => { pagina += 1; carregar(); } }, 'Próxima'),
      ) : null,
    );
  }

  await carregar();
}
