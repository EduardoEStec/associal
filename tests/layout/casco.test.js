'use strict';

// Casco das páginas (V13): cabeçalho, menu e atalhos já vêm no HTML, para a troca de página não piscar.
// Aqui se confere que o HTML estático acompanha a lista de itens de public/js/layout.js e as regras de perfil.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLICO = path.join(__dirname, '..', '..', 'public');
const ler = (arq) => fs.readFileSync(path.join(PUBLICO, arq), 'utf8').replace(/\r\n/g, '\n');

// ITENS_MENU de layout.js (o módulo importa DOM; aqui só se lê o texto)
function itensMenu() {
  const bloco = ler('js/layout.js').match(/export const ITENS_MENU = \[([\s\S]*?)\n\];/)[1];
  return [...bloco.matchAll(/\{ chave: '(\w+)', rotulo: '([^']+)', href: '([^']+)', perfis: (TODOS|\[[^\]]*\])/g)]
    .map((m) => ({ chave: m[1], rotulo: m[2], href: m[3], soCoordenacao: m[4] !== 'TODOS' }));
}
const ITENS = itensMenu();
const PAGINAS = ITENS.map((i) => ({ ...i, arquivo: i.href.slice(1) }));

test('a lista de itens do menu foi lida (7 itens, Painel e Administração só da coordenação)', () => {
  assert.deepEqual(ITENS.map((i) => i.chave), ['inicio', 'atendimentos', 'acoes', 'familias', 'relatorios', 'painel', 'admin']);
  assert.deepEqual(ITENS.filter((i) => i.soCoordenacao).map((i) => i.chave), ['painel', 'admin']);
});

for (const p of PAGINAS) {
  test(`${p.arquivo}: casco no HTML, item atual marcado e script de pré-pintura antes dos módulos`, () => {
    const html = ler(p.arquivo);
    assert.match(html, /<header class="app-cabecalho">/);
    assert.match(html, /<nav class="app-menu" aria-label="Menu principal">/);
    assert.match(html, /<main id="conteudo" class="conteudo">/);
    // script comum no <head>: o primeiro desenho só acontece depois de o menu estar com o perfil certo
    const previo = html.indexOf('<script src="/js/shell-previo.js"></script>');
    assert.ok(previo > html.indexOf('<head>') && previo < html.indexOf('</head>'), 'shell-previo.js dentro do <head>');
    assert.match(html, /<link rel="modulepreload" href="\/js\/layout\.js">/);
    // espaço do botão do usuário (o JS troca pelo botão real, na mesma caixa)
    assert.match(html, /id="previo-nome"/);

    const menu = html.match(/<nav class="app-menu"[\s\S]*?<\/nav>/)[0];
    const links = [...menu.matchAll(/<a href="([^"]+)"([^>]*)><svg[\s\S]*?<span>([^<]+)<\/span><\/a>/g)];
    assert.deepEqual(links.map((l) => [l[1], l[3]]), ITENS.map((i) => [i.href, i.rotulo]), 'mesmos itens, na mesma ordem do ITENS_MENU');
    links.forEach((l, i) => {
      const item = ITENS[i];
      assert.equal(/class="[^"]*so-coordenacao/.test(l[2]), item.soCoordenacao, `${item.chave}: so-coordenacao`);
      assert.equal(/class="[^"]*menu-extra-coord/.test(l[2]), i >= 4, `${item.chave}: do 5.º item em diante vai para o "Mais" (celular, coordenação)`);
      assert.equal(/aria-current="page"/.test(l[2]), item.chave === p.chave, `${item.chave}: aria-current`);
    });
    assert.match(menu, /<button type="button" class="menu-mais-botao">/);
  });
}

test('Início: atalhos estáticos = itens do menu (menos o Início), com as mesmas regras de perfil', () => {
  const html = ler('index.html');
  const atalhos = [...html.matchAll(/<a class="atalho([^"]*)" href="([^"]+)">[\s\S]*?<strong>([^<]+)<\/strong>/g)];
  const esperados = ITENS.filter((i) => i.chave !== 'inicio');
  assert.deepEqual(atalhos.map((a) => [a[2], a[3]]), esperados.map((i) => [i.href, i.rotulo]));
  atalhos.forEach((a, i) => assert.equal(a[1].includes('so-coordenacao'), esperados[i].soCoordenacao));
});

test('Início: o resumo reserva o espaço do cartão (esqueleto com 6 blocos) e o herói traz os textos-alvo', () => {
  const html = ler('index.html');
  assert.match(html, /<section class="card resumo-inicio resumo-esqueleto" aria-hidden="true">/);
  assert.equal((html.match(/<div class="tile">/g) || []).length, 6);
  assert.match(html, /id="data-hoje-texto"/);
  assert.match(html, /<h1 id="saudacao"><\/h1>/, 'saudação vazia no HTML: o shell-previo.js preenche antes do primeiro desenho');
  assert.doesNotMatch(html, /id="carregando"/, 'o spinner foi trocado pelo esqueleto');
});

test('CSS: cabeçalho e menu são camadas próprias na transição; reduzir movimento desliga a animação', () => {
  const css = ler('css/layout.css');
  assert.match(css, /\.app-cabecalho \{ view-transition-name: cabecalho; \}/);
  assert.match(css, /\.app-menu \{ view-transition-name: menu; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*@view-transition \{ navigation: auto; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-group\(\*\), ::view-transition-old\(\*\), ::view-transition-new\(\*\) \{ animation: none !important; \}/);
  const duracao = Number(css.match(/::view-transition-group\(\*\) \{ animation-duration: (\d+)ms/)[1]);
  assert.ok(duracao >= 150 && duracao <= 200, 'fade curto (150 a 200 ms)');
});

test('service worker: nova versão e os scripts do casco pré-armazenados', () => {
  const sw = ler('sw.js');
  assert.match(sw, /const VERSAO = 'associal-v21';/);
  assert.ok(sw.includes("'/js/shell-previo.js'") && sw.includes("'/js/shell-cache.js'"));
});

test('shell-previo.js usa a mesma chave de js/shell-cache.js', () => {
  const chave = ler('js/shell-cache.js').match(/CHAVE_SHELL = '([^']+)'/)[1];
  assert.ok(ler('js/shell-previo.js').includes(`localStorage.getItem('${chave}')`));
});
