'use strict';

// Upload e armazenamento das fotos das ações. Arquivos ficam em <uploadDir>/acoes/ com nome
// aleatório, fora de qualquer pasta pública; o acesso é sempre pela rota autenticada.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('../config');
const { consultarUm } = require('../db');
const { erros } = require('../lib/erros');

const MIMES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const NOME_VALIDO = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
const MAX_FOTOS_POR_ENVIO = 10;
const MAX_FOTOS_POR_ACAO = 40;

const diretorio = () => path.join(config.uploadDir, 'acoes');

async function limiteMb() {
  const linha = await consultarUm("SELECT valor FROM configuracao WHERE chave = 'upload_max_mb'");
  const n = Number(linha?.valor);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

const caminhoDe = (arquivo) => {
  if (!NOME_VALIDO.test(arquivo)) throw erros.naoEncontrado();
  return path.join(diretorio(), arquivo);
};

function removerArquivo(arquivo) {
  try { fs.unlinkSync(caminhoDe(arquivo)); } catch { /* já removido ou nome inválido */ }
}

// Confere os primeiros bytes: o mimetype enviado pelo cliente não é confiável.
function assinaturaValida(arquivoAbsoluto, mime) {
  const fd = fs.openSync(arquivoAbsoluto, 'r');
  try {
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (mime === 'image/png') return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mime === 'image/webp') return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

// Middleware: recebe até MAX_FOTOS_POR_ENVIO arquivos no campo "fotos" (req.files).
async function receberFotos(req, res, next) {
  try {
    fs.mkdirSync(diretorio(), { recursive: true });
    const maxMb = await limiteMb();
    const upload = multer({
      storage: multer.diskStorage({
        destination: (r, f, cb) => cb(null, diretorio()),
        filename: (r, f, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}.${MIMES[f.mimetype] || 'bin'}`),
      }),
      limits: { fileSize: maxMb * 1024 * 1024, files: MAX_FOTOS_POR_ENVIO, fields: 40 },
      fileFilter: (r, f, cb) => {
        if (MIMES[f.mimetype]) cb(null, true);
        else cb(erros.validacao({ fotos: 'Envie apenas imagens JPEG, PNG ou WebP.' }));
      },
    }).array('fotos', MAX_FOTOS_POR_ENVIO);

    upload(req, res, (err) => {
      if (!err) return next();
      for (const f of req.files || []) removerArquivo(f.filename);
      if (err.code === 'LIMIT_FILE_SIZE') return next(erros.validacao({ fotos: `Cada foto pode ter no máximo ${maxMb} MB.` }));
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(erros.validacao({ fotos: `Envie no máximo ${MAX_FOTOS_POR_ENVIO} fotos por vez.` }));
      }
      return next(err);
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { receberFotos, removerArquivo, assinaturaValida, caminhoDe, MIMES, MAX_FOTOS_POR_ACAO };
