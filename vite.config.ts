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
        // data/ 配下の JSON（カレンダー・時刻表・お知らせ）はプリキャッシュ対象から除外する。
        // 除外しないと素のURL (/data/xxx.json) がプリキャッシュに先勝ちでヒットし、
        // 下の NetworkFirst が「通常起動の読み込み経路」では効かなくなる
        // （ビルド時スナップショットが固定表示され、サーバ側のダイヤ更新が
        //   更新ボタンを押すまで反映されない）。除外することで通常起動も NetworkFirst を通り、
        // 常に最新ダイヤを取得しつつ、取得済み分をオフライン用フォールバックとして保持できる。
        globIgnores: ['data/**/*.json'],
        runtimeCaching: [
          {
            // 時刻表・カレンダー・お知らせ JSON: NetworkFirst（ネットワーク優先）。
            // 通常起動・更新ボタン・お知らせ取得のすべてがこの経路を通る。
            // StaleWhileRevalidate は古い時刻表を表示するリスクがあるため使用しない。
            // ネットワークが 3 秒で応答しなければ timetable-data キャッシュ（前回取得分）に
            // フォールバックする。オフライン・低速時もここで最後に取得したダイヤを表示できる。
            // ⚠️ キャッシュバスター（?t=timestamp）付きURLにも対応するため
            //    末尾に (\?.*)? を追加。/\.json$/ では ?t= 付きURLがマッチしなくなるバグが発生する
            urlPattern: /\/data\/.*\.json(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'timetable-data',
              networkTimeoutSeconds: 3,
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
