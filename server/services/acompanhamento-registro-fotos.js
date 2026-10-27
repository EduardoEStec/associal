'use strict';

// Fotos do registro de acompanhamento (modelo oficial 2, ANEXOS): "colocar fotos caso o entrevistado aceite" e
// "colocar a data nas fotos do dia que foi feito o acompanhamento".
//   - só entram em registro com familia_aceita_foto = 1; cada foto guarda a DATA do acompanhamento a que se refere;
//   - o arquivo fica no mesmo armazenamento das fotos das ações (UPLOAD_DIR/acoes, nome aleatório, acesso só pela rota autenticada);
//   - registro anulado não aceita nem perde fotos (a anulação preserva tudo para a auditoria).

const { consultar, consultarUm, transacao, tipos } = require('../db');
const { erros } = require('../lib/erros');
const { registrarAuditoria } = require('../lib/auditoria');
const { normalizarData, texto, inteiroPositivo } = require('../lib/validacao');
const familias = require('./familias');
const registros = require('./acompanhamento-registros');
const arquivos = require('./acoes-fotos');

const MAX_FOTOS_POR_REGISTRO = 20;

const isoData = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

// Antes de aceitar qualquer arquivo: escopo de unidade, acompanhamento em andamento, autor/coordenação e aceite da família.
async function prepararEnvio(req) {
  const ac = await familias.carregarAcompanhamento(req, req.params.id);
  familias.exigirEmAndamento(ac);
  const registro = await registros.carregarRegistro({ consultarUm }, ac.id, req.params.registroId);
  registros.exigirAutorOuCoordenacao(req, registro);
  if (!registro.familiaAceitaFoto) {
    throw erros.conflito('A família não aceitou fotos neste registro. Marque "A família aceitou fotos" no registro para anexá-las.');
  }
  return { ac, registro };
}

// Grava as fotos já recebidas (req.files). `legendas`/`datas` na mesma ordem dos arquivos; sem data vale a data do registro.
async function gravar(req, { ac, registro }, recebidas, corpo) {
  if (!recebidas.length) throw erros.validacao({ fotos: 'Selecione ao menos uma foto.' });
  if (recebidas.some((f) => !arquivos.assinaturaValida(f.path, f.mimetype))) {
    throw erros.validacao({ fotos: 'Um dos arquivos não é uma imagem válida.' });
  }
  const hoje = familias.hojeIso();
  const padrao = isoData(registro.dataRegistro);
  const legendas = [].concat(corpo?.legendas ?? []);
  const datas = [].concat(corpo?.datas ?? []);
  const problemas = {};
  const datasFinais = recebidas.map((_, i) => {
    const bruta = datas[i];
    if (bruta === undefined || bruta === null || bruta === '') return padrao;
    const d = normalizarData(bruta);
    if (!d) { problemas.datas = 'Informe uma data válida para a foto.'; return padrao; }
    if (d > hoje) { problemas.datas = 'A data da foto não pode ser futura.'; return padrao; }
    return d;
  });
  if (Object.keys(problemas).length) throw erros.validacao(problemas);

  return transacao(async (tx) => {
    const atual = await tx.consultarUm(
      'SELECT COUNT(*) AS total, COALESCE(MAX(ordem), 0) AS maior FROM acompanhamento_registro_foto WHERE registro_id = @id', { id: registro.id });
    if (atual.total + recebidas.length > MAX_FOTOS_POR_REGISTRO) {
      throw erros.validacao({ fotos: `Cada registro aceita no máximo ${MAX_FOTOS_POR_REGISTRO} fotos.` });
    }
    const criadas = [];
    for (let i = 0; i < recebidas.length; i += 1) {
      const f = recebidas[i];
      const [nova] = await tx.consultar(
        `INSERT INTO acompanhamento_registro_foto (registro_id, arquivo, nome_original, mime_type, tamanho_bytes, legenda, data_foto, ordem, criado_por)
         OUTPUT INSERTED.id
         VALUES (@registro, @arquivo, @nomeOriginal, @mime, @tamanho, @legenda, @data, @ordem, @usuario)`,
        {
          registro: registro.id, arquivo: f.filename,
          nomeOriginal: texto(Buffer.from(f.originalname, 'latin1').toString('utf8'), 255),
          mime: f.mimetype, tamanho: f.size, legenda: texto(legendas[i], 300),
          data: [tipos.Date, datasFinais[i]], ordem: atual.maior + i + 1, usuario: req.usuario.id,
        });
      criadas.push({ id: nova.id, url: `/api/familias/acompanhamentos/${ac.id}/registros/${registro.id}/fotos/${nova.id}` });
    }
    await registrarAuditoria(req, 'ADICIONAR_FOTOS', 'acompanhamento_registro', registro.id, { acompanhamentoId: ac.id, quantidade: recebidas.length }, tx);
    return criadas;
  });
}

// Foto de um registro do acompanhamento visível ao usuário (escopo de unidade). `exigirAtivo`: registro não anulado.
async function carregarFoto(req, { escrita = false } = {}) {
  const ac = await familias.carregarAcompanhamento(req, req.params.id);
  const registroId = inteiroPositivo(req.params.registroId);
  const fotoId = inteiroPositivo(req.params.fotoId);
  if (!registroId || !fotoId) throw erros.naoEncontrado();
  const foto = await consultarUm(
    `SELECT f.id, f.registro_id, f.arquivo, f.mime_type, f.legenda, f.data_foto
       FROM acompanhamento_registro_foto f JOIN acompanhamento_registro r ON r.id = f.registro_id
      WHERE f.id = @foto AND f.registro_id = @registro AND r.acompanhamento_id = @ac AND r.anulado_em IS NULL`,
    { foto: fotoId, registro: registroId, ac: ac.id });
  if (!foto) throw erros.naoEncontrado('Foto não encontrada.');
  if (escrita) {
    familias.exigirEmAndamento(ac);
    const registro = await registros.carregarRegistro({ consultarUm }, ac.id, registroId);
    registros.exigirAutorOuCoordenacao(req, registro);
  }
  return { ac, foto };
}

async function atualizar(req, corpo) {
  const { ac, foto } = await carregarFoto(req, { escrita: true });
  const legenda = corpo?.legenda === undefined ? foto.legenda : texto(corpo.legenda, 300);
  let data = isoData(foto.dataFoto);
  if (corpo?.dataFoto !== undefined) {
    const d = normalizarData(corpo.dataFoto);
    if (!d) throw erros.validacao({ dataFoto: 'Informe uma data válida.' });
    if (d > familias.hojeIso()) throw erros.validacao({ dataFoto: 'A data da foto não pode ser futura.' });
    data = d;
  }
  await consultar('UPDATE acompanhamento_registro_foto SET legenda = @legenda, data_foto = @data WHERE id = @id',
    { id: foto.id, legenda, data: [tipos.Date, data] });
  await registrarAuditoria(req, 'ALTERAR_FOTO', 'acompanhamento_registro', foto.registroId, { acompanhamentoId: ac.id, fotoId: foto.id });
  return { id: foto.id, legenda, dataFoto: data };
}

async function excluir(req) {
  const { ac, foto } = await carregarFoto(req, { escrita: true });
  await consultar('DELETE FROM acompanhamento_registro_foto WHERE id = @id', { id: foto.id });
  arquivos.removerArquivo(foto.arquivo);
  await registrarAuditoria(req, 'EXCLUIR_FOTO', 'acompanhamento_registro', foto.registroId, { acompanhamentoId: ac.id, fotoId: foto.id });
}

module.exports = { MAX_FOTOS_POR_REGISTRO, prepararEnvio, gravar, carregarFoto, atualizar, excluir };
