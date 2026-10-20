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
