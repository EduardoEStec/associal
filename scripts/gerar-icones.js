'use strict';

// Gera os ícones PWA (PNG) sem dependências: fundo verde com silhueta de pessoa em branco.
//   npm run icones   ->  public/icons/icon-192.png, icon-512.png, icon-maskable-512.png
// Para trocar pelo logotipo oficial, basta substituir os PNGs (mesmos nomes/tamanhos).

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const VERDE = [27, 107, 74];
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

// escala: fração do ícone ocupada pela silhueta (maskable usa menos, por causa da margem de segurança)
function png(tamanho, { escala, arredondar }) {
  const linhas = [];
  const c = tamanho / 2;
  const unidade = (tamanho * escala) / 2;
  for (let y = 0; y < tamanho; y++) {
    const linha = Buffer.alloc(1 + tamanho * 4);
    for (let x = 0; x < tamanho; x++) {
      const dx = (x + 0.5 - c) / unidade;
      const dy = (y + 0.5 - c) / unidade;
      // cabeça: círculo; ombros: semi-elipse
      const cabeca = dx * dx + (dy + 0.42) * (dy + 0.42) <= 0.28 * 0.28;
      const ombros = dy >= 0.05 && dy <= 0.8 && (dx * dx) / (0.72 * 0.72) + ((dy - 0.8) * (dy - 0.8)) / (0.75 * 0.75) <= 1;
      let [r, g, b] = cabeca || ombros ? BRANCO : VERDE;
      let a = 255;
      if (arredondar) {
        const raio = tamanho * 0.2;
        const ex = Math.max(Math.abs(x + 0.5 - c) - (c - raio), 0);
        const ey = Math.max(Math.abs(y + 0.5 - c) - (c - raio), 0);
        if (ex * ex + ey * ey > raio * raio) { r = g = b = 0; a = 0; }
      }
      const o = 1 + x * 4;
      linha[o] = r; linha[o + 1] = g; linha[o + 2] = b; linha[o + 3] = a;
    }
    linhas.push(linha);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tamanho, 0);
  ihdr.writeUInt32BE(tamanho, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(Buffer.concat(linhas), { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

const destino = path.resolve(__dirname, '..', 'public', 'icons');
fs.mkdirSync(destino, { recursive: true });
fs.writeFileSync(path.join(destino, 'icon-192.png'), png(192, { escala: 0.75, arredondar: true }));
fs.writeFileSync(path.join(destino, 'icon-512.png'), png(512, { escala: 0.75, arredondar: true }));
fs.writeFileSync(path.join(destino, 'icon-maskable-512.png'), png(512, { escala: 0.55, arredondar: false }));
console.log('Ícones gerados em', destino);
