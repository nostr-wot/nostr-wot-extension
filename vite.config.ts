import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { transform, build as esbuild } from 'esbuild';
import manifest from './manifest.json' with { type: 'json' };

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Post-build plugin: compile badges/engine.ts → badges/engine.js.
 *
 * crxjs copies web_accessible_resources as-is (no TypeScript compilation).
 * The badge engine runs in MAIN world via scripting.executeScript, so it
 * must be valid JavaScript. This plugin strips types after crxjs finishes
 * and patches the dist manifest to reference the compiled .js file.
 */
function compileBadgeEngine(): Plugin {
  return {
    name: 'compile-badge-engine',
    apply: 'build',
    async closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      const tsFile = resolve(outDir, 'badges/engine.ts');
      const jsFile = resolve(outDir, 'badges/engine.js');

      if (!existsSync(tsFile)) return;

      const code = readFileSync(tsFile, 'utf-8');
      const result = await transform(code, {
        loader: 'ts',
        format: 'iife',
        target: 'es2022',
        minify: false,
      });
      writeFileSync(jsFile, result.code);
      unlinkSync(tsFile);

      // Patch dist manifest to reference the compiled .js
      const mf = resolve(outDir, 'manifest.json');
      if (existsSync(mf)) {
        const txt = readFileSync(mf, 'utf-8');
        writeFileSync(mf, txt.replace(/badges\/engine\.ts/g, 'badges/engine.js'));
      }
    },
  };
}

/**
 * Post-build plugin: re-bundle the MV3 service worker into a single,
 * self-contained classic script with no runtime imports.
 *
 * Vite's default output splits the SW across multiple chunks loaded via
 * ES `import`. When Chrome wakes a sleeping MV3 service worker, those
 * chunk imports resolve asynchronously — during that window Chrome may
 * dispatch a message before `chrome.runtime.onMessage` is registered,
 * causing "Could not establish connection. Receiving end does not exist."
 *
 * Fix: esbuild-bundle the SW entry into one file (IIFE, all deps inlined)
 * and drop `type: module` from the manifest so Chrome loads it as a
 * classic script. `onMessage` then registers on the first tick of wake-up.
 */
function bundleServiceWorker(): Plugin {
  return {
    name: 'bundle-service-worker',
    apply: 'build',
    async closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      const mf = resolve(outDir, 'manifest.json');
      if (!existsSync(mf)) return;

      const manifestJson = JSON.parse(readFileSync(mf, 'utf-8'));
      const swPath: string | undefined =
        manifestJson.background?.service_worker ||
        (Array.isArray(manifestJson.background?.scripts) ? manifestJson.background.scripts[0] : undefined);
      if (!swPath) return;

      const swFile = resolve(outDir, swPath);
      if (!existsSync(swFile)) return;

      const result = await esbuild({
        entryPoints: [swFile],
        bundle: true,
        format: 'iife',
        target: 'es2022',
        minify: false,
        write: false,
        platform: 'browser',
        absWorkingDir: outDir,
      });

      const bundled = result.outputFiles[0].text;
      writeFileSync(swFile, bundled);

      if (manifestJson.background?.type === 'module') {
        delete manifestJson.background.type;
        writeFileSync(mf, JSON.stringify(manifestJson, null, 2) + '\n');
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
    compileBadgeEngine(),
    bundleServiceWorker(),
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    minify: false,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        onboarding: resolve(__dirname, 'src/onboarding/index.html'),
        prompt: resolve(__dirname, 'src/prompt/index.html'),
      },
    },
  },
  resolve: {
    conditions: ['development'],
    alias: {
      '@assets': resolve(__dirname, 'src/assets'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@components': resolve(__dirname, 'src/components'),
      '@lib': resolve(__dirname, 'lib'),
    },
  },
});
