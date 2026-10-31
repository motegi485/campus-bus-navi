/** Node 単体検査用。RPC や Cloudflare の実ランタイムを模倣したものではない。 */
export class WorkerEntrypoint<Env> {
  constructor(_ctx: unknown, protected env: Env) {}
}

/** Node 単体検査用。index.ts が DO クラスを読み込めるようにするだけで、storage は模倣しない。 */
export class DurableObject<Env> {
  constructor(protected ctx: unknown, protected env: Env) {}
}
