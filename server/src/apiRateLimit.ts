import { WorkerEntrypoint } from 'cloudflare:workers'
import {
  checkApiRateLimit, decideApiRateLimit, readMutationUsage,
  type ApiRateLimitDecision, type ApiRateLimitEnv, type MutationUsage,
} from './apiRateLimitPolicy.js'

/** Pages の Service binding 専用。default export の公開 HTTP / Cron / DO には入口を足さない。 */
export class ApiRateLimiter extends WorkerEntrypoint<ApiRateLimitEnv> {
  /** 新 Pages 用。countsTowardDaily を省略した呼出しは、変更系なら日次に数える */
  checkDetailed(ip: string, isMutation: boolean, countsTowardDaily: boolean = isMutation): Promise<ApiRateLimitDecision> {
    return decideApiRateLimit(this.env, ip, isMutation, countsTowardDaily)
  }

  /** 旧 Pages・ロールバック互換（消さない）。ip・daily の超過はどちらも false */
  check(ip: string, isMutation: boolean): Promise<boolean> {
    return checkApiRateLimit(this.env, ip, isMutation)
  }

  /** /api/status 用。全利用者を合わせた変更系の当日の消費数 */
  mutationUsage(): Promise<MutationUsage> {
    return readMutationUsage(this.env)
  }
}
