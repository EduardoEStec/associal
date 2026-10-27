'use strict';

// V21: o padrão "Outro/Outra" nos formulários (campo escondido que aparece ao marcar, rótulo obrigatório, não envia vazio,
// limpa ao desmarcar). Lê os fontes (não há navegador nos testes), como tests/layout/casco.test.js.
// Rodar: node --test tests/layout/outro.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'public', rel), 'utf8');

test('CSS: .campo[hidden] esconde o campo (o display:flex de .campo anulava o atributo hidden)', () => {
  assert.match(ler('css/componentes.css'), /\.campo\[hidden\] \{ display: none; \}/);
});

const FORMULARIOS = {
  'atendimentos/form.js': [/obrigatorio: true/, /Especifique qual é a outra opção\./, /textosPessoa\[l\.outro\]\.value = ''/, /\.required = precisa/],
  'familias/registro-form.js': [/obrigatorio: true/, /faltando\.tipoContatoOutro/, /faltando\.orientacaoOutro/, /outro\.value = ''/],
  'familias/questionario.js': [/class: 'obrigatorio'/, /pedeDetalheMarcado\(p\)/, /definirDetalhe\(p\.codigo, ''\)/],
  'familias/questionario-legado.js': [/class: 'obrigatorio'/, /outro\.required = exige/, /definir\(campoOutro, ''\)/],
  'familias/cadastro.js': [/function ligarOutro/, /obrigatorio: true/, /faltaOutro/, /texto\.value = ''/],
  'acoes/formulario.js': [/obrigatorio: true/, /Descreva qual é o outro tipo de ação\./, /tipoOutro\.value = ''/],
};
for (const [arquivo, padroes] of Object.entries(FORMULARIOS)) {
  test(`${arquivo}: campo do "Outro" obrigatório, validado antes de enviar e limpo ao desmarcar`, () => {
    const js = ler(`js/${arquivo}`);
    for (const p of padroes) assert.match(js, p, `${arquivo}: ${p}`);
  });
}

test('admin: a coordenação marca a opção que "Pede um texto livre" (perguntas dos questionários e listas)', () => {
  assert.match(ler('js/admin/perguntas.js'), /name: 'pedeDetalhe'|'pedeDetalhe'/);
  assert.match(ler('js/admin/perguntas.js'), /corpo\.pedeDetalhe = f\.elements\.pedeDetalhe\.checked/);
  assert.match(ler('js/admin/listas.js'), /'exigeTexto'/);
});
