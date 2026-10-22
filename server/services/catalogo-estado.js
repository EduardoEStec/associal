'use strict';

// Catálogo de perguntas e opções em MEMÓRIA (P2). Sem banco: quem carrega do banco é ./catalogo.js, que chama `definir`.
// Sem catálogo carregado (testes, ou tabelas ainda não criadas) valem as definições padrão do código:
// as mesmas que a migração 085 semeia, então o comportamento é o de antes da configuração pela coordenação.
//
// Escalas: cada pergunta oficial de escolha tem opções "base" (oficiais), da PIOR (posição 0) para a MELHOR. O índice de progresso
// e a comparação inicial × final usam a posição. Opção acrescentada pela coordenação "vale como" uma opção base (mesma posição)
// ou "não pontua" (fora do índice e da comparação).

const { QUESTIONARIO } = require('../lib/dominios');

// Do PIOR para o MELHOR.
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

// Rótulos diferentes no questionário FINAL ("hoje").
const ROTULOS_FINAL_PADRAO = Object.freeze({
  acessoAlimentosInNatura: { NAO_TINHA: 'Não tem acesso' },
});

const FORMULARIOS = Object.freeze(['QUESTIONARIO', 'PESQUISA', 'ATENDIMENTO']);

const VAZIO = Object.freeze({ textos: {}, opcoes: {}, extras: { QUESTIONARIO: [], PESQUISA: [], ATENDIMENTO: [] }, pesquisaTextos: {} });
let atual = VAZIO;

// `cat`: { textos: {campo: {texto, textoFinal, ajuda}}, opcoes: {campo: [opcao]}, extras: {FORM: [def]}, pesquisaTextos: {codigo: texto} }
// opcao: { id, codigo, texto, textoFinal, ordem, ativa, base, posicao, equivalePosicao }
function definir(cat) {
  atual = cat ? { ...VAZIO, ...cat, extras: { ...VAZIO.extras, ...(cat.extras || {}) } } : VAZIO;
}
const restaurarPadrao = () => definir(null);
const obter = () => atual;

// ---------- opções das perguntas oficiais de escolha ----------

function opcoesPadrao(campo) {
  const escala = ESCALAS[campo];
  if (!escala) return [];
  return escala.map((codigo, i) => ({
    id: null, codigo, texto: QUESTIONARIO[campo][codigo], textoFinal: ROTULOS_FINAL_PADRAO[campo]?.[codigo] || null,
    ordem: (i + 1) * 10, ativa: true, base: true, posicao: i, equivalePosicao: null,
  }));
}

// Todas as opções (ativas ou não) em ordem de exibição.
function opcoesDe(campo) {
  const doCatalogo = atual.opcoes[campo];
  const lista = doCatalogo && doCatalogo.length ? doCatalogo : opcoesPadrao(campo);
  return [...lista].sort((a, b) => a.ordem - b.ordem || (a.id ?? 0) - (b.id ?? 0));
}

const escalaDe = (campo) => opcoesDe(campo).map((o) => o.codigo);

const acharOpcao = (campo, codigo) => opcoesDe(campo).find((o) => o.codigo === codigo) || null;
const ehCodigoValido = (campo, codigo) => !!acharOpcao(campo, codigo);
const opcaoAtiva = (campo, codigo) => !!acharOpcao(campo, codigo)?.ativa;

// { indice, total } na escala oficial (0 = pior), ou null: código desconhecido ou opção que não pontua.
function posicaoNaEscala(campo, codigo) {
  const o = acharOpcao(campo, codigo);
  if (!o) return null;
  const posicao = o.base ? o.posicao : o.equivalePosicao;
  if (posicao === null || posicao === undefined) return null;
  const total = opcoesDe(campo).filter((x) => x.base).length;
  return { indice: posicao, total };
}

// tipo: INICIAL | REAVALIACAO | FINAL (os dois últimos usam o rótulo "hoje" quando existir)
function rotuloOpcao(campo, codigo, tipo = 'INICIAL') {
  if (codigo === null || codigo === undefined || codigo === '') return null;
  const o = acharOpcao(campo, codigo);
  if (!o) return QUESTIONARIO[campo]?.[codigo] || codigo;
  return tipo !== 'INICIAL' && o.textoFinal ? o.textoFinal : o.texto;
}

// ---------- textos das perguntas ----------

// Texto/ajuda gravados no catálogo para a pergunta oficial (null = sem catálogo: vale o do código).
const textoPergunta = (campo) => atual.textos[campo] || null;
const textoPesquisa = (codigo) => atual.pesquisaTextos[codigo] ?? null;

// ---------- extras ----------

// Definições ATIVAS, em ordem (seção, ordem).
function extras(formulario) {
  return (atual.extras[formulario] || []).filter((d) => d.ativa).sort((a, b) => a.secao - b.secao || a.ordem - b.ordem || a.id - b.id);
}
const extrasTodas = (formulario) => atual.extras[formulario] || [];

module.exports = {
  ESCALAS, FORMULARIOS, definir, restaurarPadrao, obter, opcoesDe, escalaDe, ehCodigoValido, opcaoAtiva, posicaoNaEscala, rotuloOpcao,
  textoPergunta, textoPesquisa, extras, extrasTodas,
};
