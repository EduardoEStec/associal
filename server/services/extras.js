'use strict';

// Respostas às perguntas do CATÁLOGO: as EXTRAS (P2: criadas pela coordenação para a pesquisa de satisfação, o atendimento e os
// questionários) e, nos questionários inicial e final (M1), também as perguntas OFICIAIS dos modelos em papel.
// Validação (pura) e gravação/leitura das respostas em dbo.ASSOCIAL_resposta_extra. Contrato: docs/API-CATALOGO.md.
//
// Valor na API, por tipo:  TEXTO -> string · NUMERO -> número · SIM_NAO -> true/false · ESCOLHA -> código da opção ·
// MULTIPLA -> lista de códigos. Chegam em `extras: { "<código da pergunta>": valor }`; `extras` ausente = não mexe nas respostas.

const { tipos } = require('../db');
const estado = require('./catalogo-estado');

const MAX_TEXTO = 2000;
const MAX_DETALHE = 200;
const MAX_NUMERO = 999999999999;
const FALTA = 'Responda esta pergunta para concluir.';

// formulário -> coluna de dbo.ASSOCIAL_resposta_extra que aponta o dono da resposta
const COLUNA_DONO = Object.freeze({
  QUESTIONARIO: 'questionario_id', QUESTIONARIO_INICIAL: 'questionario_id', QUESTIONARIO_FINAL: 'questionario_id',
  ATENDIMENTO: 'atendimento_id', PESQUISA: 'pesquisa_resposta_id',
});

const vazio = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function paraNumero(v) {
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function paraBooleano(v) {
  if (v === true || v === 'true' || v === 1 || v === 'sim') return true;
  if (v === false || v === 'false' || v === 0 || v === 'nao' || v === 'não') return false;
  return undefined;
}

// Valida as respostas às perguntas extras ATIVAS (`defs` = estado.extras(formulario), já filtradas por seção se for o caso).
//   entrada  : o objeto `extras` do corpo (ou undefined)
//   concluir : exige as perguntas marcadas como obrigatórias
//   atuais   : Map(perguntaId -> Set(opcaoId)) já gravados: uma opção desativada continua aceita se já estava escolhida
//   detalhes : { "<código>": texto } — complemento das opções que pedem detalhe ("Outras: ____")
// Devolve { itens, perguntaIds, erros }. `itens`: [{ perguntaId, opcaoId, valorTexto, valorNum }]; erros por "extras.<código>".
function validarExtras(defs, entrada, { concluir = false, atuais = new Map(), detalhes } = {}) {
  const detalhesInformados = detalhes !== undefined; // só o questionário M1 coleta o complemento
  const erros = {};
  const itens = [];
  if (entrada !== undefined && (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada))) {
    return { itens, perguntaIds: [], erros: { extras: 'Respostas adicionais inválidas.' } };
  }
  const dados = entrada || {};

  for (const def of defs) {
    const chave = `extras.${def.codigo}`;
    const bruto = dados[def.codigo];
    const jaEscolhidas = atuais.get(def.id) || new Set();

    if (vazio(bruto)) {
      if (concluir && def.obrigatoria) erros[chave] = FALTA;
      continue;
    }

    switch (def.tipo) {
      case 'TEXTO': {
        const t = String(bruto).trim();
        if (t.length > MAX_TEXTO) erros[chave] = `Use no máximo ${MAX_TEXTO} caracteres.`;
        else if (t) itens.push({ perguntaId: def.id, opcaoId: null, valorTexto: t, valorNum: null });
        else if (concluir && def.obrigatoria) erros[chave] = FALTA;
        break;
      }
      case 'NUMERO': {
        const n = paraNumero(bruto);
        if (def.min !== undefined && def.max !== undefined) {
          if (!Number.isInteger(n) || n < def.min || n > def.max) erros[chave] = `Informe um número inteiro entre ${def.min} e ${def.max}.`;
          else itens.push({ perguntaId: def.id, opcaoId: null, valorTexto: null, valorNum: n });
        } else if (Number.isNaN(n) || Math.abs(n) > MAX_NUMERO) erros[chave] = 'Informe um número válido.';
        else itens.push({ perguntaId: def.id, opcaoId: null, valorTexto: null, valorNum: Math.round(n * 10000) / 10000 });
        break;
      }
      case 'SIM_NAO': {
        const b = paraBooleano(bruto);
        if (b === undefined) erros[chave] = 'Responda sim ou não.';
        else itens.push({ perguntaId: def.id, opcaoId: null, valorTexto: null, valorNum: b ? 1 : 0 });
        break;
      }
      case 'ESCOLHA':
      case 'MULTIPLA': {
        const codigos = def.tipo === 'ESCOLHA' ? [bruto] : bruto;
        if (!Array.isArray(codigos) || codigos.some((c) => typeof c !== 'string')) { erros[chave] = 'Seleção inválida.'; break; }
        const unicos = [...new Set(codigos)];
        const escolhidas = unicos.map((c) => def.opcoes.find((o) => o.codigo === c));
        if (escolhidas.some((o) => !o)) erros[chave] = 'Opção inválida.';
        else if (escolhidas.some((o) => !o.ativa && !jaEscolhidas.has(o.id))) erros[chave] = 'Há uma opção que não está mais disponível.';
        else {
          const detalhe = String(detalhes?.[def.codigo] ?? '').trim();
          if (detalhe.length > MAX_DETALHE) erros[`detalhes.${def.codigo}`] = `Use no máximo ${MAX_DETALHE} caracteres.`;
          // "Outra/Outros": ao concluir, a opção marcada exige o texto (rascunho pode seguir sem ele)
          if (concluir && detalhesInformados && escolhidas.some((o) => o.pedeDetalhe) && !detalhe) erros[`detalhes.${def.codigo}`] = 'Informe qual é a outra opção.';
          for (const o of escolhidas) itens.push({ perguntaId: def.id, opcaoId: o.id, valorTexto: o.pedeDetalhe && detalhe ? detalhe : null, valorNum: null });
        }
        break;
      }
      default: break;
    }
  }
  return { itens, perguntaIds: defs.map((d) => d.id), erros };
}

// ---------- banco ----------

const marcadores = (ids, prefixo, params) => ids.map((id, i) => { params[`${prefixo}${i}`] = id; return `@${prefixo}${i}`; });

// Respostas já gravadas do dono, como Map(perguntaId -> Set(opcaoId)) (para aceitar opções desativadas já escolhidas).
async function opcoesAtuais(executor, formulario, donoId) {
  const mapa = new Map();
  if (!donoId) return mapa;
  const linhas = await executor.consultar(
    `SELECT pergunta_id, opcao_id FROM ASSOCIAL_resposta_extra WHERE ${COLUNA_DONO[formulario]} = @dono AND opcao_id IS NOT NULL`, { dono: donoId });
  for (const l of linhas) {
    if (!mapa.has(l.perguntaId)) mapa.set(l.perguntaId, new Set());
    mapa.get(l.perguntaId).add(l.opcaoId);
  }
  return mapa;
}

// Substitui as respostas do dono SÓ para as perguntas tratadas (as desativadas e as removidas do catálogo ficam intactas).
async function gravarExtras(tx, formulario, donoId, validado) {
  const ids = validado.perguntaIds;
  if (!ids.length) return;
  const params = { dono: donoId };
  const lista = marcadores(ids, 'p', params).join(', ');
  await tx.consultar(`DELETE FROM ASSOCIAL_resposta_extra WHERE ${COLUNA_DONO[formulario]} = @dono AND pergunta_id IN (${lista})`, params);
  for (const it of validado.itens) {
    await tx.consultar(
      `INSERT INTO ASSOCIAL_resposta_extra (pergunta_id, ${COLUNA_DONO[formulario]}, opcao_id, valor_texto, valor_num)
       VALUES (@pergunta, @dono, @opcao, @texto, @num)`,
      { pergunta: it.perguntaId, dono: donoId, opcao: it.opcaoId, texto: it.valorTexto, num: [tipos.Decimal(18, 4), it.valorNum] });
  }
}

// Respostas de VÁRIOS donos de uma vez: Map(donoId -> linhas). Linha: { perguntaId, opcaoId, valorTexto, valorNum }.
async function linhasDeDonos(executor, formulario, donoIds) {
  const mapa = new Map(donoIds.map((id) => [id, []]));
  if (!donoIds.length) return mapa;
  const coluna = COLUNA_DONO[formulario];
  for (let i = 0; i < donoIds.length; i += 500) {
    const params = {};
    const lote = donoIds.slice(i, i + 500);
    const lista = marcadores(lote, 'd', params).join(', ');
    const linhas = await executor.consultar(
      `SELECT ${coluna} AS dono_id, pergunta_id, opcao_id, valor_texto, valor_num FROM ASSOCIAL_resposta_extra WHERE ${coluna} IN (${lista})`, params);
    for (const l of linhas) mapa.get(l.donoId).push(l);
  }
  return mapa;
}

// ---------- formatação ----------

// Definição de uma pergunta extra como a API a entrega às telas (opções em ordem de exibição).
function definicaoPublica(def, { obrigatoria = !!def.obrigatoria } = {}) {
  return {
    codigo: def.codigo,
    secao: def.secao,
    tipo: def.tipo,
    texto: def.texto,
    ajuda: def.ajuda || null,
    obrigatoria,
    ...(def.tipo === 'ESCOLHA' || def.tipo === 'MULTIPLA'
      ? { opcoes: [...def.opcoes].sort((a, b) => a.ordem - b.ordem || a.id - b.id).map((o) => ({ valor: o.codigo, rotulo: o.texto, ativa: o.ativa })) }
      : {}),
  };
}

const numeroBr = (n) => String(Number(n)).replace('.', ',');
const ordemExibicao = (a, b) => a.secao - b.secao || (b.oficial ? 1 : 0) - (a.oficial ? 1 : 0) || a.ordem - b.ordem || a.id - b.id;

// Transforma as linhas de UM dono em { mapa, lista }:
//   mapa  : { "<código>": valor } no formato da API (para preencher o formulário);
//   lista : [{ codigo, pergunta, tipo, secao, ativa, valor, resposta }] com a resposta legível (para detalhe, .docx e CSV).
// Perguntas desativadas aparecem se houver resposta. `tipoQuestionario`: INICIAL | FINAL (texto "hoje" da pergunta).
function formatarRespostas(formulario, linhas, { tipoQuestionario = 'INICIAL' } = {}) {
  const porPergunta = new Map();
  for (const l of linhas) {
    if (!porPergunta.has(l.perguntaId)) porPergunta.set(l.perguntaId, []);
    porPergunta.get(l.perguntaId).push(l);
  }
  const mapa = {};
  const detalhes = {};
  const lista = [];
  const defs = [...estado.extrasTodas(formulario)].sort(ordemExibicao);
  for (const def of defs) {
    const ls = porPergunta.get(def.id);
    if (!ls || !ls.length) continue;
    const opcao = (id) => def.opcoes.find((o) => o.id === id);
    const rotuloOpcao = (o) => (tipoQuestionario === 'FINAL' && o.textoFinal ? o.textoFinal : o.texto);
    let valor;
    let resposta;
    switch (def.tipo) {
      case 'TEXTO': valor = ls[0].valorTexto; resposta = valor; break;
      case 'NUMERO': valor = Number(ls[0].valorNum); resposta = numeroBr(valor); break;
      case 'SIM_NAO': valor = Number(ls[0].valorNum) === 1; resposta = valor ? 'Sim' : 'Não'; break;
      case 'ESCOLHA': { const o = opcao(ls[0].opcaoId); valor = o ? o.codigo : null; resposta = o ? rotuloOpcao(o) : ''; break; }
      default: {
        const os = ls.map((l) => opcao(l.opcaoId)).filter(Boolean).sort((a, b) => a.ordem - b.ordem || a.id - b.id);
        valor = os.map((o) => o.codigo);
        resposta = os.map(rotuloOpcao).join('; ');
      }
    }
    // complemento da opção que pede detalhe ("Outras: ____")
    const comDetalhe = (def.tipo === 'ESCOLHA' || def.tipo === 'MULTIPLA') ? ls.find((l) => l.valorTexto) : null;
    if (comDetalhe) {
      detalhes[def.codigo] = comDetalhe.valorTexto;
      const o = opcao(comDetalhe.opcaoId);
      if (o) resposta = resposta.replace(rotuloOpcao(o), `${rotuloOpcao(o)}: ${comDetalhe.valorTexto}`);
    }
    mapa[def.codigo] = valor;
    lista.push({
      codigo: def.codigo,
      pergunta: tipoQuestionario === 'FINAL' && def.textoFinal ? def.textoFinal : def.texto,
      tipo: def.tipo, secao: def.secao, ativa: def.ativa, oficial: !!def.oficial, campo: def.campo || null, valor, resposta,
      ...(comDetalhe ? { detalhe: comDetalhe.valorTexto } : {}),
    });
  }
  return { mapa, detalhes, lista };
}

async function carregarRespostas(executor, formulario, donoId, opcoes) {
  if (!donoId) return { mapa: {}, detalhes: {}, lista: [] };
  const linhas = (await linhasDeDonos(executor, formulario, [donoId])).get(donoId);
  return formatarRespostas(formulario, linhas, opcoes);
}

module.exports = {
  COLUNA_DONO, validarExtras, opcoesAtuais, gravarExtras, linhasDeDonos, definicaoPublica, formatarRespostas, carregarRespostas,
};
