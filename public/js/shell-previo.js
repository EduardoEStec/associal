// Pré-pinta o casco da página (menu por perfil, nome no cabeçalho, saudação) com o último usuário conhecido neste aparelho.
// Fica no <head>, como script comum e pequeno, sem imports: o navegador só desenha o primeiro quadro depois dele.
// O perfil entra já no <html> (o CSS escolhe os itens do menu); os textos entram assim que o HTML correspondente
// é lido (MutationObserver roda antes de qualquer desenho). A chave e o formato são os de js/shell-cache.js;
// js/layout.js confirma tudo depois, com a resposta de /api/auth/me.
(function () {
  var info = null;
  try { info = JSON.parse(localStorage.getItem('associal.shell')); } catch (e) { info = null; }

  var PERFIS = { ASSISTENTE: 'Assistente Social', COORDENADOR: 'Coordenador', ADMIN: 'Administrador' };
  var conhecido = !!(info && typeof info.nome === 'string' && PERFIS[info.perfil]);
  if (conhecido) document.documentElement.setAttribute('data-perfil', info.perfil);

  var hora = new Date().getHours();
  var saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  var data = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  var partes = conhecido ? info.nome.trim().split(/\s+/) : [];

  var textos = {
    'previo-nome': conhecido ? info.nome : null,
    'previo-perfil': conhecido ? [PERFIS[info.perfil], info.unidade].filter(Boolean).join(' · ') : null,
    'previo-avatar': conhecido ? ((partes[0] || '?')[0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase() : null,
    // Início: mesmos textos que js/paginas/inicio.js monta depois (ele só troca o que mudar)
    'saudacao': conhecido ? saudacao + ', ' + info.nome.split(' ')[0] + '!' : saudacao + '!',
    'data-hoje-texto': (conhecido && info.unidade ? info.unidade + ' · ' : '') + data,
  };

  var feitos = {};
  function preencher() {
    for (var id in textos) {
      if (feitos[id] || textos[id] === null) continue;
      var e = document.getElementById(id);
      if (e) { e.textContent = textos[id]; feitos[id] = true; }
    }
  }
  preencher();
  var observador = new MutationObserver(preencher);
  observador.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', function () { preencher(); observador.disconnect(); });
})();
