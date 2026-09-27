import { BridgeFault, type LayoutPlan } from '@figma-agent/protocol';

const VALIDATION_TTL_MS = 5 * 60_000;

interface Entry {
  /** 缓存只保存已经过拓扑和指纹校验的原始计划。 */
  plan: LayoutPlan;
  expiresAt: number;
}

export class LayoutValidationCache {
  readonly #entries = new Map<string, Entry>();

  /** 保存五分钟内可应用的一次验证结果，并清理已过期条目。 */
  put(plan: LayoutPlan): { validationId: string; expiresAt: string } {
    this.prune();
    const validationId = createId();
    const expiresAt = Date.now() + VALIDATION_TTL_MS;
    this.#entries.set(validationId, { plan, expiresAt });
    return { validationId, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** 取出后立即删除，保证 validationId 只能被消费一次。 */
  take(validationId: string): LayoutPlan {
    const entry = this.#entries.get(validationId);
    this.#entries.delete(validationId);
    if (!entry || entry.expiresAt <= Date.now()) {
      throw new BridgeFault({
        code: 'VALIDATION_EXPIRED',
        message: 'Layout plan validation is missing, expired, or was already applied.',
        retryable: true,
      });
    }
    return entry.plan;
  }

  /** 源文档变化或插件状态重置时使全部验证结果失效。 */
  invalidate(): void {
    this.#entries.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(id);
    }
  }
}

/** validationId 不承载敏感数据，只用于索引内存中的短期条目。 */
function createId(): string {
  const random = Math.random().toString(36).slice(2);
  return `layout-${Date.now().toString(36)}-${random}`;
}

export const layoutValidationCache = new LayoutValidationCache();
