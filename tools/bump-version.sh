#!/usr/bin/env bash
# Give every game file link in index.html a new ?v= number so browsers load the
# new files together instead of mixing a cached old file with new ones.
# Run from the repo root before committing changes to src/ or index.html.
cd "$(dirname "$0")/.." || exit 1
v=$(date +%Y%m%d%H%M%S)
sed -i -E "s/\?v=[0-9]+/?v=${v}/g" index.html
echo "index.html now uses ?v=${v}"
