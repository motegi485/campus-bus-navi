/**
 * VAPID 公開鍵の配布（Cloudflare Pages Functions）。
 *
 * 公開鍵はビルドに埋め込んでもよいが、ここから配ることで
 * 「鍵を変えたらフロントを再ビルドする」という結合を外せる。
 * 公開してよい値なので認証は要らない。
 */

interface Env {
  /** wrangler / Pages の環境変数。秘密鍵（VAPID_PRIVATE_KEY）はここでは触らない */
  VAPID_PUBLIC_KEY: string
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.VAPID_PUBLIC_KEY) {
    return new Response(JSON.stringify({ error: 'VAPID 公開鍵が設定されていません' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
  return new Response(JSON.stringify({ publicKey: env.VAPID_PUBLIC_KEY }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 鍵はめったに変わらないが、変えたときに端末が古い鍵を掴み続けないよう短くする
      'Cache-Control': 'public, max-age=300',
    },
  })
}
