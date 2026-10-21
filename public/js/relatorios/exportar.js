// Exportação CSV (separador ";" + BOM UTF-8, abre direto no Excel) — transição das planilhas BS_ATENDIMENTO e BASE_UNICA_ACOES.
import { h, toast, comEspera } from '../ui.js';
import { baixarArquivo, campoLinha, mensagemErro } from './comum.js';

export function montarExportar(raiz, opcoes) {
  const ini = campoLinha('Data inicial', { valor: opcoes.semestre.dataInicio, tipo: 'date', nome: 'dataInicio' });
  const fim = campoLinha('Data final', { valor: opcoes.semestre.dataFim, tipo: 'date', nome: 'dataFim' });
  const marcadas = new Set(opcoes.unidades.map((u) => u.id));

  const checks = opcoes.unidades.map((u) => {
    const entrada = h('input', { type: 'checkbox', value: u.id, checked: true });
    entrada.addEventListener('change', () => (entrada.checked ? marcadas.add(u.id) : marcadas.delete(u.id)));
    return h('label', { class: 'opcao' }, entrada, `${u.sigla} — ${u.nome}`);
  });

  function botao(texto, caminho, descricao) {
    const b = h('button', { type: 'button', class: 'btn btn-secundario' }, texto);
    b.addEventListener('click', () => comEspera(b, async () => {
      if (marcadas.size === 0) { toast.aviso('Selecione ao menos uma unidade.'); return; }
      try {
        const nome = await baixarArquivo(caminho, {
          consulta: { dataInicio: ini.entrada.value, dataFim: fim.entrada.value, unidadeIds: [...marcadas].join(',') },
        });
        toast.sucesso(`Arquivo gerado: ${nome}`);
      } catch (e) {
        toast.erro(mensagemErro(e));
      }
    }));
    return h('div', { class: 'card' }, h('h3', { class: 'rel-passo-titulo' }, texto), h('p', { class: 'texto-pequeno' }, descricao), h('div', { class: 'barra-acoes rel-barra-topo' }, b));
  }

  raiz.replaceChildren(
    h('div', { class: 'card rel-filtros' },
      h('h2', { class: 'rel-passo-titulo' }, 'Período e unidades'),
      h('div', { class: 'grade grade-2' }, ini.elemento, fim.elemento),
      h('div', { class: 'campo' }, h('span', { class: 'rotulo' }, opcoes.unidades.length > 1 ? 'Unidades' : 'Unidade'), h('div', { class: 'rel-unidades' }, checks))),
    botao('Resumo mensal por unidade (CSV)', '/api/relatorios/exportar/atendimentos.csv',
      'Equivale à aba BS_ATENDIMENTO: por unidade e mês, atendimentos, ações, participantes, famílias acompanhadas, total de atendimento e % de encaminhamentos. Não contém dados pessoais.'),
    botao('Ações e visitas (CSV)', '/api/relatorios/exportar/acoes.csv',
      'Equivale à aba BASE_UNICA_ACOES: uma linha por ação/visita, com local, endereço, até 4 temas, status e participantes.'),
    ...(opcoes.usuario.perfil === 'ASSISTENTE' ? [] : [
      botao('Progresso das famílias (CSV)', '/api/relatorios/exportar/progresso.csv',
        'Famílias que melhoraram, ficaram iguais ou pioraram no índice de progresso, geral e por dimensão, no total e por unidade. Abaixo do n mínimo não há percentual. Não contém dados pessoais.'),
      botao('Satisfação das famílias (CSV)', '/api/relatorios/exportar/satisfacao.csv',
        'Respostas e recusas da pesquisa de satisfação, nota geral (NPS), satisfação, concordância, taxas e situação do semáforo, no total e por unidade. Não contém comentários nem dados pessoais.'),
    ]),
  );
}
