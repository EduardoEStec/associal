'use strict';

// Validadores e normalizadores reutilizáveis. Padrão das rotas:
//
//   const erros = {};
//   const cpf = normalizarCpf(req.body.cpf);
//   if (cpf && !cpfValido(cpf)) erros.cpf = 'CPF inválido.';
//   exigir(erros, 'nome', req.body.nome, 'Informe o nome.');
//   lancarSeErros(erros);               // -> 400 { erro: { codigo: 'VALIDACAO', detalhes } }

const { erros: fabricaErros } = require('./erros');

const apenasDigitos = (valor) => String(valor ?? '').replace(/\D/g, '');

// Retorna os 11 dígitos, ou null se vazio. Não valida: use cpfValido().
function normalizarCpf(valor) {
  const d = apenasDigitos(valor);
  return d === '' ? null : d;
}

function cpfValido(cpf) {
  const d = apenasDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[tamanho])) return false;
  }
  return true;
}

function normalizarCep(valor) {
  const d = apenasDigitos(valor);
  return d === '' ? null : d;
}

const cepValido = (cep) => apenasDigitos(cep).length === 8;

// Aceita 'YYYY-MM-DD' (padrão da API). Retorna a string ou null se inválida/vazia.
function normalizarData(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const s = String(valor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined; // undefined = inválida
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? undefined : s;
}

// Idade completa em anos na data de referência (padrão: hoje). Datas 'YYYY-MM-DD'.
function calcularIdade(dataNascimento, referencia = new Date().toISOString().slice(0, 10)) {
  const n = normalizarData(dataNascimento);
  const r = normalizarData(referencia);
  if (!n || !r) return null;
  const [an, mn, dn] = n.split('-').map(Number);
  const [ar, mr, dr] = r.split('-').map(Number);
  let idade = ar - an;
  if (mr < mn || (mr === mn && dr < dn)) idade -= 1;
  return idade >= 0 ? idade : null;
}

function texto(valor, max) {
  if (valor === undefined || valor === null) return null;
  const t = String(valor).trim();
  if (t === '') return null;
  return max ? t.slice(0, max) : t;
}

function exigir(errosObj, campo, valor, mensagem) {
  if (valor === undefined || valor === null || String(valor).trim() === '') errosObj[campo] = mensagem;
}

function lancarSeErros(errosObj) {
  if (Object.keys(errosObj).length > 0) throw fabricaErros.validacao(errosObj);
}

// Inteiro positivo vindo de req.params/query/body; null se inválido.
function inteiroPositivo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

module.exports = {
  apenasDigitos,
  normalizarCpf,
  cpfValido,
  normalizarCep,
  cepValido,
  normalizarData,
  calcularIdade,
  texto,
  exigir,
  lancarSeErros,
  inteiroPositivo,
};
