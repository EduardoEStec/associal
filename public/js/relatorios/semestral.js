// Relatório Semestral / Prestação de Contas: período + unidades → pré-visualização → editar → gerar .docx.
import { api } from '../api.js';
import { h, toast, carregando, confirmar, formatarData, formatarNumero, comEspera } from '../ui.js';
import { baixarArquivo, campoLinha, campoTexto, alterado, mensagemErro } from './comum.js';

const TEXTOS = [
  ['introducao', '1. Introdução', 7],
  ['atendimentos', '2.1 Atendimentos', 3],
  ['encaminhamentos', '2.2 Encaminhamentos', 4],
  ['visitas', '2.3 Visitas institucionais', 4],
  ['outrasAcoes', '2.4 Outras ações', 3],
  ['empoderamento', '3. Empoderamento econômico', 4],
  ['consideracoes', '4. Considerações finais', 6],
];

const FOTOS_PADRAO_POR_UNIDADE = 4;

function tabelaSimples(cabecalho, linhas, numericas = []) {
  return h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela' },
    h('thead', {}, h('tr', {}, cabecalho.map((t, i) => h('th', { class: numericas.includes(i) ? 'rel-num-col' : '' }, t)))),
    h('tbody', {}, linhas.map((l) => h('tr', {}, l.map((c, i) => h('td', { class: numericas.includes(i) ? 'rel-num-col' : '' }, c ?? '')))))));
}

const numero = (titulo, valor) => h('div', { class: 'rel-numero' }, h('strong', {}, formatarNumero(valor)), h('span', {}, titulo));

export function montarSemestral(raiz, opcoes) {
  const unidadesMarcadas = new Set(opcoes.unidades.map((u) => u.id));
  const periodoIni = campoLinha('Data inicial', { valor: opcoes.semestre.dataInicio, tipo: 'date', nome: 'dataInicio' });
  const periodoFim = campoLinha('Data final', { valor: opcoes.semestre.dataFim, tipo: 'date', nome: 'dataFim' });

  const checks = opcoes.unidades.map((u) => {
    const entrada = h('input', { type: 'checkbox', value: u.id, checked: true });
    entrada.addEventListener('change', () => (entrada.checked ? unidadesMarcadas.add(u.id) : unidadesMarcadas.delete(u.id)));
    return h('label', { class: 'opcao' }, entrada, `${u.sigla} — ${u.nome}`);
  });

  const atualizar = h('button', { type: 'button', class: 'btn' }, 'Atualizar pré-visualização');
  const resultado = h('div', { 'aria-live': 'polite' });
  let estado = null; // { previa, textos, local, data, relatos, fotos } da pré-visualização atual

  atualizar.addEventListener('click', async () => {
    const editou = estado && TEXTOS.some(([k]) => alterado(estado.textos[k].entrada, estado.previa.textos[k]));
    if (editou && !(await confirmar('Atualizar vai descartar as edições de texto feitas abaixo. Continuar?', { textoOk: 'Atualizar' }))) return;
    await comEspera(atualizar, carregar);
  });

  function consulta() {
    const ids = [...unidadesMarcadas];
    return { dataInicio: periodoIni.entrada.value, dataFim: periodoFim.entrada.value, unidadeIds: ids.join(',') };
  }

  async function carregar() {
    if (unidadesMarcadas.size === 0) { toast.aviso('Selecione ao menos uma unidade.'); return; }
    resultado.replaceChildren(carregando());
    try {
      const previa = await api.get('/api/relatorios/semestral/previa', consulta());
      estado = montarResultado(previa);
    } catch (e) {
      estado = null;
      resultado.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, mensagemErro(e)));
    }
  }

  function montarResultado(previa) {
    const t = previa.totais;
    const textos = Object.fromEntries(TEXTOS.map(([k, rotulo, linhas]) => [k, campoTexto(rotulo, previa.textos[k], { linhas, nome: k })]));
    const local = campoLinha('Local', { valor: 'São Paulo/SP', nome: 'local', max: 80 });
    const data = campoLinha('Data do relatório', { valor: opcoes.hoje, tipo: 'date', nome: 'data' });

    // relatos selecionáveis (e editáveis, p.ex. para retirar nomes)
    const relatos = previa.relatos.map((r) => {
      const marcar = h('input', { type: 'checkbox' });
      const texto = h('textarea', { class: 'textarea', rows: '3', maxlength: '3000', 'aria-label': 'Texto do relato' });
      texto.value = r.texto;
      return { id: r.id, marcar, texto, no: h('div', { class: 'rel-relato' },
        h('label', { class: 'rel-relato-cab' }, marcar, h('span', {}, h('strong', {}, r.sigla), ` — ${r.pergunta}`)), texto) };
    });

    // fotos selecionáveis (4 primeiras de cada unidade já marcadas)
    const contagem = new Map();
    const fotos = previa.fotos.map((f) => {
      const n = (contagem.get(f.unidadeId) || 0) + 1;
      contagem.set(f.unidadeId, n);
      const marcar = h('input', { type: 'checkbox', checked: n <= FOTOS_PADRAO_POR_UNIDADE });
      return { id: f.id, marcar, no: h('label', { class: 'rel-foto' },
        h('img', { src: `/api/relatorios/foto/${f.id}`, alt: f.legenda || `Foto de ${f.sigla}`, loading: 'lazy' }),
        h('span', { class: 'rel-foto-info' }, marcar, h('span', {}, `${f.sigla} · ${formatarData(f.data)}`, h('br'), f.legenda || f.local))) };
    });

    const gerar = h('button', { type: 'button', class: 'btn' }, 'Gerar .docx');
    gerar.addEventListener('click', () => comEspera(gerar, async () => {
      try {
        const nome = await baixarArquivo('/api/relatorios/semestral', {
          metodo: 'POST',
          corpo: {
            ...consulta(),
            unidadeIds: [...unidadesMarcadas],
            textos: Object.fromEntries(Object.entries(textos).map(([k, c]) => [k, c.entrada.value])),
            relatos: relatos.filter((r) => r.marcar.checked).map((r) => ({ id: r.id, texto: r.texto.value })),
            fotos: fotos.filter((f) => f.marcar.checked).map((f) => f.id),
            local: local.entrada.value,
            data: data.entrada.value,
          },
        });
        toast.sucesso(`Relatório gerado: ${nome}`);
      } catch (e) {
        toast.erro(mensagemErro(e));
      }
    }));

    const alternar = (lista, valor) => lista.forEach((i) => { i.marcar.checked = valor; });
    const selecionarPadrao = () => {
      const c = new Map();
      previa.fotos.forEach((f, i) => {
        const n = (c.get(f.unidadeId) || 0) + 1;
        c.set(f.unidadeId, n);
        fotos[i].marcar.checked = n <= FOTOS_PADRAO_POR_UNIDADE;
      });
    };

    resultado.replaceChildren(h('div', {},
      h('div', { class: 'rel-numeros' },
        numero('atendimentos', t.atendimentos), numero('encaminhamentos', t.encaminhamentos),
        numero('visitas realizadas', t.visitas), numero('outras ações', t.outrasAcoes),
        numero('famílias acompanhadas', t.familias), numero('famílias com inicial × final', t.pares)),
      t.atendimentos === 0 && t.visitas === 0 && t.familias === 0
        ? h('div', { class: 'aviso aviso-aviso' }, 'Não há registros no período e unidades selecionados.') : null,

      h('div', { class: 'rel-bloco' }, h('h3', {}, 'Atendimentos e encaminhamentos por unidade'),
        tabelaSimples(['Unidade', 'Atendimentos', 'Encaminhamentos', 'Atend. com encaminhamento'],
          previa.atendimentosPorUnidade.map((u) => [u.nome, formatarNumero(u.atendimentos), formatarNumero(u.encaminhamentos), formatarNumero(u.atendimentosComEncaminhamento)]), [1, 2, 3])),
      previa.encaminhamentosPorInstituicao.length ? h('div', { class: 'rel-bloco' }, h('h3', {}, 'Encaminhamentos por instituição'),
        tabelaSimples(['Instituição / serviço', 'Quantidade'], previa.encaminhamentosPorInstituicao.map((i) => [i.nome, formatarNumero(i.quantidade)]), [1])) : null,
      h('div', { class: 'rel-bloco' }, h('h3', {}, 'Visitas realizadas por unidade'),
        tabelaSimples(['Unidade', 'Visitas', 'Instituições visitadas'],
          previa.visitasPorUnidade.map((u) => [u.nome, formatarNumero(u.quantidade), u.itens.map((i) => i.local).filter(Boolean).join('; ')]), [1])),
      previa.comparacao.pares > 0 ? h('div', { class: 'rel-bloco' }, h('h3', {}, `Comparação inicial × final (${previa.comparacao.pares} famílias)`),
        tabelaSimples(['Indicador', 'Inicial', 'Final'], previa.comparacao.indicadores.map((i) => [i.rotulo, i.inicial, i.final]), [1, 2])) : null,

      h('h2', { class: 'rel-passo-titulo' }, 'Textos do relatório'),
      h('p', { class: 'texto-pequeno' }, 'Textos sugeridos com base nos números acima; edite livremente. As tabelas são geradas automaticamente no documento.'),
      ...TEXTOS.map(([k]) => textos[k].elemento),

      h('h2', { class: 'rel-passo-titulo' }, `Relatos das famílias (${relatos.length})`),
      relatos.length
        ? h('div', {},
          h('p', { class: 'texto-pequeno' }, 'Marque os relatos que entram no relatório. Os relatos aparecem só com a sigla da unidade; revise o texto e retire qualquer informação que identifique a família.'),
          h('div', { class: 'barra-acoes rel-barra-topo' },
            h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', onclick: () => alternar(relatos, true) }, 'Marcar todos'),
            h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', onclick: () => alternar(relatos, false) }, 'Desmarcar todos')),
          relatos.map((r) => r.no))
        : h('p', { class: 'texto-pequeno' }, 'Nenhum relato disponível (é necessário ter questionário final concluído no período).'),

      h('h2', { class: 'rel-passo-titulo' }, `Anexo de fotos (${fotos.length} disponíveis)`),
      fotos.length
        ? h('div', {},
          h('p', { class: 'texto-pequeno' }, `Marque as fotos de ações realizadas que vão no anexo, agrupadas por unidade (máximo de 60 por relatório). Já marcamos as ${FOTOS_PADRAO_POR_UNIDADE} primeiras de cada unidade. Imagens em WebP aparecem só como legenda no documento.`),
          h('div', { class: 'barra-acoes rel-barra-topo' },
            h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', onclick: selecionarPadrao }, `Marcar ${FOTOS_PADRAO_POR_UNIDADE} por unidade`),
            h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', onclick: () => alternar(fotos, false) }, 'Desmarcar todas')),
          h('div', { class: 'rel-fotos' }, fotos.map((f) => f.no)))
        : h('p', { class: 'texto-pequeno' }, 'Nenhuma foto de ação realizada no período.'),

      h('fieldset', { class: 'secao' }, h('legend', {}, 'Local, data e assinatura'),
        h('div', { class: 'grade grade-2' }, local.elemento, data.elemento),
        h('p', { class: 'texto-pequeno' }, `Assinatura: ${opcoes.usuario.nome}${opcoes.usuario.cress ? ` — CRESS ${opcoes.usuario.cress}` : ' (CRESS não cadastrado no seu usuário)'}.`)),
      h('div', { class: 'barra-acoes' }, gerar),
    ));
    return { previa, textos };
  }

  raiz.replaceChildren(
    h('div', { class: 'card rel-filtros' },
      h('h2', { class: 'rel-passo-titulo' }, 'Período e unidades'),
      h('div', { class: 'grade grade-2' }, periodoIni.elemento, periodoFim.elemento),
      h('div', { class: 'campo' }, h('span', { class: 'rotulo' }, opcoes.unidades.length > 1 ? 'Unidades' : 'Unidade'),
        h('div', { class: 'rel-unidades' }, checks),
        opcoes.consolidaTodas ? h('span', { class: 'ajuda' }, 'Com todas as unidades marcadas, o relatório é consolidado.') : null),
      h('div', { class: 'barra-acoes' }, atualizar)),
    resultado,
  );
  carregar();
}
