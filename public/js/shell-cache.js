// Último usuário conhecido neste aparelho (só nome, perfil e unidade): deixa o menu, o cabeçalho e a saudação
// aparecerem já no primeiro quadro da página, antes de /api/auth/me responder (ver shell-previo.js, que lê esta chave).
// Descartado ao sair, ao trocar de usuário e quando a sessão expira.
export const CHAVE_SHELL = 'associal.shell';

export function salvarShell(usuario) {
  try {
    localStorage.setItem(CHAVE_SHELL, JSON.stringify({
      nome: usuario.nome, perfil: usuario.perfil, unidade: usuario.unidades.length === 1 ? usuario.unidades[0].nome : '',
    }));
  } catch { /* armazenamento bloqueado: a página só perde a pré-pintura */ }
}

export function limparShell() {
  try { localStorage.removeItem(CHAVE_SHELL); } catch { /* idem */ }
}
