# API Pessoas (`/api/pessoas`)

Dados pessoais únicos por CPF, compartilhados entre módulos (Atendimentos, Famílias). Exige sessão.
**LGPD:** nenhuma resposta traz atendimentos, acompanhamentos, contadores ou datas deles.

Formato de erro padrão (ver CONVENCOES §4). Escritas exigem `X-Requested-With: fetch`.

## Objeto `pessoa`

```json
{ "id": 12, "cpf": "12345678909", "nome": "Maria da Silva", "dataNascimento": "1980-05-02T00:00:00.000Z",
  "nis": "12345678901", "telefone": "11912345678", "telefone2": null, "endereco": "Rua A, 10", "cep": "01001000", "bairro": "Centro",
  "trabalhoAtual": "Diarista", "generoId": 1, "escolaridadeId": 2, "racaId": 3 }
```

CPF/CEP/NIS/telefone: só dígitos. `telefone` e `telefone2` (recado) têm DDD + número (10 ou 11 dígitos; `400` se inválido); a máscara `(11) 91234-5678` é só de exibição (`public/js/telefone.js`, `formatarTelefone` em `server/services/pessoas.js`). `dataNascimento` chega como `Date` UTC (use `formatarData()` no front).

## `GET /api/pessoas/buscar?cpf=<11 dígitos>`

Aceita CPF com ou sem máscara. CPF inválido → `400 VALIDACAO`.

- Não existe: `{ "encontrada": false }`
- Existe: `{ "encontrada": true, "pessoa": { ... } }` — **independente da unidade**, mas só dados pessoais.
  A pessoa localizada fica registrada na sessão e pode ser atualizada (`PUT`) / usada em novo atendimento.

## `GET /api/pessoas/buscar?nome=<texto>`

Mínimo 3 letras (`400` se menos). Até 20 resultados, ordem alfabética: `{ "pessoas": [ pessoa, ... ] }`.
Só devolve pessoas que tenham atendimento **ou** acompanhamento (como responsável familiar) em unidade permitida ao usuário.

## `POST /api/pessoas` (ASSISTENTE, COORDENADOR, ADMIN)

Corpo: campos de `pessoa` sem `id` (`nome` obrigatório; `cpf` opcional, mas, se informado, válido).
- `201 { "id": 13 }`
- `409 CONFLITO` se o CPF já existe (use `buscar?cpf=` antes e reaproveite a pessoa).

## `PUT /api/pessoas/:id` (ASSISTENTE, COORDENADOR, ADMIN)

Substitui os dados pessoais (mesmo corpo do POST; campo omitido vira `null`). Permitido se a pessoa tem
atendimento/acompanhamento em unidade permitida **ou** foi localizada por CPF/criada pelo usuário na sessão atual;
caso contrário `404`. CPF de outra pessoa → `409`. Resposta: `{ "id": 13 }`.

## Para o módulo Famílias (T4)

Fluxo recomendado ao cadastrar o responsável: `GET buscar?cpf=` → se `encontrada`, use `pessoa.id`; senão `POST /api/pessoas`.
Para criar/atualizar pessoa dentro de uma transação própria, reutilize `server/services/pessoas.js`
(`normalizarTelefone`, `formatarTelefone`, `validarDadosPessoa`, `criarPessoa`, `atualizarPessoa`, `buscarPorCpf`, `pessoaNoEscopo`).

No módulo Famílias o telefone omitido **não apaga** o existente (COALESCE); no `PUT /api/pessoas/:id` e na edição de atendimento, omitido vira `null`.
