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
      // 关闭自动清空输出目录：sandbox 的安全删除机制会拦截 rm/emptyDir 并卡死，
      // 关闭后由产物文件名固定（lib 模式）保证不残留旧 chunk
      emptyOutDir: false,
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
          // 显式声明 entry 同时含默认导出与具名导出，消除 rollup 的 exports 形态告警。
          // 行为不变：UMD 全局下默认导出仍挂在 XiaoDaoSpreader.default，具名导出直挂。
          exports: 'named',
          globals: {
            vue: 'Vue',
          },
        },
      },
    },
  }
})
