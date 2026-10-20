// Acompanhamento Familiar — ESQUELETO. Substitua o conteúdo de #em-construcao pela tela do módulo.
// Convenções: docs/CONVENCOES.md ("Como criar uma página").
import { iniciarPagina } from '../layout.js';

const { usuario, conteudo } = await iniciarPagina('familias');
// usuario: { id, nome, perfil, unidades: [{ id, sigla, nome }] }  |  conteudo: <main id="conteudo">
void usuario; void conteudo;
