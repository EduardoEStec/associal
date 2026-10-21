'use strict';

// Dados de TESTE reutilizáveis para o ambiente Docker: a família "Maria Teste E2E" (unidade BRA, CPF 529.982.247-25,
// início 20/10/2026, questionários inicial e final concluídos), usada para validar a comparação e o relatório individual.
//
//   node scripts/seed-teste.js              cria (se não existir; não mexe em nada que já exista)
//   node scripts/seed-teste.js --remover    remove SOMENTE essa família de teste (confere o nome e recusa se houver atendimentos)
//
// TRAVA: recusa rodar se o SQL Server não for um container Linux local (nunca no SQL Server real).
// Regra: este script nunca apaga dados que ele não criou.

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../server/db');

const CPF = '52998224725';
const NOME = 'Maria Teste E2E';
const INICIO = '2026-10-20';

const D = (iso) => [db.tipos.Date, iso];
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const hojeIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function travaDeSeguranca() {
  const [info] = await db.consultar(
    "SELECT (SELECT host_platform FROM sys.dm_os_host_info) AS plataforma, CAST(SERVERPROPERTY('MachineName') AS NVARCHAR(100)) AS maquina");
  const local = ['localhost', '127.0.0.1', '::1'].includes(String(process.env.DB_SERVER).toLowerCase());
  if (info.plataforma !== 'Linux' || !local) {
    console.error(`RECUSADO: o banco não parece ser o container Docker de teste (DB_SERVER=${process.env.DB_SERVER}, plataforma=${info.plataforma}).`);
    process.exit(2);
  }
  console.log(`Banco de teste confirmado: container Linux ${info.maquina}.`);
}

async function existente() {
  return db.consultarUm('SELECT id, nome FROM pessoa WHERE cpf = @cpf', { cpf: CPF });
}

async function remover() {
  const p = await existente();
  if (!p) { console.log('Nada a remover: a família de teste não existe.'); return; }
  if (p.nome !== NOME) { console.error(`RECUSADO: o CPF ${CPF} pertence a "${p.nome}", não à família de teste.`); process.exit(3); }
  const [{ n }] = await db.consultar('SELECT COUNT(*) AS n FROM atendimento WHERE pessoa_id = @p', { p: p.id });
  if (n > 0) { console.error(`RECUSADO: a pessoa tem ${n} atendimento(s) que este script não criou.`); process.exit(3); }
  const fams = await db.consultar('SELECT id FROM familia WHERE responsavel_pessoa_id = @p', { p: p.id });
  for (const f of fams) {
    for (const ac of await db.consultar('SELECT id FROM acompanhamento WHERE familia_id = @f', { f: f.id })) {
      await db.consultar('DELETE FROM acompanhamento_registro WHERE acompanhamento_id = @ac', { ac: ac.id });
      await db.consultar("IF OBJECT_ID(N'dbo.pesquisa_resposta', N'U') IS NOT NULL DELETE FROM pesquisa_resposta WHERE acompanhamento_id = @ac", { ac: ac.id });
      await db.consultar('DELETE FROM questionario WHERE acompanhamento_id = @ac', { ac: ac.id });
      await db.consultar('DELETE FROM acompanhamento WHERE id = @ac', { ac: ac.id });
    }
    await db.consultar('DELETE FROM familia_membro WHERE familia_id = @f', { f: f.id });
    await db.consultar('DELETE FROM familia WHERE id = @f', { f: f.id });
  }
  await db.consultar('DELETE FROM pessoa WHERE id = @p', { p: p.id });
  console.log(`Família de teste "${NOME}" removida.`);
}

async function criar() {
  const ja = await existente();
  if (ja) {
    if (ja.nome === NOME) { console.log(`Já existe: "${NOME}" (pessoa ${ja.id}). Nada foi alterado.`); return; }
    console.error(`RECUSADO: o CPF ${CPF} já pertence a "${ja.nome}". Nada foi alterado.`);
    process.exit(3);
  }
  const assistente = await db.consultarUm(
    `SELECT TOP 1 u.id FROM usuario u JOIN perfil pf ON pf.id = u.perfil_id
       JOIN usuario_unidade uu ON uu.usuario_id = u.id JOIN unidade un ON un.id = uu.unidade_id
      WHERE pf.codigo = 'ASSISTENTE' AND un.sigla = 'BRA' AND u.ativo = 1
      ORDER BY CASE WHEN u.login = 'e2e_assist' THEN 0 ELSE 1 END, u.id`);
  const bra = await db.consultarUm("SELECT id FROM unidade WHERE sigla = 'BRA'");
  if (!assistente || !bra) { console.error('É preciso uma assistente da unidade BRA (ex.: e2e_assist) no banco de teste.'); process.exit(4); }
  const uid = assistente.id;
  const hoje = hojeIso();
  const fim = hoje > INICIO ? hoje : INICIO;

  await db.transacao(async (tx) => {
    const [p] = await tx.consultar(
      `INSERT INTO pessoa (cpf, nome, data_nascimento, nis, endereco, cep, bairro, trabalho_atual, telefone, criado_por)
       OUTPUT INSERTED.id
       VALUES (@cpf, @nome, @nasc, '12345678901', N'Rua das Flores, 100', '02000000', N'Brasilândia', N'Diarista', '11912345678', @uid)`,
      { cpf: CPF, nome: NOME, nasc: D('1988-04-12'), uid });
    const [f] = await tx.consultar('INSERT INTO familia (responsavel_pessoa_id, criado_por) OUTPUT INSERTED.id VALUES (@p, @uid)', { p: p.id, uid });
    await tx.consultar(
      `INSERT INTO familia_membro (familia_id, nome, idade, parentesco, trabalha, criado_por) VALUES
         (@f, N'Pedro Teste E2E', 8, N'Filho', 0, @uid), (@f, N'Ana Teste E2E', 14, N'Filha', 0, @uid), (@f, N'Dona Rosa Teste E2E', 62, N'Mãe', 0, @uid)`,
      { f: f.id, uid });
    const [ac] = await tx.consultar(
      `INSERT INTO acompanhamento (familia_id, unidade_id, usuario_id, data_inicio, data_prevista_final, status, observacoes, criado_por)
       OUTPUT INSERTED.id VALUES (@f, @un, @uid, @ini, @prev, 'EM_ANDAMENTO', N'Família de teste (scripts/seed-teste.js).', @uid)`,
      { f: f.id, un: bra.id, uid, ini: D(INICIO), prev: D(somarDias(INICIO, 90)) });

    const quest = async (tipo, data, { destinos, ...r }) => {
      const [q] = await tx.consultar(
        `INSERT INTO questionario (acompanhamento_id, tipo, data_aplicacao, concluido,
            qtd_membros_familia, renda_mensal_media, qtd_membros_com_renda, recebe_auxilio,
            acesso_alimentos_in_natura, frequencia_frutas_verduras, qualidade_alimentacao, saude_nutricional,
            consegue_poupar, economia_mensal_faixa, economia_mensal_valor, capacidade_poupanca, gestao_financeira,
            empoderada_decisoes, contribuicao_autonomia, melhoria_planejamento, impacto_comunidade, o_que_melhorar,
            avaliacao_armazem, principal_beneficio, recomendaria, criado_por)
         OUTPUT INSERTED.id
         VALUES (@ac, @tipo, @data, 1, 4, @renda, @comRenda, 1, @a2a, @a2b, @a2c, @a2d, @a3a, @a3b, @a3bv, @a3d, @a3e,
                 @a4a, @a4b, @a4c, @a4d, @a4e, @a5a, @a5b, @a5c, @uid)`,
        { ac: ac.id, tipo, data: D(data), uid, ...r });
      await tx.consultar('INSERT INTO questionario_beneficio VALUES (@q, 1)', { q: q.id });
      for (const d of destinos) await tx.consultar('INSERT INTO questionario_destino_economia VALUES (@q, @d)', { q: q.id, d });
    };
    await quest('INICIAL', INICIO, {
      renda: [db.tipos.Decimal(10, 2), 1500], comRenda: 1, a2a: 'NAO_TINHA', a2b: 'UMA_DUAS', a2c: 'NAO_MELHOROU', a2d: 'NENHUMA',
      a3a: 0, a3b: 'ATE_100', a3bv: [db.tipos.Decimal(10, 2), 80], a3d: 'NAO_CONSEGUE', a3e: 'SEM_MUDANCA',
      a4a: 0, a4b: 'Poderia ajudar a comprar mais alimentos com o mesmo dinheiro.', a4c: 0,
      a4d: 'Pode aproximar os vizinhos e baratear a comida do bairro.', a4e: 'Mais variedade de frutas.',
      a5a: 'REGULAR', a5b: 'Preço mais baixo.', a5c: 1, destinos: [2],
    });
    await quest('FINAL', fim, {
      renda: [db.tipos.Decimal(10, 2), 1800], comRenda: 2, a2a: 'DIARIO', a2b: 'CINCO_OU_MAIS', a2c: 'MELHOROU_MUITO', a2d: 'GRANDE_MELHORIA',
      a3a: 1, a3b: 'DE_101_200', a3bv: [db.tipos.Decimal(10, 2), 150], a3d: 'AS_VEZES', a3e: 'MELHOROU',
      a4a: 1, a4b: 'Sobra dinheiro no fim do mês e consigo planejar as compras.', a4c: 1,
      a4d: 'Os vizinhos passaram a comprar juntos e a trocar receitas.', a4e: 'Aumentar os horários de funcionamento.',
      a5a: 'OTIMA', a5b: 'Economia e comida de qualidade perto de casa.', a5c: 1, destinos: [1, 2],
    });
    console.log(`Criada "${NOME}": pessoa ${p.id}, família ${f.id}, acompanhamento ${ac.id} (BRA, início 20/10/2026, inicial e final concluídos).`);
  });
}

(async () => {
  await travaDeSeguranca();
  if (process.argv.includes('--remover')) await remover(); else await criar();
  await db.fechar();
})().catch(async (e) => {
  console.error('Falhou:', e.message);
  await db.fechar().catch(() => {});
  process.exit(1);
});
