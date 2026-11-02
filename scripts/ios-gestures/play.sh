#!/bin/zsh
# Play a gesture list (`Driver/Gestures.swift`) on Mobile Safari in an iOS simulator: play.sh script.json [simulator id]
# Built once with: xcodebuild build-for-testing -project IOSGestures.xcodeproj -scheme GestureDriver -destination id=<sim> -derivedDataPath /tmp/ios-gestures/dd
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
script=${1:?a gesture list}
sim=${2:-0F8406F6-C2BE-4EC6-A61E-B33CC18B9F7D}
mkdir -p /tmp/ios-gestures && cp "$script" /tmp/ios-gestures/script.json
run=$(ls /tmp/ios-gestures/dd/Build/Products/*.xctestrun | head -1)
xcodebuild test-without-building -xctestrun "$run" -destination "id=$sim" -quiet 2>&1 | grep -E "error|failed|passed" | head -5
cat /tmp/ios-gestures/log.txt
