#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
validator="${FUNDS_FLOW_VALIDATOR:-$repo/../AML-Canva/skills/funds-flow-layout/scripts/validate_layout.py}"
results="${1:-$repo/test-results}"

if [[ ! -f "$validator" ]]; then
  printf 'Set FUNDS_FLOW_VALIDATOR to the path of validate_layout.py\n' >&2
  exit 1
fi

for view in core return batch-D8 all; do
  snapshots=("$results"/kucoin-*/"$view.geometry.json")
  if [[ ${#snapshots[@]} != 1 || ! -f "${snapshots[0]}" ]]; then
    printf 'Expected one %s.geometry.json under %s. Run kucoin.spec.ts first.\n' "$view" "$results" >&2
    exit 1
  fi
  report=${snapshots[0]%.geometry.json}.audit.json
  PYTHONDONTWRITEBYTECODE=1 python3 "$validator" "${snapshots[0]}" --require-rendered \
    --max label_node_overlaps=0 --max label_overlaps=0 > "$report"
  printf '%s passed. Metrics in %s\n' "$view" "$report"
done
