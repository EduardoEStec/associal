'use strict';

// Regra do alerta "família sem contato há X dias" (F2).
//
// Último contato = a data mais recente entre: início do acompanhamento, registro de acompanhamento COM
// contato (tentativas sem sucesso não contam; registros anulados também não), atendimento do responsável
// NA UNIDADE do acompanhamento e questionário concluído. Só acompanhamentos EM_ANDAMENTO podem estar "sem contato".

const { consultar, consultarUm, tipos } = require('../db');

const LIMITE_PADRAO_DIAS = 30;

// Fragmento SQL (escalar, tipo DATE) com o último contato. Exige o parâmetro @hoje e os aliases informados
// para `acompanhamento` e `familia` (familia.responsavel_pessoa_id) na consulta que o usa.
function sqlUltimoContato(ac = 'ac', familia = 'f') {
  return `(SELECT MAX(v.d) FROM (VALUES
      (${ac}.data_inicio),
      ((SELECT MAX(r.data_registro) FROM acompanhamento_registro r
         WHERE r.acompanhamento_id = ${ac}.id AND r.houve_contato = 1 AND r.anulado_em IS NULL)),
      ((SELECT MAX(a.data_atendimento) FROM atendimento a
         WHERE a.pessoa_id = ${familia}.responsavel_pessoa_id AND a.unidade_id = ${ac}.unidade_id AND a.data_atendimento <= @hoje)),
      ((SELECT MAX(q.data_aplicacao) FROM questionario q
         WHERE q.acompanhamento_id = ${ac}.id AND q.concluido = 1))
    ) AS v(d))`;
}

// Condição SQL (sobre a coluna `ultimo_contato` e `status`) de "sem contato". Parâmetros: @hoje, @semContato.
const SQL_SEM_CONTATO = "status = 'EM_ANDAMENTO' AND DATEDIFF(DAY, ultimo_contato, @hoje) > @semContato";

const isoData = (valor) => (valor ? new Date(valor).toISOString().slice(0, 10) : null);
const diasEntre = (deIso, ateIso) =>
  Math.round((new Date(`${ateIso}T00:00:00Z`) - new Date(`${deIso}T00:00:00Z`)) / 86400000);

// { ultimoContatoEm, diasSemContato, semContato } — `diasSemContato` é null fora de EM_ANDAMENTO.
// "Sem contato" = mais de `limiteDias` dias desde o último contato.
function resumoContato({ status, ultimoContato, hoje, limiteDias = LIMITE_PADRAO_DIAS }) {
  const ultimo = isoData(ultimoContato);
  if (!ultimo || status !== 'EM_ANDAMENTO') return { ultimoContatoEm: ultimo, diasSemContato: null, semContato: false };
  const dias = Math.max(0, diasEntre(ultimo, hoje));
  return { ultimoContatoEm: ultimo, diasSemContato: dias, semContato: dias > limiteDias };
}

// Resumo de contato de UM acompanhamento já carregado (com escopo de unidade): último contato, dias, alerta,
// última situação registrada e próximo contato combinado.
async function lerResumoContato(ac, hoje, limiteDias) {
  const [linha] = await consultar(
    `SELECT ${sqlUltimoContato('ac', 'f')} AS ultimo_contato
       FROM acompanhamento ac JOIN familia f ON f.id = ac.familia_id
      WHERE ac.id = @id`,
    { id: ac.id, hoje: [tipos.Date, hoje] },
  );
  const ultimaSituacao = await consultarUm(
    `SELECT TOP 1 situacao, data_registro FROM acompanhamento_registro
      WHERE acompanhamento_id = @id AND houve_contato = 1 AND anulado_em IS NULL
      ORDER BY data_registro DESC, id DESC`,
    { id: ac.id },
  );
  const proximo = await consultarUm(
    `SELECT TOP 1 proximo_contato_em FROM acompanhamento_registro
      WHERE acompanhamento_id = @id AND anulado_em IS NULL AND proximo_contato_em IS NOT NULL
      ORDER BY data_registro DESC, id DESC`,
    { id: ac.id },
  );
  const proximoContatoEm = isoData(proximo?.proximoContatoEm);
  return {
    ...resumoContato({ status: ac.status, ultimoContato: linha?.ultimoContato, hoje, limiteDias }),
    ultimaSituacao: ultimaSituacao ? { situacao: ultimaSituacao.situacao, data: isoData(ultimaSituacao.dataRegistro) } : null,
    proximoContatoEm,
    proximoContatoAtrasado: !!proximoContatoEm && proximoContatoEm < hoje && ac.status === 'EM_ANDAMENTO',
  };
}

module.exports = { LIMITE_PADRAO_DIAS, sqlUltimoContato, SQL_SEM_CONTATO, resumoContato, lerResumoContato };
