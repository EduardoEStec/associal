'use strict';

// Servidor de teste VISUAL (sem SQL Server): serve /public + a API de relatórios sobre o banco simulado,
// com um usuário fixo. Uso:  node tests/relatorios/servidor-teste.js [porta] [ASSISTENTE|COORDENADOR]

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
process.env.NODE_ENV = 'test';
const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'associal-uploads-'));
process.env.UPLOAD_DIR = uploads;

const { instalar, UNIDADES } = require('./banco-simulado');
instalar();

const RAIZ = path.resolve(__dirname, '..', '..');
const PizZip = require('pizzip');
fs.mkdirSync(path.join(uploads, 'acoes'), { recursive: true });
fs.writeFileSync(path.join(uploads, 'acoes', 'foto1.jpg'),
  new PizZip(fs.readFileSync(path.join(RAIZ, 'server/templates/individual.docx'))).file('word/media/image1.jpeg').asNodeBuffer());
fs.writeFileSync(path.join(uploads, 'acoes', 'foto2.png'), Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABvrngfAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAC8BQPQ1QvYjAAAAABJRU5ErkJggg==', 'base64'));

const express = require('express');
const { tratarErros, protecaoCsrf } = require(path.join(RAIZ, 'server/middlewares/erros.js'));
const router = require(path.join(RAIZ, 'server/routes/relatorios.js'));

const porta = Number(process.argv[2]) || 3105;
const perfil = (process.argv[3] || 'COORDENADOR').toUpperCase();
const usuario = {
  id: 1, login: 'teste', nome: 'Usuária de Teste', email: null, cress: '12345', perfil, deveTrocarSenha: false,
  unidades: perfil === 'ASSISTENTE' ? [UNIDADES[0]] : UNIDADES,
};

const app = express();
app.use('/api', express.json(), protecaoCsrf);
app.get('/api/auth/me', (req, res) => res.json({ usuario }));
app.use('/api/relatorios', (req, res, next) => { req.usuario = usuario; next(); }, router);
app.use(express.static(path.join(RAIZ, 'public'), { extensions: ['html'] }));
app.use(tratarErros);
app.listen(porta, '127.0.0.1', () => console.log(`Servidor de teste em http://127.0.0.1:${porta}/relatorios.html (perfil ${perfil})`));
