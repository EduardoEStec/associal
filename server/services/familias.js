'use strict';

// Famílias e acompanhamentos (Módulo 3). Regras de negócio e queries.
// LGPD: familia/familia_membro não têm unidade — só são lidos/gravados através de um
// acompanhamento de unidade permitida (clausulaUnidades em ac.unidade_id).

const { consultar, consultarUm, transacao, tipos } = require('../db');
const { clausulaUnidades, unidadesPermitidas, exigirUnidade, resolverUnidade } = require('../middlewares/auth');
const { erros } = require('../lib/erros');
const { registrarAuditoria } = require('../lib/auditoria');
const { normalizarTelefone } = require('./pessoas');
const contato = require('./acompanhamento-contato');
const pesquisaRegras = require('./pesquisa-regras');
const {
  normalizarCpf, cpfValido, normalizarCep, cepValido, normalizarData, texto, inteiroPositivo,
  lancarSeErros, apenasDigitos,
} = require('../lib/validacao');

const MAX_MEMBROS = 30;
const PRAZO_PADRAO_DIAS = 90;
const ALERTA_PADRAO_DIAS = 15;

// ---------- datas ----------

function hojeIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function somarDias(iso, dias) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const diasEntre = (deIso, ateIso) =>
  Math.round((new Date(`${ateIso}T00:00:00Z`) - new Date(`${deIso}T00:00:00Z`)) / 86400000);

const isoData = (valor) => (valor ? new Date(valor).toISOString().slice(0, 10) : null);

// ---------- configuração ----------

async function lerConfiguracao(executor = { consultar }) {
  const linhas = await executor.consultar(
    `SELECT chave, valor FROM configuracao
      WHERE chave IN ('prazo_questionario_final_dias', 'alerta_questionario_final_dias_antes', 'alerta_sem_contato_dias')`,
  );
  const mapa = Object.fromEntries(linhas.map((l) => [l.chave, Number(l.valor)]));
  const inteiro = (v, padrao) => (Number.isInteger(v) && v >= 0 ? v : padrao);
  return {
    prazoDias: inteiro(mapa.prazo_questionario_final_dias, PRAZO_PADRAO_DIAS),
    alertaDias: inteiro(mapa.alerta_questionario_final_dias_antes, ALERTA_PADRAO_DIAS),
    semContatoDias: inteiro(mapa.alerta_sem_contato_dias, contato.LIMITE_PADRAO_DIAS),
  };
}

// Situação do questionário FINAL de um acompanhamento EM_ANDAMENTO (mesma regra do SQL da listagem).
function situacaoFinal({ status, finalConcluido, dataPrevistaFinal }, hoje, alertaDias) {
  if (status !== 'EM_ANDAMENTO') return { situacao: null, dias: null };
  if (finalConcluido) return { situacao: 'CONCLUIDO', dias: null };
  const prevista = isoData(dataPrevistaFinal);
  if (!prevista) return { situacao: 'EM_DIA', dias: null };
  const dias = diasEntre(hoje, prevista);
  if (dias < 0) return { situacao: 'VENCIDO', dias };
  if (dias <= alertaDias) return { situacao: 'VENCENDO', dias };
  return { situacao: 'EM_DIA', dias };
}

// ---------- carregamento com escopo de unidade ----------

// Carrega o acompanhamento por id SOMENTE se for de unidade permitida (senão 404).
async function carregarAcompanhamento(req, id, executor = { consultarUm }, { travar = false } = {}) {
  const acId = inteiroPositivo(id);
  if (!acId) throw erros.naoEncontrado();
  const params = { id: acId };
  const where = clausulaUnidades(req, 'ac.unidade_id', params);
  const dica = travar ? ' WITH (UPDLOCK, ROWLOCK)' : '';
  const ac = await executor.consultarUm(
    `SELECT ac.id, ac.familia_id, ac.unidade_id, ac.usuario_id, ac.data_inicio, ac.data_prevista_final,
            ac.data_encerramento, ac.status, ac.observacoes
       FROM acompanhamento ac${dica}
      WHERE ac.id = @id AND ${where}`,
    params,
  );
  if (!ac) throw erros.naoEncontrado('Acompanhamento não encontrado.');
  return ac;
}

function exigirEmAndamento(ac) {
  if (ac.status !== 'EM_ANDAMENTO') {
    throw erros.conflito('Este acompanhamento já foi encerrado e não pode mais ser alterado.');
  }
}

// ---------- listagem ----------

const STATUS = ['EM_ANDAMENTO', 'CONCLUIDO', 'DESLIGADO'];
const SITUACOES = ['PENDENTE', 'EM_DIA', 'VENCENDO', 'VENCIDO', 'CONCLUIDO'];

const escaparLike = (t) => t.replace(/[\\%_[]/g, (c) => `\\${c}`);

async function listar(req, consulta) {
  const hoje = hojeIso();
  const { alertaDias, semContatoDias } = await lerConfiguracao();

  const params = { hoje: [tipos.Date, hoje], alerta: alertaDias, semContato: semContatoDias };
  const filtros = [clausulaUnidades(req, 'ac.unidade_id', params)];

  if (consulta.unidadeId !== undefined && consulta.unidadeId !== '') {
    const un = inteiroPositivo(consulta.unidadeId);
    if (!un) throw erros.validacao({ unidadeId: 'Unidade inválida.' });
    exigirUnidade(req, un);
    filtros.push('ac.unidade_id = @unidadeFiltro');
    params.unidadeFiltro = un;
  }
  if (consulta.status) {
    if (!STATUS.includes(consulta.status)) throw erros.validacao({ status: 'Situação inválida.' });
    filtros.push('ac.status = @status');
    params.status = consulta.status;
  }
  const filtrosExternos = [];
  if (consulta.finalSituacao) {
    if (!SITUACOES.includes(consulta.finalSituacao)) throw erros.validacao({ finalSituacao: 'Situação do questionário final inválida.' });
    filtrosExternos.push(consulta.finalSituacao === 'PENDENTE'
      ? "situacao_final IN ('EM_DIA', 'VENCENDO', 'VENCIDO')"
      : 'situacao_final = @situacao');
    if (consulta.finalSituacao !== 'PENDENTE') params.situacao = consulta.finalSituacao;
  }
  if (consulta.contato) {
    if (consulta.contato !== 'SEM_CONTATO') throw erros.validacao({ contato: 'Filtro de contato inválido.' });
    filtrosExternos.push(`(${contato.SQL_SEM_CONTATO})`);
  }
  const filtroSituacao = filtrosExternos.length ? `WHERE ${filtrosExternos.join(' AND ')}` : '';
  const busca = texto(consulta.q, 100);
  if (busca) {
    const partes = ["p.nome LIKE @busca ESCAPE '\\'"];
    params.busca = `%${escaparLike(busca)}%`;
    const digitos = apenasDigitos(busca);
    if (digitos.length >= 3) {
      partes.push('p.cpf LIKE @buscaCpf');
      params.buscaCpf = `${digitos}%`;
    }
    filtros.push(`(${partes.join(' OR ')})`);
  }

  const pagina = Math.max(1, inteiroPositivo(consulta.pagina) || 1);
  const tamanho = Math.min(100, inteiroPositivo(consulta.tamanho) || 20);
  params.deslocamento = (pagina - 1) * tamanho;
  params.tamanho = tamanho;

  const cte = `
    WITH base AS (
      SELECT ac.id AS acompanhamento_id, ac.familia_id, ac.unidade_id, un.sigla AS unidade_sigla,
             ac.status, ac.data_inicio, ac.data_prevista_final, ac.data_encerramento,
             p.id AS responsavel_id, p.nome AS responsavel_nome, p.cpf AS responsavel_cpf,
             (SELECT COUNT(*) FROM familia_membro fm WHERE fm.familia_id = ac.familia_id) + 1 AS qtd_membros,
             CAST(CASE WHEN qi.concluido = 1 THEN 1 ELSE 0 END AS BIT) AS inicial_concluido,
             CAST(CASE WHEN qf.concluido = 1 THEN 1 ELSE 0 END AS BIT) AS final_concluido,
             ${contato.sqlUltimoContato('ac', 'f')} AS ultimo_contato,
             CASE
               WHEN ac.status <> 'EM_ANDAMENTO' THEN NULL
               WHEN qf.concluido = 1 THEN 'CONCLUIDO'
               WHEN ac.data_prevista_final IS NULL THEN 'EM_DIA'
               WHEN ac.data_prevista_final < @hoje THEN 'VENCIDO'
               WHEN DATEDIFF(DAY, @hoje, ac.data_prevista_final) <= @alerta THEN 'VENCENDO'
               ELSE 'EM_DIA'
             END AS situacao_final
        FROM acompanhamento ac
        JOIN familia f ON f.id = ac.familia_id
        JOIN pessoa p ON p.id = f.responsavel_pessoa_id
        JOIN unidade un ON un.id = ac.unidade_id
        LEFT JOIN questionario qi ON qi.acompanhamento_id = ac.id AND qi.tipo = 'INICIAL'
        LEFT JOIN questionario qf ON qf.acompanhamento_id = ac.id AND qf.tipo = 'FINAL'
       WHERE ${filtros.join(' AND ')}
    )`;

  const [{ total }] = await consultar(`${cte} SELECT COUNT(*) AS total FROM base ${filtroSituacao}`, params);
  const linhas = await consultar(
    `${cte}
     SELECT * FROM base ${filtroSituacao}
      ORDER BY CASE WHEN status = 'EM_ANDAMENTO' THEN 0 ELSE 1 END,
               CASE situacao_final WHEN 'VENCIDO' THEN 0 WHEN 'VENCENDO' THEN 1 WHEN 'EM_DIA' THEN 2 ELSE 3 END,
               data_prevista_final, responsavel_nome, acompanhamento_id
     OFFSET @deslocamento ROWS FETCH NEXT @tamanho ROWS ONLY`,
    params,
  );

  const itens = linhas.map((l) => {
    const { situacao, dias } = situacaoFinal(
      { status: l.status, finalConcluido: l.finalConcluido, dataPrevistaFinal: l.dataPrevistaFinal }, hoje, alertaDias);
    return {
      acompanhamentoId: l.acompanhamentoId,
      familiaId: l.familiaId,
      unidadeId: l.unidadeId,
      unidadeSigla: l.unidadeSigla,
      status: l.status,
      dataInicio: l.dataInicio,
      dataPrevistaFinal: l.dataPrevistaFinal,
      dataEncerramento: l.dataEncerramento,
      responsavel: { id: l.responsavelId, nome: l.responsavelNome, cpf: l.responsavelCpf },
      qtdMembros: l.qtdMembros,
      inicialConcluido: !!l.inicialConcluido,
      finalConcluido: !!l.finalConcluido,
      finalSituacao: situacao,
      diasParaFinal: dias,
      ...contato.resumoContato({ status: l.status, ultimoContato: l.ultimoContato, hoje, limiteDias: semContatoDias }),
    };
  });
  return { itens, total, pagina, tamanho };
}

// ---------- detalhe ----------

async function detalhar(req, id) {
  const ac = await carregarAcompanhamento(req, id);
  const [familia, membros, questionarios, unidade, assistente] = await Promise.all([
    consultarUm(
      `SELECT f.id, p.id AS pessoa_id, p.cpf, p.nome, p.data_nascimento, p.nis, p.telefone, p.telefone2, p.endereco, p.cep, p.bairro,
              p.trabalho_atual, p.genero_id, p.escolaridade_id, p.raca_id
         FROM familia f JOIN pessoa p ON p.id = f.responsavel_pessoa_id
        WHERE f.id = @familia`, { familia: ac.familiaId }),
    consultar(
      `SELECT id, nome, data_nascimento, idade, genero_id, parentesco, trabalha
         FROM familia_membro WHERE familia_id = @familia ORDER BY id`, { familia: ac.familiaId }),
    consultar(
      `SELECT id, tipo, data_aplicacao, concluido, alterado_em, criado_em
         FROM questionario WHERE acompanhamento_id = @id`, { id: ac.id }),
    consultarUm('SELECT id, sigla, nome FROM unidade WHERE id = @id', { id: ac.unidadeId }),
    consultarUm('SELECT id, nome FROM usuario WHERE id = @id', { id: ac.usuarioId }),
  ]);

  const { alertaDias, semContatoDias } = await lerConfiguracao();
  const resumoQ = (tipo) => {
    const q = questionarios.find((x) => x.tipo === tipo);
    return q
      ? { existe: true, id: q.id, concluido: !!q.concluido, dataAplicacao: q.dataAplicacao }
      : { existe: false, id: null, concluido: false, dataAplicacao: null };
  };
  const inicial = resumoQ('INICIAL');
  const final = resumoQ('FINAL');
  const hoje = hojeIso();
  const { situacao, dias } = situacaoFinal(
    { status: ac.status, finalConcluido: final.concluido, dataPrevistaFinal: ac.dataPrevistaFinal }, hoje, alertaDias);

  return {
    acompanhamentoId: ac.id,
    familiaId: ac.familiaId,
    status: ac.status,
    dataInicio: ac.dataInicio,
    dataPrevistaFinal: ac.dataPrevistaFinal,
    dataEncerramento: ac.dataEncerramento,
    observacoes: ac.observacoes,
    unidade,
    assistente,
    responsavel: familia && {
      pessoaId: familia.pessoaId, cpf: familia.cpf, nome: familia.nome, dataNascimento: familia.dataNascimento,
      nis: familia.nis, telefone: familia.telefone, telefone2: familia.telefone2, endereco: familia.endereco, cep: familia.cep, bairro: familia.bairro,
      trabalhoAtual: familia.trabalhoAtual, generoId: familia.generoId, escolaridadeId: familia.escolaridadeId,
      racaId: familia.racaId,
    },
    membros: membros.map((m) => ({ ...m, trabalha: m.trabalha === null ? null : !!m.trabalha })),
    questionarios: { inicial, final },
    finalSituacao: situacao,
    diasParaFinal: dias,
    comparacaoDisponivel: inicial.concluido && final.concluido,
    contato: await contato.lerResumoContato(ac, hoje, semContatoDias),
    pesquisa: { pendencia: await pesquisaRegras.lerPendencia(ac, hoje) },
  };
}

// ---------- validação de entrada ----------

function validarMembros(entrada, hoje) {
  const problemas = {};
  if (entrada === undefined) return { membros: undefined, problemas };
  if (!Array.isArray(entrada)) {
    return { membros: [], problemas: { membros: 'Lista de membros inválida.' } };
  }
  if (entrada.length > MAX_MEMBROS) problemas.membros = `Informe no máximo ${MAX_MEMBROS} membros.`;

  const membros = entrada.slice(0, MAX_MEMBROS).map((m, i) => {
    const item = m && typeof m === 'object' ? m : {};
    const nome = texto(item.nome, 150);
    if (!nome) problemas[`membros.${i}.nome`] = 'Informe o nome do membro.';
    let dataNascimento = normalizarData(item.dataNascimento);
    if (dataNascimento === undefined) { problemas[`membros.${i}.dataNascimento`] = 'Data de nascimento inválida.'; dataNascimento = null; }
    else if (dataNascimento && dataNascimento > hoje) { problemas[`membros.${i}.dataNascimento`] = 'A data de nascimento não pode ser futura.'; }
    let idade = null;
    if (item.idade !== undefined && item.idade !== null && item.idade !== '') {
      idade = Number(item.idade);
      if (!Number.isInteger(idade) || idade < 0 || idade > 120) { problemas[`membros.${i}.idade`] = 'Idade inválida.'; idade = null; }
    }
    if (dataNascimento) idade = null; // a data de nascimento prevalece; idade só quando ela é desconhecida
    let generoId = null;
    if (item.generoId !== undefined && item.generoId !== null && item.generoId !== '') {
      generoId = inteiroPositivo(item.generoId);
      if (!generoId) problemas[`membros.${i}.generoId`] = 'Gênero inválido.';
    }
    let trabalha = null;
    if (item.trabalha === true || item.trabalha === false) trabalha = item.trabalha;
    else if (item.trabalha !== undefined && item.trabalha !== null && item.trabalha !== '') {
      problemas[`membros.${i}.trabalha`] = 'Responda sim ou não.';
    }
    return { nome, dataNascimento, idade, generoId, parentesco: texto(item.parentesco, 60), trabalha };
  });
  return { membros, problemas };
}

// Dados pessoais do responsável. `exigirCpf`: na criação o CPF é obrigatório e válido.
function validarResponsavel(entrada, hoje, { exigirCpf }) {
  const problemas = {};
  const r = entrada && typeof entrada === 'object' ? entrada : {};
  const chave = (campo) => `responsavel.${campo}`;

  const cpf = normalizarCpf(r.cpf);
  if (exigirCpf) {
    if (!cpf) problemas[chave('cpf')] = 'Informe o CPF do responsável.';
    else if (!cpfValido(cpf)) problemas[chave('cpf')] = 'CPF inválido.';
  }
  const nome = texto(r.nome, 150);
  if (exigirCpf && !nome) problemas[chave('nome')] = 'Informe o nome do responsável.';

  let dataNascimento = normalizarData(r.dataNascimento);
  if (dataNascimento === undefined) { problemas[chave('dataNascimento')] = 'Data de nascimento inválida.'; dataNascimento = null; }
  else if (dataNascimento && dataNascimento > hoje) problemas[chave('dataNascimento')] = 'A data de nascimento não pode ser futura.';

  const nis = apenasDigitos(r.nis) || null;
  if (nis && nis.length > 11) problemas[chave('nis')] = 'O NIS deve ter no máximo 11 dígitos.';
  const cep = normalizarCep(r.cep);
  if (cep && !cepValido(cep)) problemas[chave('cep')] = 'CEP inválido.';
  const tel = {};
  for (const campo of ['telefone', 'telefone2']) {
    const { valor, erro } = normalizarTelefone(r[campo]);
    tel[campo] = valor;
    if (erro) problemas[chave(campo)] = erro;
  }

  const ids = {};
  for (const campo of ['generoId', 'escolaridadeId', 'racaId']) {
    const v = r[campo];
    if (v === undefined || v === null || v === '') ids[campo] = null;
    else {
      ids[campo] = inteiroPositivo(v);
      if (!ids[campo]) problemas[chave(campo)] = 'Opção inválida.';
    }
  }

  return {
    problemas,
    pessoa: {
      cpf, nome, dataNascimento, nis, cep, ...tel,
      endereco: texto(r.endereco, 200), bairro: texto(r.bairro, 100), trabalhoAtual: texto(r.trabalhoAtual, 200),
      ...ids,
    },
  };
}

// Confere se ids de tabelas de apoio existem (evita 409 genérico de FK).
async function conferirApoio(executor, tabela, ids, campoErro, problemas) {
  const lista = [...new Set(ids.filter(Boolean))];
  if (lista.length === 0) return;
  const params = {};
  const marcadores = lista.map((id, i) => { params[`i${i}`] = id; return `@i${i}`; });
  const achados = await executor.consultar(`SELECT id FROM ${tabela} WHERE id IN (${marcadores.join(', ')})`, params);
  if (achados.length !== lista.length) problemas[campoErro] = 'Opção inexistente.';
}

async function conferirTabelasDePessoaEMembros(executor, pessoa, membros, problemas) {
  if (pessoa) {
    await conferirApoio(executor, 'genero', [pessoa.generoId], 'responsavel.generoId', problemas);
    await conferirApoio(executor, 'escolaridade', [pessoa.escolaridadeId], 'responsavel.escolaridadeId', problemas);
    await conferirApoio(executor, 'raca', [pessoa.racaId], 'responsavel.racaId', problemas);
  }
  if (membros) await conferirApoio(executor, 'genero', membros.map((m) => m.generoId), 'membros', problemas);
}

// ---------- escrita: pessoa e membros ----------

const paramData = (v) => [tipos.Date, v ?? null];

// Insere/atualiza a pessoa (responsável) por CPF. Campos não informados NÃO apagam os existentes.
async function gravarPessoa(tx, req, p) {
  const existente = await tx.consultarUm(
    'SELECT id FROM pessoa WITH (UPDLOCK, HOLDLOCK) WHERE cpf = @cpf', { cpf: [tipos.Char(11), p.cpf] });
  const params = {
    nome: p.nome, dataNascimento: paramData(p.dataNascimento), nis: p.nis, telefone: p.telefone, telefone2: p.telefone2, endereco: p.endereco, cep: p.cep,
    bairro: p.bairro, trabalhoAtual: p.trabalhoAtual, generoId: p.generoId, escolaridadeId: p.escolaridadeId,
    racaId: p.racaId, usuario: req.usuario.id,
  };
  if (existente) {
    await tx.consultar(
      `UPDATE pessoa SET nome = @nome,
              data_nascimento = COALESCE(@dataNascimento, data_nascimento), nis = COALESCE(@nis, nis),
              telefone = COALESCE(@telefone, telefone), telefone2 = COALESCE(@telefone2, telefone2),
              endereco = COALESCE(@endereco, endereco), cep = COALESCE(@cep, cep), bairro = COALESCE(@bairro, bairro),
              trabalho_atual = COALESCE(@trabalhoAtual, trabalho_atual), genero_id = COALESCE(@generoId, genero_id),
              escolaridade_id = COALESCE(@escolaridadeId, escolaridade_id), raca_id = COALESCE(@racaId, raca_id),
              alterado_por = @usuario, alterado_em = SYSUTCDATETIME()
        WHERE id = @id`,
      { ...params, id: existente.id });
    return { id: existente.id, criada: false };
  }
  const [nova] = await tx.consultar(
    `INSERT INTO pessoa (cpf, nome, data_nascimento, nis, telefone, telefone2, endereco, cep, bairro, trabalho_atual,
                         genero_id, escolaridade_id, raca_id, criado_por)
     OUTPUT INSERTED.id
     VALUES (@cpf, @nome, @dataNascimento, @nis, @telefone, @telefone2, @endereco, @cep, @bairro, @trabalhoAtual,
             @generoId, @escolaridadeId, @racaId, @usuario)`,
    { ...params, cpf: [tipos.Char(11), p.cpf] });
  return { id: nova.id, criada: true };
}

// Atualização parcial dos dados pessoais de uma pessoa já conhecida (id). CPF não muda aqui.
async function atualizarPessoaPorId(tx, req, pessoaId, p) {
  await tx.consultar(
    `UPDATE pessoa SET nome = COALESCE(@nome, nome),
            data_nascimento = COALESCE(@dataNascimento, data_nascimento), nis = COALESCE(@nis, nis),
            telefone = COALESCE(@telefone, telefone), telefone2 = COALESCE(@telefone2, telefone2),
            endereco = COALESCE(@endereco, endereco), cep = COALESCE(@cep, cep), bairro = COALESCE(@bairro, bairro),
            trabalho_atual = COALESCE(@trabalhoAtual, trabalho_atual), genero_id = COALESCE(@generoId, genero_id),
            escolaridade_id = COALESCE(@escolaridadeId, escolaridade_id), raca_id = COALESCE(@racaId, raca_id),
            alterado_por = @usuario, alterado_em = SYSUTCDATETIME()
      WHERE id = @id`,
    {
      id: pessoaId, nome: p.nome, dataNascimento: paramData(p.dataNascimento), nis: p.nis, telefone: p.telefone,
      telefone2: p.telefone2, endereco: p.endereco,
      cep: p.cep, bairro: p.bairro, trabalhoAtual: p.trabalhoAtual, generoId: p.generoId,
      escolaridadeId: p.escolaridadeId, racaId: p.racaId, usuario: req.usuario.id,
    });
}

// DELETE + INSERT dos membros (padrão N:N das convenções).
async function substituirMembros(tx, req, familiaId, membros) {
  await tx.consultar('DELETE FROM familia_membro WHERE familia_id = @familia', { familia: familiaId });
  for (const m of membros) {
    await tx.consultar(
      `INSERT INTO familia_membro (familia_id, nome, data_nascimento, idade, genero_id, parentesco, trabalha, criado_por)
       VALUES (@familia, @nome, @dataNascimento, @idade, @generoId, @parentesco, @trabalha, @usuario)`,
      {
        familia: familiaId, nome: m.nome, dataNascimento: paramData(m.dataNascimento), idade: m.idade,
        generoId: m.generoId, parentesco: m.parentesco, trabalha: m.trabalha, usuario: req.usuario.id,
      });
  }
}

// ---------- criação ----------

async function criar(req, corpo) {
  const hoje = hojeIso();
  const problemas = {};

  const { problemas: pr, pessoa } = validarResponsavel(corpo.responsavel, hoje, { exigirCpf: true });
  Object.assign(problemas, pr);
  const { membros, problemas: pm } = validarMembros(corpo.membros === undefined ? [] : corpo.membros, hoje);
  Object.assign(problemas, pm);

  let dataInicio = normalizarData(corpo.dataInicio || hoje);
  if (dataInicio === undefined) problemas.dataInicio = 'Informe uma data de início válida.';
  else if (dataInicio > hoje) problemas.dataInicio = 'A data de início não pode ser futura.';
  lancarSeErros(problemas);
  dataInicio = dataInicio || hoje;

  const unidadeId = resolverUnidade(req, corpo.unidadeId);
  const observacoes = texto(corpo.observacoes, 4000);

  const resultado = await transacao(async (tx) => {
    await conferirTabelasDePessoaEMembros(tx, pessoa, membros, problemas);
    lancarSeErros(problemas);

    const { prazoDias } = await lerConfiguracao(tx);
    const dataPrevistaFinal = somarDias(dataInicio, prazoDias);

    const { id: pessoaId, criada } = await gravarPessoa(tx, req, pessoa);

    let familia = await tx.consultarUm(
      'SELECT id FROM familia WITH (UPDLOCK, HOLDLOCK) WHERE responsavel_pessoa_id = @pessoa', { pessoa: pessoaId });
    if (familia) {
      const ativo = await tx.consultarUm(
        "SELECT id, unidade_id FROM acompanhamento WHERE familia_id = @familia AND status = 'EM_ANDAMENTO'",
        { familia: familia.id });
      if (ativo) {
        // Não revela detalhes de outra unidade: só diz que existe.
        if (unidadesPermitidas(req).includes(ativo.unidadeId)) {
          throw erros.conflito('Esta família já está em acompanhamento.', { acompanhamentoId: ativo.id });
        }
        throw erros.conflito('Esta família já está em acompanhamento em outra unidade.');
      }
    } else {
      [familia] = await tx.consultar(
        'INSERT INTO familia (responsavel_pessoa_id, criado_por) OUTPUT INSERTED.id VALUES (@pessoa, @usuario)',
        { pessoa: pessoaId, usuario: req.usuario.id });
    }

    await substituirMembros(tx, req, familia.id, membros);

    const [ac] = await tx.consultar(
      `INSERT INTO acompanhamento (familia_id, unidade_id, usuario_id, data_inicio, data_prevista_final, status, observacoes, criado_por)
       OUTPUT INSERTED.id
       VALUES (@familia, @unidade, @usuario, @inicio, @prevista, 'EM_ANDAMENTO', @observacoes, @usuario)`,
      {
        familia: familia.id, unidade: unidadeId, usuario: req.usuario.id, inicio: paramData(dataInicio),
        prevista: paramData(dataPrevistaFinal), observacoes,
      });

    await registrarAuditoria(req, 'CRIAR', 'acompanhamento', ac.id, { familiaId: familia.id, unidadeId, pessoaCriada: criada }, tx);
    return { acompanhamentoId: ac.id, familiaId: familia.id, dataPrevistaFinal };
  });
  return resultado;
}

// ---------- edição ----------

async function atualizar(req, id, corpo) {
  const hoje = hojeIso();
  const problemas = {};

  const { membros, problemas: pm } = validarMembros(corpo.membros, hoje);
  Object.assign(problemas, pm);

  let pessoaParcial = null;
  if (corpo.responsavel !== undefined) {
    const { problemas: pr, pessoa } = validarResponsavel(corpo.responsavel, hoje, { exigirCpf: false });
    Object.assign(problemas, pr);
    pessoaParcial = pessoa;
  }

  let dataInicio;
  if (corpo.dataInicio !== undefined) {
    dataInicio = normalizarData(corpo.dataInicio);
    if (!dataInicio) problemas.dataInicio = 'Informe uma data de início válida.';
    else if (dataInicio > hoje) problemas.dataInicio = 'A data de início não pode ser futura.';
  }
  let dataPrevistaFinal;
  if (corpo.dataPrevistaFinal !== undefined) {
    if (req.usuario.perfil === 'ASSISTENTE') problemas.dataPrevistaFinal = 'Somente o Coordenador altera o prazo do questionário final.';
    else {
      dataPrevistaFinal = normalizarData(corpo.dataPrevistaFinal);
      if (!dataPrevistaFinal) problemas.dataPrevistaFinal = 'Informe uma data válida.';
    }
  }
  const observacoes = corpo.observacoes === undefined ? undefined : texto(corpo.observacoes, 4000);
  lancarSeErros(problemas);

  await transacao(async (tx) => {
    const ac = await carregarAcompanhamento(req, id, tx, { travar: true });
    exigirEmAndamento(ac);
    await conferirTabelasDePessoaEMembros(tx, pessoaParcial, membros, problemas);
    lancarSeErros(problemas);

    if (membros) await substituirMembros(tx, req, ac.familiaId, membros);
    if (pessoaParcial) {
      const familia = await tx.consultarUm('SELECT responsavel_pessoa_id FROM familia WHERE id = @id', { id: ac.familiaId });
      await atualizarPessoaPorId(tx, req, familia.responsavelPessoaId, pessoaParcial);
    }

    const sets = ['alterado_por = @usuario', 'alterado_em = SYSUTCDATETIME()'];
    const params = { id: ac.id, usuario: req.usuario.id };
    if (dataInicio) {
      sets.push('data_inicio = @inicio');
      params.inicio = paramData(dataInicio);
      if (dataPrevistaFinal === undefined) {
        const { prazoDias } = await lerConfiguracao(tx);
        sets.push('data_prevista_final = @prevista');
        params.prevista = paramData(somarDias(dataInicio, prazoDias));
      }
    }
    if (dataPrevistaFinal) { sets.push('data_prevista_final = @prevista'); params.prevista = paramData(dataPrevistaFinal); }
    if (observacoes !== undefined) { sets.push('observacoes = @observacoes'); params.observacoes = observacoes; }
    await tx.consultar(`UPDATE acompanhamento SET ${sets.join(', ')} WHERE id = @id`, params);

    await registrarAuditoria(req, 'ALTERAR', 'acompanhamento', ac.id, {
      membros: membros ? membros.length : undefined, responsavel: !!pessoaParcial,
      dataInicio: dataInicio || undefined, dataPrevistaFinal: dataPrevistaFinal || undefined,
    }, tx);
  });
}

// ---------- encerramento ----------

async function encerrar(req, id, corpo) {
  const problemas = {};
  const status = corpo.status;
  if (status !== 'CONCLUIDO' && status !== 'DESLIGADO') problemas.status = 'Escolha "Concluído" ou "Desligado".';
  const hoje = hojeIso();
  let dataEncerramento = normalizarData(corpo.dataEncerramento || hoje);
  if (dataEncerramento === undefined) problemas.dataEncerramento = 'Informe uma data válida.';
  else if (dataEncerramento > hoje) problemas.dataEncerramento = 'A data de encerramento não pode ser futura.';
  const observacoes = texto(corpo.observacoes, 4000);
  if (status === 'DESLIGADO' && !observacoes) problemas.observacoes = 'Informe o motivo do desligamento.';
  lancarSeErros(problemas);
  dataEncerramento = dataEncerramento || hoje;

  await transacao(async (tx) => {
    const ac = await carregarAcompanhamento(req, id, tx, { travar: true });
    exigirEmAndamento(ac);
    if (dataEncerramento < isoData(ac.dataInicio)) {
      throw erros.validacao({ dataEncerramento: 'A data de encerramento não pode ser anterior ao início do acompanhamento.' });
    }
    if (status === 'CONCLUIDO') {
      const final = await tx.consultarUm(
        "SELECT concluido FROM questionario WHERE acompanhamento_id = @id AND tipo = 'FINAL'", { id: ac.id });
      if (!final || !final.concluido) {
        throw erros.conflito('Para concluir o acompanhamento é preciso concluir o questionário final. Se a família saiu do programa, use "Desligado".');
      }
    }
    await tx.consultar(
      `UPDATE acompanhamento
          SET status = @status, data_encerramento = @encerramento,
              observacoes = COALESCE(@observacoes, observacoes),
              alterado_por = @usuario, alterado_em = SYSUTCDATETIME()
        WHERE id = @id`,
      { id: ac.id, status, encerramento: paramData(dataEncerramento), observacoes, usuario: req.usuario.id });
    await registrarAuditoria(req, 'ALTERAR', 'acompanhamento', ac.id, { encerrar: status }, tx);
  });
}

module.exports = {
  hojeIso,
  somarDias,
  lerConfiguracao,
  situacaoFinal,
  carregarAcompanhamento,
  exigirEmAndamento,
  listar,
  detalhar,
  criar,
  atualizar,
  encerrar,
  // exportados para testes
  validarMembros,
  validarResponsavel,
};
