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
	-sEXPORTED_FUNCTIONS=_engine_init_webgpu,_engine_init_webgl,_engine_view,_engine_camera,_engine_item,_engine_remove,_engine_clear,_engine_texture_gpu,_engine_texture_gl,_engine_forget_texture,_engine_target,_engine_dirty,_engine_visible,_engine_frame,_engine_stat,_engine_bridge \
	-sEXPORTED_RUNTIME_METHODS=GL \
	-sNO_EXIT_RUNTIME=1 -sFILESYSTEM=0 -sASSERTIONS=0 \
	-o wasm/engine.mjs
ls -la wasm

# The scene: the drawing's model and layout, with no GPU, for the page, a worker and the server.
# HarfBuzz, built once from its own source into an object beside it: Emscripten's port drags in
# FreeType, whose install fails on this disk, and HarfBuzz reads fonts without it.
HB="${HARFBUZZ:-/mnt/data/decks-data/tools/harfbuzz-10.1.0}"
if [ ! -f "$HB/harfbuzz.o" ]; then em++ -std=c++17 -O2 -DHB_NO_MT -fno-exceptions -fno-rtti -c "$HB/src/harfbuzz.cc" -o "$HB/harfbuzz.o"; fi
em++ cpp/scene.cpp cpp/pick.cpp cpp/snap.cpp cpp/text.cpp cpp/card.cpp cpp/paint.cpp cpp/raster.cpp "$HB/harfbuzz.o" -I"$HB/src" -std=c++20 -O3 \
	--js-library cpp/scene-library.js \
	-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createSceneModule -sENVIRONMENT=web,worker,node \
	-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=2MB \
	-sEXPORTED_FUNCTIONS=_scene_input,_scene_reset,_scene_bytes,_scene_text,_scene_card,_text_card,_paint_init,_paint_record,_paint_flags,_paint_scheme,_paint_tile,_scene_add,_scene_set,_scene_children,_scene_words,_scene_fonts,_scene_remove,_scene_count,_scene_layout,_scene_results,_pick_io,_pick_add,_pick_remove,_pick_set,_pick_geometry,_pick_point,_pick_within,_pick_found,_snap_in,_snap_out,_snap_move,_snap_edges,_text_scratch,_text_answer,_text_lines,_text_font,_text_measure,_text_face_metrics \
	-sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 \
	-sEXPORTED_RUNTIME_METHODS=HEAPF64,HEAP32,HEAPU8,GL \
	-sNO_EXIT_RUNTIME=1 -sFILESYSTEM=0 -sASSERTIONS=0 \
	-o wasm/scene.mjs
ls -la wasm/scene.*
