'use strict';

// Catálogo de perguntas e opções (P2): carrega do banco para a memória (./catalogo-estado.js) e mantém atualizado.
// As telas e as regras (questionário, índice, comparação, pesquisa, atendimento) leem sempre do estado em memória.
//
//   - `middleware` (montado em routes/index.js) garante um catálogo recente antes de cada requisição (TTL curto);
//   - ao editar o catálogo (catalogo-admin.js) chama `invalidar()` + `garantir()` e a mudança vale na hora;
//   - se as tabelas ainda não existem (migração 085 não aplicada) ou o banco falha, vale o catálogo padrão do código.

const { consultar } = require('../db');
const estado = require('./catalogo-estado');
const m1 = require('./modelos-m1');

const TTL_MS = 20 * 1000;
const NOVA_TENTATIVA_MS = 5 * 1000;

let validoAte = 0;
let emCarga = null;
let avisou = false;

const booleano = (v) => v === true || v === 1;

function opcaoDoCatalogo(o) {
  return {
    id: o.id,
    codigo: o.codigo,
    texto: o.texto,
    textoFinal: o.textoFinal || null,
    ordem: o.ordem,
    ativa: booleano(o.ativa),
    base: booleano(o.base),
    posicao: o.posicao === null || o.posicao === undefined ? null : Number(o.posicao),
    equivaleId: o.equivaleAId ?? null,
    equivaleCodigo: o.equivaleCodigo ?? null,
    equivalePosicao: o.equivalePosicao === null || o.equivalePosicao === undefined ? null : Number(o.equivalePosicao),
    pontos: o.pontos === null || o.pontos === undefined ? null : Number(o.pontos),
    pedeDetalhe: booleano(o.pedeDetalhe),
    equivalePontos: o.equivalePontos === null || o.equivalePontos === undefined ? null : Number(o.equivalePontos),
  };
}

// Monta o objeto de catalogo-estado a partir das linhas do banco (função pura, usada também nos testes).
function montarCatalogo(perguntas, opcoes) {
  const porPergunta = new Map();
  for (const o of opcoes) {
    if (!porPergunta.has(o.perguntaId)) porPergunta.set(o.perguntaId, []);
    porPergunta.get(o.perguntaId).push(opcaoDoCatalogo(o));
  }
  const cat = {
    textos: {}, opcoes: {}, pesquisaTextos: {}, m1: { QUESTIONARIO_INICIAL: [], QUESTIONARIO_FINAL: [] },
    extras: { QUESTIONARIO: [], QUESTIONARIO_INICIAL: [], QUESTIONARIO_FINAL: [], PESQUISA: [], ATENDIMENTO: [] },
  };
  for (const p of perguntas) {
    const lista = porPergunta.get(p.id) || [];
    if (m1.FORMULARIOS_M1.includes(p.formulario)) {
      // modelos M1: perguntas oficiais e adicionais juntas (todas respondidas em dbo.resposta_extra)
      const padrao = m1.PERGUNTAS_PADRAO[p.formulario].find((x) => x.codigo === p.codigo);
      cat.m1[p.formulario].push({
        id: p.id, formulario: p.formulario, codigo: p.codigo, campo: p.campo || null, oficial: booleano(p.oficial),
        secao: p.secao, tipo: p.tipo, texto: p.texto, textoFinal: p.textoFinal || null, ajuda: p.ajuda || null,
        obrigatoria: booleano(p.obrigatoria), ordem: p.ordem, ativa: booleano(p.ativa), opcoes: lista,
        min: padrao?.min, max: padrao?.max,
      });
    } else if (booleano(p.oficial)) {
      if (p.formulario === 'QUESTIONARIO' && p.campo) {
        cat.textos[p.campo] = { texto: p.texto, textoFinal: p.textoFinal || null, ajuda: p.ajuda || null };
        if (p.tipo === 'ESCOLHA') cat.opcoes[p.campo] = lista;
      } else if (p.formulario === 'PESQUISA') {
        cat.pesquisaTextos[p.codigo] = p.texto;
      }
    } else if (cat.extras[p.formulario]) {
      cat.extras[p.formulario].push({
        id: p.id,
        formulario: p.formulario,
        codigo: p.codigo,
        secao: p.secao,
        tipo: p.tipo,
        texto: p.texto,
        textoFinal: p.textoFinal || null,
        ajuda: p.ajuda || null,
        obrigatoria: booleano(p.obrigatoria),
        ordem: p.ordem,
        ativa: booleano(p.ativa),
        opcoes: lista,
      });
    }
  }
  return cat;
}

async function carregar() {
  const perguntas = await consultar(
    `SELECT id, formulario, secao, codigo, oficial, campo, tipo, texto, texto_final, ajuda, obrigatoria, ordem, ativa
       FROM catalogo_pergunta ORDER BY formulario, secao, ordem, id`);
  const opcoes = await consultar(
    `SELECT o.id, o.pergunta_id, o.codigo, o.texto, o.texto_final, o.ordem, o.ativa, o.base, o.posicao, o.pontos, o.pede_detalhe,
            o.equivale_a_id, eq.codigo AS equivale_codigo, eq.posicao AS equivale_posicao, eq.pontos AS equivale_pontos
       FROM catalogo_opcao o LEFT JOIN catalogo_opcao eq ON eq.id = o.equivale_a_id
      ORDER BY o.pergunta_id, o.ordem, o.id`);
  estado.definir(montarCatalogo(perguntas, opcoes));
}

// Garante um catálogo carregado há menos de TTL_MS. Nunca lança: em caso de falha mantém o que já havia.
async function garantir() {
  if (Date.now() < validoAte) return;
  if (!emCarga) {
    emCarga = carregar()
      .then(() => { validoAte = Date.now() + TTL_MS; avisou = false; })
      .catch((e) => {
        validoAte = Date.now() + NOVA_TENTATIVA_MS;
        if (!avisou) { avisou = true; console.warn(`Catálogo de perguntas indisponível (${e.message}); usando o padrão do código.`); }
      })
      .finally(() => { emCarga = null; });
  }
  await emCarga;
}

const invalidar = () => { validoAte = 0; };

const middleware = (req, res, next) => { garantir().then(() => next(), next); };

module.exports = { montarCatalogo, carregar, garantir, invalidar, middleware };
