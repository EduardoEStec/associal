// Cliente da API. Sempre use este módulo (nunca fetch direto) para ter:
//  - cabeçalho anti-CSRF (X-Requested-With) e cookies de sessão;
//  - redirecionamento ao login em 401;
//  - erros padronizados (ErroApi) com .status, .codigo, .mensagem e .detalhes ({ campo: mensagem }).
//
//   import { api } from '/js/api.js';
//   const lista = await api.get('/api/atendimentos', { dataInicio: '2026-01-01' });
//   await api.post('/api/atendimentos', { ... });

import { limparShell } from './shell-cache.js';

export class ErroApi extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes || null;
  }
}

function irParaLogin() {
  if (location.pathname.endsWith('/login.html') || location.pathname === '/login') return;
  limparShell(); // sessão expirada: o próximo usuário deste aparelho não herda o nome na tela
  const proximo = encodeURIComponent(location.pathname + location.search);
  location.href = `/login.html?proximo=${proximo}`;
}

function montarUrl(url, consulta) {
  if (!consulta) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(consulta)) {
    if (v !== undefined && v !== null && v !== '') params.append(k, v);
  }
  const texto = params.toString();
  return texto ? `${url}${url.includes('?') ? '&' : '?'}${texto}` : url;
}

async function requisitar(metodo, url, { corpo, consulta, formData } = {}) {
  const opcoes = {
    method: metodo,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'X-Requested-With': 'fetch' },
  };
  if (formData) {
    opcoes.body = formData; // multipart: o navegador define o Content-Type
  } else if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }

  let resposta;
  try {
    resposta = await fetch(montarUrl(url, consulta), opcoes);
  } catch {
    throw new ErroApi(0, 'SEM_CONEXAO', 'Sem conexão com o servidor. Verifique sua internet.');
  }

  const ehJson = (resposta.headers.get('content-type') || '').includes('application/json');
  const dados = ehJson ? await resposta.json().catch(() => null) : null;

  if (resposta.ok) return dados;

  const erro = dados?.erro || {};
  if (resposta.status === 401 && erro.codigo === 'NAO_AUTENTICADO') irParaLogin();
  throw new ErroApi(resposta.status, erro.codigo || 'ERRO', erro.mensagem || 'Não foi possível concluir a operação.', erro.detalhes);
}

export const api = {
  get: (url, consulta) => requisitar('GET', url, { consulta }),
  post: (url, corpo) => requisitar('POST', url, { corpo: corpo ?? {} }),
  put: (url, corpo) => requisitar('PUT', url, { corpo: corpo ?? {} }),
  patch: (url, corpo) => requisitar('PATCH', url, { corpo: corpo ?? {} }),
  delete: (url) => requisitar('DELETE', url),
  upload: (url, formData) => requisitar('POST', url, { formData }),
};
