'use strict';

// Regras de Pessoa (dbo.pessoa, única por CPF). Compartilhado por /api/pessoas e /api/atendimentos.
// LGPD: aqui só circulam DADOS PESSOAIS; nada de atendimento/acompanhamento fora das unidades permitidas.

const { consultar, consultarUm, tipos } = require('../db');
const { clausulaUnidades } = require('../middlewares/auth');
const {
  normalizarCpf, cpfValido, normalizarCep, cepValido, normalizarData, texto, inteiroPositivo, apenasDigitos,
} = require('../lib/validacao');

const COLUNAS_PESSOA = `p.id, p.cpf, p.nome, p.data_nascimento, p.nis, p.endereco, p.cep, p.bairro,
  p.trabalho_atual, p.genero_id, p.escolaridade_id, p.raca_id`;

// Valida/normaliza os dados pessoais do corpo da requisição. Devolve { dados, problemas }.
function validarDadosPessoa(corpo) {
  const problemas = {};
  const dados = {};

  dados.nome = texto(corpo.nome, 150);
  if (!dados.nome) problemas.nome = 'Informe o nome completo.';

  dados.cpf = normalizarCpf(corpo.cpf);
  if (dados.cpf && !cpfValido(dados.cpf)) problemas.cpf = 'CPF inválido.';

  dados.dataNascimento = normalizarData(corpo.dataNascimento);
  if (dados.dataNascimento === undefined) problemas.dataNascimento = 'Data de nascimento inválida.';
  else if (dados.dataNascimento && dados.dataNascimento > new Date().toISOString().slice(0, 10)) {
    problemas.dataNascimento = 'A data de nascimento não pode ser futura.';
  }

  const nis = apenasDigitos(corpo.nis);
  dados.nis = nis === '' ? null : nis;
  if (dados.nis && dados.nis.length > 11) problemas.nis = 'O Nº CadÚnico (NIS) deve ter até 11 dígitos.';

  dados.endereco = texto(corpo.endereco, 200);
  dados.cep = normalizarCep(corpo.cep);
  if (dados.cep && !cepValido(dados.cep)) problemas.cep = 'CEP inválido.';
  dados.bairro = texto(corpo.bairro, 100);
  dados.trabalhoAtual = texto(corpo.trabalhoAtual, 200);

  for (const campo of ['generoId', 'escolaridadeId', 'racaId']) {
    const v = corpo[campo];
    if (v === undefined || v === null || v === '') dados[campo] = null;
    else if (!inteiroPositivo(v)) problemas[campo] = 'Opção inválida.';
    else dados[campo] = Number(v);
  }
  return { dados, problemas };
}

// Garante que gênero/escolaridade/raça existem (mensagem clara em vez de erro de FK).
async function validarApoioPessoa(dados, problemas, executor = { consultar }) {
  const mapa = { generoId: 'genero', escolaridadeId: 'escolaridade', racaId: 'raca' };
  for (const [campo, tabela] of Object.entries(mapa)) {
    if (!dados[campo] || problemas[campo]) continue;
    const achou = await executor.consultar(`SELECT 1 AS ok FROM ${tabela} WHERE id = @id`, { id: dados[campo] });
    if (!achou.length) problemas[campo] = 'Opção inexistente.';
  }
}

function paramsPessoa(d) {
  return {
    cpf: d.cpf,
    nome: d.nome,
    dataNascimento: [tipos.Date, d.dataNascimento],
    nis: d.nis,
    endereco: d.endereco,
    cep: d.cep,
    bairro: d.bairro,
    trabalhoAtual: d.trabalhoAtual,
    generoId: d.generoId,
    escolaridadeId: d.escolaridadeId,
    racaId: d.racaId,
  };
}

async function criarPessoa(tx, dados, usuarioId) {
  const [nova] = await tx.consultar(
    `INSERT INTO pessoa (cpf, nome, data_nascimento, nis, endereco, cep, bairro, trabalho_atual,
                         genero_id, escolaridade_id, raca_id, criado_por)
     OUTPUT INSERTED.id
     VALUES (@cpf, @nome, @dataNascimento, @nis, @endereco, @cep, @bairro, @trabalhoAtual,
             @generoId, @escolaridadeId, @racaId, @usuarioId)`,
    { ...paramsPessoa(dados), usuarioId },
  );
  return nova.id;
}

async function atualizarPessoa(tx, id, dados, usuarioId) {
  await tx.consultar(
    `UPDATE pessoa SET cpf = @cpf, nome = @nome, data_nascimento = @dataNascimento, nis = @nis,
            endereco = @endereco, cep = @cep, bairro = @bairro, trabalho_atual = @trabalhoAtual,
            genero_id = @generoId, escolaridade_id = @escolaridadeId, raca_id = @racaId,
            alterado_por = @usuarioId, alterado_em = SYSUTCDATETIME()
      WHERE id = @id`,
    { ...paramsPessoa(dados), usuarioId, id },
  );
}

const buscarPorCpf = (cpf, executor = { consultarUm }) =>
  executor.consultarUm(`SELECT ${COLUNAS_PESSOA} FROM pessoa p WHERE p.cpf = @cpf`, { cpf });

// A pessoa tem atendimento ou acompanhamento (como responsável) em unidade permitida?
async function pessoaNoEscopo(req, pessoaId, executor = { consultarUm }) {
  const params = { pessoaId };
  const whereA = clausulaUnidades(req, 'a.unidade_id', params, 'ua');
  const whereC = clausulaUnidades(req, 'ac.unidade_id', params, 'uc');
  const achou = await executor.consultarUm(
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM atendimento a WHERE a.pessoa_id = @pessoaId AND ${whereA})
                   OR EXISTS (SELECT 1 FROM acompanhamento ac
                                JOIN familia f ON f.id = ac.familia_id
                               WHERE f.responsavel_pessoa_id = @pessoaId AND ${whereC})
                 THEN 1 ELSE 0 END AS ok`,
    params,
  );
  return achou?.ok === 1;
}

// "Acabou de localizar por CPF": lembramos na sessão (até 50) para liberar a edição dos dados pessoais.
function lembrarLocalizada(req, pessoaId) {
  if (!req.session) return;
  const lista = (req.session.pessoasLocalizadas ||= []);
  if (!lista.includes(pessoaId)) lista.push(pessoaId);
  if (lista.length > 50) lista.shift();
}
const foiLocalizada = (req, pessoaId) => !!req.session?.pessoasLocalizadas?.includes(pessoaId);

module.exports = {
  COLUNAS_PESSOA,
  validarDadosPessoa,
  validarApoioPessoa,
  criarPessoa,
  atualizarPessoa,
  buscarPorCpf,
  pessoaNoEscopo,
  lembrarLocalizada,
  foiLocalizada,
};
