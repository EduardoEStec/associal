'use strict';

// Gera os ícones do app (PNG) a partir da logo, sem dependências: public/img/logo-associal.png
// (quadrada, fundo transparente) sobre fundo branco.
//   npm run icones  ->  public/icons/icon-192.png, icon-512.png, icon-maskable-512.png,
//                       apple-touch-icon.png (180) e favicon-32.png
// Para trocar a logo, substitua public/img/logo-associal.png (PNG RGBA 8 bits, sem entrelaçamento) e rode de novo.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const RAIZ = path.resolve(__dirname, '..');
const BRANCO = [255, 255, 255];

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bloco(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([len, corpo, crc]);
}

function codificarPng(largura, altura, rgba) {
  const linhas = Buffer.alloc(altura * (1 + largura * 4));
  for (let y = 0; y < altura; y++) {
    const o = y * (1 + largura * 4);
    linhas[o] = 0;
    rgba.copy(linhas, o + 1, y * largura * 4, (y + 1) * largura * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(linhas, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

// Lê PNG RGBA de 8 bits sem entrelaçamento (o formato do public/img/logo-associal.png).
function decodificarPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Arquivo não é um PNG.');
  let pos = 8;
  let largura; let altura;
  const dados = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const tipo = buf.toString('latin1', pos + 4, pos + 8);
    const corpo = buf.subarray(pos + 8, pos + 8 + len);
    if (tipo === 'IHDR') {
      largura = corpo.readUInt32BE(0);
      altura = corpo.readUInt32BE(4);
      if (corpo[8] !== 8 || corpo[9] !== 6 || corpo[12] !== 0) throw new Error('Use um PNG RGBA de 8 bits, sem entrelaçamento.');
    } else if (tipo === 'IDAT') dados.push(corpo);
    pos += 12 + len;
  }
  const bruto = zlib.inflateSync(Buffer.concat(dados));
  const pixels = Buffer.alloc(largura * altura * 4);
  const passo = largura * 4;
  for (let y = 0; y < altura; y++) {
    const filtro = bruto[y * (passo + 1)];
    const entrada = bruto.subarray(y * (passo + 1) + 1, (y + 1) * (passo + 1));
    for (let i = 0; i < passo; i++) {
      const a = i >= 4 ? pixels[y * passo + i - 4] : 0;
      const b = y > 0 ? pixels[(y - 1) * passo + i] : 0;
      const c = i >= 4 && y > 0 ? pixels[(y - 1) * passo + i - 4] : 0;
      let v = entrada[i];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * passo + i] = v & 0xff;
    }
  }
  return { largura, altura, pixels };
}

// Média por área (com alfa pré-multiplicado) da região [x0,x1)×[y0,y1) da logo.
function amostrar(logo, x0, x1, y0, y1) {
  let r = 0; let g = 0; let b = 0; let a = 0; let peso = 0;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    const wy = Math.min(y + 1, y1) - Math.max(y, y0);
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const w = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
      const o = (Math.min(y, logo.altura - 1) * logo.largura + Math.min(x, logo.largura - 1)) * 4;
      const alfa = logo.pixels[o + 3] / 255;
      r += logo.pixels[o] * alfa * w; g += logo.pixels[o + 1] * alfa * w; b += logo.pixels[o + 2] * alfa * w;
      a += alfa * w; peso += w;
    }
  }
  return a === 0 ? [0, 0, 0, 0] : [r / a, g / a, b / a, a / peso];
}

// escala: fração do ícone ocupada pela logo; fundo: cor sólida ou null (transparente);
// arredondar: cantos transparentes (ícones "any"); o maskable e o apple-touch são quadrados, o SO recorta.
function icone(logo, tamanho, { escala, fundo, arredondar }) {
  const saida = Buffer.alloc(tamanho * tamanho * 4);
  const lado = tamanho * escala;
  const origem = (tamanho - lado) / 2;
  const razao = logo.largura / lado;
  const c = tamanho / 2;
  const raio = tamanho * 0.2;
  for (let y = 0; y < tamanho; y++) {
    for (let x = 0; x < tamanho; x++) {
      let [r, g, b, a] = [0, 0, 0, 0];
      if (fundo) [r, g, b, a] = [...fundo, 1];
      if (arredondar) {
        const ex = Math.max(Math.abs(x + 0.5 - c) - (c - raio), 0);
        const ey = Math.max(Math.abs(y + 0.5 - c) - (c - raio), 0);
        if (ex * ex + ey * ey > raio * raio) a = 0;
      }
      const lx0 = (x - origem) * razao; const ly0 = (y - origem) * razao;
      if (lx0 + razao > 0 && ly0 + razao > 0 && lx0 < logo.largura && ly0 < logo.altura) {
        const [lr, lg, lb, la] = amostrar(logo, Math.max(lx0, 0), Math.min(lx0 + razao, logo.largura), Math.max(ly0, 0), Math.min(ly0 + razao, logo.altura));
        const sa = la + a * (1 - la);
        if (sa > 0) {
          r = (lr * la + r * a * (1 - la)) / sa; g = (lg * la + g * a * (1 - la)) / sa; b = (lb * la + b * a * (1 - la)) / sa;
          a = sa;
        }
      }
      const o = (y * tamanho + x) * 4;
      saida[o] = Math.round(r); saida[o + 1] = Math.round(g); saida[o + 2] = Math.round(b); saida[o + 3] = Math.round(a * 255);
    }
  }
  return codificarPng(tamanho, tamanho, saida);
}

const logo = decodificarPng(fs.readFileSync(path.join(RAIZ, 'public', 'img', 'logo-associal.png')));
const destino = path.join(RAIZ, 'public', 'icons');
fs.mkdirSync(destino, { recursive: true });
const gravar = (nome, png) => fs.writeFileSync(path.join(destino, nome), png);
gravar('icon-192.png', icone(logo, 192, { escala: 0.72, fundo: BRANCO, arredondar: true }));
gravar('icon-512.png', icone(logo, 512, { escala: 0.72, fundo: BRANCO, arredondar: true }));
gravar('icon-maskable-512.png', icone(logo, 512, { escala: 0.56, fundo: BRANCO, arredondar: false }));
gravar('apple-touch-icon.png', icone(logo, 180, { escala: 0.72, fundo: BRANCO, arredondar: false }));
gravar('favicon-32.png', icone(logo, 32, { escala: 0.96, fundo: null, arredondar: false }));
console.log('Ícones gerados em', destino);
