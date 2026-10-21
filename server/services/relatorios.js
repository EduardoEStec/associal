'use strict';

// Orquestra os relatórios: valida entrada, junta dados + textos padrão + edições da tela e gera o .docx/.csv.

const { erros } = require('../lib/erros');
const { normalizarData, apenasDigitos, lancarSeErros } = require('../lib/validacao');
const dados = require('./relatorios-dados');
const textos = require('./relatorios-textos');
const docx = require('./relatorios-docx');
const evolucaoRel = require('./relatorios-evolucao');
const famRel = require('./relatorios-progresso');
const painelFam = require('./painel-familias');

const { paragrafos, numero, percentual, dataBr, dataExtenso } = textos;

const MAX_TEXTO = 20000;

const CHAVES_INDIVIDUAL = ['introducao', 'objetivo', 'metodologia', 'diagnostico', 'impactoAlimentar',
  'impactoDesafios', 'impactoEconomico', 'evolucao', 'feedback', 'consideracoes'];
const CHAVES_SEMESTRAL = ['introducao', 'atendimentos', 'encaminhamentos', 'visitas', 'outrasAcoes', 'empoderamento', 'progresso', 'satisfacao', 'consideracoes'];
const CAMPOS_IDENTIFICACAO = ['nome', 'responsavel', 'cpf', 'nis', 'contato', 'endereco'];

// ---------- helpers ----------

const hoje = () => new Date().toISOString().slice(0, 10);

function semestreAtual(referencia = hoje()) {
  const ano = Number(referencia.slice(0, 4));
  const primeiro = Number(referencia.slice(5, 7)) <= 6;
  return primeiro
    ? { dataInicio: `${ano}-01-01`, dataFim: `${ano}-06-30` }
    : { dataInicio: `${ano}-07-01`, dataFim: `${ano}-12-31` };
}

// Lê e valida o período (query ou body). Sem datas => semestre atual.
function lerPeriodo(origem) {
  const padrao = semestreAtual();
  const problemas = {};
  const ini = origem.dataInicio ? normalizarData(origem.dataInicio) : padrao.dataInicio;
  const fim = origem.dataFim ? normalizarData(origem.dataFim) : padrao.dataFim;
  if (!ini) problemas.dataInicio = 'Informe uma data inicial válida.';
  if (!fim) problemas.dataFim = 'Informe uma data final válida.';
  if (ini && fim && ini > fim) problemas.dataFim = 'A data final deve ser igual ou posterior à data inicial.';
  if (ini && fim && ini <= fim && (Date.parse(fim) - Date.parse(ini)) / 86400000 > 731) {
    problemas.dataFim = 'O período não pode ser maior que 2 anos.';
  }
  lancarSeErros(problemas);
  return { dataInicio: ini, dataFim: fim };
}

function lerData(valor, campo, padrao) {
  if (valor === undefined || valor === null || valor === '') return padrao;
  const d = normalizarData(valor);
  if (!d) throw erros.validacao({ [campo]: 'Informe uma data válida.' });
  return d;
}

function lerTextoCurto(valor, campo, max, padrao = '') {
  if (valor === undefined || valor === null) return padrao;
  if (typeof valor !== 'string') throw erros.validacao({ [campo]: 'Texto inválido.' });
  if (valor.length > max) throw erros.validacao({ [campo]: `Use no máximo ${max} caracteres.` });
  return valor.trim();
}

// Mescla textos editados (body.textos) sobre os padrões; só aceita as chaves conhecidas, strings.
function mesclarTextos(editados, padroes, chaves) {
  if (editados === undefined || editados === null) return { ...padroes };
  if (typeof editados !== 'object' || Array.isArray(editados)) throw erros.validacao({ textos: 'Textos inválidos.' });
  const saida = {};
  const problemas = {};
  for (const chave of chaves) {
    const v = editados[chave];
    if (v === undefined) { saida[chave] = padroes[chave] ?? ''; continue; }
    if (typeof v !== 'string') problemas[`textos.${chave}`] = 'Texto inválido.';
    else if (v.length > MAX_TEXTO) problemas[`textos.${chave}`] = `Use no máximo ${numero(MAX_TEXTO)} caracteres.`;
    else saida[chave] = v;
  }
  lancarSeErros(problemas);
  return saida;
}

const formatarTelefone = (tel) => {
  const d = String(tel ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return '';
};
const formatarCpf = (cpf) => {
  const d = apenasDigitos(cpf);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (cpf || '');
};

const formatarCep = (cep) => {
  const d = apenasDigitos(cep);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : '';
};

function linhaCress(cress) {
  const c = String(cress || '').trim();
  if (!c) return 'CRESS/SP: ';
  return /cress/i.test(c) ? c : `CRESS/SP: ${c}`;
}

function cargoAssinatura(perfil, tipo) {
  if (tipo === 'semestral' && perfil !== 'ASSISTENTE') return 'Coordenador(a)';
  return 'Assistente Social';
}

function localData(local, data) {
  const l = (local || 'São Paulo/SP').replace(/[,\s]+$/, '');
  return `${l}, ${dataExtenso(data)}.`;
}

function enviarPara(res, buffer, nomeArquivo, tipo) {
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"; filename*=UTF-8''${encodeURIComponent(nomeArquivo)}`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}

// ---------- Relatório Individual Familiar ----------

function identificacaoPadrao(d) {
  const { responsavel, acompanhamento } = d;
  const partes = (responsavel.nome || '').trim().split(/\s+/);
  const sobrenome = partes.length > 1 ? partes[partes.length - 1] : partes[0] || '';
  const endereco = [responsavel.endereco, responsavel.bairro, formatarCep(responsavel.cep) && `CEP ${formatarCep(responsavel.cep)}`]
    .filter(Boolean).join(' – ');
  return {
    nome: sobrenome ? `Família ${sobrenome}` : '',
    responsavel: responsavel.nome || '',
    cpf: formatarCpf(responsavel.cpf),
    nis: responsavel.nis || '',
    contato: [formatarTelefone(responsavel.telefone), formatarTelefone(responsavel.telefone2) && `${formatarTelefone(responsavel.telefone2)} (recado)`].filter(Boolean).join(' / '),
    endereco,
    unidade: acompanhamento.unidadeNome,
  };
}

async function previaIndividual(req, acompanhamentoId) {
  const d = await dados.carregarIndividual(req, acompanhamentoId);
  const avisos = [];
  if (!d.inicial) avisos.push('O questionário inicial ainda não foi preenchido: o diagnóstico precisará ser escrito manualmente.');
  else if (!d.inicial.concluido) avisos.push('O questionário inicial está em rascunho (não concluído).');
  if (!d.final) avisos.push('O questionário final ainda não foi preenchido: impacto e feedback ficam em branco para você completar.');
  else if (!d.final.concluido) avisos.push('O questionário final está em rascunho (não concluído).');
  const u = req.usuario;
  return {
    acompanhamento: {
      id: d.acompanhamento.id, status: d.acompanhamento.status, dataInicio: d.acompanhamento.dataInicio,
      unidadeSigla: d.acompanhamento.unidadeSigla, unidadeNome: d.acompanhamento.unidadeNome,
    },
    identificacao: identificacaoPadrao(d),
    textos: textos.montarIndividual(d),
    avisos,
    assinatura: { nome: u.nome, cargo: cargoAssinatura(u.perfil, 'individual'), cress: u.cress || '' },
    local: 'São Paulo/SP',
    data: hoje(),
  };
}

async function gerarIndividual(req, acompanhamentoId) {
  const d = await dados.carregarIndividual(req, acompanhamentoId);
  const corpo = req.body || {};
  const padroes = textos.montarIndividual(d);
  const t = mesclarTextos(corpo.textos, padroes, CHAVES_INDIVIDUAL);

  const idPadrao = identificacaoPadrao(d);
  const ident = { ...idPadrao };
  if (corpo.identificacao !== undefined) {
    if (typeof corpo.identificacao !== 'object' || corpo.identificacao === null) throw erros.validacao({ identificacao: 'Dados inválidos.' });
    for (const campo of CAMPOS_IDENTIFICACAO) {
      ident[campo] = lerTextoCurto(corpo.identificacao[campo], `identificacao.${campo}`, 300, idPadrao[campo]);
    }
  }
  const data = lerData(corpo.data, 'data', hoje());
  const local = lerTextoCurto(corpo.local, 'local', 80, 'São Paulo/SP');
  const u = req.usuario;

  const tabelaEvolucao = evolucaoRel.tabelasEvolucaoXml(d.evolucao);
  const buffer = docx.renderizar('individual', {
    ...ident,
    ...Object.fromEntries(CHAVES_INDIVIDUAL.map((c) => [c, paragrafos(t[c])])),
    temEvolucao: !!tabelaEvolucao || paragrafos(t.evolucao).length > 0,
    evolucaoTabela: tabelaEvolucao,
    localData: localData(local, data),
    assinaturaNome: u.nome,
    assinaturaCargo: cargoAssinatura(u.perfil, 'individual'),
    cressLinha: linhaCress(u.cress),
  });
  return { buffer, nomeArquivo: `Relatorio_Individual_Familiar_${d.acompanhamento.unidadeSigla}_${acompanhamentoId}_${data}.docx` };
}

// ---------- Relatório Semestral ----------

function textosPadraoSemestral(coleta) {
  return textos.gerarTextosSemestral({ periodo: coleta.periodo, unidades: coleta.unidades, totais: coleta.totais });
}

async function previaSemestral(req, consulta) {
  const periodo = lerPeriodo(consulta);
  const coleta = await dados.coletarSemestral(req, { ...periodo, unidadeIds: consulta.unidadeIds });
  const fam = await famRel.coletar(req, periodo, coleta.unidades.map((u) => u.id));
  return {
    ...coleta,
    // F6: números das duas seções novas (os textos padrão vão junto em `textos`) e os comentários candidatos
    progresso: fam.progresso,
    satisfacao: { ...fam.satisfacao, comentarios: undefined },
    comentariosSatisfacao: fam.comentarios.slice(0, 100).map((c) => ({ id: c.id, sigla: c.sigla, data: c.data, pergunta: c.pergunta, texto: c.texto })),
    textos: { ...textosPadraoSemestral(coleta), ...famRel.textosPadrao(fam) },
    totais: { ...coleta.totais, percentualEncaminhamento: percentual(coleta.totais.atendimentosComEncaminhamento, coleta.totais.atendimentos) },
  };
}

async function gerarSemestral(req) {
  const corpo = req.body || {};
  const periodo = lerPeriodo(corpo);
  const coleta = await dados.coletarSemestral(req, { ...periodo, unidadeIds: corpo.unidadeIds });
  const fam = await famRel.coletar(req, periodo, coleta.unidades.map((u) => u.id));
  const t = mesclarTextos(corpo.textos, { ...textosPadraoSemestral(coleta), ...famRel.textosPadrao(fam) }, CHAVES_SEMESTRAL);
  const comentariosSatisfacao = famRel.escolherComentarios(fam.comentarios, corpo.comentariosSatisfacao);
  const data = lerData(corpo.data, 'data', hoje());
  const local = lerTextoCurto(corpo.local, 'local', 80, 'São Paulo/SP');

  // relatos escolhidos (só ids que existem no escopo; texto pode ter sido editado/anonimizado na tela)
  const relatosPorId = new Map(coleta.relatos.map((r) => [r.id, r]));
  const relatos = [];
  if (corpo.relatos !== undefined) {
    if (!Array.isArray(corpo.relatos)) throw erros.validacao({ relatos: 'Lista de relatos inválida.' });
    for (const item of corpo.relatos.slice(0, 200)) {
      const base = relatosPorId.get(String(item?.id));
      if (!base) continue;
      const texto = typeof item.texto === 'string' ? item.texto.trim().slice(0, 3000) : base.texto;
      if (texto) relatos.push({ texto, sigla: base.sigla });
    }
  }

  // fotos escolhidas (só ids dentro do escopo/período), agrupadas por unidade
  const fotosPorId = new Map(coleta.fotos.map((f) => [f.id, f]));
  let escolhidas = [];
  if (corpo.fotos !== undefined) {
    if (!Array.isArray(corpo.fotos)) throw erros.validacao({ fotos: 'Lista de fotos inválida.' });
    const ids = new Set(corpo.fotos.map(Number));
    escolhidas = coleta.fotos.filter((f) => ids.has(f.id) && fotosPorId.has(f.id));
  }
  const grupos = coleta.unidades.map((u) => ({
    nome: u.nome,
    fotos: escolhidas.filter((f) => f.unidadeId === u.id).map((f) => ({
      caminho: dados.caminhoFoto(f.arquivo), legenda: f.legenda, data: f.data, local: f.local,
    })),
  }));
  const anexos = await docx.montarAnexos(grupos);

  const { totais } = coleta;
  const u = req.usuario;
  const dadosTemplate = {
    periodoTexto: `${dataBr(periodo.dataInicio)} a ${dataBr(periodo.dataFim)}`,
    unidadesTexto: coleta.unidades.map((x) => x.nome).join(', '),
    ...Object.fromEntries(CHAVES_SEMESTRAL.map((c) => [c, paragrafos(t[c])])),

    atendimentosUnidades: coleta.atendimentosPorUnidade.map((x) => ({
      nome: x.nome,
      atendimentos: numero(x.atendimentos),
      encaminhamentos: numero(x.encaminhamentos),
      percentual: percentual(x.atendimentosComEncaminhamento, x.atendimentos),
    })),
    totalAtendimentos: numero(totais.atendimentos),
    totalEncaminhamentos: numero(totais.encaminhamentos),

    temInstituicoes: coleta.encaminhamentosPorInstituicao.length > 0,
    instituicoes: coleta.encaminhamentosPorInstituicao.map((x) => ({ nome: x.nome, quantidade: numero(x.quantidade) })),

    visitasUnidades: coleta.visitasPorUnidade.map((x) => ({
      nome: x.nome,
      quantidade: numero(x.quantidade),
      temItens: x.itens.length > 0,
      semItens: x.itens.length === 0,
      itens: x.itens.map((i) => ({ data: dataBr(i.data), local: i.local, temas: i.temas, participantes: i.participantes ?? '' })),
    })),

    temOutrasAcoes: coleta.outrasAcoes.length > 0,
    outras: coleta.outrasAcoes.map((i) => ({
      data: dataBr(i.data), sigla: i.sigla, tipo: i.tipo, local: i.local, participantes: i.participantes ?? '',
    })),

    temFamiliasUnidades: coleta.familiasPorUnidade.length > 0 && totais.familias > 0,
    familiasUnidades: coleta.familiasPorUnidade.map((x) => ({ nome: x.nome, familias: numero(x.familias) })),
    temComparacao: coleta.comparacao.pares > 0,
    indicadores: coleta.comparacao.indicadores,
    distribuicoes: coleta.comparacao.distribuicoes,
    temRelatos: relatos.length > 0,
    relatos,
    ...famRel.dadosTemplate({ progresso: fam.progresso, satisfacao: fam.satisfacao, comentarios: comentariosSatisfacao }),

    localData: localData(local, data),
    assinaturaNome: u.nome,
    assinaturaCargo: cargoAssinatura(u.perfil, 'semestral'),
    cressLinha: linhaCress(u.cress),
  };

  const buffer = docx.renderizar('semestral', dadosTemplate, anexos);
  return {
    buffer,
    nomeArquivo: `Relatorio_Semestral_${periodo.dataInicio}_a_${periodo.dataFim}.docx`,
    resumo: { fotos: anexos.midias.length, relatos: relatos.length, comentariosSatisfacao: comentariosSatisfacao.length },
  };
}

// ---------- CSV ----------

const SEPARADOR = ';';

function celulaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  let t = valor instanceof Date ? dataBr(valor) : typeof valor === 'number' ? String(valor).replace('.', ',') : String(valor);
  if (/^[=+\-@\t\r]/.test(t) && typeof valor !== 'number') t = `'${t}`; // evita injeção de fórmula no Excel
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function montarCsv(cabecalho, linhas) {
  const todas = [cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(SEPARADOR));
  return Buffer.from(`﻿${todas.join('\r\n')}\r\n`, 'utf8');
}

const STATUS_ROTULO = { PLANEJADA: 'Planejada', REALIZADA: 'Realizada', CANCELADA: 'Cancelada' };

async function csvAtendimentos(req, consulta) {
  const periodo = lerPeriodo(consulta);
  const linhas = await dados.resumoMensal(req, { ...periodo, unidadeIds: consulta.unidadeIds });
  return {
    periodo,
    buffer: montarCsv(
      ['ANO', 'MÊS', 'DATA', 'UNIDADE', 'QTD ATD_ENCAMINHAMENTO CRAS E DESCOMPLICA', 'QTD AÇOES', 'QTDE PARTICIPANTES',
        'QTD FAMILIA ACOMPANHADA', 'TOTAL ATENDIMENTO', '% ENCAMINHAMENTOS'],
      linhas.map((l) => [l.ano, l.mes, dataBr(l.data), l.unidade, l.atendimentos, l.acoes, l.participantes, l.familias, l.total,
        Number(l.percentual.toFixed(6))]),
    ),
  };
}

async function csvAcoes(req, consulta) {
  const periodo = lerPeriodo(consulta);
  const acoes = await dados.listaAcoes(req, { ...periodo, unidadeIds: consulta.unidadeIds });
  return {
    periodo,
    buffer: montarCsv(
      ['ANO', 'vv', 'DATA', 'UNIDADE', 'LOCAL', 'ENDEREÇO', 'TEMA 1', 'TEMA 2', 'TEMA 3', 'TEMA 4', 'STATUS', 'QTD DE PARTICIPANTES', 'TIPO'],
      acoes.map((a) => {
        const iso = a.dataAcao instanceof Date ? a.dataAcao.toISOString().slice(0, 10) : String(a.dataAcao).slice(0, 10);
        return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), dataBr(iso), a.sigla, a.instituicaoLocal, a.endereco,
          a.temas[0], a.temas[1], a.temas[2], a.temas[3], STATUS_ROTULO[a.status] || a.status, a.qtdParticipantes, a.tipo];
      }),
    ),
  };
}

async function csvProgresso(req, consulta) {
  const periodo = lerPeriodo(consulta);
  const ids = dados.resolverEscopo(req, consulta.unidadeIds);
  const d = await painelFam.progresso(req, { inicio: periodo.dataInicio, fim: periodo.dataFim }, ids, { comAnterior: false });
  return { periodo, buffer: montarCsv(famRel.CABECALHO_CSV_PROGRESSO, famRel.linhasCsvProgresso(d)) };
}

async function csvSatisfacao(req, consulta) {
  const periodo = lerPeriodo(consulta);
  const ids = dados.resolverEscopo(req, consulta.unidadeIds);
  const d = await painelFam.satisfacao(req, { inicio: periodo.dataInicio, fim: periodo.dataFim }, ids, { comComentarios: false, comAnterior: false });
  return { periodo, buffer: montarCsv(famRel.CABECALHO_CSV_SATISFACAO, famRel.linhasCsvSatisfacao(d)) };
}

module.exports = {
  semestreAtual, lerPeriodo, hoje, enviarPara,
  previaIndividual, gerarIndividual,
  previaSemestral, gerarSemestral,
  csvAtendimentos, csvAcoes, csvProgresso, csvSatisfacao, montarCsv,
};
