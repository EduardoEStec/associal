'use strict';

// MÓDULO 2 — Visitas e Ações. Montado em /api/acoes (sessão já exigida). Ver docs/API-ACOES.md.

const express = require('express');
const { consultar, consultarUm, transacao, tipos } = require('../db');
const { resolverUnidade, requirePerfil } = require('../middlewares/auth');
const { erros } = require('../lib/erros');
const { registrarAuditoria } = require('../lib/auditoria');
const { texto, inteiroPositivo, lancarSeErros } = require('../lib/validacao');
const { STATUS_ACAO } = require('../lib/dominios');
const servico = require('../services/acoes');
const fotos = require('../services/acoes-fotos');

const router = express.Router();
const podeEscrever = requirePerfil('ASSISTENTE', 'COORDENADOR', 'ADMIN');

// GET /api/acoes/resumo?inicio=&fim=&unidadeId=  (antes de /:id)
router.get('/resumo', async (req, res) => {
  res.json(await servico.resumo(req));
});

// GET /api/acoes?inicio=&fim=&unidadeId=&status=&tipoAcaoId=&temaId=&q=&ordem=asc|desc
router.get('/', async (req, res) => {
  res.json(await servico.listar(req));
});

router.get('/:id', async (req, res) => {
  res.json(await servico.detalhar(req, req.params.id));
});

router.post('/', podeEscrever, async (req, res) => {
  const dados = await servico.validarCorpo(req, req.body || {});
  const unidadeId = resolverUnidade(req, req.body?.unidadeId);

  const id = await transacao(async (tx) => {
    const [novo] = await tx.consultar(
      `INSERT INTO ASSOCIAL_acao_visita (unidade_id, tipo_acao_id, tipo_acao_outro, data_acao, instituicao_local, endereco, status,
                                qtd_participantes, descricao, criado_por)
       OUTPUT INSERTED.id
       VALUES (@unidadeId, @tipoAcaoId, @tipoAcaoOutro, @dataAcao, @instituicaoLocal, @endereco, @status,
               @qtdParticipantes, @descricao, @usuario)`,
      {
        unidadeId,
        tipoAcaoId: dados.tipoAcaoId,
        tipoAcaoOutro: dados.tipoAcaoOutro,
        dataAcao: [tipos.Date, dados.dataAcao],
        instituicaoLocal: dados.instituicaoLocal,
        endereco: dados.endereco,
        status: dados.status,
        qtdParticipantes: dados.qtdParticipantes,
        descricao: dados.descricao,
        usuario: req.usuario.id,
      },
    );
    await servico.gravarTemas(tx, novo.id, dados.temaIds);
    await registrarAuditoria(req, 'CRIAR', 'acao_visita', novo.id, { status: dados.status }, tx);
    return novo.id;
  });
  res.status(201).json({ id });
});

router.put('/:id', podeEscrever, async (req, res) => {
  const atual = await servico.carregarAcao(req, req.params.id);
  const temasAtuais = (await consultar('SELECT tema_id FROM ASSOCIAL_acao_visita_tema WHERE acao_visita_id = @id', { id: atual.id }))
    .map((t) => t.temaId);
  const dados = await servico.validarCorpo(req, req.body || {}, { atual, temasAtuais });

  await transacao(async (tx) => {
    await tx.consultar(
      `UPDATE ASSOCIAL_acao_visita
          SET unidade_id = @unidadeId, tipo_acao_id = @tipoAcaoId, tipo_acao_outro = @tipoAcaoOutro, data_acao = @dataAcao,
              instituicao_local = @instituicaoLocal, endereco = @endereco, status = @status,
              qtd_participantes = @qtdParticipantes, descricao = @descricao,
              alterado_por = @usuario, alterado_em = SYSUTCDATETIME()
        WHERE id = @id`,
      {
        id: atual.id,
        unidadeId: dados.unidadeId,
        tipoAcaoId: dados.tipoAcaoId,
        tipoAcaoOutro: dados.tipoAcaoOutro,
        dataAcao: [tipos.Date, dados.dataAcao],
        instituicaoLocal: dados.instituicaoLocal,
        endereco: dados.endereco,
        status: dados.status,
        qtdParticipantes: dados.qtdParticipantes,
        descricao: dados.descricao,
        usuario: req.usuario.id,
      },
    );
    await servico.gravarTemas(tx, atual.id, dados.temaIds);
    await registrarAuditoria(req, 'ALTERAR', 'acao_visita', atual.id, { status: dados.status }, tx);
  });
  res.json({ id: atual.id });
});

// PATCH /api/acoes/:id/status  { status, qtdParticipantes? }
router.patch('/:id/status', podeEscrever, async (req, res) => {
  const atual = await servico.carregarAcao(req, req.params.id);
  const status = String(req.body?.status ?? '').toUpperCase();
  const problemas = {};
  if (!STATUS_ACAO.includes(status)) problemas.status = 'Status inválido.';

  let qtd = atual.qtdParticipantes;
  const bruta = req.body?.qtdParticipantes;
  if (bruta !== undefined && bruta !== null && String(bruta).trim() !== '') {
    const n = Number(bruta);
    if (!Number.isInteger(n) || n < 0 || n > 100000) problemas.qtdParticipantes = 'Informe um número inteiro maior ou igual a zero.';
    else qtd = n;
  }
  if (status === 'REALIZADA' && (qtd === null || qtd === undefined) && !problemas.qtdParticipantes) {
    problemas.qtdParticipantes = 'Informe a quantidade de participantes para marcar como realizada.';
  }
  lancarSeErros(problemas);

  await transacao(async (tx) => {
    await tx.consultar(
      `UPDATE ASSOCIAL_acao_visita SET status = @status, qtd_participantes = @qtd,
              alterado_por = @usuario, alterado_em = SYSUTCDATETIME() WHERE id = @id`,
      { id: atual.id, status, qtd, usuario: req.usuario.id },
    );
    await registrarAuditoria(req, 'ALTERAR_STATUS', 'acao_visita', atual.id, { de: atual.status, para: status }, tx);
  });
  res.json({ id: atual.id, status, qtdParticipantes: qtd });
});

// DELETE /api/acoes/:id — COORDENADOR/ADMIN ou o autor
router.delete('/:id', podeEscrever, async (req, res) => {
  const atual = await servico.carregarAcao(req, req.params.id);
  if (!servico.podeExcluir(req, atual)) throw erros.proibido('Somente o autor ou a coordenação podem excluir esta ação.');

  const arquivos = await consultar('SELECT arquivo FROM ASSOCIAL_acao_visita_foto WHERE acao_visita_id = @id', { id: atual.id });
  await transacao(async (tx) => {
    await tx.consultar('DELETE FROM ASSOCIAL_acao_visita WHERE id = @id', { id: atual.id }); // temas e fotos em cascata
    await registrarAuditoria(req, 'EXCLUIR', 'acao_visita', atual.id, undefined, tx);
  });
  for (const f of arquivos) fotos.removerArquivo(f.arquivo);
  res.status(204).end();
});

// ---------- Fotos ----------

// POST /api/acoes/:id/fotos  (multipart: campo "fotos" [até 10]; "legendas" opcional, na mesma ordem)
router.post('/:id/fotos', podeEscrever, async (req, res, next) => {
  try {
    req.acaoAtual = await servico.carregarAcao(req, req.params.id); // 404 antes de aceitar qualquer arquivo
    next();
  } catch (e) { next(e); }
}, fotos.receberFotos, async (req, res) => {
  const arquivos = req.files || [];
  const descartar = () => arquivos.forEach((f) => fotos.removerArquivo(f.filename));
  try {
    if (!arquivos.length) throw erros.validacao({ fotos: 'Selecione ao menos uma foto.' });
    if (arquivos.some((f) => !fotos.assinaturaValida(f.path, f.mimetype))) {
      throw erros.validacao({ fotos: 'Um dos arquivos não é uma imagem válida.' });
    }
    const acaoId = req.acaoAtual.id;
    const existente = await consultarUm(
      'SELECT COUNT(*) AS total, COALESCE(MAX(ordem), 0) AS maior FROM ASSOCIAL_acao_visita_foto WHERE acao_visita_id = @id', { id: acaoId });
    if (existente.total + arquivos.length > fotos.MAX_FOTOS_POR_ACAO) {
      throw erros.validacao({ fotos: `Cada ação aceita no máximo ${fotos.MAX_FOTOS_POR_ACAO} fotos.` });
    }
    const legendas = [].concat(req.body?.legendas ?? []);

    const criadas = await transacao(async (tx) => {
      const saida = [];
      for (let i = 0; i < arquivos.length; i++) {
        const f = arquivos[i];
        const [nova] = await tx.consultar(
          `INSERT INTO ASSOCIAL_acao_visita_foto (acao_visita_id, arquivo, nome_original, mime_type, tamanho_bytes, legenda, ordem, criado_por)
           OUTPUT INSERTED.id
           VALUES (@acaoId, @arquivo, @nomeOriginal, @mime, @tamanho, @legenda, @ordem, @usuario)`,
          {
            acaoId,
            arquivo: f.filename,
            nomeOriginal: texto(Buffer.from(f.originalname, 'latin1').toString('utf8'), 255),
            mime: f.mimetype,
            tamanho: f.size,
            legenda: texto(legendas[i], 300),
            ordem: existente.maior + i + 1,
            usuario: req.usuario.id,
          },
        );
        saida.push({ id: nova.id, url: `/api/acoes/${acaoId}/fotos/${nova.id}` });
      }
      await registrarAuditoria(req, 'ADICIONAR_FOTOS', 'acao_visita', acaoId, { quantidade: arquivos.length }, tx);
      return saida;
    });
    res.status(201).json({ fotos: criadas });
  } catch (e) {
    descartar();
    throw e;
  }
});

async function carregarFoto(req) {
  const acao = await servico.carregarAcao(req, req.params.id);
  const fotoId = inteiroPositivo(req.params.fotoId);
  if (!fotoId) throw erros.naoEncontrado();
  const foto = await consultarUm(
    'SELECT id, arquivo, mime_type, legenda, ordem FROM ASSOCIAL_acao_visita_foto WHERE id = @fotoId AND acao_visita_id = @acaoId',
    { fotoId, acaoId: acao.id },
  );
  if (!foto) throw erros.naoEncontrado();
  return { acao, foto };
}

// GET /api/acoes/:id/fotos/:fotoId — autenticado e restrito à unidade da ação
router.get('/:id/fotos/:fotoId', async (req, res, next) => {
  const { foto } = await carregarFoto(req);
  res.type(foto.mimeType || 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(fotos.caminhoDe(foto.arquivo), (err) => {
    if (err) next(err.code === 'ENOENT' ? erros.naoEncontrado('Arquivo da foto não encontrado.') : err);
  });
});

// PATCH /api/acoes/:id/fotos/:fotoId  { legenda?, ordem? }
router.patch('/:id/fotos/:fotoId', podeEscrever, async (req, res) => {
  const { acao, foto } = await carregarFoto(req);
  const problemas = {};
  const legenda = req.body?.legenda === undefined ? foto.legenda : texto(req.body.legenda, 300);
  let ordem = foto.ordem;
  if (req.body?.ordem !== undefined) {
    const n = Number(req.body.ordem);
    if (!Number.isInteger(n) || n < 0 || n > 1000) problemas.ordem = 'Ordem inválida.';
    else ordem = n;
  }
  lancarSeErros(problemas);
  await consultar(
    'UPDATE ASSOCIAL_acao_visita_foto SET legenda = @legenda, ordem = @ordem WHERE id = @id',
    { id: foto.id, legenda, ordem },
  );
  await registrarAuditoria(req, 'ALTERAR_FOTO', 'acao_visita', acao.id, { fotoId: foto.id });
  res.json({ id: foto.id, legenda, ordem });
});

router.delete('/:id/fotos/:fotoId', podeEscrever, async (req, res) => {
  const { acao, foto } = await carregarFoto(req);
  await consultar('DELETE FROM ASSOCIAL_acao_visita_foto WHERE id = @id', { id: foto.id });
  fotos.removerArquivo(foto.arquivo);
  await registrarAuditoria(req, 'EXCLUIR_FOTO', 'acao_visita', acao.id, { fotoId: foto.id });
  res.status(204).end();
});

module.exports = router;
