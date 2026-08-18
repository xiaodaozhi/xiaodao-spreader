import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
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
      // 将 vue 作为外部依赖，避免打包进产物，交由使用方提供
      external: ['vue'],
      output: {
        globals: {
          vue: 'Vue',
        },
      },
    },
  },
})