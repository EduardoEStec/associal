'use strict';

// Questionário familiar (INICIAL / FINAL): modelo das perguntas, validação das respostas e
// comparação inicial × final. Tudo aqui é puro (sem acesso a banco) para ser testável.
//
// Fonte única das perguntas: a tela busca o modelo em GET /api/familias/questionario/modelo,
// então texto, ordem e opções vivem só neste arquivo (+ server/lib/dominios.js).

const { QUESTIONARIO } = require('../lib/dominios');
const { normalizarData, texto } = require('../lib/validacao');

const MAX_TEXTO = 4000;
const MAX_TEXTO_CURTO = 200;

// Ordem das opções do PIOR para o MELHOR (usada na comparação e na ordem exibida invertida).
const ESCALAS = Object.freeze({
  acessoAlimentosInNatura: ['NAO_TINHA', 'SEMANAL_1_2', 'SEMANAL_2_3', 'DIARIO'],
  frequenciaFrutasVerduras: ['UMA_DUAS', 'TRES_QUATRO', 'CINCO_OU_MAIS'],
  qualidadeAlimentacao: ['PIOROU', 'NAO_MELHOROU', 'MELHOROU_POUCO', 'MELHOROU_MUITO'],
  saudeNutricional: ['NENHUMA', 'PEQUENA_MELHORIA', 'GRANDE_MELHORIA'],
  economiaMensalFaixa: ['ATE_100', 'DE_101_200', 'DE_201_300', 'ACIMA_300'],
  capacidadePoupanca: ['NAO_CONSEGUE', 'AS_VEZES', 'REGULARMENTE'],
  gestaoFinanceira: ['PIOROU', 'SEM_MUDANCA', 'MELHOROU'],
  avaliacaoArmazem: ['RUIM', 'REGULAR', 'BOA', 'OTIMA'],
});

// Faixas de economia: limite superior (inclusive) e inferior (exclusive) em R$.
const LIMITES_FAIXA = Object.freeze({
  ATE_100: [-Infinity, 100],
  DE_101_200: [100, 200],
  DE_201_300: [200, 300],
  ACIMA_300: [300, Infinity],
});

// tipo: numero | moeda | booleano | escolha | multipla | texto
// maisMelhor: para numero/moeda/booleano, true => aumentar (ou "sim") é melhora; ausente => neutro.
const BLOCOS = [
  {
    numero: 1,
    titulo: 'Dados da família',
    perguntas: [
      {
        campo: 'qtdMembrosFamilia', codigo: '1a', tipo: 'numero', min: 1, max: 30,
        textoInicial: 'Quantas pessoas compõem a família (contando com o responsável)?',
        textoFinal: 'Hoje, quantas pessoas compõem a família (contando com o responsável)?',
      },
      {
        campo: 'rendaMensalMedia', codigo: '1b', tipo: 'moeda', maisMelhor: true,
        textoInicial: 'Qual é a renda mensal média da família (R$)?',
        textoFinal: 'Hoje, qual é a renda mensal média da família (R$)?',
      },
      {
        campo: 'qtdMembrosComRenda', codigo: '1c', tipo: 'numero', min: 0, max: 30, maisMelhor: true,
        textoInicial: 'Quantas pessoas da família têm renda?',
        textoFinal: 'Hoje, quantas pessoas da família têm renda?',
      },
      {
        campo: 'recebeAuxilio', codigo: '1d', tipo: 'booleano',
        textoInicial: 'A família recebe algum auxílio governamental?',
        textoFinal: 'Hoje, a família recebe algum auxílio governamental?',
        detalhe: { campo: 'beneficioIds', apoio: 'beneficio', campoOutro: 'auxilioOutro', rotulo: 'Qual(is) auxílio(s)?' },
      },
    ],
  },
  {
    numero: 2,
    titulo: 'Alimentação',
    perguntas: [
      {
        campo: 'acessoAlimentosInNatura', codigo: '2a', tipo: 'escolha',
        textoInicial: 'Com que frequência a família tem acesso a alimentos in natura (frutas, verduras e legumes)?',
        textoFinal: 'Hoje, com que frequência a família tem acesso a alimentos in natura (frutas, verduras e legumes)?',
        rotulosFinal: { NAO_TINHA: 'Não tem acesso' },
      },
      {
        campo: 'frequenciaFrutasVerduras', codigo: '2b', tipo: 'escolha',
        textoInicial: 'Com que frequência a família consome frutas, verduras e legumes?',
        textoFinal: 'Hoje, com que frequência a família consome frutas, verduras e legumes?',
      },
      {
        campo: 'qualidadeAlimentacao', codigo: '2c', tipo: 'escolha',
        textoInicial: 'Como está a qualidade da alimentação da família?',
        textoFinal: 'Como ficou a qualidade da alimentação da família?',
        ajudaInicial: 'No questionário inicial, registre a percepção atual da família (ex.: "Não melhorou" se está igual).',
      },
      {
        campo: 'saudeNutricional', codigo: '2d', tipo: 'escolha',
        textoInicial: 'Como está a saúde e o bem-estar nutricional da família?',
        textoFinal: 'Houve melhoria na saúde e no bem-estar nutricional da família?',
        ajudaInicial: 'No questionário inicial, registre a percepção atual da família.',
      },
    ],
  },
  {
    numero: 3,
    titulo: 'Economia da família',
    perguntas: [
      {
        campo: 'conseguePoupar', codigo: '3a', tipo: 'booleano', maisMelhor: true,
        textoInicial: 'A família consegue poupar?',
        textoFinal: 'Hoje, a família consegue poupar?',
      },
      {
        campo: 'economiaMensalFaixa', codigo: '3b', tipo: 'escolha',
        textoInicial: 'Quanto a família economiza por mês comprando no Armazém Solidário?',
        textoFinal: 'Hoje, quanto a família economiza por mês comprando no Armazém Solidário?',
        detalhe: { campo: 'economiaMensalValor', tipo: 'moeda', rotulo: 'Valor aproximado da economia (R$)' },
      },
      {
        campo: 'destinoEconomiaIds', codigo: '3c', tipo: 'multipla', apoio: 'destino_economia', campoOutro: 'destinoEconomiaOutro',
        textoInicial: 'Para onde vai o dinheiro economizado?',
        textoFinal: 'Hoje, para onde vai o dinheiro economizado?',
      },
      {
        campo: 'capacidadePoupanca', codigo: '3d', tipo: 'escolha',
        textoInicial: 'Qual é a capacidade de poupança da família?',
        textoFinal: 'Hoje, qual é a capacidade de poupança da família?',
      },
      {
        campo: 'gestaoFinanceira', codigo: '3e', tipo: 'escolha',
        textoInicial: 'Como está a situação de dívidas e a gestão financeira da família?',
        textoFinal: 'Como ficou a situação de dívidas e a gestão financeira da família?',
        ajudaInicial: 'No questionário inicial, registre a percepção atual (ex.: "Sem mudança" se está estável).',
      },
    ],
  },
  {
    numero: 4,
    titulo: 'Empoderamento',
    perguntas: [
      {
        campo: 'empoderadaDecisoes', codigo: '4a', tipo: 'booleano', maisMelhor: true,
        textoInicial: 'Você se sente mais empoderada(o) para tomar decisões?',
        textoFinal: 'Hoje, você se sente mais empoderada(o) para tomar decisões?',
      },
      {
        campo: 'contribuicaoAutonomia', codigo: '4b', tipo: 'texto',
        textoInicial: 'Como o Armazém Solidário pode contribuir para a autonomia financeira da família?',
        textoFinal: 'Como o Armazém Solidário contribuiu para a autonomia financeira da família?',
      },
      {
        campo: 'melhoriaPlanejamento', codigo: '4c', tipo: 'booleano', maisMelhor: true,
        textoInicial: 'A família consegue planejar melhor os seus gastos?',
        textoFinal: 'Hoje, houve melhoria no planejamento dos gastos da família?',
      },
      {
        campo: 'impactoComunidade', codigo: '4d', tipo: 'texto',
        textoInicial: 'Qual impacto o Armazém Solidário pode ter na comunidade?',
        textoFinal: 'Qual impacto o Armazém Solidário teve na comunidade?',
      },
      {
        campo: 'oQueMelhorar', codigo: '4e', tipo: 'texto',
        textoInicial: 'O que poderia melhorar no Armazém Solidário?',
        textoFinal: 'O que ainda pode melhorar no Armazém Solidário?',
      },
    ],
  },
  {
    numero: 5,
    titulo: 'Percepção sobre o Armazém',
    perguntas: [
      {
        campo: 'avaliacaoArmazem', codigo: '5a', tipo: 'escolha',
        textoInicial: 'Como a família avalia o Armazém Solidário?',
        textoFinal: 'Hoje, como a família avalia o Armazém Solidário?',
      },
      {
        campo: 'principalBeneficio', codigo: '5b', tipo: 'texto',
        textoInicial: 'Qual é o principal benefício do Armazém Solidário para a família?',
        textoFinal: 'Qual foi o principal benefício do Armazém Solidário para a família?',
      },
      {
        campo: 'recomendaria', codigo: '5c', tipo: 'booleano', maisMelhor: true,
        textoInicial: 'A família recomendaria o Armazém Solidário?',
        textoFinal: 'A família recomendaria o Armazém Solidário?',
      },
    ],
  },
];

const PERGUNTAS = BLOCOS.flatMap((b) => b.perguntas.map((p) => ({ ...p, bloco: b.numero })));

// Colunas escalares de dbo.questionario (campo da API -> coluna) — fora data/concluido.
const COLUNAS = Object.freeze({
  qtdMembrosFamilia: 'qtd_membros_familia',
  rendaMensalMedia: 'renda_mensal_media',
  qtdMembrosComRenda: 'qtd_membros_com_renda',
  recebeAuxilio: 'recebe_auxilio',
  auxilioOutro: 'auxilio_outro',
  acessoAlimentosInNatura: 'acesso_alimentos_in_natura',
  frequenciaFrutasVerduras: 'frequencia_frutas_verduras',
  qualidadeAlimentacao: 'qualidade_alimentacao',
  saudeNutricional: 'saude_nutricional',
  conseguePoupar: 'consegue_poupar',
  economiaMensalFaixa: 'economia_mensal_faixa',
  economiaMensalValor: 'economia_mensal_valor',
  destinoEconomiaOutro: 'destino_economia_outro',
  capacidadePoupanca: 'capacidade_poupanca',
  gestaoFinanceira: 'gestao_financeira',
  empoderadaDecisoes: 'empoderada_decisoes',
  contribuicaoAutonomia: 'contribuicao_autonomia',
  melhoriaPlanejamento: 'melhoria_planejamento',
  impactoComunidade: 'impacto_comunidade',
  oQueMelhorar: 'o_que_melhorar',
  avaliacaoArmazem: 'avaliacao_armazem',
  principalBeneficio: 'principal_beneficio',
  recomendaria: 'recomendaria',
});

const CAMPOS_BOOLEANOS = ['recebeAuxilio', 'conseguePoupar', 'empoderadaDecisoes', 'melhoriaPlanejamento', 'recomendaria'];
const CAMPOS_ESCOLHA = Object.keys(ESCALAS);
const CAMPOS_TEXTO = ['contribuicaoAutonomia', 'impactoComunidade', 'oQueMelhorar', 'principalBeneficio'];

// Modelo entregue à tela: textos conforme o tipo (INICIAL "como está" / FINAL "hoje").
function montarModelo(tipo) {
  const final = tipo === 'FINAL';
  return {
    tipo,
    blocos: BLOCOS.map((b) => ({
      numero: b.numero,
      titulo: b.titulo,
      perguntas: b.perguntas.map((p) => {
        const saida = {
          campo: p.campo,
          codigo: p.codigo,
          tipo: p.tipo,
          texto: final ? p.textoFinal : p.textoInicial,
          ajuda: final ? null : p.ajudaInicial || null,
          min: p.min,
          max: p.max,
          apoio: p.apoio,
          campoOutro: p.campoOutro,
          detalhe: p.detalhe,
        };
        if (p.tipo === 'escolha') {
          const rotulos = { ...QUESTIONARIO[p.campo], ...(final ? p.rotulosFinal : null) };
          saida.opcoes = ESCALAS[p.campo].map((valor) => ({ valor, rotulo: rotulos[valor] }));
        }
        return saida;
      }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function paraNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function paraBooleano(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v === true || v === 'true' || v === 1 || v === 'sim') return true;
  if (v === false || v === 'false' || v === 0 || v === 'nao' || v === 'não') return false;
  return undefined; // inválido
}

function listaDeIds(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const ids = v.map(Number);
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  return [...new Set(ids)];
}

// Normaliza e valida o corpo do PUT do questionário. NÃO consulta o banco: a checagem de
// existência das opções de apoio (beneficioIds/destinoEconomiaIds) é feita pelo service.
// `concluir`: exige as respostas fechadas. Retorna { valores, beneficioIds, destinoEconomiaIds, erros }.
function validarRespostas(corpo, { concluir, hoje }) {
  const erros = {};
  const origem = corpo && typeof corpo === 'object' ? corpo : {};
  const v = {};

  // Data de aplicação
  const data = normalizarData(origem.dataAplicacao || hoje);
  if (data === undefined) erros.dataAplicacao = 'Informe uma data válida.';
  else if (data > hoje) erros.dataAplicacao = 'A data de aplicação não pode ser futura.';
  else v.dataAplicacao = data;

  // Inteiros
  for (const p of PERGUNTAS.filter((q) => q.tipo === 'numero')) {
    const n = paraNumero(origem[p.campo]);
    if (Number.isNaN(n) || (n !== null && (!Number.isInteger(n) || n < p.min || n > p.max))) {
      erros[p.campo] = `Informe um número inteiro entre ${p.min} e ${p.max}.`;
    } else v[p.campo] = n;
  }
  if (!erros.qtdMembrosFamilia && !erros.qtdMembrosComRenda
    && v.qtdMembrosFamilia !== null && v.qtdMembrosComRenda !== null
    && v.qtdMembrosComRenda > v.qtdMembrosFamilia) {
    erros.qtdMembrosComRenda = 'Não pode ser maior que o número de pessoas da família.';
  }

  // Valores monetários
  for (const campo of ['rendaMensalMedia', 'economiaMensalValor']) {
    const n = paraNumero(origem[campo]);
    if (Number.isNaN(n) || (n !== null && (n < 0 || n > 99999999.99))) erros[campo] = 'Informe um valor em reais válido (zero ou mais).';
    else v[campo] = n === null ? null : Math.round(n * 100) / 100;
  }

  // Sim/Não
  for (const campo of CAMPOS_BOOLEANOS) {
    const b = paraBooleano(origem[campo]);
    if (b === undefined) erros[campo] = 'Responda sim ou não.';
    else v[campo] = b;
  }

  // Escolhas fechadas (códigos de dominios.js)
  for (const campo of CAMPOS_ESCOLHA) {
    const x = origem[campo];
    if (x === undefined || x === null || x === '') v[campo] = null;
    else if (!ESCALAS[campo].includes(x)) erros[campo] = 'Opção inválida.';
    else v[campo] = x;
  }

  // Textos
  for (const campo of CAMPOS_TEXTO) v[campo] = texto(origem[campo], MAX_TEXTO);
  v.auxilioOutro = texto(origem.auxilioOutro, MAX_TEXTO_CURTO);
  v.destinoEconomiaOutro = texto(origem.destinoEconomiaOutro, MAX_TEXTO_CURTO);

  // Múltipla escolha
  const beneficioIds = listaDeIds(origem.beneficioIds);
  if (beneficioIds === null) erros.beneficioIds = 'Seleção inválida.';
  const destinoEconomiaIds = listaDeIds(origem.destinoEconomiaIds);
  if (destinoEconomiaIds === null) erros.destinoEconomiaIds = 'Seleção inválida.';

  // Coerência economia: valor × faixa
  if (!erros.economiaMensalValor && v.economiaMensalValor !== null && v.economiaMensalFaixa && !erros.economiaMensalFaixa) {
    const [min, max] = LIMITES_FAIXA[v.economiaMensalFaixa];
    if (v.economiaMensalValor <= min || v.economiaMensalValor > max) {
      erros.economiaMensalValor = 'O valor informado não corresponde à faixa de economia escolhida.';
    }
  }

  // Sem auxílio: descarta o detalhamento
  if (v.recebeAuxilio === false) v.auxilioOutro = null;

  if (concluir) {
    const falta = 'Responda esta pergunta para concluir.';
    const obrigatorios = [
      'qtdMembrosFamilia', 'rendaMensalMedia', 'qtdMembrosComRenda', 'recebeAuxilio',
      ...CAMPOS_ESCOLHA, 'conseguePoupar', 'empoderadaDecisoes', 'melhoriaPlanejamento', 'recomendaria',
    ];
    for (const campo of obrigatorios) {
      if (!erros[campo] && (v[campo] === null || v[campo] === undefined)) erros[campo] = falta;
    }
    if (v.recebeAuxilio === true && !erros.beneficioIds && (beneficioIds || []).length === 0) {
      erros.beneficioIds = 'Informe qual(is) auxílio(s) a família recebe.';
    }
    if (!erros.destinoEconomiaIds && (destinoEconomiaIds || []).length === 0) {
      erros.destinoEconomiaIds = 'Informe para onde vai a economia (escolha ao menos uma opção).';
    }
    if (v.economiaMensalFaixa === 'ACIMA_300' && !erros.economiaMensalValor && v.economiaMensalValor === null) {
      erros.economiaMensalValor = 'Informe o valor aproximado da economia.';
    }
  }

  return {
    valores: v,
    beneficioIds: beneficioIds || [],
    destinoEconomiaIds: destinoEconomiaIds || [],
    erros,
  };
}

// Converte a linha do banco (camelCase, vinda de `consultar`) + seleções N:N em "respostas" da API.
function montarRespostas(linha, beneficioIds = [], destinoEconomiaIds = []) {
  const r = {};
  for (const campo of Object.keys(COLUNAS)) {
    const valor = linha ? linha[campo] : null;
    r[campo] = valor === undefined ? null : valor;
  }
  for (const campo of ['rendaMensalMedia', 'economiaMensalValor']) {
    if (r[campo] !== null) r[campo] = Number(r[campo]);
  }
  r.beneficioIds = beneficioIds;
  r.destinoEconomiaIds = destinoEconomiaIds;
  return r;
}

// ---------------------------------------------------------------------------
// Comparação
// ---------------------------------------------------------------------------

const TENDENCIA = Object.freeze({
  MELHOROU: 'melhorou', IGUAL: 'igual', PIOROU: 'piorou', NEUTRO: 'neutro', SEM_DADOS: 'sem_dados',
});

function rotuloEscolha(p, valor, tipo) {
  if (valor === null || valor === undefined) return null;
  const extra = tipo === 'FINAL' ? p.rotulosFinal : null;
  return (extra && extra[valor]) || QUESTIONARIO[p.campo][valor] || valor;
}

function compararValores(p, antes, depois) {
  if (antes === null || antes === undefined || depois === null || depois === undefined) return TENDENCIA.SEM_DADOS;
  if (p.tipo === 'escolha') {
    const escala = ESCALAS[p.campo];
    const d = escala.indexOf(depois) - escala.indexOf(antes);
    return d > 0 ? TENDENCIA.MELHOROU : d < 0 ? TENDENCIA.PIOROU : TENDENCIA.IGUAL;
  }
  if (p.tipo === 'texto' || p.tipo === 'multipla') return TENDENCIA.NEUTRO;
  const a = Number(antes);
  const b = Number(depois);
  if (a === b) return TENDENCIA.IGUAL;
  if (!p.maisMelhor) return TENDENCIA.NEUTRO; // mudou, mas sem juízo de valor (ex.: nº de pessoas, auxílio)
  return b > a ? TENDENCIA.MELHOROU : TENDENCIA.PIOROU;
}

const arredondar = (n) => Math.round(n * 100) / 100;

// Comparação de UMA família. `inicial` e `final` são as "respostas" (montarRespostas).
// `nomesApoio`: { beneficio: {id: nome}, destino_economia: {id: nome} } para exibir as múltiplas.
function compararFamilia(inicial, final, nomesApoio = {}) {
  const itens = [];
  const resumo = { melhorou: 0, igual: 0, piorou: 0, neutro: 0, semDados: 0, comparaveis: 0 };

  for (const p of PERGUNTAS) {
    const a = inicial[p.campo];
    const d = final[p.campo];
    let item;

    if (p.tipo === 'multipla') {
      const nomes = (ids, mapa) => (ids || []).map((id) => mapa[id] || `#${id}`);
      const mapa = nomesApoio[p.apoio] || {};
      item = {
        campo: p.campo, codigo: p.codigo, bloco: p.bloco, tipo: p.tipo, pergunta: p.textoFinal,
        inicial: nomes(inicial[p.campo], mapa), final: nomes(final[p.campo], mapa),
        tendencia: TENDENCIA.NEUTRO,
      };
      const outroCampo = p.campoOutro;
      if (outroCampo) { item.inicialOutro = inicial[outroCampo]; item.finalOutro = final[outroCampo]; }
    } else {
      const tendencia = compararValores(p, a, d);
      item = {
        campo: p.campo, codigo: p.codigo, bloco: p.bloco, tipo: p.tipo, pergunta: p.textoFinal,
        inicial: a, final: d, tendencia,
      };
      if (p.tipo === 'escolha') {
        item.inicialRotulo = rotuloEscolha(p, a, 'INICIAL');
        item.finalRotulo = rotuloEscolha(p, d, 'FINAL');
      }
      if ((p.tipo === 'numero' || p.tipo === 'moeda') && a !== null && d !== null) {
        item.variacao = arredondar(d - a);
        item.variacaoPercentual = a !== 0 ? arredondar(((d - a) / a) * 100) : null;
      }
      if (p.campo === 'recebeAuxilio') {
        const mapa = nomesApoio.beneficio || {};
        item.detalheInicial = (inicial.beneficioIds || []).map((id) => mapa[id] || `#${id}`);
        item.detalheFinal = (final.beneficioIds || []).map((id) => mapa[id] || `#${id}`);
        item.inicialOutro = inicial.auxilioOutro;
        item.finalOutro = final.auxilioOutro;
      }
      if (p.campo === 'economiaMensalFaixa') {
        item.inicialValor = inicial.economiaMensalValor;
        item.finalValor = final.economiaMensalValor;
      }
    }

    itens.push(item);
    if (item.tendencia === TENDENCIA.MELHOROU) resumo.melhorou += 1;
    else if (item.tendencia === TENDENCIA.IGUAL) resumo.igual += 1;
    else if (item.tendencia === TENDENCIA.PIOROU) resumo.piorou += 1;
    else if (item.tendencia === TENDENCIA.SEM_DADOS) resumo.semDados += 1;
    else resumo.neutro += 1;
  }
  resumo.comparaveis = resumo.melhorou + resumo.igual + resumo.piorou;

  const variacao = (campo) => {
    const a = inicial[campo];
    const d = final[campo];
    if (a === null || d === null || a === undefined || d === undefined) return null;
    return { antes: a, depois: d, variacao: arredondar(d - a), variacaoPercentual: a !== 0 ? arredondar(((d - a) / a) * 100) : null };
  };

  return {
    itens,
    resumo,
    renda: variacao('rendaMensalMedia'),
    economia: variacao('economiaMensalValor'),
    passouAPoupar: inicial.conseguePoupar === false && final.conseguePoupar === true,
  };
}

// Comparação CONSOLIDADA. `pares`: [{ inicial, final }] (respostas já montadas, ambos concluídos).
// `nomesApoio`: como em compararFamilia. Devolve estatísticas para o relatório semestral.
function consolidarComparacao(pares, nomesApoio = {}) {
  const total = pares.length;
  const perguntas = [];

  const media = (valores) => {
    const v = valores.filter((x) => x !== null && x !== undefined);
    return v.length ? arredondar(v.reduce((s, x) => s + Number(x), 0) / v.length) : null;
  };

  for (const p of PERGUNTAS) {
    if (p.tipo === 'texto') continue; // respostas abertas ficam na comparação individual

    const base = { campo: p.campo, codigo: p.codigo, bloco: p.bloco, tipo: p.tipo, pergunta: p.textoFinal };

    if (p.tipo === 'multipla') {
      const mapa = nomesApoio[p.apoio] || {};
      const contar = (lado) => {
        const cont = {};
        for (const par of pares) for (const id of par[lado][p.campo] || []) cont[id] = (cont[id] || 0) + 1;
        return Object.entries(cont)
          .map(([id, n]) => ({ id: Number(id), nome: mapa[id] || `#${id}`, familias: n }))
          .sort((x, y) => y.familias - x.familias || x.nome.localeCompare(y.nome, 'pt-BR'));
      };
      perguntas.push({ ...base, antes: contar('inicial'), depois: contar('final') });
      continue;
    }

    if (p.tipo === 'escolha') {
      const distribuicao = (lado, tipo) => {
        const cont = Object.fromEntries(ESCALAS[p.campo].map((c) => [c, 0]));
        let semResposta = 0;
        for (const par of pares) {
          const valor = par[lado][p.campo];
          if (valor === null || valor === undefined) semResposta += 1;
          else cont[valor] += 1;
        }
        return {
          opcoes: ESCALAS[p.campo].map((c) => ({
            valor: c, rotulo: rotuloEscolha(p, c, tipo), familias: cont[c],
            percentual: total ? arredondar((cont[c] / total) * 100) : 0,
          })),
          semResposta,
        };
      };
      perguntas.push({ ...base, antes: distribuicao('inicial', 'INICIAL'), depois: distribuicao('final', 'FINAL'), ...contarTendencias(p, pares) });
      continue;
    }

    if (p.tipo === 'booleano') {
      const contar = (lado) => {
        let sim = 0; let nao = 0; let sem = 0;
        for (const par of pares) {
          const valor = par[lado][p.campo];
          if (valor === true) sim += 1; else if (valor === false) nao += 1; else sem += 1;
        }
        return { sim, nao, semResposta: sem, percentualSim: total ? arredondar((sim / total) * 100) : 0 };
      };
      perguntas.push({ ...base, antes: contar('inicial'), depois: contar('final'), ...contarTendencias(p, pares) });
      continue;
    }

    // numero | moeda
    const ant = pares.map((x) => x.inicial[p.campo]);
    const dep = pares.map((x) => x.final[p.campo]);
    const mA = media(ant);
    const mD = media(dep);
    perguntas.push({
      ...base,
      antes: { media: mA },
      depois: { media: mD },
      variacaoMedia: mA !== null && mD !== null ? arredondar(mD - mA) : null,
      variacaoPercentual: mA ? arredondar(((mD - mA) / mA) * 100) : null,
      ...contarTendencias(p, pares),
    });
  }

  const porCampo = Object.fromEntries(perguntas.map((q) => [q.campo, q]));
  const poupou = (lado) => pares.filter((x) => x[lado].conseguePoupar === true).length;
  const naoPoupavamAntes = pares.filter((x) => x.inicial.conseguePoupar === false);
  const passaramAPoupar = naoPoupavamAntes.filter((x) => x.final.conseguePoupar === true).length;

  return {
    totalFamilias: total,
    perguntas,
    destaques: {
      rendaMedia: porCampo.rendaMensalMedia
        ? { antes: porCampo.rendaMensalMedia.antes.media, depois: porCampo.rendaMensalMedia.depois.media,
          variacao: porCampo.rendaMensalMedia.variacaoMedia, variacaoPercentual: porCampo.rendaMensalMedia.variacaoPercentual }
        : null,
      economiaMedia: porCampo.economiaMensalFaixa
        ? mediaEconomia(pares, media)
        : null,
      poupanca: {
        antes: poupou('inicial'),
        depois: poupou('final'),
        percentualAntes: total ? arredondar((poupou('inicial') / total) * 100) : 0,
        percentualDepois: total ? arredondar((poupou('final') / total) * 100) : 0,
        naoPoupavamAntes: naoPoupavamAntes.length,
        passaramAPoupar,
        percentualPassaramAPoupar: naoPoupavamAntes.length ? arredondar((passaramAPoupar / naoPoupavamAntes.length) * 100) : null,
      },
    },
  };
}

function mediaEconomia(pares, media) {
  const a = media(pares.map((x) => x.inicial.economiaMensalValor));
  const d = media(pares.map((x) => x.final.economiaMensalValor));
  return {
    antes: a, depois: d,
    variacao: a !== null && d !== null ? arredondar(d - a) : null,
    variacaoPercentual: a ? arredondar(((d - a) / a) * 100) : null,
  };
}

function contarTendencias(p, pares) {
  const t = { melhoraram: 0, iguais: 0, pioraram: 0, semDados: 0 };
  for (const par of pares) {
    const r = compararValores(p, par.inicial[p.campo], par.final[p.campo]);
    if (r === TENDENCIA.MELHOROU) t.melhoraram += 1;
    else if (r === TENDENCIA.PIOROU) t.pioraram += 1;
    else if (r === TENDENCIA.IGUAL) t.iguais += 1;
    else if (r === TENDENCIA.SEM_DADOS) t.semDados += 1;
    // NEUTRO (mudou, mas sem juízo de valor) não entra em nenhum contador
  }
  return t;
}

module.exports = {
  BLOCOS,
  PERGUNTAS,
  ESCALAS,
  COLUNAS,
  TENDENCIA,
  montarModelo,
  validarRespostas,
  montarRespostas,
  compararFamilia,
  consolidarComparacao,
};
