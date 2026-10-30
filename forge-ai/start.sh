#!/usr/bin/env bash
# Starts EGalhardo IA (API :8787 + UI :5173) and repairs the install first if needed.
# Safe to run after a fresh clone or after an environment restore that dropped node_modules/dist.
#   ./start.sh          → production-like (built UI via vite preview)
#   ./start.sh --dev    → vite dev server with hot reload
set -euo pipefail
cd "$(dirname "$0")"

healthy_deps() {
  [ -x node_modules/.bin/vite ] && [ -x node_modules/.bin/tsx ] &&
    node -e "require('better-sqlite3')(':memory:').close()" >/dev/null 2>&1
}

if ! healthy_deps; then
  echo "[forge] dependências em falta ou partidas → a reinstalar…"
  rm -rf node_modules
  npm install --no-audit --no-fund
fi

MODE="${1:-}"
if [ "$MODE" != "--dev" ] && { [ ! -f dist/index.html ] || [ -n "$(find src index.html vite.config.ts -newer dist/index.html -print -quit 2>/dev/null)" ]; }; then
  echo "[forge] a compilar a interface…"
  npx vite build
fi

command -v bwrap >/dev/null || echo "[forge] aviso: bubblewrap não instalado — comandos correm sem isolamento (sudo apt install bubblewrap)"

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

npx tsx watch --clear-screen=false server/index.ts & pids+=($!)
if [ "$MODE" = "--dev" ]; then
  npx vite --host 0.0.0.0 --port 5173 --strictPort & pids+=($!)
else
  npx vite preview --host 0.0.0.0 --port 5173 --strictPort & pids+=($!)
fi
wait -n
