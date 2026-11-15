#!/usr/bin/env bash
# Build the engine for the browser, twice, both committed so building the app needs no Rust:
#   pkg/     WebGPU only, for the browsers that have it (most);
#   pkg-gl/  WebGPU and WebGL 2 (wgpu's GL backend and naga's GLSL writer), for the ones that do not.
# WebGL 2 costs about 680 KB of brotli wasm, which a browser with WebGPU should not download; the
# page chooses which to load before it loads either (apps/web/src/stage/backends/detect.ts).
# demo/pkg (the bench page) is the WebGPU one. Needs Rust with the wasm32 target and wasm-bindgen-cli.
set -e
cd "$(dirname "$0")"
wasm=target/wasm32-unknown-unknown/release/stage_web.wasm

cargo build --release --target wasm32-unknown-unknown -p stage-web
wasm-bindgen --target web --out-dir pkg "$wasm"
rm -f pkg/.gitignore

cargo build --release --target wasm32-unknown-unknown -p stage-web --features webgl
wasm-bindgen --target web --out-dir pkg-gl "$wasm"
rm -f pkg-gl/.gitignore

rm -rf demo/pkg && cp -r pkg demo/pkg
for build in pkg pkg-gl; do
	printf '%-7s %9d bytes, %8d brotli\n' "$build" "$(wc -c < $build/stage_web_bg.wasm)" "$( (brotli -c $build/stage_web_bg.wasm 2>/dev/null || gzip -9c $build/stage_web_bg.wasm) | wc -c)"
done
