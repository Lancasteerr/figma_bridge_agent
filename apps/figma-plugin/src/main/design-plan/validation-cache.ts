import { BridgeFault, type DesignPlan } from '@figma-agent/protocol';

const VALIDATION_TTL_MS = 5 * 60_000;

interface Entry {
  plan: DesignPlan;
  expiresAt: number;
}

export class DesignValidationCache {
  readonly #entries = new Map<string, Entry>();

  put(plan: DesignPlan): { validationId: string; expiresAt: string } {
    this.prune();
    const validationId = createId();
    const expiresAt = Date.now() + VALIDATION_TTL_MS;
    this.#entries.set(validationId, { plan, expiresAt });
    return { validationId, expiresAt: new Date(expiresAt).toISOString() };
  }

  take(validationId: string): DesignPlan {
    const entry = this.#entries.get(validationId);
    this.#entries.delete(validationId);
    if (!entry || entry.expiresAt <= Date.now()) {
      throw new BridgeFault({
        code: 'VALIDATION_EXPIRED',
        message: 'Design plan validation is missing, expired, or was already applied.',
        retryable: true,
      });
    }
    return entry.plan;
  }

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

function createId(): string {
  const random = Math.random().toString(36).slice(2);
  return `design-${Date.now().toString(36)}-${random}`;
}

export const designValidationCache = new DesignValidationCache();
