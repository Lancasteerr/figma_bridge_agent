import {
  BridgeFault,
  ApplyLayoutPlanInputSchema,
  ValidateLayoutPlanInputSchema,
  type LayoutPlanApplyResult,
  type LayoutPlanValidationResult,
} from '@figma-agent/protocol';

import { layoutValidationCache } from '../layout-plan/validation-cache.js';
import { executeLayoutPlan } from '../layout-plan/executor.js';
import { validateLayoutTopology } from '../layout-plan/validator.js';
import { atomicMutation } from '../mutation/coordinator.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';

/** 只读验证布局计划，并缓存五分钟内可单次消费的 validationId。 */
export async function validateLayoutPlan(params: unknown): Promise<LayoutPlanValidationResult> {
  const { plan } = ValidateLayoutPlanInputSchema.parse(params);
  try {
    const { roots } = await validateLayoutTopology(plan);
    const actual = await fingerprintNodeTree(roots);
    // 拓扑正确但指纹过期同样不能缓存，否则应用时会基于用户新修改的文档执行。
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

/** 消费 validationId，重新验证拓扑和指纹后，在 Proposal 副本上原子执行计划。 */
export async function applyLayoutPlan(params: unknown): Promise<LayoutPlanApplyResult> {
  const { validationId } = ApplyLayoutPlanInputSchema.parse(params);
  return await atomicMutation({
    prepare: async () => {
      const plan = layoutValidationCache.take(validationId);
      const source = await validateLayoutTopology(plan);
      const actual = await fingerprintNodeTree(source.roots);
      // 验证到应用之间仍可能有用户编辑，因此必须在串行预检中第二次核对指纹。
      if (actual !== plan.source.fingerprint) {
        throw new BridgeFault({
          code: 'PLAN_STALE',
          message: 'The source changed after the layout plan was validated.',
          retryable: true,
          details: { expectedFingerprint: plan.source.fingerprint, actualFingerprint: actual },
        });
      }
      return { plan, source };
    },
    mutate: async ({ plan, source }) => {
      const executed = await executeLayoutPlan(plan, source);
      return {
        proposalRootId: executed.root.id,
        idMap: executed.idMap,
        fingerprint: await fingerprintNodeTree([executed.root]),
        ...(executed.componentId ? { componentId: executed.componentId } : {}),
      };
    },
  });
}
