# Convenções de desenvolvimento — ASSOCIAL

Guia para quem constrói os módulos em cima da fundação. Leia junto com [`ESPECIFICACAO.md`](ESPECIFICACAO.md).
Regra geral: **código e banco em português**; banco em `snake_case`, JavaScript em `camelCase`; interface 100% em português.

## 0. Divisão de arquivos (para trabalho em paralelo sem conflito)

Cada módulo é dono de:

| O quê | Onde |
|---|---|
| API | `server/routes/<modulo>.js` → montada automaticamente em `/api/<modulo>` |
| Serviços/queries auxiliares | `server/services/<modulo>*.js` (crie a pasta se precisar) |
| Página | `public/<modulo>.html` + `public/js/paginas/<modulo>.js` (+ `public/js/<modulo>/*.js`) |
| Banco | **novo** arquivo `database/NNN_<descricao>.sql` (nunca edite `001`/`002`; se faltar algo no schema, crie um script novo ou combine com o gerente) |

Arquivos **compartilhados** (`server/app.js`, `server/db.js`, `server/middlewares/*`, `server/lib/*`, `public/js/{api,ui,layout}.js`, `public/css/*`, `package.json`) só devem ser alterados com necessidade real, em mudanças pequenas e retrocompatíveis. Estilos específicos do módulo vão em `public/css/<modulo>.css` (linkado só na página do módulo), não nos arquivos globais.

Numeração dos scripts SQL (sugestão para evitar colisão entre terminais paralelos; ajuste com o gerente): atendimentos `010–019`, ações `020–029`, famílias `030–039`, painel `040–049`, relatórios `050–059`, admin `060–069`. O `db:migrate` executa tudo em ordem alfabética.

## 1. Como criar uma rota de módulo

Basta editar/criar `server/routes/<modulo>.js` exportando um `express.Router()`. Ele já recebe `requireAuth` (sessão válida e senha trocada) e `req.usuario`:

```js
req.usuario = { id, login, nome, email, cress, perfil: 'ASSISTENTE'|'COORDENADOR'|'ADMIN',
                deveTrocarSenha, unidades: [{ id, sigla, nome }] }   // unidades JÁ filtradas pelo perfil
```

Exemplo completo (listagem + criação, com unidade, validação, transação e auditoria):

```js
'use strict';
const express = require('express');
const { consultar, consultarUm, transacao, tipos } = require('../db');
const { requirePerfil, clausulaUnidades, resolverUnidade } = require('../middlewares/auth');
const { erros } = require('../lib/erros');
const { registrarAuditoria } = require('../lib/auditoria');
const { exigir, lancarSeErros, normalizarData, inteiroPositivo } = require('../lib/validacao');

const router = express.Router();

// GET /api/exemplos?dataInicio=2026-01-01&unidadeId=3
router.get('/', async (req, res) => {
  const params = {};
  const filtros = [clausulaUnidades(req, 'e.unidade_id', params)];   // <- SEMPRE
  if (req.query.dataInicio) { filtros.push('e.data >= @dataInicio'); params.dataInicio = [tipos.Date, req.query.dataInicio]; }
  const linhas = await consultar(
    `SELECT e.id, e.data, e.unidade_id FROM exemplo e WHERE ${filtros.join(' AND ')} ORDER BY e.data DESC`, params);
  res.json(linhas);                                                   // chaves já em camelCase: unidadeId
});

// GET /api/exemplos/:id  — outra unidade => 404 (não revelar existência)
router.get('/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw erros.naoEncontrado();
  const params = { id };
  const where = clausulaUnidades(req, 'e.unidade_id', params);
  const registro = await consultarUm(`SELECT * FROM exemplo e WHERE e.id = @id AND ${where}`, params);
  if (!registro) throw erros.naoEncontrado();
  res.json(registro);
});

// POST /api/exemplos
router.post('/', requirePerfil('ASSISTENTE', 'COORDENADOR'), async (req, res) => {
  const problemas = {};
  const data = normalizarData(req.body.data);
  if (!data) problemas.data = 'Informe uma data válida.';
  lancarSeErros(problemas);                                           // -> 400 { erro: { codigo: 'VALIDACAO', detalhes } }

  const unidadeId = resolverUnidade(req, req.body.unidadeId);         // valida permissão; usa a única unidade do usuário se omitida

  const id = await transacao(async (tx) => {
    const [novo] = await tx.consultar(
      `INSERT INTO exemplo (unidade_id, data, criado_por) OUTPUT INSERTED.id VALUES (@unidadeId, @data, @usuario)`,
      { unidadeId, data: [tipos.Date, data], usuario: req.usuario.id });
    await registrarAuditoria(req, 'CRIAR', 'exemplo', novo.id, undefined, tx);
    return novo.id;
  });
  res.status(201).json({ id });
});

module.exports = router;
```

Regras:

- **Queries sempre parametrizadas** (`@nome` + objeto de parâmetros). Nunca concatene valores vindos do usuário no SQL. Nomes de tabela/coluna dinâmicos só a partir de *whitelist* (ver `TABELAS_APOIO`).
- Tipo do parâmetro: texto/inteiro/bit são inferidos; **decimais e datas só-data com tipo explícito**: `[tipos.Decimal(10, 2), valor]`, `[tipos.Date, '2026-03-01']`.
- Resultados voltam em **camelCase**; colunas `DATE` chegam como `Date` UTC-meia-noite (JSON: `"2026-03-01T00:00:00.000Z"`) — no front use `formatarData()` que lê só os 10 primeiros caracteres.
- Escritas que tocam várias tabelas (registro + N:N) usam `transacao(async (tx) => ...)`. Padrão para N:N em edição: `DELETE` das linhas do registro + `INSERT` das novas, na mesma transação.
- Preencha `criado_por` no INSERT e `alterado_por = @usuario, alterado_em = SYSUTCDATETIME()` no UPDATE. Chame `registrarAuditoria(req, acao, tabela, id, detalhes)` em criar/alterar/excluir (não grave CPF nem textos longos em `detalhes`).
- Não use `console.log` com dados pessoais.
- Rotas `GET /api/<modulo>/_status` dos esqueletos são só demonstração: remova ao implementar.
- Listas para selects (demandas, temas, gêneros...) vêm de `GET /api/apoio` (somente ativas) — não faça hard-code.

### Perfis

`requirePerfil('COORDENADOR', 'ADMIN')` restringe a rota (ou `router.use(...)` o módulo inteiro). O front também esconde itens de menu por perfil (`ITENS_MENU` em `layout.js`), mas **o back-end é quem decide**.

## 2. Filtro por unidade (obrigatório — LGPD)

| Helper (`server/middlewares/auth.js`) | Uso |
|---|---|
| `unidadesPermitidas(req)` | `number[]` com os IDs das unidades do usuário (ASSISTENTE: vinculadas; COORDENADOR/ADMIN: todas ativas) |
| `clausulaUnidades(req, 'a.unidade_id', params)` | devolve `a.unidade_id IN (@un0, @un1)` (ou `1 = 0` se sem unidade) já preenchendo `params`. Use em **todo** SELECT/UPDATE/DELETE de dados por unidade |
| `exigirUnidade(req, unidadeId)` | 403 se a unidade não é permitida (ao gravar com unidade vinda do front) |
| `resolverUnidade(req, unidadeIdInformada)` | valida a informada ou usa a única unidade do usuário; senão 400 |

Regras:

1. Ao carregar por `id`, inclua a cláusula de unidade no `WHERE` e devolva **404** se não achar.
2. Filtros de unidade vindos da tela (`?unidadeId=`) são *adicionais*: aplique `clausulaUnidades` e só então `AND a.unidade_id = @filtro`; se o filtro não estiver entre `unidadesPermitidas`, responda 403.
3. **Pessoa** (`dbo.pessoa`) é global por CPF: a busca por CPF (para reaproveitar cadastro) devolve **apenas dados pessoais** — nunca atendimentos/acompanhamentos de outra unidade, nem sequer um contador ou data do último atendimento fora do escopo.
4. `familia`/`familia_membro` não têm unidade: exponha-os só via `acompanhamento` de unidade permitida (`JOIN acompanhamento ac ... WHERE ${clausulaUnidades(req, 'ac.unidade_id', params)}`).
5. Fotos de ações (`acao_visita_foto`) não ficam em pasta pública: sirva por rota autenticada que verifica a unidade da ação.
6. Agregações do painel/relatórios também passam pelo filtro (COORDENADOR/ADMIN têm todas; ASSISTENTE só as dela).

## 3. Como criar uma página (front)

1. Copie uma página-esqueleto (ex.: `public/atendimentos.html`): `<main id="conteudo">` + `<script type="module" src="/js/paginas/<modulo>.js">`. **Sem scripts nem `onclick` inline** (a CSP bloqueia); sem frameworks.
2. No JS da página:

```js
import { iniciarPagina } from '../layout.js';
import { api, ErroApi } from '../api.js';
import { h, toast, abrirModal, confirmar, carregando, formatarData, mostrarErrosCampos, comEspera } from '../ui.js';

const { usuario, conteudo } = await iniciarPagina('atendimentos');   // valida sessão/perfil, injeta cabeçalho e menu
conteudo.replaceChildren(h('h1', {}, 'Atendimentos'), carregando());

try {
  const lista = await api.get('/api/atendimentos', { dataInicio: '2026-01-01' });
  // ...renderizar
} catch (e) {
  toast.erro(e.message);
}
```

3. **Componentes CSS** (`public/css/componentes.css`; use as variáveis de `tokens.css`, nunca cores soltas): `.btn` (`-secundario`, `-perigo`, `-texto`, `-pequeno`, `-bloco`), `.card`, `.campo` + `.input/.select/.textarea` + `.ajuda/.erro-campo`, `.opcoes/.opcao` (checkbox/radio grandes para toque), `fieldset.secao`, `.badge(-sucesso|-aviso|-perigo|-info)`, `.aviso(-sucesso|-aviso|-perigo)`, `.grade .grade-2/3/4`, `.linha`, `.barra-acoes`, `.carregando`.
4. **Tabela que vira lista no celular**: classe `tabela tabela-responsiva` e `data-rotulo` em cada `td`:

```html
<div class="tabela-wrap"><table class="tabela tabela-responsiva">
  <thead><tr><th>Data</th><th>Nome</th></tr></thead>
  <tbody><tr><td data-rotulo="Data">05/03/2026</td><td data-rotulo="Nome">Maria</td></tr></tbody>
</table></div>
```

5. **Formulários**: um `.campo` por pergunta com `<label for>`; o `name` do input deve ser o mesmo nome do campo na API (camelCase) para `mostrarErrosCampos(form, e.detalhes)` marcar o campo certo. Mobile-first: uma coluna, alvos de toque ≥ 44px, `inputmode="numeric"` para CPF/CEP/valores, máscaras com `mascarar(input, formatarCpf)`.
6. Mensagens: `toast.sucesso/erro/aviso`; confirmações destrutivas com `await confirmar('...', { perigo: true })`; janelas com `abrirModal`.
7. Datas na tela em **dd/mm/aaaa** (`formatarData`); em `<input type="date">` e na API sempre `AAAA-MM-DD`. Valores em R$ com `formatarMoeda`.
8. Escreva texto de usuário sempre em português e **nunca** monte HTML com dados do usuário via `innerHTML` sem `esc()` (prefira `h()`).
9. Ao criar um módulo/página nova, registre o item em `ITENS_MENU` (`public/js/layout.js`) e, se for estático novo, considere o cache do service worker (`VERSAO` em `public/sw.js`).

## 4. Validação e erros da API

- Corpo/respostas JSON em **camelCase**; erros em um único formato:

```json
{ "erro": { "codigo": "VALIDACAO", "mensagem": "Dados inválidos.", "detalhes": { "cpf": "CPF inválido." } } }
```

| Status | `codigo` | Quando |
|---|---|---|
| 400 | `VALIDACAO` | campos inválidos (`detalhes` = `{ campo: mensagem }`) — `erros.validacao(...)` / `lancarSeErros(...)` |
| 401 | `NAO_AUTENTICADO` | sem sessão (o `api.js` redireciona ao login) |
| 403 | `PROIBIDO` / `TROCAR_SENHA` | perfil/unidade sem permissão; senha provisória pendente |
| 404 | `NAO_ENCONTRADO` | inexistente **ou de outra unidade** |
| 409 | `CONFLITO` | duplicidade (ex.: CPF já cadastrado), regra de negócio |
| 429 | `MUITAS_REQUISICOES` | rate-limit |
| 503 | `BANCO_INDISPONIVEL` | banco fora do ar |
| 500 | `ERRO_INTERNO` | inesperado (detalhes só no log do servidor) |

- Lance erros com `throw erros.xxx(...)` (Express 5 já encaminha rejeições de `async` ao handler; não precisa de try/catch na rota). Erros de unicidade/FK do SQL Server viram 409 automaticamente.
- Validar **sempre no back-end**; a validação do front é só conveniência. Helpers em `server/lib/validacao.js`: `normalizarCpf/cpfValido`, `normalizarCep/cepValido`, `normalizarData` (`'AAAA-MM-DD'`, devolve `undefined` se inválida), `calcularIdade`, `texto(valor, max)`, `exigir`, `lancarSeErros`, `inteiroPositivo`.
- CPF e CEP: guardar **só dígitos** (`CHAR(11)`/`CHAR(8)`); formatar apenas na exibição.
- Faixa etária: calcule pela data de nascimento na data do atendimento usando `faixa_etaria.idade_min/idade_max`; sem data de nascimento use a opção "Outra" (ambas NULL).
- Todas as requisições que alteram dados (POST/PUT/PATCH/DELETE) precisam do cabeçalho `X-Requested-With: fetch` — usando `public/js/api.js` já vai automático. Para teste via curl: `-H "X-Requested-With: fetch"`.
- Upload (fotos): `multer` gravando em `config.uploadDir`, validar tipo (`image/jpeg|png|webp`) e tamanho (config `upload_max_mb`), gravar só o nome gerado no banco (`acao_visita_foto.arquivo`).

## 5. Banco de dados

- Scripts em `database/NNN_*.sql`, **idempotentes** (`IF OBJECT_ID(N'dbo.x', N'U') IS NULL CREATE TABLE ...`, `IF NOT EXISTS (SELECT 1 FROM sys.indexes ...)`), lotes separados por `GO`. Para alterar tabela existente: `IF COL_LENGTH('dbo.tabela', 'coluna') IS NULL ALTER TABLE ... ADD ...`.
- Toda tabela principal tem `criado_por/criado_em/alterado_por/alterado_em` (UTC). Tabelas de apoio têm `ordem`, `ativo`, `exige_texto` — **desative em vez de apagar** opções já usadas.
- Respostas fechadas do questionário familiar são códigos (`CHECK`) — tabela de códigos e rótulos em `server/lib/dominios.js` (`QUESTIONARIO`). Perguntas múltiplas: `questionario_beneficio` (1d) e `questionario_destino_economia` (3c); os textos "outro/outras" ficam em `auxilio_outro` e `destino_economia_outro`.
- Atendimento: múltiplas em `atendimento_demanda`, `atendimento_vulnerabilidade`, `atendimento_encaminhamento`; textos "Outra/Outros" em `demanda_outra`, `vulnerabilidade_outra`, `encaminhamento_outro`.
- Ação/visita: até 4 temas (`acao_visita_tema.ordem` 1..4 impõe o limite), fotos em `acao_visita_foto` (arquivo em `UPLOAD_DIR`).
- Configurações em `dbo.configuracao` (`chave/valor`): `prazo_questionario_final_dias` (padrão 90), `alerta_questionario_final_dias_antes` (15), `upload_max_mb` (10), `nome_entidade`, `termo_colaboracao`.
- Sessões ficam em `dbo.sessao`; usuários inativos perdem o acesso imediatamente (o `requireAuth` consulta o usuário a cada requisição).

## 6. Checklist antes de entregar um módulo

- [ ] Toda query de dados por unidade usa `clausulaUnidades`/`exigirUnidade`/`resolverUnidade`; testei com ASSISTENTE de unidade A tentando ver dado da unidade B (esperado 404/403).
- [ ] Perfis corretos nas rotas e no `ITENS_MENU`.
- [ ] Validação no back-end com mensagens em português; erros no formato padrão.
- [ ] Auditoria (`criado_por`/`alterado_por` + `registrarAuditoria`) nas escritas.
- [ ] Tela usável no celular (uma coluna, toque ≥ 44px, tabela responsiva) e no desktop.
- [ ] Script SQL novo idempotente e rodado duas vezes sem erro.
- [ ] Sem `console.log` de dados pessoais; sem segredos no código.
