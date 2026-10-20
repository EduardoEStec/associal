// Telefone brasileiro: máscara "(11) 91234-5678" (11 dígitos) ou "(11) 1234-5678" (10).
// Complementa ui.js (formatarCpf/formatarCep). Na API o telefone trafega só com dígitos.
import { apenasDigitos } from './ui.js';

export function formatarTelefone(valor) {
  const d = apenasDigitos(valor).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// 10 ou 11 dígitos, DDD sem zero à esquerda
export const telefoneValido = (valor) => /^[1-9]\d{9,10}$/.test(apenasDigitos(valor));
