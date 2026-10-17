#!/usr/bin/env bash
# Build the engine for the browser into demo/pkg (the app's own copy comes with the switch-over).
set -e
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown -p stage-web
wasm-bindgen --target web --out-dir demo/pkg target/wasm32-unknown-unknown/release/stage_web.wasm
ls -la demo/pkg/stage_web_bg.wasm
