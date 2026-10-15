#!/usr/bin/env bash
# Build the engine to wasm/engine.mjs and wasm/engine.wasm. Needs Emscripten on PATH, or EMSDK set:
# the built files are committed, so building the app never needs it.
set -e
cd "$(dirname "$0")"
if ! command -v em++ >/dev/null 2>&1; then . "${EMSDK:-/mnt/data/decks-data/tools/emsdk}/emsdk_env.sh" >/dev/null 2>&1; fi
mkdir -p wasm
em++ cpp/engine.cpp -std=c++20 -O3 -flto \
	--use-port=emdawnwebgpu \
	--js-library cpp/library.js \
	-sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 \
	-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createEngineModule -sENVIRONMENT=web \
	-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=4MB \
	-sEXPORTED_FUNCTIONS=_engine_init_webgpu,_engine_init_webgl,_engine_view,_engine_camera,_engine_item,_engine_remove,_engine_clear,_engine_texture_gpu,_engine_texture_gl,_engine_forget_texture,_engine_target,_engine_dirty,_engine_frame,_engine_stat,_engine_bridge \
	-sEXPORTED_RUNTIME_METHODS=GL \
	-sNO_EXIT_RUNTIME=1 -sFILESYSTEM=0 -sASSERTIONS=0 \
	-o wasm/engine.mjs
ls -la wasm
