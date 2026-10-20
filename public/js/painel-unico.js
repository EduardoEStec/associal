// Garante um único painel flutuante aberto por vez (lista suspensa de select-bonito.js e calendário de data-bonita.js).
// Cada painel registra a função que o fecha; abrir um fecha o anterior (sem devolver o foco).

let atual = null;

export function abrirExclusivo(fechar) {
  if (atual && atual !== fechar) atual(false);
  atual = fechar;
}

export function liberar(fechar) {
  if (atual === fechar) atual = null;
}
