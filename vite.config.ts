import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import packageJson from './package.json'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // prompt: 新バージョン検知時にToastで通知し、ユーザーの任意タイミングで更新させる
      // autoUpdate は操作中に強制更新される危険があるため使用しない
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: false, // public/manifest.json を直接使用
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        runtimeCaching: [
          {
            // JSONデータ: NetworkFirst（ネットワーク優先）
            // StaleWhileRevalidate は古い時刻表を表示するリスクがあるため使用しない
            // ⚠️ キャッシュバスター（?t=timestamp）付きURLにも対応するため
            //    末尾に (\?.*)? を追加。/\.json$/ では ?t= 付きURLがマッチしなくなるバグが発生する
            urlPattern: /\/data\/.*\.json(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'timetable-data',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7日
              },
            },
          },
          {
            // OSMタイル: Cache First（オフライン時もキャッシュ済みタイルを表示するため）
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30日
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
  },
  define: {
    '__APP_VERSION__': JSON.stringify(packageJson.version),
  },
})
