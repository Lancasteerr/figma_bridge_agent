import { BridgeFault } from '@figma-agent/protocol';

/** 让所有写操作串行执行，避免 Figma undo 栈和共享节点状态交叉。 */
export class MutationCoordinator {
  #tail: Promise<void> = Promise.resolve();
  #active = false;

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release: (() => void) | undefined;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    if (this.#active) {
      // 队列中的调用不等待第二次并发 mutation，直接返回 BUSY 让调用方稍后重试。
      release?.();
      throw new BridgeFault({
        code: 'BUSY',
        message: 'Another mutation is active.',
        retryable: true,
      });
    }
    this.#active = true;
    try {
      return await operation();
    } finally {
      this.#active = false;
      release?.();
    }
  }
}

export const mutationCoordinator = new MutationCoordinator();

export const MUTATION_UNDO_ANCHOR_KEY = 'figma-agent-mcp:mutation-undo-anchor';
const MUTATION_UNDO_ANCHOR_NAME = '__Figma Agent Undo Anchor__';

export interface AtomicMutationOperation<Prepared, Result> {
  /** 只读预检在 undo 边界之外执行；失败时绝不能触发 Figma Undo。 */
  prepare: () => Promise<Prepared> | Prepared;
  /** 只有预检成功后才允许执行文档写入。 */
  mutate: (prepared: Prepared) => Promise<Result> | Result;
}

let undoAnchorSequence = 0;

/**
 * 将一次写操作包进单个 undo 事务，失败时恢复到操作前状态。
 *
 * Figma 会忽略没有实际变更的空 commitUndo 边界，且 Page plugin data 不参与 Undo。
 * 因此在 mutate 前创建一个隐藏临时节点，保证即使第一个业务写入立即抛错，triggerUndo
 * 也只会回滚本次边界。成功时临时节点会在 commit 前删除，不会留在文档中。
 */
export async function atomicMutation<Prepared, Result>(
  operation: AtomicMutationOperation<Prepared, Result>,
): Promise<Result> {
  return await mutationCoordinator.run(async () => {
    const prepared = await operation.prepare();
    const page = figma.currentPage;
    const anchor = `${Date.now()}:${++undoAnchorSequence}`;

    figma.commitUndo();
    const anchorNode = figma.createRectangle();
    try {
      anchorNode.name = MUTATION_UNDO_ANCHOR_NAME;
      anchorNode.visible = false;
      anchorNode.locked = true;
      removeStaleUndoAnchors(page);
      anchorNode.setPluginData(MUTATION_UNDO_ANCHOR_KEY, anchor);
      const result = await operation.mutate(prepared);
      anchorNode.remove();
      figma.commitUndo();
      return result;
    } catch (error) {
      // Figma triggerUndo 只撤销已提交的最后一个单元，不会优先处理未提交写入。
      // 锚点保证这里的 commit 一定产生新单元，随后 undo 才不会命中前一次成功操作。
      figma.commitUndo();
      figma.triggerUndo();
      throw error;
    }
  });
}

/** 崩溃可能留下不可见锚点；下一次成功 mutation 会把它们和业务写入一起提交清理。 */
function removeStaleUndoAnchors(page: PageNode): void {
  const stale = page.findAllWithCriteria({
    pluginData: { keys: [MUTATION_UNDO_ANCHOR_KEY] },
  });
  for (const node of stale) {
    if (node.getPluginData(MUTATION_UNDO_ANCHOR_KEY)) node.remove();
  }
}
