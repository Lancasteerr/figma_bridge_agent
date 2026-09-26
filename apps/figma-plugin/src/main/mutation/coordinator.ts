import { BridgeFault } from '@figma-agent/protocol';

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
      release?.();
      throw new BridgeFault({ code: 'BUSY', message: 'Another mutation is active.', retryable: true });
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

