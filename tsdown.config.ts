import { defineConfig } from 'tsdown'

/** Build the runtime and its bundled declaration file for npm and Git installs. */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
  sourcemap: false,
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-web',
      '@deepseek-ai/schemastery',
    ],
  },
})
