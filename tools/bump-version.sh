#!/usr/bin/env bash
# Give every game file link in index.html a new ?v= number so browsers load the
# new files together instead of mixing a cached old file with new ones, and record
# the build in index.html (<meta name="build">) and version.json. The page checks
# version.json (never cached) on load and reloads itself if it's an older build.
# Run from the repo root before committing changes to src/ or index.html.
cd "$(dirname "$0")/.." || exit 1
v=$(date +%Y%m%d%H%M%S)
sed -i -E "s/\?v=[0-9]+/?v=${v}/g" index.html
sed -i -E "s/(<meta name=\"build\" content=\")[0-9]+(\">)/\1${v}\2/" index.html
printf '{ "v": "%s" }\n' "$v" > version.json
echo "index.html now uses ?v=${v} (version.json updated)"
