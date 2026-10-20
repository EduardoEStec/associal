// Redimensiona fotos no navegador antes do envio (economiza dados móveis):
// lado maior 1600 px, JPEG com qualidade ~0.8.

const LADO_MAXIMO = 1600;
const QUALIDADE = 0.8;

async function abrirImagem(arquivo) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(arquivo, { imageOrientation: 'from-image' }); } catch { /* tenta via <img> */ }
  }
  const url = URL.createObjectURL(arquivo);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// -> Blob JPEG
export async function redimensionarFoto(arquivo) {
  const imagem = await abrirImagem(arquivo);
  const largura = imagem.width;
  const altura = imagem.height;
  const escala = Math.min(1, LADO_MAXIMO / Math.max(largura, altura));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(largura * escala);
  canvas.height = Math.round(altura * escala);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG/WebP com transparência
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(imagem, 0, 0, canvas.width, canvas.height);
  imagem.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível preparar a imagem.'))), 'image/jpeg', QUALIDADE);
  });
}

export function nomeJpeg(nomeOriginal, indice) {
  const base = String(nomeOriginal || `foto-${indice + 1}`).replace(/\.[^.]+$/, '');
  return `${base}.jpg`;
}
