/** Node 単体検査用。RPC や Cloudflare の実ランタイムを模倣したものではない。 */
export class WorkerEntrypoint<Env> {
  constructor(_ctx: unknown, protected env: Env) {}
}
