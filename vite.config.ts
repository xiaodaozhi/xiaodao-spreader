import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  if (mode === 'demo') {
    return {
      plugins: [vue()],
      build: {
        outDir: 'dist-demo',
        rollupOptions: {
          input: fileURLToPath(new URL('./index.html', import.meta.url)),
        },
      },
    }
  }

  return {
    plugins: [vue()],
    build: {
      lib: {
        entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        name: 'XiaoDaoSpreader',
        formats: ['es', 'umd'],
        fileName: (format) =>
          format === 'es'
            ? 'xiaodao-spreader.es.js'
            : 'xiaodao-spreader.umd.js',
      },
      rollupOptions: {
        external: ['vue'],
        output: {
          globals: {
            vue: 'Vue',
          },
        },
      },
    },
  }
})
