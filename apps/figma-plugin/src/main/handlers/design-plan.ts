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
  const { plan, returnRefs = [] } = ValidateDesignPlanInputSchema.parse(params);
  try {
    const source = await validatePlanTopology(plan, returnRefs);
    if (plan.source) {
      const actual = await fingerprintNodeTree(source.roots);
      if (actual !== plan.source.fingerprint) throw stale(plan.source.fingerprint, actual);
    }
    return {
      status: 'VALID',
      ...designValidationCache.put(plan, returnRefs),
      ...(source.warnings.length > 0 ? { warnings: source.warnings } : {}),
    };
  } catch (error) {
    if (
      error instanceof BridgeFault &&
      (error.bridgeError.code === 'PLAN_INVALID' ||
        error.bridgeError.code === 'MISSING_FONT' ||
        error.bridgeError.code === 'RESOURCE_CONFLICT')
    ) {
      const ref = issueRef(error.bridgeError.details);
      return {
        status: 'INVALID',
        issues: [
          {
            code: error.bridgeError.code,
            message: error.bridgeError.message,
            ...(ref ? { ref } : {}),
            ...(error.bridgeError.nodeId ? { nodeId: error.bridgeError.nodeId } : {}),
          },
        ],
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
      const { plan, returnRefs } = designValidationCache.take(validationId);
      const source = await validatePlanTopology(plan, returnRefs);
      if (plan.source) {
        const actual = await fingerprintNodeTree(source.roots);
        if (actual !== plan.source.fingerprint) throw stale(plan.source.fingerprint, actual);
      }
      await preloadDesignFonts(source);
      const planDigest = designPlanDigest(plan);
      return { plan, returnRefs, source, planDigest };
    },
    mutate: async ({ plan, returnRefs, source, planDigest }) => {
      const operationId = `design-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const resources = applyDesignResources(
        source.resources,
        source.resolvedFonts,
        operationId,
        planDigest,
      );
      try {
        const executed = await executeDesignPlan(plan, source, resources, operationId, planDigest);
        const allRefs = { ...executed.refMap, ...resources.resourceMap };
        const refMap = Object.fromEntries(
          returnRefs.map((ref) => [ref, requireAppliedRef(allRefs, ref)]),
        );
        const proposalFingerprint = await fingerprintNodeTree([executed.root]);
        resources.commit();
        return {
          proposalRootId: executed.root.id,
          ...(returnRefs.length > 0 ? { refMap } : {}),
          proposalFingerprint,
        };
      } catch (error) {
        resources.rollback();
        throw error;
      }
    },
  });
}

/** 只从内部错误中提升计划定位 ref，不转发任意 details。 */
function issueRef(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const ref = (details as Record<string, unknown>).ref;
  return typeof ref === 'string' ? ref : undefined;
}

function requireAppliedRef(refs: Record<string, string>, ref: string): string {
  const nodeId = refs[ref];
  if (nodeId) return nodeId;
  throw new BridgeFault({
    code: 'INTERNAL_ERROR',
    message: `Validated return ref ${ref} was not produced while applying the DesignPlan.`,
    retryable: false,
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
