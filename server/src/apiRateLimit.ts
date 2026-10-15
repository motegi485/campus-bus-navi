import { WorkerEntrypoint } from 'cloudflare:workers'
import { checkApiRateLimit, type ApiRateLimitEnv } from './apiRateLimitPolicy.js'

/** Pages の Service binding 専用。default export の公開 HTTP / Cron / DO には入口を足さない。 */
export class ApiRateLimiter extends WorkerEntrypoint<ApiRateLimitEnv> {
  check(ip: string, isMutation: boolean): Promise<boolean> {
    return checkApiRateLimit(this.env, ip, isMutation)
  }
}
