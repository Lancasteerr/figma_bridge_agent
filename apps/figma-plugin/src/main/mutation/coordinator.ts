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

/** 将一次写操作包进单个 undo 事务，失败时恢复到操作前状态。 */
export async function atomicMutation<T>(operation: () => Promise<T>): Promise<T> {
  return await mutationCoordinator.run(async () => {
    figma.commitUndo();
    try {
      const result = await operation();
      figma.commitUndo();
      return result;
    } catch (error) {
      figma.triggerUndo();
      throw error;
    }
  });
}
