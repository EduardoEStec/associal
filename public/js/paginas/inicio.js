// Início: saudação + atalhos para os módulos disponíveis ao perfil.
import { iniciarPagina, icone } from '../layout.js';
import { h } from '../ui.js';

const { usuario, itens } = await iniciarPagina('inicio');

const DESCRICOES = {
  atendimentos: 'Registrar e consultar atendimentos sociais',
  acoes: 'Visitas institucionais e ações, com fotos',
  familias: 'Famílias acompanhadas e questionários',
  relatorios: 'Gerar relatórios em Word (.docx)',
  painel: 'Indicadores por unidade e período',
  admin: 'Usuários, unidades e configurações',
};

const primeiroNome = usuario.nome.split(' ')[0];
document.getElementById('saudacao').textContent = `Olá, ${primeiroNome}!`;
document.getElementById('carregando').remove();

const atalhos = document.getElementById('atalhos');
for (const item of itens.filter((i) => i.chave !== 'inicio')) {
  atalhos.append(
    h('a', { class: 'card card-atalho', href: item.href },
      icone(item.chave),
      h('strong', {}, item.rotulo),
      h('span', { class: 'texto-suave texto-pequeno' }, DESCRICOES[item.chave] || ''),
    ),
  );
}

if (usuario.unidades.length === 0 && usuario.perfil === 'ASSISTENTE') {
  document.getElementById('conteudo').prepend(
    h('div', { class: 'aviso aviso-aviso' }, 'Seu usuário ainda não está vinculado a nenhuma unidade. Procure a TI.'),
  );
}

// ---- Resumo do mês (T6): ASSISTENTE vê as suas unidades; COORDENADOR/ADMIN veem o total geral ----
try {
  const { api } = await import('../api.js');
  const { formatarNumero, formatarData } = await import('../ui.js');
  const r = await api.get('/api/painel/resumo-inicio');
  const t = r.total;
  const pct = t.pctEncaminhamentos === null || t.pctEncaminhamentos === undefined
    ? '—' : `${(t.pctEncaminhamentos * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  const quadro = (rotulo, valor) => h('div', { class: 'card' },
    h('span', { class: 'texto-suave texto-pequeno' }, rotulo), h('br'), h('strong', {}, valor));
  const [ano, mes] = r.periodo.inicio.split('-');
  const escopo = usuario.perfil === 'ASSISTENTE'
    ? (usuario.unidades.length === 1 ? usuario.unidades[0].nome : 'suas unidades')
    : 'todas as unidades';
  const bloco = h('section', { class: 'resumo-inicio' },
    h('h2', {}, `Resumo de ${mes}/${ano}`),
    h('p', { class: 'texto-suave texto-pequeno' }, `Dados de ${escopo}.`),
    h('div', { class: 'grade grade-4' },
      quadro('Atendimentos', formatarNumero(t.atendimentos)),
      quadro('Ações realizadas', formatarNumero(t.acoes)),
      quadro('Participantes', formatarNumero(t.participantes)),
      quadro('Famílias acompanhadas', formatarNumero(t.familiasAcompanhadas)),
      quadro('Total de atendimento', formatarNumero(t.totalAtendimento)),
      quadro('% encaminhamentos', pct)));

  const { vencidos, aVencer, itens } = r.pendentes;
  if (vencidos + aVencer > 0) {
    bloco.append(
      h('div', { class: `aviso ${vencidos ? 'aviso-perigo' : 'aviso-aviso'}` },
        h('strong', {}, 'Questionários finais pendentes: '),
        `${vencidos} vencido(s) e ${aVencer} a vencer.`,
        h('ul', {}, itens.map((i) => h('li', {}, `${i.responsavelNome} (${i.unidadeSigla}) — limite ${formatarData(i.dataLimite)}`))),
        h('a', { href: '/familias.html' }, 'Abrir famílias')));
  }
  atalhos.before(bloco);
} catch { /* o resumo é opcional: a tela inicial funciona sem ele */ }
