#!/bin/sh
# Exemplo neutro de homologação. Sem WEBMANIA_LIVE=1 não compila nem faz requisições (saída 77).
# Com --build compila o checkout depois dessa verificação. Usa dist/ quando existe; senão compila
# uma cópia temporária do checkout com as dependências travadas e a remove ao terminar.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
root=$(CDPATH= cd -- "$here/../.." && pwd -P)
if [ "${WEBMANIA_LIVE:-}" != "1" ]; then printf '%s\n' '{"result":"blocked"}'; exit 77; fi
if [ "${1:-}" = "--build" ]; then (cd "$root" && npm run build) >&2; fi
if [ ! -f "$root/dist/index.js" ]; then
  work=$(mktemp -d "${TMPDIR:-/tmp}/webmania-example.XXXXXX")
  trap 'rm -rf "$work"' EXIT
  work=$(CDPATH= cd -- "$work" && pwd -P)
  # A temporary directory inside the checkout is left out of its own copy, matched literally.
  set -- --exclude=./node_modules --exclude=./dist --exclude=./.git
  case "$work" in
    "$root"/*) set -- "$@" "--exclude=./$(printf '%s\n' "${work#"$root"/}" | sed 's/[][\\*?]/\\&/g')" ;;
  esac
  (cd "$root" && tar "$@" -cf - .) | (cd "$work" && tar -xf -)
  (cd "$work" && npm ci --ignore-scripts --no-audit --no-fund && npm run build) >&2
  root=$work
fi
node "$root/examples/homologacao/main.mjs"
