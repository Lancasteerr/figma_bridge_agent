import {
  ApplyDesignPlanInputSchema,
  BridgeFault,
  ValidateDesignPlanInputSchema,
  type DesignPlanApplyResult,
  type DesignPlanValidationResult,
} from '@figma-agent/protocol';

import { executeDesignPlan } from '../design-plan/executor.js';
import { designValidationCache } from '../design-plan/validation-cache.js';
import {
  preloadDesignFonts,
  validateDesignPlan as validatePlanTopology,
} from '../design-plan/validator.js';
import { atomicMutation } from '../mutation/coordinator.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';
import { applyDesignResources, designPlanDigest } from '../design-plan/resources.js';

/** DesignPlan 验证阶段只读取当前页、字体和资源，不触碰 Undo 历史。 */
export async function validateDesignPlan(params: unknown): Promise<DesignPlanValidationResult> {
  const { plan } = ValidateDesignPlanInputSchema.parse(params);
  try {
    const source = await validatePlanTopology(plan);
    if (plan.source) {
      const actual = await fingerprintNodeTree(source.roots);
      if (actual !== plan.source.fingerprint) throw stale(plan.source.fingerprint, actual);
    }
    return { valid: true, ...designValidationCache.put(plan), warnings: source.warnings };
  } catch (error) {
    if (
      error instanceof BridgeFault &&
      (error.bridgeError.code === 'PLAN_INVALID' ||
        error.bridgeError.code === 'MISSING_FONT' ||
        error.bridgeError.code === 'RESOURCE_CONFLICT')
    ) {
      return {
        valid: false,
        warnings: [{ code: error.bridgeError.code, message: error.bridgeError.message }],
      };
    }
    throw error;
  }
}

/** 单次消费 validationId，并在打开 Undo 边界前重新检查所有源引用。 */
export async function applyDesignPlan(params: unknown): Promise<DesignPlanApplyResult> {
  const { validationId } = ApplyDesignPlanInputSchema.parse(params);
  return await atomicMutation({
    prepare: async () => {
      const plan = designValidationCache.take(validationId);
      const source = await validatePlanTopology(plan);
      if (plan.source) {
        const actual = await fingerprintNodeTree(source.roots);
        if (actual !== plan.source.fingerprint) throw stale(plan.source.fingerprint, actual);
      }
      await preloadDesignFonts(source);
      const planDigest = designPlanDigest(plan);
      return { plan, source, planDigest };
    },
    mutate: async ({ plan, source, planDigest }) => {
      const operationId = `design-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const resources = applyDesignResources(
        source.resources,
        source.resolvedFonts,
        operationId,
        planDigest,
      );
      try {
        const executed = await executeDesignPlan(plan, source, resources, operationId, planDigest);
        resources.commit();
        return {
          proposalRootId: executed.root.id,
          refMap: executed.refMap,
          resourceMap: resources.resourceMap,
          fingerprint: await fingerprintNodeTree([executed.root]),
        };
      } catch (error) {
        resources.rollback();
        throw error;
      }
    },
  });
}

function stale(expectedFingerprint: string, actualFingerprint: string): BridgeFault {
  return new BridgeFault({
    code: 'PLAN_STALE',
    message: 'The DesignPlan source fingerprint is stale.',
    retryable: true,
    details: { expectedFingerprint, actualFingerprint },
  });
}
