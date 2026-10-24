#!/bin/bash
# swap.sh msaa|nomsaa : install that engine build and rebuild the web app
cd /Users/dotin13/Documents/DotGit/worktrees/pan-perf
rm -rf packages/stage/pkg && cp -R /tmp/panperf-pkg-$1 packages/stage/pkg && npm run build --workspace @decks/web >/tmp/pp-b.log 2>&1
