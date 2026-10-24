#!/bin/bash
one() { # api label W H stage zoom
  W=$3 H=$4 STEPS=600 API=$1 node real.mjs "$5" "$6" "$2" --headed 2>&1 | grep '"label"' | sed 's/"at":{[^}]*},//' | grep -o '"label[^,]*,\|"fps[^,]*,\|"movedPerSec[^,]*,\|"p90[^,]*,\|"max[^,]*,\|"over20[^,]*,\|"gpuPan[^}]*' | tr -d '\n'; echo " $5 $3x$4"
}
for size in "1440 900" "2560 1440"; do read w h <<< "$size"
  for i in 1 2 3; do
    one http://127.0.0.1:4653 live $w $h decks-memo-design-kit-and-build 0.3
    one http://127.0.0.1:4652 latest $w $h decks-memo-design-kit-and-build 0.3
    one http://127.0.0.1:4651 fixed $w $h decks-memo-design-kit-and-build 0.3
  done
done
