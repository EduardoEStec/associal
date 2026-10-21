// Relatório Individual Familiar: escolher a família → editar os textos → gerar .docx.
import { api } from '../api.js';
import { h, toast, carregando, formatarData, comEspera } from '../ui.js';
import { icone } from '../layout.js';
import { baixarArquivo, campoLinha, campoTexto, mensagemErro } from './comum.js';

const SECOES = [
  ['introducao', '1. Introdução', 6],
  ['objetivo', '2. Objetivo', 5],
  ['metodologia', '3. Metodologia', 6],
  ['diagnostico', '4. Diagnóstico Inicial — situação socioeconômica identificada', 8],
  ['impactoAlimentar', '5. Impacto na Comunidade — melhoria das escolhas alimentares', 5],
  ['impactoDesafios', '5. Impacto na Comunidade — desafios e oportunidades', 5],
  ['impactoEconomico', '5. Impacto na Comunidade — impactos econômicos', 6],
  ['evolucao', '5. Impacto na Comunidade — evolução durante o acompanhamento (índice de progresso; a tabela é incluída automaticamente)', 6],
  ['feedback', '6. Feedback dos beneficiários', 6],
  ['consideracoes', '7. Considerações finais', 5],
];

const STATUS = { EM_ANDAMENTO: 'Em andamento', CONCLUIDO: 'Concluído', DESLIGADO: 'Desligado' };

export function montarIndividual(raiz, opcoes) {
  const area = h('div');
  raiz.replaceChildren(area);

  const idInicial = Number(new URLSearchParams(location.search).get('acompanhamento')) || null;
  if (idInicial) abrirPrevia(idInicial);
  else mostrarLista();

  // ---------- passo 1: escolher a família ----------
  function mostrarLista() {
    const filtros = { unidadeId: '', busca: '' };
    const lista = h('div', { 'aria-live': 'polite' });

    const unidade = h('select', { class: 'select', id: 'ind-unidade' },
      h('option', { value: '' }, opcoes.unidades.length > 1 ? 'Todas as minhas unidades' : opcoes.unidades[0]?.nome || ''),
      opcoes.unidades.length > 1 ? opcoes.unidades.map((u) => h('option', { value: u.id }, `${u.sigla} — ${u.nome}`)) : []);
    const busca = h('input', { class: 'input', id: 'ind-busca', type: 'search', placeholder: 'Nome do responsável familiar', maxlength: '100' });

    async function carregar() {
      lista.replaceChildren(carregando());
      try {
        const itens = await api.get('/api/relatorios/individual/acompanhamentos', filtros);
        lista.replaceChildren(itens.length ? tabela(itens) : h('div', { class: 'card card-vazio' }, 'Nenhuma família em acompanhamento encontrada.'));
      } catch (e) {
        lista.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, mensagemErro(e)));
      }
    }
    unidade.addEventListener('change', () => { filtros.unidadeId = unidade.value; carregar(); });
    let espera;
    busca.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => { filtros.busca = busca.value.trim(); carregar(); }, 350); });

    area.replaceChildren(
      h('div', { class: 'card rel-filtros' },
        h('h2', { class: 'rel-passo-titulo' }, '1. Escolha a família'),
        h('div', { class: 'grade grade-2' },
          opcoes.unidades.length > 1 ? h('div', { class: 'campo' }, h('label', { for: 'ind-unidade' }, 'Unidade'), unidade) : null,
          h('div', { class: 'campo' }, h('label', { for: 'ind-busca' }, 'Buscar'), busca))),
      lista,
    );
    carregar();
  }

  function tabela(itens) {
    return h('div', { class: 'tabela-wrap rel-lista-acompanhamentos' },
      h('table', { class: 'tabela tabela-responsiva' },
        h('thead', {}, h('tr', {}, ['Responsável familiar', 'Unidade', 'Início', 'Situação', 'Questionários', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, itens.map((i) => h('tr', {},
          h('td', { 'data-rotulo': 'Responsável' }, i.responsavelNome),
          h('td', { 'data-rotulo': 'Unidade' }, i.unidadeSigla),
          h('td', { 'data-rotulo': 'Início' }, formatarData(i.dataInicio)),
          h('td', { 'data-rotulo': 'Situação' }, STATUS[i.status] || i.status),
          h('td', { 'data-rotulo': 'Questionários' },
            h('span', { class: `badge ${i.temInicial ? 'badge-sucesso' : 'badge-aviso'}` }, i.temInicial ? [icone('check'), 'Inicial'] : 'Inicial pendente'),
            ' ',
            h('span', { class: `badge ${i.temFinal ? 'badge-sucesso' : 'badge-aviso'}` }, i.temFinal ? [icone('check'), 'Final'] : 'Final pendente')),
          h('td', { 'data-rotulo': 'Ação' },
            h('button', { type: 'button', class: 'btn btn-pequeno', onclick: () => abrirPrevia(i.id) }, 'Preparar relatório')))))));
  }

  // ---------- passo 2: editar e gerar ----------
  async function abrirPrevia(id) {
    area.replaceChildren(carregando());
    let previa;
    try {
      previa = await api.get(`/api/relatorios/individual/${id}/previa`);
    } catch (e) {
      area.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, mensagemErro(e)),
        h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => { history.replaceState(null, '', location.pathname); mostrarLista(); } }, 'Voltar à lista'));
      return;
    }

    const ident = previa.identificacao;
    const campos = {
      nome: campoLinha('Nome (identificação da família)', { valor: ident.nome, nome: 'nome' }),
      responsavel: campoLinha('Responsável familiar', { valor: ident.responsavel, nome: 'responsavel' }),
      cpf: campoLinha('CPF', { valor: ident.cpf, nome: 'cpf', max: 20 }),
      nis: campoLinha('Nº CadÚnico', { valor: ident.nis, nome: 'nis', max: 20 }),
      contato: campoLinha('Contato', { valor: ident.contato, nome: 'contato', ajuda: 'Telefone ou outra forma de contato (não é guardado no cadastro).' }),
      endereco: campoLinha('Endereço', { valor: ident.endereco, nome: 'endereco' }),
    };
    const textos = Object.fromEntries(SECOES.map(([chave, rotulo, linhas]) => [chave, campoTexto(rotulo, previa.textos[chave], { linhas, nome: chave })]));
    const local = campoLinha('Local', { valor: previa.local, nome: 'local', max: 80 });
    const data = campoLinha('Data do relatório', { valor: previa.data, tipo: 'date', nome: 'data' });

    const gerar = h('button', { type: 'button', class: 'btn' }, 'Gerar .docx');
    gerar.addEventListener('click', () => comEspera(gerar, async () => {
      try {
        const nome = await baixarArquivo(`/api/relatorios/individual/${id}`, {
          metodo: 'POST',
          corpo: {
            identificacao: Object.fromEntries(Object.entries(campos).map(([k, c]) => [k, c.entrada.value])),
            textos: Object.fromEntries(Object.entries(textos).map(([k, c]) => [k, c.entrada.value])),
            local: local.entrada.value,
            data: data.entrada.value,
          },
        });
        toast.sucesso(`Relatório gerado: ${nome}`);
      } catch (e) {
        toast.erro(mensagemErro(e));
      }
    }));

    area.replaceChildren(
      h('div', { class: 'barra-acoes rel-barra-topo' },
        h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', onclick: () => { history.replaceState(null, '', location.pathname); mostrarLista(); } }, '← Escolher outra família')),
      h('div', { class: 'card' },
        h('h2', { class: 'rel-passo-titulo' }, `2. Revise o relatório — ${previa.acompanhamento.unidadeNome}`),
        h('p', { class: 'texto-pequeno' }, 'Os textos abaixo foram preenchidos com os dados dos questionários. Edite o que for necessário antes de gerar o documento.'),
        previa.avisos.map((a) => h('div', { class: 'aviso aviso-aviso rel-aviso-item' }, a))),
      h('fieldset', { class: 'secao' }, h('legend', {}, 'Identificação'),
        h('div', { class: 'grade grade-2' }, Object.values(campos).map((c) => c.elemento))),
      ...SECOES.map(([chave]) => textos[chave].elemento),
      h('fieldset', { class: 'secao' }, h('legend', {}, 'Local, data e assinatura'),
        h('div', { class: 'grade grade-2' }, local.elemento, data.elemento),
        h('p', { class: 'texto-pequeno' }, `Assinatura: ${previa.assinatura.nome} — ${previa.assinatura.cargo}${previa.assinatura.cress ? ` — CRESS ${previa.assinatura.cress}` : ' (CRESS não cadastrado no seu usuário; peça ao administrador para preencher)'}.`)),
      h('div', { class: 'barra-acoes' }, gerar),
    );
  }
}
