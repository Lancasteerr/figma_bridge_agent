import {
  BridgeFault,
  ValidateLayoutPlanInputSchema,
  type LayoutPlanValidationResult,
} from '@figma-agent/protocol';

import { layoutValidationCache } from '../layout-plan/validation-cache.js';
import { validateLayoutTopology } from '../layout-plan/validator.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';

export async function validateLayoutPlan(params: unknown): Promise<LayoutPlanValidationResult> {
  const { plan } = ValidateLayoutPlanInputSchema.parse(params);
  try {
    const { roots } = await validateLayoutTopology(plan);
    const actual = await fingerprintNodeTree(roots);
    if (actual !== plan.source.fingerprint) {
      throw new BridgeFault({
        code: 'PLAN_STALE',
        message: 'The source fingerprint no longer matches the layout plan.',
        retryable: true,
        details: { expectedFingerprint: plan.source.fingerprint, actualFingerprint: actual },
      });
    }
    const cached = layoutValidationCache.put(plan);
    return { valid: true, ...cached, warnings: [] };
  } catch (error) {
    if (error instanceof BridgeFault && error.bridgeError.code === 'PLAN_INVALID') {
      return {
        valid: false,
        warnings: [
          {
            code: error.bridgeError.code,
            message: error.bridgeError.message,
            ...(error.bridgeError.nodeId ? { nodeId: error.bridgeError.nodeId } : {}),
          },
        ],
      };
    }
    throw error;
  }
}
