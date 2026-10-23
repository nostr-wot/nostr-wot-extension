#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Emscripten 3.1.64; source emsdk_env.sh before invoking this script.
em++ --version | head -1 | grep -F '3.1.64' >/dev/null
em++ third_party/ggwave/src/ggwave.cpp third_party/ggwave/emscripten.cpp \
  -Ithird_party/ggwave/include -Ithird_party/ggwave/src -std=c++17 -O3 --bind \
  -sDYNAMIC_EXECUTION=0 -sEMBIND_STD_STRING_IS_UTF8=0 \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sSINGLE_FILE=1 -sALLOW_MEMORY_GROWTH=1 \
  -sENVIRONMENT=web,node -sFILESYSTEM=0 \
  -o src/vendor/ggwave/ggwave.mjs
