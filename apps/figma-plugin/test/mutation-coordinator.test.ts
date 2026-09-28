import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MUTATION_UNDO_ANCHOR_KEY,
  MutationCoordinator,
  atomicMutation,
} from '../src/main/mutation/coordinator.js';

interface DocumentState {
  nodes: string[];
  anchors: Record<string, string>;
}

class FakeFigmaUndoRuntime {
  current: DocumentState = { nodes: [], anchors: {} };
  readonly history: DocumentState[] = [this.clone(this.current)];
  commitCalls = 0;
  undoCalls = 0;
  #anchorSequence = 0;

  readonly page = {
    findAllWithCriteria: () =>
      Object.entries(this.current.anchors)
        .filter(([, value]) => Boolean(value))
        .map(([id]) => this.anchorNode(id)),
  };

  readonly figma = {
    currentPage: this.page,
    commitUndo: () => this.commitUndo(),
    createRectangle: () => {
      const id = `anchor-${++this.#anchorSequence}`;
      this.current.anchors[id] = '';
      return this.anchorNode(id);
    },
    triggerUndo: () => this.triggerUndo(),
  };

  seedStaleAnchor(): void {
    const id = `stale-anchor-${++this.#anchorSequence}`;
    this.current.anchors[id] = 'stale';
  }

  commitUndo(): void {
    this.commitCalls += 1;
    const latest = this.history.at(-1)!;
    // Figma 不会为无实际变更的 commitUndo 创建新边界。
    if (!this.equal(this.current, latest)) this.history.push(this.clone(this.current));
  }

  triggerUndo(): void {
    this.undoCalls += 1;
    // Figma 只撤销最后一个已提交单元；未提交写入不会自动成为优先回滚目标。
    if (this.history.length > 1) this.history.pop();
    this.current = this.clone(this.history.at(-1)!);
  }

  private clone(state: DocumentState): DocumentState {
    return structuredClone(state);
  }

  private equal(left: DocumentState, right: DocumentState): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private anchorNode(id: string) {
    return {
      id,
      name: '',
      visible: true,
      locked: false,
      getPluginData: (key: string) =>
        key === MUTATION_UNDO_ANCHOR_KEY ? (this.current.anchors[id] ?? '') : '',
      setPluginData: (key: string, value: string) => {
        if (key === MUTATION_UNDO_ANCHOR_KEY && id in this.current.anchors) {
          this.current.anchors[id] = value;
        }
      },
      remove: () => {
        delete this.current.anchors[id];
      },
    };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('atomicMutation', () => {
  it('does not touch undo history when read-only preparation fails', async () => {
    const runtime = new FakeFigmaUndoRuntime();
    vi.stubGlobal('figma', runtime.figma);

    await atomicMutation({
      prepare: () => undefined,
      mutate: () => {
        runtime.current.nodes.push('successful-frame');
      },
    });
    const commitsAfterSuccess = runtime.commitCalls;

    await expect(
      atomicMutation({
        prepare: () => {
          throw new Error('invalid layout');
        },
        mutate: () => undefined,
      }),
    ).rejects.toThrow('invalid layout');

    expect(runtime.current.nodes).toEqual(['successful-frame']);
    expect(runtime.commitCalls).toBe(commitsAfterSuccess);
    expect(runtime.undoCalls).toBe(0);
  });

  it('uses the undo anchor when mutate throws before a business write', async () => {
    const runtime = new FakeFigmaUndoRuntime();
    vi.stubGlobal('figma', runtime.figma);

    await atomicMutation({
      prepare: () => undefined,
      mutate: () => {
        runtime.current.nodes.push('previous-success');
      },
    });

    await expect(
      atomicMutation({
        prepare: () => 'prepared',
        mutate: () => {
          throw new Error('figma rejected the first write');
        },
      }),
    ).rejects.toThrow('figma rejected the first write');

    expect(runtime.current.nodes).toEqual(['previous-success']);
    expect(runtime.current.anchors).toEqual({});
    expect(runtime.undoCalls).toBe(1);
  });

  it('rolls back partial writes together with the undo anchor', async () => {
    const runtime = new FakeFigmaUndoRuntime();
    vi.stubGlobal('figma', runtime.figma);

    await atomicMutation({
      prepare: () => undefined,
      mutate: () => {
        runtime.current.nodes.push('stable-node');
      },
    });

    await expect(
      atomicMutation({
        prepare: () => undefined,
        mutate: () => {
          runtime.current.nodes.push('partial-node');
          throw new Error('later property failed');
        },
      }),
    ).rejects.toThrow('later property failed');

    expect(runtime.current.nodes).toEqual(['stable-node']);
    expect(runtime.current.anchors).toEqual({});
  });

  it('commits a successful write as one undoable unit without persisting the anchor', async () => {
    const runtime = new FakeFigmaUndoRuntime();
    vi.stubGlobal('figma', runtime.figma);

    await atomicMutation({
      prepare: () => ({ nodeId: 'component' }),
      mutate: ({ nodeId }) => {
        runtime.current.nodes.push(nodeId);
        return nodeId;
      },
    });

    expect(runtime.current.nodes).toEqual(['component']);
    expect(runtime.current.anchors).toEqual({});
    expect(runtime.history).toHaveLength(2);

    runtime.triggerUndo();
    expect(runtime.current.nodes).toEqual([]);
  });

  it('cleans a stale hidden anchor during the next successful mutation', async () => {
    const runtime = new FakeFigmaUndoRuntime();
    runtime.seedStaleAnchor();
    vi.stubGlobal('figma', runtime.figma);

    await atomicMutation({
      prepare: () => undefined,
      mutate: () => {
        runtime.current.nodes.push('new-node');
      },
    });

    expect(runtime.current.nodes).toEqual(['new-node']);
    expect(runtime.current.anchors).toEqual({});
  });
});

describe('MutationCoordinator', () => {
  it('serializes queued mutations', async () => {
    const coordinator = new MutationCoordinator();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = coordinator.run(async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
    });
    const second = coordinator.run(async () => {
      order.push('second');
    });

    await vi.waitFor(() => expect(order).toEqual(['first:start']));
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });
});
