// Início: herói de boas-vindas, resumo do mês, atalhos para os módulos do perfil e pendências.
import { iniciarPagina, icone } from '../layout.js';
import { h, formatarNumero, formatarData } from '../ui.js';
import { api } from '../api.js';

const { usuario, itens } = await iniciarPagina('inicio');

const DESCRICOES = {
  atendimentos: 'Registrar e consultar atendimentos',
  acoes: 'Visitas institucionais e ações, com fotos',
  familias: 'Famílias acompanhadas e questionários',
  relatorios: 'Gerar relatórios em Word (.docx)',
  painel: 'Indicadores por unidade e período',
  admin: 'Usuários, unidades e configurações',
};

// ---- Herói ----
const hora = new Date().getHours();
const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
const primeiroNome = usuario.nome.split(' ')[0];
document.getElementById('saudacao').textContent = `${saudacao}, ${primeiroNome}!`;
const dataExtenso = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const unidade = usuario.unidades.length === 1 ? `${usuario.unidades[0].nome} · ` : '';
document.getElementById('data-hoje').replaceChildren(icone('acoes'), `${unidade}${dataExtenso}`);
document.getElementById('carregando').remove();

// ---- Atalhos (blocos sólidos) ----
const atalhos = document.getElementById('atalhos');
itens.filter((i) => i.chave !== 'inicio').forEach((item) => {
  atalhos.append(
    h('a', { class: 'atalho', href: item.href },
      h('span', { class: 'atalho-ic' }, icone(item.chave)),
      h('span', { class: 'atalho-texto' }, h('strong', {}, item.rotulo), h('small', {}, DESCRICOES[item.chave] || '')),
      h('span', { class: 'atalho-seta', 'aria-hidden': 'true' }, '›'),
    ),
  );
});

if (usuario.unidades.length === 0 && usuario.perfil === 'ASSISTENTE') {
  document.getElementById('conteudo').prepend(
    h('div', { class: 'aviso aviso-aviso' }, 'Seu usuário ainda não está vinculado a nenhuma unidade. Procure a TI.'),
  );
}

// ---- Resumo do mês (T6): ASSISTENTE vê as suas unidades; COORDENADOR/ADMIN veem o total geral ----
try {
  const r = await api.get('/api/painel/resumo-inicio');
  const t = r.total;
  const pct = t.pctEncaminhamentos === null || t.pctEncaminhamentos === undefined
    ? '—' : `${(t.pctEncaminhamentos * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  const tile = (icone_, rotulo, valor) => h('div', { class: 'tile' },
    h('span', { class: 'tile-ic' }, icone(icone_)), h('strong', {}, valor), h('span', { class: 'tile-rotulo' }, rotulo));
  const [ano, mes] = r.periodo.inicio.split('-');
  const escopo = usuario.perfil === 'ASSISTENTE'
    ? (usuario.unidades.length === 1 ? usuario.unidades[0].nome : 'suas unidades')
    : 'todas as unidades';
  document.getElementById('resumo').append(
    h('section', { class: 'card resumo-inicio', 'aria-labelledby': 'resumo-titulo' },
      h('h2', { id: 'resumo-titulo' }, `Seu mês — ${mes}/${ano}`),
      h('p', { class: 'texto-suave texto-pequeno' }, `Dados de ${escopo}.`),
      h('div', { class: 'tiles' },
        tile('atendimentos', 'Atendimentos', formatarNumero(t.atendimentos)),
        tile('acoes', 'Ações realizadas', formatarNumero(t.acoes)),
        tile('atendimentos', 'Participantes', formatarNumero(t.participantes)),
        tile('familias', 'Famílias acompanhadas', formatarNumero(t.familiasAcompanhadas)),
        tile('relatorios', 'Total de atendimento', formatarNumero(t.totalAtendimento)),
        tile('painel', '% encaminhamentos', pct))));

  // ---- Pra ficar de olho: questionários finais pendentes ----
  const pend = r.pendentes;
  const semContato = pend.semContato || 0;
  const pesquisas = pend.pesquisa || 0;
  const semMeta = pend.semMeta || 0;
  const reavaliacoes = pend.reavaliacao || 0;
  const linhasReavaliacao = (pend.reavaliacaoItens || []).map((i) => h('div', { class: 'pendencia' },
    h('span', { class: 'pendencia-ic' }, icone('familias')),
    h('div', { class: 'pendencia-texto' },
      h('p', {}, `Reavaliação rápida pendente — família de ${i.responsavelNome}`),
      h('small', {}, `${i.unidadeSigla} · devida desde ${formatarData(i.devidaEm)}`),
      h('a', { class: 'btn btn-pequeno', href: `/familias.html#/a/${i.acompanhamentoId}/q/REAVALIACAO` }, 'Aplicar agora'))));
  const linhasMeta = (pend.semMetaItens || []).map((i) => h('div', { class: 'pendencia' },
    h('span', { class: 'pendencia-ic' }, icone('alvo')),
    h('div', { class: 'pendencia-texto' },
      h('p', {}, `Família de ${i.responsavelNome} está há ${i.diasSemMeta} dias sem meta`),
      h('small', {}, `${i.unidadeSigla} · sem meta desde ${formatarData(i.semMetaDesde)}`),
      h('a', { class: 'btn btn-pequeno', href: `/familias.html#/a/${i.acompanhamentoId}/acompanhamento` }, 'Definir meta'))));
  const linhasPesquisa = (pend.pesquisaItens || []).map((i) => h('div', { class: 'pendencia' },
    h('span', { class: 'pendencia-ic' }, icone('estrela')),
    h('div', { class: 'pendencia-texto' },
      h('p', {}, `Pesquisa de satisfação ${i.momento === 'FINAL' ? 'final' : 'semestral'} pendente — família de ${i.responsavelNome}`),
      h('small', {}, `${i.unidadeSigla} · devida desde ${formatarData(i.devidaEm)}`),
      h('a', { class: 'btn btn-pequeno', href: `/familias.html#/a/${i.acompanhamentoId}/pesquisa/${i.momento}` }, 'Aplicar agora'))));
  if (pend.vencidos + pend.aVencer + semContato + pesquisas + semMeta + reavaliacoes > 0) {
    const linhasContato = (pend.semContatoItens || []).map((i) => h('div', { class: 'pendencia' },
      h('span', { class: 'pendencia-ic' }, icone('atendimentos')),
      h('div', { class: 'pendencia-texto' },
        h('p', {}, `Sem contato com a família de ${i.responsavelNome} há ${i.diasSemContato} dias`),
        h('small', {}, `${i.unidadeSigla} · último contato em ${formatarData(i.ultimoContato)}`),
        h('a', { class: 'btn btn-pequeno', href: `/familias.html#/a/${i.acompanhamentoId}/acompanhamento/novo` }, 'Registrar contato'))));
    const linhas = pend.itens.map((i) => {
      const vencido = i.situacao === 'VENCIDO';
      const dias = Math.abs(i.diasRestantes);
      const quando = vencido
        ? `venceu há ${dias} ${dias === 1 ? 'dia' : 'dias'}`
        : (i.diasRestantes === 0 ? 'vence hoje' : `vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`);
      return h('div', { class: `pendencia ${vencido ? 'pendencia-vencida' : ''}` },
        h('span', { class: 'pendencia-ic' }, icone('familias')),
        h('div', { class: 'pendencia-texto' },
          h('p', {}, `Questionário final da família de ${i.responsavelNome} ${quando}`),
          h('small', {}, `${i.unidadeSigla} · prazo ${formatarData(i.dataLimite)}`),
          h('a', { class: `btn btn-pequeno ${vencido ? 'btn-secundario' : ''}`, href: `/familias.html#/a/${i.acompanhamentoId}` }, vencido ? 'Ver família' : 'Aplicar agora')));
    });
    document.getElementById('pendencias').append(
      h('section', { class: 'card', 'aria-labelledby': 'pendencias-titulo' },
        h('h2', { id: 'pendencias-titulo' }, 'Pra ficar de olho'),
        h('p', { class: 'texto-suave texto-pequeno' },
          [pend.vencidos + pend.aVencer > 0 ? `${pend.vencidos} questionário(s) vencido(s) e ${pend.aVencer} a vencer` : null,
            semContato > 0 ? `${semContato} ${semContato === 1 ? 'família sem contato' : 'famílias sem contato'}` : null,
            pesquisas > 0 ? `${pesquisas} ${pesquisas === 1 ? 'pesquisa de satisfação pendente' : 'pesquisas de satisfação pendentes'}` : null,
            semMeta > 0 ? `${semMeta} ${semMeta === 1 ? 'família sem meta' : 'famílias sem meta'}` : null,
            reavaliacoes > 0 ? `${reavaliacoes} ${reavaliacoes === 1 ? 'reavaliação pendente' : 'reavaliações pendentes'}` : null].filter(Boolean).join(' · ') + '.'),
        h('div', { class: 'pendencias' }, [...linhasContato, ...linhasMeta, ...linhasReavaliacao, ...linhasPesquisa, ...linhas])));
  }
} catch { /* o resumo é opcional: a tela inicial funciona sem ele */ }
