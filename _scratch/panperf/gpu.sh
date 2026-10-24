#!/bin/zsh
# gpu.sh <outfile>: sample GPU utilisation every 100 ms until killed
while true; do ioreg -r -d 1 -c IOAccelerator | grep -o '"Device Utilization %"=[0-9]*' | head -1 | sed 's/.*=//' >> $1; sleep 0.1; done
