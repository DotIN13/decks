#!/usr/bin/env bash
# Build the engine for the browser: pkg/ for the app (committed, so building the app needs no Rust),
# and demo/pkg for the bench page. Needs Rust with the wasm32 target and wasm-bindgen-cli.
set -e
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown -p stage-web
wasm-bindgen --target web --out-dir pkg target/wasm32-unknown-unknown/release/stage_web.wasm
rm -f pkg/.gitignore
rm -rf demo/pkg && cp -r pkg demo/pkg
ls -la pkg/stage_web_bg.wasm
