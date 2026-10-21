// Ponte entre Atendimentos e Famílias (páginas diferentes): guarda de onde a pessoa veio para devolvê-la ao terminar o questionário.
// sessionStorage: some ao fechar a aba; o retorno expira em 12 h para não "sequestrar" a navegação depois.
const CHAVE_RETORNO = 'associal.retornoAtendimento';
const CHAVE_PRE = 'associal.preCadastroFamilia';
const VALIDADE_MS = 12 * 3600 * 1000;

function gravar(chave, valor) {
  try { sessionStorage.setItem(chave, JSON.stringify({ ...valor, em: Date.now() })); } catch { /* sem sessionStorage: segue sem retorno */ }
}
function ler(chave) {
  try {
    const v = JSON.parse(sessionStorage.getItem(chave));
    return v && Date.now() - v.em < VALIDADE_MS ? v : null;
  } catch { return null; }
}
function limpar(chave) { try { sessionStorage.removeItem(chave); } catch { /* nada */ } }

// { acompanhamentoId (null até a família existir), cpf, url }
export const guardarRetorno = (r) => gravar(CHAVE_RETORNO, r);
export const guardarPreCadastro = (p) => gravar(CHAVE_PRE, p);

// Cadastro novo: devolve { cpf, unidadeId } uma única vez
export function consumirPreCadastro() {
  const p = ler(CHAVE_PRE);
  limpar(CHAVE_PRE);
  return p;
}

// Depois de criar a família: amarra o retorno ao acompanhamento novo
export function vincularRetorno(acompanhamentoId, cpf) {
  const r = ler(CHAVE_RETORNO);
  const meu = !!r && r.acompanhamentoId === null && r.cpf === cpf;
  if (meu) gravar(CHAVE_RETORNO, { ...r, acompanhamentoId });
  return meu;
}

// Ao concluir o questionário: se veio de um atendimento deste acompanhamento, devolve a URL (e esquece)
export function consumirRetorno(acompanhamentoId) {
  const r = ler(CHAVE_RETORNO);
  if (!r || r.acompanhamentoId !== Number(acompanhamentoId)) return null;
  limpar(CHAVE_RETORNO);
  return r.url;
}

export const temRetornoPendente = () => !!ler(CHAVE_RETORNO);
