# Regras comuns — T2 a T7 (trabalho em paralelo)

Seis terminais trabalham AO MESMO TEMPO neste repositório. Siga à risca:

1. Leia antes: `docs/ESPECIFICACAO.md` e `docs/CONVENCOES.md` (padrões obrigatórios de rota, filtro de unidade, página, validação, erros, SQL).
2. **Edite apenas os arquivos do seu módulo** (tabela de "dono" na seção 0 de CONVENCOES.md e a lista na sua task). Arquivos compartilhados (`server/app.js`, `server/db.js`, `server/middlewares/*`, `server/lib/*`, `public/js/{api,ui,layout,pwa}.js`, `public/css/{tokens,base,componentes,layout,app}.css`, `public/sw.js`, `package.json`, `database/001*`, `database/002*`) **não devem ser editados**. Se precisar de algo neles (ex.: um helper novo ou dependência npm), implemente localmente no seu módulo ou relate ao gerente na entrega como pendência.
3. Scripts SQL só na sua faixa de numeração: atendimentos 010–019 · ações 020–029 · famílias 030–039 · painel 040–049 · relatórios 050–059 · admin 060–069. Idempotentes.
4. **Não faça `git commit`** nem `git add`/`stash`/`checkout`/`reset` — o gerente revisa e commita. Não apague arquivos de outros módulos.
5. Não há SQL Server disponível agora. Valide com: o app sobe (`node server/index.js` em uma porta própria — use a porta indicada na sua task para não colidir), páginas carregam, sintaxe JS ok (`node --check`), e se possível testes com banco simulado (mock de `server/db.js` dentro de um script de teste no seu próprio diretório `tests/<modulo>/`). Seja explícito no relatório sobre o que NÃO pôde ser testado.
6. Interface 100% em português, mobile-first, componentes de `componentes.css`, sem script inline, sem framework.
7. Trabalhe de forma autônoma; decisões de produto que você não tem confiança para tomar: escolha a opção mais conservadora, siga, e liste em "Decisões a validar" no relatório.
8. Ao terminar, reporte: `maestri ask "gerente" "<Tn concluída: arquivos criados/alterados, endpoints, como testar, o que não foi testado, decisões a validar>"`.
