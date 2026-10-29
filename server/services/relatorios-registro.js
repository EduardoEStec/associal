'use strict';

// Registro periódico de acompanhamento (.docx no formato do modelo oficial 2): prévia editável e geração.
// Os dados da tabela (mês, contato, uso do Armazém, orientações) vêm sempre do banco; a assistente edita só a identificação,
// as observações do profissional de cada registro e a escolha das fotos antes de baixar (mesmo fluxo do relatório individual).

const { consultar, consultarUm } = require('../db');
const { erros } = require('../lib/erros');
const { apenasDigitos, lancarSeErros } = require('../lib/validacao');
const familias = require('./familias');
const docx = require('./relatorios-docx');
const dados = require('./relatorios-dados');
const { dataBr, paragrafos } = require('./relatorios-textos');

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MAX_OBSERVACAO = 4000;
const CAMPOS_IDENTIFICACAO = ['responsavel', 'cpfNis', 'contato', 'endereco', 'profissional'];

const iso = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

// '2026-10-01' -> 'outubro/2026'
function mesExtenso(valor) {
  const d = iso(valor);
  if (!d) return '';
  return `${MESES[Number(d.slice(5, 7)) - 1]}/${d.slice(0, 4)}`;
}

function formatarTelefone(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return '';
}

function formatarCpf(cpf) {
  const d = apenasDigitos(cpf);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (cpf || '');
}

// Lista de datas curtas "10/10, 24/10" (só dia/mês quando todas são do mesmo ano)
const listaTexto = (itens) => itens.filter(Boolean).join(', ');

// Linha da tabela a partir de um registro lido do banco (pura; testada).
function montarLinha(r) {
  const tipo = r.tipoContatoOutro ? `${r.tipoContatoNome} – ${r.tipoContatoOutro}` : r.tipoContatoNome;
  const orientacoes = [r.orientacoesTexto, r.orientacaoOutro && `${r.orientacaoOutroNome || 'Outros'}: ${r.orientacaoOutro}`].filter(Boolean);
  return {
    id: r.id,
    mes: mesExtenso(r.mesReferencia || `${iso(r.dataRegistro).slice(0, 7)}-01`),
    data: iso(r.dataRegistro),
    dataTexto: dataBr(r.dataRegistro),
    contato: r.houveContato ? tipo : `Tentativa sem sucesso – ${tipo}`,
    uso: r.houveContato ? (r.usoArmazemNome || '') : '',
    orientacoes: orientacoes.join('; '),
    observacao: r.resumo || '',
  };
}

// Monta o conteúdo do documento a partir dos dados carregados e das edições (pura; testada).
//   edicoes: { identificacao?: {campo: texto}, observacoes?: {registroId: texto} }
function montarDocumento({ responsavel, linhas, profissional }, edicoes = {}) {
  const idPadrao = {
    responsavel: responsavel.nome || '',
    cpfNis: [formatarCpf(responsavel.cpf), responsavel.nis].filter(Boolean).join(' / '),
    contato: [formatarTelefone(responsavel.telefone), formatarTelefone(responsavel.telefone2) && `${formatarTelefone(responsavel.telefone2)} (recado)`]
      .filter(Boolean).join(' / '),
    endereco: [responsavel.endereco, responsavel.bairro].filter(Boolean).join(' – '),
    profissional: profissional || '',
  };
  const ident = { ...idPadrao, ...(edicoes.identificacao || {}) };
  const observacoes = edicoes.observacoes || {};
  const itens = linhas.map((l) => ({ ...l, observacao: observacoes[l.id] !== undefined ? observacoes[l.id] : l.observacao }));
  const meses = [...new Set(itens.map((l) => l.mes))];
  return {
    identificacao: ident,
    linhas: itens,
    mesesTexto: meses.length > 1 ? `${meses[0]} a ${meses[meses.length - 1]}` : (meses[0] || ''),
    datasTexto: listaTexto(itens.map((l) => l.dataTexto)),
    observacoes: itens
      .filter((l) => (l.observacao || '').trim())
      .map((l) => ({ rotulo: `${l.mes} (${l.dataTexto})`, texto: paragrafos(l.observacao).join(' ') })),
  };
}

async function coletar(req, acompanhamentoId) {
  const ac = await familias.carregarAcompanhamento(req, acompanhamentoId);
  const unidade = await consultarUm('SELECT sigla, nome FROM ASSOCIAL_unidade WHERE id = @id', { id: ac.unidadeId });
  const responsavel = await consultarUm(
    `SELECT p.nome, p.cpf, p.nis, p.telefone, p.telefone2, p.endereco, p.bairro
       FROM ASSOCIAL_familia f JOIN ASSOCIAL_pessoa p ON p.id = f.responsavel_pessoa_id WHERE f.id = @familiaId`,
    { familiaId: ac.familiaId });
  const registros = await consultar(
    `SELECT r.id, r.data_registro, r.mes_referencia, tc.nome AS tipo_contato_nome, r.tipo_contato_outro, r.houve_contato,
            r.resumo, r.orientacao_outro, ua.nome AS uso_armazem_nome,
            (SELECT STRING_AGG(o.nome, N'; ') WITHIN GROUP (ORDER BY o.ordem, o.nome)
               FROM ASSOCIAL_acompanhamento_registro_orientacao ro JOIN ASSOCIAL_orientacao_registro o ON o.id = ro.orientacao_id
              WHERE ro.registro_id = r.id AND o.exige_texto = 0) AS orientacoes_texto,
            (SELECT MIN(o.nome) FROM ASSOCIAL_acompanhamento_registro_orientacao ro JOIN ASSOCIAL_orientacao_registro o ON o.id = ro.orientacao_id
              WHERE ro.registro_id = r.id AND o.exige_texto = 1) AS orientacao_outro_nome
       FROM ASSOCIAL_acompanhamento_registro r
       JOIN ASSOCIAL_tipo_contato tc ON tc.id = r.tipo_contato_id
       LEFT JOIN ASSOCIAL_uso_armazem ua ON ua.id = r.uso_armazem_id
      WHERE r.acompanhamento_id = @id AND r.anulado_em IS NULL
      ORDER BY COALESCE(r.mes_referencia, DATEFROMPARTS(YEAR(r.data_registro), MONTH(r.data_registro), 1)), r.data_registro, r.id`,
    { id: ac.id });
  const fotos = registros.length
    ? await consultar(
      `SELECT f.id, f.registro_id, f.arquivo, f.legenda, f.data_foto
         FROM ASSOCIAL_acompanhamento_registro_foto f JOIN ASSOCIAL_acompanhamento_registro r ON r.id = f.registro_id
        WHERE r.acompanhamento_id = @id AND r.anulado_em IS NULL
        ORDER BY f.data_foto, f.registro_id, f.ordem, f.id`,
      { id: ac.id })
    : [];
  return { ac, unidade, responsavel: responsavel || {}, registros, fotos, linhas: registros.map(montarLinha) };
}

async function previa(req, acompanhamentoId) {
  const c = await coletar(req, acompanhamentoId);
  const doc = montarDocumento({ responsavel: c.responsavel, linhas: c.linhas, profissional: req.usuario.nome });
  const avisos = [];
  if (!c.linhas.length) avisos.push('Este acompanhamento ainda não tem registros de contato: a tabela sairá vazia.');
  return {
    acompanhamento: { id: c.ac.id, status: c.ac.status, dataInicio: c.ac.dataInicio, unidadeSigla: c.unidade?.sigla, unidadeNome: c.unidade?.nome },
    identificacao: doc.identificacao,
    registros: doc.linhas.map((l) => ({
      id: l.id, mes: l.mes, data: l.data, contato: l.contato, uso: l.uso, orientacoes: l.orientacoes, observacao: l.observacao,
    })),
    fotos: c.fotos.map((f) => ({
      id: f.id, registroId: f.registroId, data: iso(f.dataFoto), legenda: f.legenda || '',
      url: `/api/familias/acompanhamentos/${c.ac.id}/registros/${f.registroId}/fotos/${f.id}`,
    })),
    avisos,
  };
}

function lerEdicoes(corpo, registrosValidos) {
  const problemas = {};
  const edicoes = {};
  if (corpo.identificacao !== undefined) {
    if (typeof corpo.identificacao !== 'object' || corpo.identificacao === null || Array.isArray(corpo.identificacao)) {
      throw erros.validacao({ identificacao: 'Dados inválidos.' });
    }
    edicoes.identificacao = {};
    for (const campo of CAMPOS_IDENTIFICACAO) {
      const v = corpo.identificacao[campo];
      if (v === undefined) continue;
      if (typeof v !== 'string' || v.length > 300) problemas[`identificacao.${campo}`] = 'Use no máximo 300 caracteres.';
      else edicoes.identificacao[campo] = v.trim();
    }
  }
  if (corpo.observacoes !== undefined) {
    if (typeof corpo.observacoes !== 'object' || corpo.observacoes === null || Array.isArray(corpo.observacoes)) {
      throw erros.validacao({ observacoes: 'Dados inválidos.' });
    }
    edicoes.observacoes = {};
    for (const [id, v] of Object.entries(corpo.observacoes)) {
      if (!registrosValidos.has(Number(id))) continue; // só registros deste acompanhamento
      if (typeof v !== 'string' || v.length > MAX_OBSERVACAO) problemas[`observacoes.${id}`] = `Use no máximo ${MAX_OBSERVACAO} caracteres.`;
      else edicoes.observacoes[Number(id)] = v.trim();
    }
  }
  lancarSeErros(problemas);
  return edicoes;
}

async function gerar(req, acompanhamentoId) {
  const corpo = req.body || {};
  const c = await coletar(req, acompanhamentoId);
  const edicoes = lerEdicoes(corpo, new Set(c.linhas.map((l) => l.id)));
  const doc = montarDocumento({ responsavel: c.responsavel, linhas: c.linhas, profissional: req.usuario.nome }, edicoes);

  // fotos escolhidas (só ids deste acompanhamento); sem escolha informada, vão todas
  let escolhidas = c.fotos;
  if (corpo.fotos !== undefined) {
    if (!Array.isArray(corpo.fotos)) throw erros.validacao({ fotos: 'Lista de fotos inválida.' });
    const ids = new Set(corpo.fotos.map(Number));
    escolhidas = c.fotos.filter((f) => ids.has(f.id));
  }
  const linhaPorId = new Map(c.linhas.map((l) => [l.id, l]));
  const anexos = await docx.montarAnexos([{
    nome: c.unidade?.nome || '',
    fotos: escolhidas.map((f) => ({
      caminho: dados.caminhoFoto(f.arquivo),
      legenda: [linhaPorId.get(f.registroId)?.contato, f.legenda].filter(Boolean).join(' – '),
      data: f.dataFoto,
      local: '',
    })),
  }]);

  const ident = doc.identificacao;
  const buffer = docx.renderizar('registro-periodico', {
    ...ident,
    mesesTexto: doc.mesesTexto,
    datasTexto: doc.datasTexto,
    linhas: doc.linhas.map((l) => ({ mes: l.mes, dataTexto: l.dataTexto, contato: l.contato, uso: l.uso, orientacoes: l.orientacoes })),
    observacoes: doc.observacoes,
    semObservacoes: doc.observacoes.length === 0,
    semFotos: anexos.xml === '',
  }, anexos);
  const hoje = familias.hojeIso();
  return { buffer, nomeArquivo: `Registro_Periodico_${c.unidade?.sigla || 'UN'}_${acompanhamentoId}_${hoje}.docx` };
}

module.exports = { mesExtenso, montarLinha, montarDocumento, previa, gerar, coletar };
