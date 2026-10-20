'use strict';

// Geração dos .docx: renderiza os templates (server/templates/*.docx, docxtemplater) e, para o anexo de fotos,
// insere as imagens direto no pacote .docx (sem módulo de imagem externo — não há dependência npm extra).
// Formatos de foto suportados no documento: JPEG e PNG. Outros (ex.: WebP) entram só como legenda.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { dataBr } = require('./relatorios-textos');

const DIR_TEMPLATES = path.resolve(__dirname, '..', 'templates');
const EMU_POR_CM = 360000;
const LARGURA_MAX_EMU = 12 * EMU_POR_CM;
const ALTURA_MAX_EMU = 9 * EMU_POR_CM;
const MAX_FOTOS = 60;

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- dimensões da imagem ----------

function dimensoesJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marcador = buf[i + 1];
    if (marcador === 0xff) { i += 1; continue; }
    if (marcador === 0xd8 || (marcador >= 0xd0 && marcador <= 0xd7) || marcador === 0x01) { i += 2; continue; }
    const tamanho = buf.readUInt16BE(i + 2);
    const ehSof = marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador);
    if (ehSof) return { altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) };
    i += 2 + tamanho;
  }
  return null;
}

function dimensoesPng(buf) {
  const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(assinatura)) return null;
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

// -> { ext: 'jpeg'|'png', largura, altura } ou null se não suportada
function inspecionarImagem(buf) {
  const j = dimensoesJpeg(buf);
  if (j && j.largura > 0 && j.altura > 0) return { ext: 'jpeg', ...j };
  const p = dimensoesPng(buf);
  if (p && p.largura > 0 && p.altura > 0) return { ext: 'png', ...p };
  return null;
}

// ---------- XML do anexo de fotos ----------

const rprAnexo = (b, sz) => `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${b ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;

function paragrafoAnexo(texto, { b = false, sz = 24, jc = 'left', quebraPagina = false, manter = false, depois = 120 } = {}) {
  return `<w:p><w:pPr>${manter ? '<w:keepNext/>' : ''}${quebraPagina ? '<w:pageBreakBefore/>' : ''}`
    + `<w:spacing w:before="120" w:after="${depois}"/><w:jc w:val="${jc}"/>${rprAnexo(b, sz)}</w:pPr>`
    + `<w:r>${rprAnexo(b, sz)}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r></w:p>`;
}

function desenhoInline({ rid, id, nome, cx, cy }) {
  return '<w:p><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="40"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>'
    + `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:docPr id="${id}" name="${esc(nome)}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(nome)}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

// grupos: [{ nome, fotos: [{ caminho, legenda, data, local }] }]
// -> { xml, midias: [{ nome, ext, dados, rid }], semImagem: n } — xml vazio se não houver fotos.
async function montarAnexos(grupos) {
  const midias = [];
  let xml = '';
  let contador = 0;
  let omitidas = 0;
  for (const grupo of grupos) {
    if (!grupo.fotos.length) continue;
    let blocoUnidade = paragrafoAnexo(`Unidade: ${grupo.nome}`, { b: true, manter: true });
    for (const foto of grupo.fotos) {
      if (contador >= MAX_FOTOS) { omitidas += 1; continue; }
      contador += 1;
      const detalhe = [foto.local, foto.data ? dataBr(foto.data) : ''].filter(Boolean).join(' – ');
      const legenda = `Foto ${contador}${foto.legenda ? ` – ${foto.legenda}` : ''}${detalhe ? ` (${detalhe})` : ''}`;
      let imagem = null;
      let dados = null;
      try {
        if (foto.caminho) {
          dados = await fsp.readFile(foto.caminho);
          imagem = inspecionarImagem(dados);
        }
      } catch {
        imagem = null;
      }
      if (!imagem) {
        blocoUnidade += paragrafoAnexo(`${legenda} [imagem não incorporada: formato não suportado ou arquivo indisponível]`, { sz: 20, jc: 'center' });
        continue;
      }
      const escala = Math.min(1, LARGURA_MAX_EMU / (imagem.largura * 9525), ALTURA_MAX_EMU / (imagem.altura * 9525));
      const cx = Math.max(1, Math.round(imagem.largura * 9525 * escala));
      const cy = Math.max(1, Math.round(imagem.altura * 9525 * escala));
      const nome = `foto_anexo_${contador}.${imagem.ext}`;
      const rid = `rIdFotoAnexo${contador}`;
      midias.push({ nome, ext: imagem.ext, dados, rid });
      blocoUnidade += desenhoInline({ rid, id: 1000 + contador, nome, cx, cy })
        + paragrafoAnexo(legenda, { sz: 18, jc: 'center', depois: 160 });
    }
    xml += blocoUnidade;
  }
  if (omitidas) xml += paragrafoAnexo(`(${omitidas} foto(s) adicional(is) não incluída(s): limite de ${MAX_FOTOS} por relatório.)`, { sz: 18 });
  if (xml) xml = paragrafoAnexo('ANEXOS – REGISTRO FOTOGRÁFICO', { b: true, jc: 'center', quebraPagina: true, manter: true }) + xml;
  return { xml, midias, omitidas };
}

function incluirMidias(zip, midias) {
  if (!midias.length) return;
  let tipos = zip.file('[Content_Types].xml').asText();
  for (const ext of new Set(midias.map((m) => m.ext))) {
    if (!new RegExp(`<Default[^>]+Extension="${ext}"`, 'i').test(tipos)) {
      const tipo = ext === 'png' ? 'image/png' : 'image/jpeg';
      tipos = tipos.replace('<Default ', `<Default Extension="${ext}" ContentType="${tipo}"/><Default `);
    }
  }
  zip.file('[Content_Types].xml', tipos);

  const relsPath = 'word/_rels/document.xml.rels';
  const rels = midias.map((m) =>
    `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.nome}"/>`).join('');
  zip.file(relsPath, zip.file(relsPath).asText().replace('</Relationships>', `${rels}</Relationships>`));
  for (const m of midias) zip.file(`word/media/${m.nome}`, m.dados);
}

// ---------- renderização ----------

// nomeTemplate: 'individual' | 'semestral'. `anexos` = resultado de montarAnexos (só o semestral usa).
function renderizar(nomeTemplate, dados, anexos = { xml: '', midias: [] }) {
  const caminho = path.join(DIR_TEMPLATES, `${nomeTemplate}.docx`);
  const zip = new PizZip(fs.readFileSync(caminho));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: false,
    nullGetter: () => '',
  });
  doc.render({ ...dados, anexosXml: anexos.xml || '' });
  const saida = doc.getZip();
  incluirMidias(saida, anexos.midias || []);
  return saida.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { renderizar, montarAnexos, inspecionarImagem, MAX_FOTOS };
