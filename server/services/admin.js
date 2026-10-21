'use strict';

// Regras do módulo de administração (senha provisória, tabelas de apoio, configurações).

const crypto = require('crypto');
const { consultar } = require('../db');

const CUSTO_BCRYPT = 12;
const SENHA_MINIMA = 8; // mesma política de routes/auth.js (POST /senha)

// Sem caracteres ambíguos (0/O, 1/l/I) para facilitar o repasse verbal da senha.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function gerarSenhaProvisoria(tamanho = 12) {
  let senha = '';
  for (let i = 0; i < tamanho; i += 1) senha += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return senha;
}

// ---------- Sessões ----------

// Apaga as sessões abertas do usuário (dbo.sessao.dados é JSON com usuarioId). `manterSid` preserva a sessão atual.
// Devolve quantas foram encerradas.
async function encerrarSessoes(executor, usuarioId, manterSid) {
  const params = { id: usuarioId };
  let extra = '';
  if (manterSid) { extra = ' AND sid <> @manterSid'; params.manterSid = manterSid; }
  const apagadas = await executor.consultar(
    `DELETE FROM sessao OUTPUT DELETED.sid WHERE TRY_CAST(JSON_VALUE(dados, '$.usuarioId') AS INT) = @id${extra}`, params);
  return apagadas.length;
}

// ---------- Tabelas de apoio ----------

const colunasApoio = (tabela) =>
  tabela === 'faixa_etaria' ? 'id, nome, ordem, ativo, exige_texto, idade_min, idade_max' : 'id, nome, ordem, ativo, exige_texto';

const citar = (identificador) => `[${String(identificador).replace(/]/g, ']]')}]`;

// Colunas de outras tabelas que referenciam a tabela de apoio (via catálogo do banco). `tabela` vem da whitelist.
const cacheReferencias = new Map();
async function referenciasDe(tabela) {
  if (!cacheReferencias.has(tabela)) {
    const linhas = await consultar(
      `SELECT OBJECT_NAME(fkc.parent_object_id) AS tabela, COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS coluna
         FROM sys.foreign_key_columns fkc
        WHERE fkc.referenced_object_id = OBJECT_ID(@nome)`,
      { nome: `dbo.${tabela}` },
    );
    cacheReferencias.set(tabela, linhas);
  }
  return cacheReferencias.get(tabela);
}

// Fragmento SQL "EXISTS (...) OR ..." que diz se o registro `alias.id` está em uso.
async function sqlEmUso(tabela, alias) {
  const refs = await referenciasDe(tabela);
  if (!refs.length) return '1 = 0';
  return refs.map((r) => `EXISTS (SELECT 1 FROM dbo.${citar(r.tabela)} WHERE ${citar(r.coluna)} = ${alias}.id)`).join(' OR ');
}

// ---------- Configurações ----------

// tipo: 'inteiro' (faixa min..max) ou 'texto'. `coordenador`: COORDENADOR também pode editar.
const CONFIG_REGRAS = Object.freeze({
  prazo_questionario_final_dias: { tipo: 'inteiro', min: 1, max: 3650, coordenador: true, rotulo: 'Prazo do questionário final (dias)' },
  alerta_questionario_final_dias_antes: { tipo: 'inteiro', min: 1, max: 365, coordenador: true, rotulo: 'Alerta antes do vencimento (dias)' },
  alerta_sem_contato_dias: { tipo: 'inteiro', min: 1, max: 365, coordenador: true, rotulo: 'Alerta de família sem contato (dias)' },
  alerta_sem_meta_dias: { tipo: 'inteiro', min: 7, max: 365, coordenador: true, rotulo: 'Alerta de família sem meta (dias)' },
  pesquisa_intervalo_dias: { tipo: 'inteiro', min: 30, max: 730, coordenador: true, rotulo: 'Intervalo da pesquisa de satisfação (dias)' },
  pesquisa_prazo_final_dias: { tipo: 'inteiro', min: 7, max: 365, coordenador: true, rotulo: 'Prazo da pesquisa final após concluir (dias)' },
  pesquisa_n_minimo: { tipo: 'inteiro', min: 1, max: 100, coordenador: true, rotulo: 'Mínimo de respostas para exibir percentuais' },
  semaforo_progresso_verde_pct: { tipo: 'inteiro', min: 1, max: 100, coordenador: true, rotulo: 'Semáforo do progresso: verde a partir de (% que melhoraram)' },
  semaforo_progresso_amarelo_pct: { tipo: 'inteiro', min: 0, max: 100, coordenador: true, rotulo: 'Semáforo do progresso: amarelo a partir de (% que melhoraram)' },
  semaforo_nps_verde: { tipo: 'inteiro', min: 0, max: 100, coordenador: true, rotulo: 'Semáforo da satisfação: verde a partir da nota geral (NPS)' },
  semaforo_nps_amarelo: { tipo: 'inteiro', min: 0, max: 100, coordenador: true, rotulo: 'Semáforo da satisfação: amarelo a partir da nota geral (NPS)' },
  semaforo_concordancia_verde: { tipo: 'inteiro', min: 1, max: 100, coordenador: true, rotulo: 'Semáforo da satisfação: verde a partir de (% de concordância)' },
  semaforo_concordancia_amarelo: { tipo: 'inteiro', min: 0, max: 100, coordenador: true, rotulo: 'Semáforo da satisfação: amarelo a partir de (% de concordância)' },
  indice_tolerancia_pontos: { tipo: 'inteiro', min: 1, max: 50, coordenador: true, rotulo: 'Tolerância do semáforo do índice de progresso (pontos)' },
  salario_minimo_referencia: { tipo: 'inteiro', min: 1, max: 100000, coordenador: true, rotulo: 'Salário mínimo de referência (R$)' },
  reavaliacao_dias: { tipo: 'inteiro', min: 7, max: 730, coordenador: true, rotulo: 'Dias até a reavaliação rápida' },
  upload_max_mb: { tipo: 'inteiro', min: 1, max: 50, coordenador: false, rotulo: 'Tamanho máximo de foto (MB)' },
  nome_entidade: { tipo: 'texto', max: 150, coordenador: false, rotulo: 'Nome da entidade' },
  termo_colaboracao: { tipo: 'texto', max: 200, coordenador: false, rotulo: 'Termo de colaboração' },
});

// Devolve { valor } normalizado ou { erro } em português.
function validarConfig(chave, bruto) {
  const regra = CONFIG_REGRAS[chave];
  const valor = bruto === undefined || bruto === null ? '' : String(bruto).trim();
  if (!regra) return valor ? { valor: valor.slice(0, 500) } : { erro: 'Informe um valor.' };
  if (regra.tipo === 'inteiro') {
    if (!/^\d+$/.test(valor)) return { erro: 'Informe um número inteiro positivo.' };
    const n = Number(valor);
    if (n < regra.min || n > regra.max) return { erro: `Informe um valor entre ${regra.min} e ${regra.max}.` };
    return { valor: String(n) };
  }
  if (!valor) return { erro: 'Informe um valor.' };
  if (valor.length > regra.max) return { erro: `Use no máximo ${regra.max} caracteres.` };
  return { valor };
}

module.exports = {
  CUSTO_BCRYPT, SENHA_MINIMA, gerarSenhaProvisoria, encerrarSessoes, colunasApoio, sqlEmUso, referenciasDe, CONFIG_REGRAS, validarConfig,
};
