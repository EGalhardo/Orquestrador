# Estrutura do projeto (modelo fullstack-react)

- **Frontend**: React 19 + React Router 7 + Tailwind 4 em `src/`. Rotas em `src/App.jsx`; chamadas à API com `api()` de `src/api.js`.
- **Backend**: Express em `server/app.js` (todas as rotas em `/api/...`). Em desenvolvimento corre **dentro do Vite** (uma porta, recarrega sozinho).
- **Base de dados**: SQLite (`better-sqlite3`) em `server/db.js`. Para mudar o esquema, **acrescenta** uma migração ao fim de `MIGRATIONS` (não edites as antigas).
- **Testes da API**: `server/*.test.js` com `node --test` (`npm test`).
- **Comandos**: `npm install` · `npm run dev` (pré-visualização) · `npm run build` · `npm test` · `npm start` (produção).
- Organiza código novo em ficheiros pequenos: `src/pages/`, `src/components/`, `server/routes/`.
