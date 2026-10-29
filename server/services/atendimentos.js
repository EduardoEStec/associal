'use strict';

// Regras do atendimento social: validação do corpo, faixa etária e gravação das listas N:N.

const { consultar, tipos } = require('../db');
const { normalizarData, calcularIdade, texto, inteiroPositivo } = require('../lib/validacao');
const pessoas = require('./pessoas');
const estado = require('./catalogo-estado');
const extras = require('./extras');

// Tabela N:N -> { tabela de apoio, coluna da relação, campo da lista no corpo, campo do texto "outra" }
const LISTAS = Object.freeze({
  demandas: { apoio: 'demanda', relacao: 'atendimento_demanda', coluna: 'demanda_id', outra: 'demandaOutra', rotulo: 'demanda' },
  vulnerabilidades: { apoio: 'vulnerabilidade', relacao: 'atendimento_vulnerabilidade', coluna: 'vulnerabilidade_id', outra: 'vulnerabilidadeOutra', rotulo: 'vulnerabilidade' },
  encaminhamentos: { apoio: 'encaminhamento', relacao: 'atendimento_encaminhamento', coluna: 'encaminhamento_id', outra: 'encaminhamentoOutro', rotulo: 'encaminhamento' },
});

const hoje = () => new Date().toISOString().slice(0, 10);

function listaDeIds(valor) {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) return null;
  const ids = valor.map(inteiroPositivo);
  return ids.includes(null) ? null : [...new Set(ids)];
}

// Valida o corpo de criação/edição. Devolve { dados, problemas } (dados.pessoa = dados pessoais).
function validarCorpo(corpo) {
  const { dados: pessoa, problemas } = pessoas.validarDadosPessoa(corpo);
  const dados = { pessoa };

  dados.dataAtendimento = normalizarData(corpo.dataAtendimento);
  if (!dados.dataAtendimento) problemas.dataAtendimento = 'Informe uma data de atendimento válida.';
  else if (dados.dataAtendimento > hoje()) problemas.dataAtendimento = 'A data do atendimento não pode ser futura.';
  else if (pessoa.dataNascimento && pessoa.dataNascimento > dados.dataAtendimento) {
    problemas.dataNascimento = 'A data de nascimento é posterior ao atendimento.';
  }

  for (const campo of ['nivelVulnerabilidadeId', 'faixaEtariaId', 'pessoaId']) {
    const v = corpo[campo];
    if (v === undefined || v === null || v === '') dados[campo] = null;
    else if (!inteiroPositivo(v)) problemas[campo] = 'Opção inválida.';
    else dados[campo] = Number(v);
  }

  for (const [campo, cfg] of Object.entries(LISTAS)) {
    const ids = listaDeIds(corpo[campo]);
    if (ids === null) problemas[campo] = 'Seleção inválida.';
    dados[campo] = ids || [];
    dados[cfg.outra] = texto(corpo[cfg.outra], 300);
  }
  dados.resumo = texto(corpo.resumo);
  return { dados, problemas };
}

// Confere, nas tabelas de apoio, que os ids existem (e estão ativos, ao criar) e que as opções
// com `exige_texto` ("Outra") vieram com o texto preenchido.
async function validarApoio(dados, problemas, { somenteAtivas = true, executor = { consultar } } = {}) {
  await pessoas.validarApoioPessoa(dados.pessoa, problemas, executor);

  const filtroAtivo = somenteAtivas ? 'AND ativo = 1' : '';
  for (const [campo, cfg] of Object.entries(LISTAS)) {
    const ids = dados[campo];
    if (problemas[campo] || ids.length === 0) continue;
    const params = {};
    const nomes = ids.map((id, i) => { params[`i${i}`] = id; return `@i${i}`; });
    const achadas = await executor.consultar(
      `SELECT id, exige_texto FROM ASSOCIAL_${cfg.apoio} WHERE id IN (${nomes.join(', ')}) ${filtroAtivo}`, params);
    if (achadas.length !== ids.length) problemas[campo] = 'Há opções inexistentes ou inativas.';
    else if (achadas.some((a) => a.exigeTexto) && !dados[cfg.outra]) {
      problemas[cfg.outra] = `Descreva a opção "Outra"/"Outros" de ${cfg.rotulo}.`;
    }
  }
  for (const cfg of Object.values(LISTAS)) {
    if (dados[cfg.outra] && !problemas[cfg.outra]) {
      // texto "outra" só faz sentido com a opção correspondente marcada; sem ela é descartado
      const ids = dados[Object.keys(LISTAS).find((k) => LISTAS[k] === cfg)];
      if (ids.length === 0) dados[cfg.outra] = null;
      else {
        const params = {};
        const nomes = ids.map((id, i) => { params[`i${i}`] = id; return `@i${i}`; });
        const [{ total }] = await executor.consultar(
          `SELECT COUNT(*) AS total FROM ASSOCIAL_${cfg.apoio} WHERE id IN (${nomes.join(', ')}) AND exige_texto = 1`, params);
        if (!total) dados[cfg.outra] = null;
      }
    }
  }
  if (dados.nivelVulnerabilidadeId && !problemas.nivelVulnerabilidadeId) {
    const r = await executor.consultar('SELECT 1 AS ok FROM ASSOCIAL_nivel_vulnerabilidade WHERE id = @id', { id: dados.nivelVulnerabilidadeId });
    if (!r.length) problemas.nivelVulnerabilidadeId = 'Opção inexistente.';
  }
}

// Perguntas extras do formulário (P2). Obrigatórias valem sempre ao salvar. `extras` ausente na edição = não mexe nas respostas
// (as obrigatórias são conferidas contra o que já está gravado). Devolve o resultado a gravar ou null.
async function validarExtras(corpo, atendimentoId, problemas, executor = { consultar }) {
  const defs = estado.extras('ATENDIMENTO');
  if (!defs.length) return null;
  const informado = corpo.extras !== undefined;
  const entrada = informado ? corpo.extras
    : (atendimentoId ? (await extras.carregarRespostas(executor, 'ATENDIMENTO', atendimentoId)).mapa : {});
  const atuais = await extras.opcoesAtuais(executor, 'ATENDIMENTO', atendimentoId);
  const r = extras.validarExtras(defs, entrada, { concluir: true, atuais });
  Object.assign(problemas, r.erros);
  return informado ? r : null;
}

// Faixa etária calculada na data do atendimento; sem nascimento usa a escolhida (ou "Outra").
async function definirFaixaEtaria(dados, executor = { consultar }) {
  const faixas = await executor.consultar(
    'SELECT id, idade_min, idade_max FROM ASSOCIAL_faixa_etaria WHERE ativo = 1 ORDER BY ordem, id');
  return escolherFaixa(faixas, dados);
}

function escolherFaixa(faixas, dados) {
  const idade = dados.pessoa.dataNascimento ? calcularIdade(dados.pessoa.dataNascimento, dados.dataAtendimento) : null;
  if (idade !== null) {
    const achada = faixas.find((f) =>
      (f.idadeMin !== null || f.idadeMax !== null)
      && (f.idadeMin === null || idade >= f.idadeMin) && (f.idadeMax === null || idade <= f.idadeMax));
    if (achada) return achada.id;
  }
  if (dados.faixaEtariaId && faixas.some((f) => f.id === dados.faixaEtariaId)) return dados.faixaEtariaId;
  return faixas.find((f) => f.idadeMin === null && f.idadeMax === null)?.id ?? null;
}

// Grava (substituindo) as três listas N:N de um atendimento. Usar dentro de uma transação.
async function gravarListas(tx, atendimentoId, dados) {
  for (const [campo, cfg] of Object.entries(LISTAS)) {
    await tx.consultar(`DELETE FROM ASSOCIAL_${cfg.relacao} WHERE atendimento_id = @id`, { id: atendimentoId });
    for (const itemId of dados[campo]) {
      await tx.consultar(
        `INSERT INTO ASSOCIAL_${cfg.relacao} (atendimento_id, ${cfg.coluna}) VALUES (@id, @item)`,
        { id: atendimentoId, item: itemId });
    }
  }
}

const paramsAtendimento = (dados, faixaEtariaId) => ({
  dataAtendimento: [tipos.Date, dados.dataAtendimento],
  faixaEtariaId,
  nivelVulnerabilidadeId: dados.nivelVulnerabilidadeId,
  demandaOutra: dados.demandaOutra,
  vulnerabilidadeOutra: dados.vulnerabilidadeOutra,
  encaminhamentoOutro: dados.encaminhamentoOutro,
  resumo: dados.resumo,
});

module.exports = {
  LISTAS, validarCorpo, validarApoio, validarExtras, definirFaixaEtaria, escolherFaixa, gravarListas, paramsAtendimento,
};
