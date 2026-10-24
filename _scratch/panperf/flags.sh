#!/bin/bash
one() { PP=$1 W=2560 H=1440 STEPS=600 node real.mjs rust-stage-engine 0.6 "${1:-coalesced}" --headed 2>&1 | grep '"label"' | sed 's/"at":{[^}]*},//' | grep -o '"label[^,]*,\|"fps[^,]*,\|"max[^,]*,\|"over20[^,]*,\|"longSum[^,]*,' | tr -d '\n'; echo; }
for i in 1 2 3 4 5; do one oldTileDraw; one ""; one noTileDrawMoving; done
