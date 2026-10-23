# ggwave

Vendored from https://github.com/ggerganov/ggwave at commit 060aec73dd7123ccac200442f75bdc7369795ffe (0.4.3), under its included MIT license. Sources are unmodified. The extension decoder is built from these sources and the unmodified JavaScript binding `emscripten.cpp` from the MIT-licensed ggwave npm package 0.4.0 (upstream tag ggwave-v0.4.0, e035c75be1916ed8c0d1a38e823981366da3971e).

Run `scripts/build-sound-decoder.sh` with Emscripten 3.1.64 activated. The generated `src/vendor/ggwave/ggwave.mjs` embeds WASM, uses no dynamic JavaScript execution, and preserves binary payloads rather than interpreting them as UTF-8. Normal extension builds use the checked-in output and require no compiler download. The original npm binding remains a development-only interoperability test transmitter.
