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

const MAX_RESUMO = 2000;
const MAX_ORIENTACOES = 20;

// Mês de referência do registro (modelo oficial 2): aceita "AAAA-MM" ou "AAAA-MM-DD" e devolve o dia 1 do mês.
// undefined = não informado; null = em branco; 'AAAA-MM-01'; false = inválido.
function normalizarMes(valor) {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(valor).trim());
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return false;
  return `${m[1]}-${m[2]}-01`;
}

// `tiposAtivos`: [{ id, nome, exigeTexto }]. `usosAtivos` ([{ id }]) e `orientacoesAtivas` ([{ id, exigeTexto }]) só são
// conferidos quando o corpo traz o campo (campo ausente = não mexe no que já está gravado: `undefined` em `dados`).
// Devolve { dados, erros }.
function validarRegistro(corpo, { hoje, dataInicio, tiposAtivos, usosAtivos = [], orientacoesAtivas = [] }) {
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

  const resumo = texto(corpo.resumo, MAX_RESUMO);
  if (houveContato === true && !resumo) problemas.resumo = 'Escreva as observações do profissional sobre o contato.';
  if (corpo.resumo && String(corpo.resumo).trim().length > MAX_RESUMO) problemas.resumo = `Use no máximo ${MAX_RESUMO} caracteres.`;

  let proximoContatoEm = normalizarData(corpo.proximoContatoEm);
  if (proximoContatoEm === undefined) { problemas.proximoContatoEm = 'Informe uma data válida.'; proximoContatoEm = null; }
  else if (proximoContatoEm && proximoContatoEm < dataRegistro) problemas.proximoContatoEm = 'O próximo contato não pode ser antes do contato registrado.';

  // mês de referência: não pode ser futuro nem anterior ao mês do início do acompanhamento
  let mesReferencia = normalizarMes(corpo.mesReferencia);
  if (mesReferencia === false) { problemas.mesReferencia = 'Informe o mês de referência (mês e ano).'; mesReferencia = undefined; }
  else if (mesReferencia && mesReferencia > `${hoje.slice(0, 7)}-01`) problemas.mesReferencia = 'O mês de referência não pode ser futuro.';
  else if (mesReferencia && dataInicio && mesReferencia < `${dataInicio.slice(0, 7)}-01`) problemas.mesReferencia = 'O mês não pode ser anterior ao início do acompanhamento.';

  // uso do Armazém (lista de apoio)
  let usoArmazemId;
  if (corpo.usoArmazemId !== undefined) {
    if (corpo.usoArmazemId === null || corpo.usoArmazemId === '' || houveContato === false) usoArmazemId = null;
    else {
      usoArmazemId = inteiroPositivo(corpo.usoArmazemId);
      if (!usoArmazemId || !usosAtivos.some((u) => u.id === usoArmazemId)) { problemas.usoArmazemId = 'Escolha uma das opções de uso do Armazém.'; usoArmazemId = undefined; }
    }
  }

  // orientações e encaminhamentos (várias; "Outros" pede o texto)
  let orientacaoIds;
  let orientacaoOutro;
  if (corpo.orientacaoIds !== undefined) {
    const brutos = corpo.orientacaoIds === null ? [] : corpo.orientacaoIds;
    if (!Array.isArray(brutos) || brutos.length > MAX_ORIENTACOES) problemas.orientacaoIds = 'Seleção inválida.';
    else {
      const ids = [...new Set(brutos.map(inteiroPositivo))];
      if (ids.includes(null) || ids.some((id) => !orientacoesAtivas.some((o) => o.id === id))) problemas.orientacaoIds = 'Escolha apenas opções da lista.';
      else {
        orientacaoIds = houveContato === false ? [] : ids;
        orientacaoOutro = texto(corpo.orientacaoOutro, 200);
        const pedeTexto = orientacaoIds.some((id) => orientacoesAtivas.find((o) => o.id === id)?.exigeTexto);
        if (pedeTexto && !orientacaoOutro) problemas.orientacaoOutro = 'Descreva a outra orientação ou encaminhamento.';
        if (!pedeTexto) orientacaoOutro = null;
      }
    }
  }

  let familiaAceitaFoto;
  if (corpo.familiaAceitaFoto !== undefined) {
    const v = corpo.familiaAceitaFoto;
    if (v === true || v === 'true' || v === 1) familiaAceitaFoto = true;
    else if (v === false || v === 'false' || v === 0 || v === null) familiaAceitaFoto = false;
    else problemas.familiaAceitaFoto = 'Informe se a família aceitou fotos.';
  }

  return {
    erros: problemas,
    dados: {
      dataRegistro, tipoContatoId, tipoContatoOutro, houveContato: houveContato === true, situacao, resumo, proximoContatoEm,
      mesReferencia, usoArmazemId, orientacaoIds, orientacaoOutro, familiaAceitaFoto,
    },
  };
}

async function tiposContatoAtivos(executor = { consultar }) {
  return executor.consultar('SELECT id, nome, exige_texto FROM ASSOCIAL_tipo_contato WHERE ativo = 1 ORDER BY ordem, nome');
}

// Listas de apoio do formulário (só as ativas): uso do Armazém, orientações/encaminhamentos e frases-sugestão. Uma consulta só.
async function apoiosDoRegistro(executor = { consultar }) {
  const linhas = await executor.consultar(
    `SELECT 'USO' AS lista, id, nome, exige_texto, ordem FROM ASSOCIAL_uso_armazem WHERE ativo = 1
     UNION ALL SELECT 'ORI', id, nome, exige_texto, ordem FROM ASSOCIAL_orientacao_registro WHERE ativo = 1
     UNION ALL SELECT 'FRA', id, nome, exige_texto, ordem FROM ASSOCIAL_frase_registro WHERE ativo = 1
     ORDER BY lista, ordem, nome`);
  const de = (lista) => linhas.filter((l) => l.lista === lista).map((l) => ({ id: l.id, nome: l.nome, exigeTexto: !!l.exigeTexto }));
  return { usosArmazem: de('USO'), orientacoes: de('ORI'), frases: de('FRA') };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const lerJson = (valor) => {
  try { return valor ? JSON.parse(valor) : []; } catch { return []; }
};

const formatarRegistro = (req, r, metasDoRegistro = [], acompanhamentoId = null) => ({
  id: r.id,
  dataRegistro: r.dataRegistro,
  mesReferencia: r.mesReferencia ? isoData(r.mesReferencia) : (r.dataRegistro ? `${isoData(r.dataRegistro).slice(0, 7)}-01` : null),
  usoArmazem: r.usoArmazemId ? { id: r.usoArmazemId, nome: r.usoArmazemNome } : null,
  orientacoes: lerJson(r.orientacoesJson).map((o) => ({ id: o.id, nome: o.nome, exigeTexto: !!o.exige_texto })),
  orientacaoOutro: r.orientacaoOutro ?? null,
  familiaAceitaFoto: !!r.familiaAceitaFoto,
  fotos: lerJson(r.fotosJson).map((f) => ({
    id: f.id, legenda: f.legenda ?? null, dataFoto: f.data_foto,
    url: `/api/familias/acompanhamentos/${acompanhamentoId}/registros/${r.id}/fotos/${f.id}`,
  })),
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
  const [config, linhas, tiposContato, metasPorReg, apoios] = await Promise.all([
    familias.lerConfiguracao(),
    consultar(
      `SELECT r.id, r.data_registro, r.tipo_contato_id, tc.nome AS tipo_contato_nome, r.tipo_contato_outro, r.houve_contato,
              r.situacao, r.resumo, r.proximo_contato_em, r.usuario_id, u.nome AS autor_nome, r.criado_em, r.alterado_em,
              r.mes_referencia, r.uso_armazem_id, ua.nome AS uso_armazem_nome, r.orientacao_outro, r.familia_aceita_foto,
              (SELECT o.id, o.nome, o.exige_texto FROM ASSOCIAL_acompanhamento_registro_orientacao ro JOIN ASSOCIAL_orientacao_registro o ON o.id = ro.orientacao_id
                WHERE ro.registro_id = r.id ORDER BY o.ordem, o.nome FOR JSON PATH) AS orientacoes_json,
              (SELECT f.id, f.legenda, CONVERT(VARCHAR(10), f.data_foto, 23) AS data_foto FROM ASSOCIAL_acompanhamento_registro_foto f
                WHERE f.registro_id = r.id ORDER BY f.data_foto, f.ordem, f.id FOR JSON PATH) AS fotos_json
         FROM ASSOCIAL_acompanhamento_registro r
         JOIN ASSOCIAL_tipo_contato tc ON tc.id = r.tipo_contato_id
         JOIN ASSOCIAL_usuario u ON u.id = r.usuario_id
         LEFT JOIN ASSOCIAL_uso_armazem ua ON ua.id = r.uso_armazem_id
        WHERE r.acompanhamento_id = @id AND r.anulado_em IS NULL
        ORDER BY r.data_registro DESC, r.id DESC`,
      { id: ac.id },
    ),
    tiposContatoAtivos(),
    metas.metasPorRegistro(ac.id),
    apoiosDoRegistro(),
  ]);
  return {
    acompanhamentoId: ac.id,
    status: ac.status,
    semContatoDias: config.semContatoDias,
    resumo: await contato.lerResumoContato(ac, hoje, config.semContatoDias),
    tiposContato: tiposContato.map((t) => ({ id: t.id, nome: t.nome, exigeTexto: !!t.exigeTexto })),
    ...apoios,
    registros: linhas.map((r) => formatarRegistro(req, r, metasPorReg.get(r.id) || [], ac.id)),
  };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

async function carregarRegistro(executor, acId, registroId) {
  const id = inteiroPositivo(registroId);
  if (!id) throw erros.naoEncontrado('Registro não encontrado.');
  const r = await executor.consultarUm(
    `SELECT id, acompanhamento_id, usuario_id, anulado_em, data_registro, familia_aceita_foto FROM ASSOCIAL_acompanhamento_registro
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

async function gravarOrientacoes(tx, registroId, ids) {
  await tx.consultar('DELETE FROM ASSOCIAL_acompanhamento_registro_orientacao WHERE registro_id = @id', { id: registroId });
  for (const orientacaoId of ids) {
    await tx.consultar('INSERT INTO ASSOCIAL_acompanhamento_registro_orientacao (registro_id, orientacao_id) VALUES (@r, @o)', { r: registroId, o: orientacaoId });
  }
}

async function criarRegistro(req, acompanhamentoId, corpo) {
  const hoje = familias.hojeIso();
  const id = await transacao(async (tx) => {
    const ac = await familias.carregarAcompanhamento(req, acompanhamentoId, tx, { travar: true });
    familias.exigirEmAndamento(ac);
    const apoios = (corpo.usoArmazemId !== undefined || corpo.orientacaoIds !== undefined) ? await apoiosDoRegistro(tx) : {};
    const { dados, erros: problemas } = validarRegistro(corpo, {
      hoje, dataInicio: isoData(ac.dataInicio), tiposAtivos: (await tiposContatoAtivos(tx)).map((t) => ({ id: t.id, exigeTexto: !!t.exigeTexto })),
      usosAtivos: apoios.usosArmazem, orientacoesAtivas: apoios.orientacoes,
    });
    const marcadas = metasRegras.validarMetasDoRegistro(corpo.metas, { houveContato: dados.houveContato, abertas: await metas.metasMarcaveis(tx, ac.id) });
    lancarSeErros({ ...problemas, ...marcadas.erros });
    const [novo] = await tx.consultar(
      `INSERT INTO ASSOCIAL_acompanhamento_registro
         (acompanhamento_id, usuario_id, data_registro, tipo_contato_id, tipo_contato_outro, houve_contato, situacao,
          resumo, proximo_contato_em, mes_referencia, uso_armazem_id, orientacao_outro, familia_aceita_foto, criado_por)
       OUTPUT INSERTED.id
       VALUES (@ac, @usuario, @data, @tipo, @outro, @houve, @situacao, @resumo, @proximo, @mes, @uso, @orientacaoOutro, @aceitaFoto, @usuario)`,
      {
        ac: ac.id, usuario: req.usuario.id, data: paramData(dados.dataRegistro), tipo: dados.tipoContatoId,
        outro: dados.tipoContatoOutro, houve: dados.houveContato, situacao: dados.situacao, resumo: dados.resumo,
        proximo: paramData(dados.proximoContatoEm),
        mes: paramData(dados.mesReferencia || `${dados.dataRegistro.slice(0, 7)}-01`), uso: dados.usoArmazemId ?? null,
        orientacaoOutro: dados.orientacaoOutro ?? null, aceitaFoto: dados.familiaAceitaFoto === true,
      },
    );
    if (dados.orientacaoIds?.length) await gravarOrientacoes(tx, novo.id, dados.orientacaoIds);
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
      'SELECT tc.id, tc.exige_texto FROM ASSOCIAL_acompanhamento_registro r JOIN ASSOCIAL_tipo_contato tc ON tc.id = r.tipo_contato_id WHERE r.id = @id',
      { id: registro.id });
    if (atual && !ativos.some((t) => t.id === atual.id)) ativos.push({ id: atual.id, exigeTexto: !!atual.exigeTexto });
    // usos/orientações já gravados neste registro continuam aceitos mesmo se a coordenação os desativou depois
    let apoios = {};
    if (corpo.usoArmazemId !== undefined || corpo.orientacaoIds !== undefined) {
      apoios = await apoiosDoRegistro(tx);
      const gravado = await tx.consultarUm('SELECT uso_armazem_id FROM ASSOCIAL_acompanhamento_registro WHERE id = @id', { id: registro.id });
      if (gravado?.usoArmazemId && !apoios.usosArmazem.some((u) => u.id === gravado.usoArmazemId)) apoios.usosArmazem.push({ id: gravado.usoArmazemId });
      const antigas = await tx.consultar(
        `SELECT o.id, o.exige_texto FROM ASSOCIAL_acompanhamento_registro_orientacao ro
           JOIN ASSOCIAL_orientacao_registro o ON o.id = ro.orientacao_id WHERE ro.registro_id = @id`, { id: registro.id });
      for (const o of antigas) if (!apoios.orientacoes.some((x) => x.id === o.id)) apoios.orientacoes.push({ id: o.id, exigeTexto: !!o.exigeTexto });
    }
    const { dados, erros: problemas } = validarRegistro(corpo, {
      hoje, dataInicio: isoData(ac.dataInicio), tiposAtivos: ativos, usosAtivos: apoios.usosArmazem, orientacoesAtivas: apoios.orientacoes,
    });
    // não dá para desmarcar "a família aceitou fotos" com fotos já anexadas
    if (dados.familiaAceitaFoto === false) {
      const fotos = await tx.consultarUm('SELECT COUNT(*) AS n FROM ASSOCIAL_acompanhamento_registro_foto WHERE registro_id = @id', { id: registro.id });
      if (fotos && fotos.n > 0) problemas.familiaAceitaFoto = 'Remova as fotos deste registro antes de desmarcar o aceite da família.';
    }
    // metas: só mexe nelas se vierem no corpo (ou se virou tentativa sem contato, que não marca metas)
    const mexeEmMetas = corpo.metas !== undefined || !dados.houveContato;
    const marcadas = mexeEmMetas
      ? metasRegras.validarMetasDoRegistro(corpo.metas ?? [], { houveContato: dados.houveContato, abertas: await metas.metasMarcaveis(tx, ac.id, registro.id) })
      : { erros: {}, itens: [] };
    lancarSeErros({ ...problemas, ...marcadas.erros });
    // campos do modelo 2: só mexe nos que vieram no corpo (ausente = mantém); sem contato limpa uso e orientações
    const extra = [];
    const paramsExtra = {};
    if (dados.mesReferencia !== undefined) { extra.push('mes_referencia = @mes'); paramsExtra.mes = paramData(dados.mesReferencia || `${dados.dataRegistro.slice(0, 7)}-01`); }
    if (dados.usoArmazemId !== undefined) { extra.push('uso_armazem_id = @uso'); paramsExtra.uso = dados.usoArmazemId; }
    if (dados.orientacaoIds !== undefined) { extra.push('orientacao_outro = @orientacaoOutro'); paramsExtra.orientacaoOutro = dados.orientacaoOutro ?? null; }
    if (dados.familiaAceitaFoto !== undefined) { extra.push('familia_aceita_foto = @aceitaFoto'); paramsExtra.aceitaFoto = dados.familiaAceitaFoto; }
    await tx.consultar(
      `UPDATE ASSOCIAL_acompanhamento_registro
          SET data_registro = @data, tipo_contato_id = @tipo, tipo_contato_outro = @outro, houve_contato = @houve,
              situacao = @situacao, resumo = @resumo, proximo_contato_em = @proximo${extra.map((e) => `, ${e}`).join('')},
              alterado_por = @usuario, alterado_em = SYSUTCDATETIME()
        WHERE id = @id`,
      {
        id: registro.id, usuario: req.usuario.id, data: paramData(dados.dataRegistro), tipo: dados.tipoContatoId,
        outro: dados.tipoContatoOutro, houve: dados.houveContato, situacao: dados.situacao, resumo: dados.resumo,
        proximo: paramData(dados.proximoContatoEm), ...paramsExtra,
      },
    );
    if (dados.orientacaoIds !== undefined) await gravarOrientacoes(tx, registro.id, dados.orientacaoIds);
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
      `UPDATE ASSOCIAL_acompanhamento_registro
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
        ? ([r.usoArmazemNome && `Armazém: ${r.usoArmazemNome.toLowerCase()}`,
          r.orientacoesTexto && `Orientações: ${r.orientacoesTexto}`,
          (r.metasTratadas || []).length ? `Metas: ${r.metasTratadas.map((m) => `${m.descricao} (${ROTULO_AVANCO[m.avanco]})`).join('; ')}` : null,
        ].filter(Boolean).join(' · ') || null)
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
    'SELECT f.responsavel_pessoa_id, p.nome FROM ASSOCIAL_familia f JOIN ASSOCIAL_pessoa p ON p.id = f.responsavel_pessoa_id WHERE f.id = @familia',
    { familia: ac.familiaId });
  const paramsAt = { pessoa: familia.responsavelPessoaId, hoje: paramData(hoje) };
  const filtroUnidade = clausulaUnidades(req, 'a.unidade_id', paramsAt);

  const [registros, atendimentos, questionarios, assistente, pesquisas, metasAc, metasPorReg] = await Promise.all([
    consultar(
      `SELECT r.id, r.data_registro, r.tipo_contato_outro, tc.nome AS tipo_contato_nome, r.houve_contato, r.situacao, r.resumo,
              r.proximo_contato_em, u.nome AS autor_nome, r.criado_em, ua.nome AS uso_armazem_nome,
              (SELECT STRING_AGG(o.nome, N', ') WITHIN GROUP (ORDER BY o.ordem, o.nome)
                 FROM ASSOCIAL_acompanhamento_registro_orientacao ro JOIN ASSOCIAL_orientacao_registro o ON o.id = ro.orientacao_id
                WHERE ro.registro_id = r.id) AS orientacoes_texto
         FROM ASSOCIAL_acompanhamento_registro r
         JOIN ASSOCIAL_tipo_contato tc ON tc.id = r.tipo_contato_id
         JOIN ASSOCIAL_usuario u ON u.id = r.usuario_id
         LEFT JOIN ASSOCIAL_uso_armazem ua ON ua.id = r.uso_armazem_id
        WHERE r.acompanhamento_id = @id AND r.anulado_em IS NULL`,
      { id: ac.id }),
    // atendimentos do RESPONSÁVEL (membros não são "pessoa"), apenas de unidades que o usuário pode ver
    consultar(
        `SELECT a.id, a.data_atendimento, a.criado_em, a.resumo, a.demanda_outra, a.encaminhamento_outro,
                un.sigla AS unidade_sigla, u.nome AS autor_nome,
                (SELECT STRING_AGG(d.nome, N', ') WITHIN GROUP (ORDER BY d.ordem, d.nome)
                   FROM ASSOCIAL_atendimento_demanda ad JOIN ASSOCIAL_demanda d ON d.id = ad.demanda_id WHERE ad.atendimento_id = a.id) AS demandas,
                (SELECT STRING_AGG(e.nome, N', ') WITHIN GROUP (ORDER BY e.ordem, e.nome)
                   FROM ASSOCIAL_atendimento_encaminhamento ae JOIN ASSOCIAL_encaminhamento e ON e.id = ae.encaminhamento_id WHERE ae.atendimento_id = a.id) AS encaminhamentos
           FROM ASSOCIAL_atendimento a
           JOIN ASSOCIAL_unidade un ON un.id = a.unidade_id
           JOIN ASSOCIAL_usuario u ON u.id = a.usuario_id
          WHERE a.pessoa_id = @pessoa AND a.data_atendimento <= @hoje AND ${filtroUnidade}`,
        paramsAt),
    consultar(
      `SELECT q.id, q.tipo, q.data_aplicacao, q.criado_em, q.alterado_em, u.nome AS autor_nome
         FROM ASSOCIAL_questionario q LEFT JOIN ASSOCIAL_usuario u ON u.id = COALESCE(q.alterado_por, q.criado_por)
        WHERE q.acompanhamento_id = @id AND q.concluido = 1`,
      { id: ac.id }),
    consultarUm('SELECT nome FROM ASSOCIAL_usuario WHERE id = @id', { id: ac.usuarioId }),
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
  // usados pelas fotos do registro e pelo relatório do registro periódico
  carregarRegistro,
  exigirAutorOuCoordenacao,
  apoiosDoRegistro,
  // exportados para testes
  validarRegistro,
  normalizarMes,
  montarEventos,
};
