'use strict';

// F2 — Registros de acompanhamento (contato/visita) e linha do tempo da família.
// Regras de unidade: tudo passa por carregarAcompanhamento (outra unidade => 404); a linha do tempo só
// mostra atendimentos de unidades permitidas ao usuário (CONVENCOES §2.3).
// Privacidade (D11, revista em 21/10/2026): o ADMIN opera como a coordenação e lê os textos livres como ela.

const { consultar, consultarUm, transacao, tipos } = require('../db');
const { clausulaUnidades } = require('../middlewares/auth');
const { erros } = require('../lib/erros');
const { ehCoordenacao } = require('../lib/dominios');
const { registrarAuditoria } = require('../lib/auditoria');
const { normalizarData, texto, inteiroPositivo, lancarSeErros } = require('../lib/validacao');
const familias = require('./familias');
const contato = require('./acompanhamento-contato');
const pesquisa = require('./pesquisa');
const metas = require('./acompanhamento-metas');
const metasRegras = require('./metas-regras');

const SITUACOES = Object.freeze(['MELHORANDO', 'IGUAL', 'PIORANDO', 'NAO_SEI']);
const TIPOS_EVENTO = Object.freeze(['INICIO', 'QUESTIONARIO', 'REGISTRO', 'ATENDIMENTO', 'ENCAMINHAMENTO', 'PESQUISA', 'META', 'PRAZO', 'ENCERRAMENTO']);
// Desempate de eventos na mesma data/momento (maior = mais acima na lista, que é do mais novo ao mais antigo)
const PESO = Object.freeze({ PRAZO: 7, ENCERRAMENTO: 6, QUESTIONARIO: 4, REGISTRO: 4, PESQUISA: 4, META: 3, ENCAMINHAMENTO: 3, ATENDIMENTO: 2, INICIO: 1 });

const isoData = (valor) => (valor ? new Date(valor).toISOString().slice(0, 10) : null);
const paramData = (v) => [tipos.Date, v ?? null];

// ---------------------------------------------------------------------------
// Validação (pura, exportada para teste)
// ---------------------------------------------------------------------------

// `tiposAtivos`: [{ id, nome, exigeTexto }]. Devolve { dados, erros }.
function validarRegistro(corpo, { hoje, dataInicio, tiposAtivos }) {
  const problemas = {};

  let dataRegistro = normalizarData(corpo.dataRegistro || hoje);
  if (dataRegistro === undefined) problemas.dataRegistro = 'Informe uma data válida.';
  else if (dataRegistro > hoje) problemas.dataRegistro = 'A data do contato não pode ser futura.';
  else if (dataInicio && dataRegistro < dataInicio) {
    problemas.dataRegistro = 'A data não pode ser anterior ao início do acompanhamento. Se o contato foi antes, ajuste a data de início da família.';
  }
  dataRegistro = dataRegistro || hoje;

  const tipoContatoId = inteiroPositivo(corpo.tipoContatoId);
  const tipo = tiposAtivos.find((t) => t.id === tipoContatoId);
  if (!tipoContatoId || !tipo) problemas.tipoContatoId = 'Escolha o tipo de contato.';
  let tipoContatoOutro = texto(corpo.tipoContatoOutro, 200);
  if (tipo && tipo.exigeTexto && !tipoContatoOutro) problemas.tipoContatoOutro = 'Descreva o tipo de contato.';
  if (!tipo || !tipo.exigeTexto) tipoContatoOutro = null;

  let houveContato = corpo.houveContato;
  if (houveContato === 'true' || houveContato === 1) houveContato = true;
  if (houveContato === 'false' || houveContato === 0) houveContato = false;
  if (typeof houveContato !== 'boolean') problemas.houveContato = 'Informe se conseguiu falar com a família.';

  let situacao = null;
  if (houveContato === true) {
    situacao = corpo.situacao;
    if (!SITUACOES.includes(situacao)) { problemas.situacao = 'Escolha como a família está.'; situacao = null; }
  }

  const resumo = texto(corpo.resumo, 1000);
  if (houveContato === true && !resumo) problemas.resumo = 'Escreva um resumo curto do contato.';
  if (corpo.resumo && String(corpo.resumo).trim().length > 1000) problemas.resumo = 'Use no máximo 1000 caracteres.';

  let proximoContatoEm = normalizarData(corpo.proximoContatoEm);
  if (proximoContatoEm === undefined) { problemas.proximoContatoEm = 'Informe uma data válida.'; proximoContatoEm = null; }
  else if (proximoContatoEm && proximoContatoEm < dataRegistro) problemas.proximoContatoEm = 'O próximo contato não pode ser antes do contato registrado.';

  return {
    erros: problemas,
    dados: {
      dataRegistro, tipoContatoId, tipoContatoOutro, houveContato: houveContato === true, situacao, resumo, proximoContatoEm,
    },
  };
}

async function tiposContatoAtivos(executor = { consultar }) {
  return executor.consultar('SELECT id, nome, exige_texto FROM tipo_contato WHERE ativo = 1 ORDER BY ordem, nome');
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const formatarRegistro = (req, r, metasDoRegistro = []) => ({
  id: r.id,
  dataRegistro: r.dataRegistro,
  tipoContatoId: r.tipoContatoId,
  tipoContato: r.tipoContatoNome,
  tipoContatoOutro: r.tipoContatoOutro,
  houveContato: !!r.houveContato,
  situacao: r.situacao,
  resumo: r.resumo ?? null,
  proximoContatoEm: r.proximoContatoEm,
  metas: metasDoRegistro.map((m) => ({ ...m, dimensaoNome: metasRegras.DIMENSOES[m.dimensao] })),
  autor: { id: r.usuarioId, nome: r.autorNome },
  criadoEm: r.criadoEm,
  alteradoEm: r.alteradoEm,
  // quem pode editar/anular: o autor ou a coordenação/ADMIN (a rota ainda confere)
  podeAlterar: r.usuarioId === req.usuario.id || ehCoordenacao(req.usuario),
});

async function listarRegistros(req, acompanhamentoId) {
  const ac = await familias.carregarAcompanhamento(req, acompanhamentoId);
  const hoje = familias.hojeIso();
  const [config, linhas, tiposContato, metasPorReg] = await Promise.all([
    familias.lerConfiguracao(),
    consultar(
      `SELECT r.id, r.data_registro, r.tipo_contato_id, tc.nome AS tipo_contato_nome, r.tipo_contato_outro, r.houve_contato,
              r.situacao, r.resumo, r.proximo_contato_em, r.usuario_id, u.nome AS autor_nome, r.criado_em, r.alterado_em
         FROM acompanhamento_registro r
         JOIN tipo_contato tc ON tc.id = r.tipo_contato_id
         JOIN usuario u ON u.id = r.usuario_id
        WHERE r.acompanhamento_id = @id AND r.anulado_em IS NULL
        ORDER BY r.data_registro DESC, r.id DESC`,
      { id: ac.id },
    ),
    tiposContatoAtivos(),
    metas.metasPorRegistro(ac.id),
  ]);
  return {
    acompanhamentoId: ac.id,
    status: ac.status,
    semContatoDias: config.semContatoDias,
    resumo: await contato.lerResumoContato(ac, hoje, config.semContatoDias),
    tiposContato: tiposContato.map((t) => ({ id: t.id, nome: t.nome, exigeTexto: !!t.exigeTexto })),
    registros: linhas.map((r) => formatarRegistro(req, r, metasPorReg.get(r.id) || [])),
  };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

async function carregarRegistro(executor, acId, registroId) {
  const id = inteiroPositivo(registroId);
  if (!id) throw erros.naoEncontrado('Registro não encontrado.');
  const r = await executor.consultarUm(
    `SELECT id, acompanhamento_id, usuario_id, anulado_em FROM acompanhamento_registro
      WHERE id = @id AND acompanhamento_id = @ac`,
    { id, ac: acId },
  );
  if (!r || r.anuladoEm) throw erros.naoEncontrado('Registro não encontrado.');
  return r;
}

function exigirAutorOuCoordenacao(req, registro) {
  if (registro.usuarioId !== req.usuario.id && !ehCoordenacao(req.usuario)) {
    throw erros.proibido('Somente quem fez o registro ou a coordenação pode alterá-lo.');
  }
}

async function criarRegistro(req, acompanhamentoId, corpo) {
  const hoje = familias.hojeIso();
  const id = await transacao(async (tx) => {
    const ac = await familias.carregarAcompanhamento(req, acompanhamentoId, tx, { travar: true });
    familias.exigirEmAndamento(ac);
    const { dados, erros: problemas } = validarRegistro(corpo, {
      hoje, dataInicio: isoData(ac.dataInicio), tiposAtivos: (await tiposContatoAtivos(tx)).map((t) => ({ id: t.id, exigeTexto: !!t.exigeTexto })),
    });
    const marcadas = metasRegras.validarMetasDoRegistro(corpo.metas, { houveContato: dados.houveContato, abertas: await metas.metasMarcaveis(tx, ac.id) });
    lancarSeErros({ ...problemas, ...marcadas.erros });
    const [novo] = await tx.consultar(
      `INSERT INTO acompanhamento_registro
         (acompanhamento_id, usuario_id, data_registro, tipo_contato_id, tipo_contato_outro, houve_contato, situacao,
          resumo, proximo_contato_em, criado_por)
       OUTPUT INSERTED.id
       VALUES (@ac, @usuario, @data, @tipo, @outro, @houve, @situacao, @resumo, @proximo, @usuario)`,
      {
        ac: ac.id, usuario: req.usuario.id, data: paramData(dados.dataRegistro), tipo: dados.tipoContatoId,
        outro: dados.tipoContatoOutro, houve: dados.houveContato, situacao: dados.situacao, resumo: dados.resumo,
        proximo: paramData(dados.proximoContatoEm),
      },
    );
    if (marcadas.itens.length) await metas.gravarMetasDoRegistro(tx, novo.id, marcadas.itens);
    await registrarAuditoria(req, 'CRIAR', 'acompanhamento_registro', novo.id,
      { acompanhamentoId: ac.id, houveContato: dados.houveContato, situacao: dados.situacao, metas: marcadas.itens.length }, tx);
    return novo.id;
  });
  return { id };
}

async function atualizarRegistro(req, acompanhamentoId, registroId, corpo) {
  const hoje = familias.hojeIso();
  await transacao(async (tx) => {
    const ac = await familias.carregarAcompanhamento(req, acompanhamentoId, tx, { travar: true });
    familias.exigirEmAndamento(ac);
    const registro = await carregarRegistro(tx, ac.id, registroId);
    exigirAutorOuCoordenacao(req, registro);
    // tipos inativos já usados por este registro continuam aceitos na edição
    const ativos = (await tiposContatoAtivos(tx)).map((t) => ({ id: t.id, exigeTexto: !!t.exigeTexto }));
    const atual = await tx.consultarUm(
      'SELECT tc.id, tc.exige_texto FROM acompanhamento_registro r JOIN tipo_contato tc ON tc.id = r.tipo_contato_id WHERE r.id = @id',
      { id: registro.id });
    if (atual && !ativos.some((t) => t.id === atual.id)) ativos.push({ id: atual.id, exigeTexto: !!atual.exigeTexto });
    const { dados, erros: problemas } = validarRegistro(corpo, { hoje, dataInicio: isoData(ac.dataInicio), tiposAtivos: ativos });
    // metas: só mexe nelas se vierem no corpo (ou se virou tentativa sem contato, que não marca metas)
    const mexeEmMetas = corpo.metas !== undefined || !dados.houveContato;
    const marcadas = mexeEmMetas
      ? metasRegras.validarMetasDoRegistro(corpo.metas ?? [], { houveContato: dados.houveContato, abertas: await metas.metasMarcaveis(tx, ac.id, registro.id) })
      : { erros: {}, itens: [] };
    lancarSeErros({ ...problemas, ...marcadas.erros });
    await tx.consultar(
      `UPDATE acompanhamento_registro
          SET data_registro = @data, tipo_contato_id = @tipo, tipo_contato_outro = @outro, houve_contato = @houve,
              situacao = @situacao, resumo = @resumo, proximo_contato_em = @proximo,
              alterado_por = @usuario, alterado_em = SYSUTCDATETIME()
        WHERE id = @id`,
      {
        id: registro.id, usuario: req.usuario.id, data: paramData(dados.dataRegistro), tipo: dados.tipoContatoId,
        outro: dados.tipoContatoOutro, houve: dados.houveContato, situacao: dados.situacao, resumo: dados.resumo,
        proximo: paramData(dados.proximoContatoEm),
      },
    );
    if (mexeEmMetas) await metas.gravarMetasDoRegistro(tx, registro.id, marcadas.itens);
    await registrarAuditoria(req, 'ALTERAR', 'acompanhamento_registro', registro.id, { acompanhamentoId: ac.id }, tx);
  });
}

async function anularRegistro(req, acompanhamentoId, registroId, corpo) {
  const motivo = texto(corpo.motivo, 200);
  if (!motivo) throw erros.validacao({ motivo: 'Informe o motivo da anulação.' });
  await transacao(async (tx) => {
    const ac = await familias.carregarAcompanhamento(req, acompanhamentoId, tx, { travar: true });
    familias.exigirEmAndamento(ac);
    const registro = await carregarRegistro(tx, ac.id, registroId);
    exigirAutorOuCoordenacao(req, registro);
    await tx.consultar(
      `UPDATE acompanhamento_registro
          SET anulado_em = SYSUTCDATETIME(), anulado_por = @usuario, anulado_motivo = @motivo,
              alterado_por = @usuario, alterado_em = SYSUTCDATETIME()
        WHERE id = @id`,
      { id: registro.id, usuario: req.usuario.id, motivo },
    );
    await registrarAuditoria(req, 'EXCLUIR', 'acompanhamento_registro', registro.id, { acompanhamentoId: ac.id, anulado: true }, tx);
  });
}

// ---------------------------------------------------------------------------
// Linha do tempo
// ---------------------------------------------------------------------------

const TITULO_QUESTIONARIO = {
  INICIAL: 'Questionário inicial concluído',
  REAVALIACAO: 'Reavaliação rápida concluída',
  FINAL: 'Questionário final concluído',
};

const TITULO_META_FIM = { ATINGIDA: 'Meta atingida', NAO_ATINGIDA: 'Meta não atingida', CANCELADA: 'Meta cancelada' };
const ROTULO_AVANCO = { AVANCOU: 'avançou', SEM_MUDANCA: 'sem mudança', RETROCEDEU: 'retrocedeu' };

// Pura: transforma as linhas lidas em eventos {data, momento, tipo, titulo, ...}. Exportada para teste.
function montarEventos({ ac, hoje, registros, atendimentos, questionarios, familiaNome, pesquisas = [], metas: metasAc = [] }) {
  const eventos = [];
  const txt = (v) => v || null;
  const inicio = isoData(ac.dataInicio);

  eventos.push({
    tipo: 'INICIO', data: inicio, momento: ac.criadoEm ? new Date(ac.criadoEm).toISOString() : `${inicio}T00:00:00.000Z`,
    titulo: 'Início do acompanhamento', detalhe: familiaNome ? `Responsável: ${familiaNome}` : null, resumo: null,
    autor: ac.assistenteNome || null, referencia: { tipo: 'ACOMPANHAMENTO', id: ac.id },
  });

  for (const q of questionarios) {
    eventos.push({
      tipo: 'QUESTIONARIO', data: isoData(q.dataAplicacao), momento: new Date(q.alteradoEm || q.criadoEm).toISOString(),
      titulo: TITULO_QUESTIONARIO[q.tipo] || 'Questionário concluído', detalhe: null, resumo: null,
      autor: q.autorNome || null, referencia: { tipo: 'QUESTIONARIO', id: q.id, subtipo: q.tipo },
    });
  }

  for (const r of registros) {
    const quem = r.tipoContatoOutro ? `${r.tipoContatoNome} — ${r.tipoContatoOutro}` : r.tipoContatoNome;
    eventos.push({
      tipo: 'REGISTRO', data: isoData(r.dataRegistro), momento: new Date(r.criadoEm).toISOString(),
      titulo: r.houveContato ? `Contato: ${quem}` : `Tentativa sem sucesso: ${quem}`,
      detalhe: r.houveContato
        ? ((r.metasTratadas || []).length ? `Metas: ${r.metasTratadas.map((m) => `${m.descricao} (${ROTULO_AVANCO[m.avanco]})`).join('; ')}` : null)
        : 'Não foi possível falar com a família.', // a situação aparece no selo
      resumo: txt(r.resumo), autor: r.autorNome,
      situacao: r.houveContato ? r.situacao : null,
      proximoContatoEm: isoData(r.proximoContatoEm),
      referencia: { tipo: 'REGISTRO', id: r.id },
    });
  }

  for (const a of atendimentos) {
    const data = isoData(a.dataAtendimento);
    const momento = new Date(a.criadoEm).toISOString();
    const demandas = [a.demandas, a.demandaOutra && `Outra: ${a.demandaOutra}`].filter(Boolean).join(' · ');
    eventos.push({
      tipo: 'ATENDIMENTO', data, momento, titulo: `Atendimento social — ${a.unidadeSigla}`,
      detalhe: demandas ? `Demandas: ${demandas}` : null, resumo: txt(a.resumo), autor: a.autorNome,
      antesDoInicio: data < inicio, referencia: { tipo: 'ATENDIMENTO', id: a.id },
    });
    const enc = [a.encaminhamentos, a.encaminhamentoOutro && `Outra: ${a.encaminhamentoOutro}`].filter(Boolean).join(' · ');
    if (enc) {
      eventos.push({
        tipo: 'ENCAMINHAMENTO', data, momento, titulo: 'Encaminhamentos', detalhe: enc, resumo: null, autor: a.autorNome,
        antesDoInicio: data < inicio, referencia: { tipo: 'ATENDIMENTO', id: a.id },
      });
    }
  }

  for (const m of metasAc) {
    const dimensao = metasRegras.DIMENSOES[m.dimensao] || m.dimensao;
    const prazo = m.prazo ? ` · prazo ${isoData(m.prazo).split('-').reverse().join('/')}` : '';
    eventos.push({
      tipo: 'META', data: isoData(m.criadoEm), momento: new Date(m.criadoEm).toISOString(),
      titulo: 'Meta definida', detalhe: `${dimensao}${prazo}`, resumo: txt(m.descricao), autor: m.autorNome,
      referencia: { tipo: 'META', id: m.id },
    });
    if (m.status !== 'EM_ANDAMENTO' && m.concluidaEm) {
      const data = isoData(m.concluidaEm);
      eventos.push({
        tipo: 'META', data, momento: m.alteradoEm ? new Date(m.alteradoEm).toISOString() : `${data}T00:00:00.000Z`,
        titulo: TITULO_META_FIM[m.status] || 'Meta encerrada', detalhe: dimensao, resumo: txt(m.descricao), autor: m.autorNome,
        referencia: { tipo: 'META', id: m.id },
      });
    }
  }

  const ROTULO_MOMENTO = { FINAL: 'ao encerrar', SEMESTRAL: 'semestral', AVULSA: 'avulsa' };
  for (const p of pesquisas) {
    const quando = ROTULO_MOMENTO[p.momento] || '';
    if (p.situacao === 'RECUSADA') {
      eventos.push({
        tipo: 'PESQUISA', data: isoData(p.dataAplicacao), momento: new Date(p.criadoEm).toISOString(),
        titulo: 'Pesquisa de satisfação: a família preferiu não responder', detalhe: `Pesquisa ${quando}`, resumo: null,
        autor: p.autorNome, referencia: { tipo: 'PESQUISA', id: p.id },
      });
      continue;
    }
    const r = p.resumo || {};
    const partes = [];
    if (r.nps !== null && r.nps !== undefined) partes.push(`Nota geral: ${r.nps} de 10`);
    if (r.indice !== null && r.indice !== undefined) partes.push(`Satisfação: ${r.indice}%`);
    const comentarios = p.comentarios.map((c) => `${c.codigo === 'T1' ? 'Faz de melhor' : 'Precisa melhorar'}: ${c.texto}`).join('\n');
    eventos.push({
      tipo: 'PESQUISA', data: isoData(p.dataAplicacao), momento: new Date(p.criadoEm).toISOString(),
      titulo: 'Pesquisa de satisfação aplicada', detalhe: [`Pesquisa ${quando}`, ...partes].join(' · '), resumo: txt(comentarios),
      autor: p.autorNome, nps: r.nps ?? null, categoriaNps: r.categoriaNps ?? null, referencia: { tipo: 'PESQUISA', id: p.id },
    });
  }

  if (ac.status === 'EM_ANDAMENTO' && ac.dataPrevistaFinal && !questionarios.some((q) => q.tipo === 'FINAL')) {
    const prazo = isoData(ac.dataPrevistaFinal);
    eventos.push({
      tipo: 'PRAZO', data: prazo, momento: `${prazo}T00:00:00.000Z`,
      titulo: prazo < hoje ? 'Prazo do questionário final vencido' : 'Prazo do questionário final',
      detalhe: null, resumo: null, autor: null, futuro: prazo > hoje, vencido: prazo < hoje, referencia: { tipo: 'ACOMPANHAMENTO', id: ac.id },
    });
  }

  if (ac.dataEncerramento && ac.status !== 'EM_ANDAMENTO') {
    const data = isoData(ac.dataEncerramento);
    eventos.push({
      tipo: 'ENCERRAMENTO', data, momento: ac.alteradoEm ? new Date(ac.alteradoEm).toISOString() : `${data}T00:00:00.000Z`,
      titulo: ac.status === 'CONCLUIDO' ? 'Acompanhamento concluído' : 'Acompanhamento encerrado (desligado)',
      detalhe: null, resumo: txt(ac.observacoes), autor: null, referencia: { tipo: 'ACOMPANHAMENTO', id: ac.id },
    });
  }

  // mais novo primeiro; mesma data => momento; mesmo momento => peso (desfecho acima da causa)
  eventos.sort((x, y) =>
    y.data.localeCompare(x.data) || y.momento.localeCompare(x.momento) || (PESO[y.tipo] - PESO[x.tipo]));
  return eventos;
}

function lerTipos(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const lista = String(valor).split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
  const invalido = lista.find((t) => !TIPOS_EVENTO.includes(t));
  if (invalido) throw erros.validacao({ tipos: `Tipo de evento inválido: ${invalido}.` });
  return new Set(lista);
}

async function linhaDoTempo(req, acompanhamentoId, consulta = {}) {
  const filtroTipos = lerTipos(consulta.tipos);
  const pagina = Math.max(1, inteiroPositivo(consulta.pagina) || 1);
  const tamanho = Math.min(100, inteiroPositivo(consulta.tamanho) || 30);

  const ac = await familias.carregarAcompanhamento(req, acompanhamentoId);
  const hoje = familias.hojeIso();
  const familia = await consultarUm(
    'SELECT f.responsavel_pessoa_id, p.nome FROM familia f JOIN pessoa p ON p.id = f.responsavel_pessoa_id WHERE f.id = @familia',
    { familia: ac.familiaId });
  const paramsAt = { pessoa: familia.responsavelPessoaId, hoje: paramData(hoje) };
  const filtroUnidade = clausulaUnidades(req, 'a.unidade_id', paramsAt);

  const [registros, atendimentos, questionarios, assistente, pesquisas, metasAc, metasPorReg] = await Promise.all([
    consultar(
      `SELECT r.id, r.data_registro, r.tipo_contato_outro, tc.nome AS tipo_contato_nome, r.houve_contato, r.situacao, r.resumo,
              r.proximo_contato_em, u.nome AS autor_nome, r.criado_em
         FROM acompanhamento_registro r
         JOIN tipo_contato tc ON tc.id = r.tipo_contato_id
         JOIN usuario u ON u.id = r.usuario_id
        WHERE r.acompanhamento_id = @id AND r.anulado_em IS NULL`,
      { id: ac.id }),
    // atendimentos do RESPONSÁVEL (membros não são "pessoa"), apenas de unidades que o usuário pode ver
    consultar(
        `SELECT a.id, a.data_atendimento, a.criado_em, a.resumo, a.demanda_outra, a.encaminhamento_outro,
                un.sigla AS unidade_sigla, u.nome AS autor_nome,
                (SELECT STRING_AGG(d.nome, N', ') WITHIN GROUP (ORDER BY d.ordem, d.nome)
                   FROM atendimento_demanda ad JOIN demanda d ON d.id = ad.demanda_id WHERE ad.atendimento_id = a.id) AS demandas,
                (SELECT STRING_AGG(e.nome, N', ') WITHIN GROUP (ORDER BY e.ordem, e.nome)
                   FROM atendimento_encaminhamento ae JOIN encaminhamento e ON e.id = ae.encaminhamento_id WHERE ae.atendimento_id = a.id) AS encaminhamentos
           FROM atendimento a
           JOIN unidade un ON un.id = a.unidade_id
           JOIN usuario u ON u.id = a.usuario_id
          WHERE a.pessoa_id = @pessoa AND a.data_atendimento <= @hoje AND ${filtroUnidade}`,
        paramsAt),
    consultar(
      `SELECT q.id, q.tipo, q.data_aplicacao, q.criado_em, q.alterado_em, u.nome AS autor_nome
         FROM questionario q LEFT JOIN usuario u ON u.id = COALESCE(q.alterado_por, q.criado_por)
        WHERE q.acompanhamento_id = @id AND q.concluido = 1`,
      { id: ac.id }),
    consultarUm('SELECT nome FROM usuario WHERE id = @id', { id: ac.usuarioId }),
    pesquisa.paraLinhaDoTempo(req, ac.id),
    metas.paraLinhaDoTempo(ac.id),
    metas.metasPorRegistro(ac.id),
  ]);

  let eventos = montarEventos({
    ac: { ...ac, assistenteNome: assistente?.nome }, hoje, registros: registros.map((r) => ({ ...r, metasTratadas: metasPorReg.get(r.id) || [] })), atendimentos, questionarios,
    familiaNome: familia?.nome, pesquisas, metas: metasAc,
  });
  if (filtroTipos) eventos = eventos.filter((e) => filtroTipos.has(e.tipo));
  const total = eventos.length;
  const itens = eventos.slice((pagina - 1) * tamanho, pagina * tamanho);
  return { acompanhamentoId: ac.id, itens, total, pagina, tamanho };
}

module.exports = {
  SITUACOES,
  TIPOS_EVENTO,
  listarRegistros,
  criarRegistro,
  atualizarRegistro,
  anularRegistro,
  linhaDoTempo,
  // exportados para testes
  validarRegistro,
  montarEventos,
};
