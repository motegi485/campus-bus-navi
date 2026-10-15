import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Node 単体検査だけの入口 stub。実 RPC は別の Miniflare ランタイム検査で確かめる。
      'cloudflare:workers': fileURLToPath(new URL('./test/support/cloudflareWorkers.ts', import.meta.url)),
    },
  },
})
