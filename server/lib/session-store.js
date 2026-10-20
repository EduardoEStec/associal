'use strict';

// Store de sessão do express-session em SQL Server (tabela dbo.sessao).
// Mantém o login após reinício do container e permite várias instâncias.

const session = require('express-session');
const db = require('../db');

class SqlSessionStore extends session.Store {
  constructor({ duracaoMs }) {
    super();
    this.duracaoMs = duracaoMs;
    // limpeza de sessões expiradas a cada 30 min (não segura o processo aberto)
    this.limpeza = setInterval(() => this.limpar(), 30 * 60 * 1000);
    this.limpeza.unref();
  }

  expiraEm(sess) {
    const expires = sess?.cookie?.expires ? new Date(sess.cookie.expires) : null;
    return expires && !Number.isNaN(expires.getTime()) ? expires : new Date(Date.now() + this.duracaoMs);
  }

  get(sid, cb) {
    db.consultarUm('SELECT dados FROM sessao WHERE sid = @sid AND expira_em > SYSUTCDATETIME()', { sid })
      .then((linha) => cb(null, linha ? JSON.parse(linha.dados) : null))
      .catch((err) => cb(err));
  }

  set(sid, sess, cb) {
    db.executar(
      `MERGE sessao WITH (HOLDLOCK) AS alvo
       USING (SELECT @sid AS sid) AS origem ON alvo.sid = origem.sid
       WHEN MATCHED THEN UPDATE SET dados = @dados, expira_em = @expira
       WHEN NOT MATCHED THEN INSERT (sid, dados, expira_em) VALUES (@sid, @dados, @expira);`,
      { sid, dados: JSON.stringify(sess), expira: [db.tipos.DateTime2, this.expiraEm(sess)] },
    )
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }

  touch(sid, sess, cb) {
    db.executar('UPDATE sessao SET expira_em = @expira WHERE sid = @sid', {
      sid,
      expira: [db.tipos.DateTime2, this.expiraEm(sess)],
    })
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }

  destroy(sid, cb) {
    db.executar('DELETE FROM sessao WHERE sid = @sid', { sid })
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }

  limpar() {
    db.executar('DELETE FROM sessao WHERE expira_em < SYSUTCDATETIME()').catch(() => {});
  }
}

module.exports = SqlSessionStore;
