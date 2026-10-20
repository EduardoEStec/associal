// Atendimentos — detalhe (somente leitura) com histórico da pessoa nas unidades permitidas.
import { api } from '../api.js';
import { h, toast, confirmar, carregando, formatarData, formatarCpf, formatarCep } from '../ui.js';

const nomeDe = (lista, id) => lista.find((o) => o.id === id)?.nome || '';

function par(rotulo, valor) {
  return [h('dt', {}, rotulo), h('dd', {}, valor || '—')];
}

function listaComOutra(lista, ids, outra) {
  const nomes = ids.map((id) => nomeDe(lista, id));
  if (outra) nomes.push(`Detalhe: ${outra}`);
  return nomes.join('; ');
}

export async function renderDetalhe({ conteudo, apoio }, id) {
  conteudo.replaceChildren(carregando());
  const a = await api.get(`/api/atendimentos/${id}`);
  const p = a.pessoa;

  async function excluir() {
    if (!await confirmar('Excluir este atendimento? Essa ação não pode ser desfeita.', { perigo: true, textoOk: 'Excluir' })) return;
    try {
      await api.delete(`/api/atendimentos/${id}`);
      toast.sucesso('Atendimento excluído.');
      location.hash = '';
    } catch (e) {
      toast.erro(e.message);
    }
  }

  conteudo.replaceChildren(
    h('div', { class: 'pagina-titulo' },
      h('h1', {}, 'Atendimento'),
      h('a', { class: 'btn btn-secundario', href: '#' }, 'Voltar à lista')),
    h('div', { class: 'card atend-detalhe' },
      h('h2', {}, p.nome),
      h('dl', {},
        ...par('Data do atendimento', formatarData(a.dataAtendimento)),
        ...par('Unidade', `${a.unidadeSigla} — ${a.unidadeNome}`),
        ...par('Atendido por', a.atendente),
        ...par('CPF', p.cpf ? formatarCpf(p.cpf) : ''),
        ...par('Data de nascimento', formatarData(p.dataNascimento)),
        ...par('Nº CadÚnico (NIS)', p.nis),
        ...par('Endereço', [p.endereco, p.bairro, p.cep ? formatarCep(p.cep) : ''].filter(Boolean).join(' · ')),
        ...par('Trabalho atual', p.trabalhoAtual),
        ...par('Faixa etária', nomeDe(apoio.faixaEtaria, a.faixaEtariaId)),
        ...par('Gênero', nomeDe(apoio.genero, p.generoId)),
        ...par('Escolaridade', nomeDe(apoio.escolaridade, p.escolaridadeId)),
        ...par('Raça/etnia', nomeDe(apoio.raca, p.racaId)),
        ...par('Nível de vulnerabilidade', nomeDe(apoio.nivelVulnerabilidade, a.nivelVulnerabilidadeId)),
        ...par('Demandas', listaComOutra(apoio.demanda, a.demandas, a.demandaOutra)),
        ...par('Vulnerabilidades/riscos', listaComOutra(apoio.vulnerabilidade, a.vulnerabilidades, a.vulnerabilidadeOutra)),
        ...par('Encaminhamentos', listaComOutra(apoio.encaminhamento, a.encaminhamentos, a.encaminhamentoOutro)),
        ...par('Resumo do atendimento', a.resumo),
      ),
      h('div', { class: 'barra-acoes' },
        a.podeExcluir ? h('button', { type: 'button', class: 'btn btn-perigo', onclick: excluir }, 'Excluir') : null,
        a.podeEditar ? h('a', { class: 'btn', href: `#${id}/editar` }, 'Editar') : null),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Outros atendimentos desta pessoa'),
      a.historico.length
        ? h('ul', { class: 'atend-historico' }, ...a.historico.map((x) => h('li', {},
          h('a', { href: `#${x.id}` }, formatarData(x.dataAtendimento)), ` · ${x.unidadeSigla}`,
          x.demandas ? h('div', { class: 'texto-pequeno' }, x.demandas) : null)))
        : h('p', { class: 'texto-pequeno' }, 'Nenhum outro atendimento registrado nas suas unidades.'),
    ),
  );
}
