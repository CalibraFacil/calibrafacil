import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/preload/preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    outDir: 'dist/preload',
    rollupOptions: {
      external: ['electron'],
    },
    sourcemap: true,
    target: 'node20',
  },
})
