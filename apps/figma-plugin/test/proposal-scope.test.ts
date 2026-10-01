import { describe, expect, it } from 'vitest';

import { resolveProposalScope } from '../src/main/proposal/scope.js';

interface FakeNode {
  id: string;
  type: string;
  name: string;
  parent: FakeNode | null;
  children?: FakeNode[];
  x: number;
  y: number;
  width: number;
  height: number;
  layoutMode?: string;
  layoutPositioning?: string;
}

describe('adaptive Proposal clone scope', () => {
  it('keeps a Page or Section child as its own clone root', () => {
    const page = fake('PAGE', 'page');
    const section = append(page, fake('SECTION', 'section', true));
    const pageFrame = append(page, fake('FRAME', 'page-frame', true));
    const sectionFrame = append(section, fake('FRAME', 'section-frame', true));

    expect(resolveProposalScope([scene(pageFrame)]).roots[0]?.node.id).toBe('page-frame');
    expect(resolveProposalScope([scene(sectionFrame)]).roots[0]?.node.id).toBe('section-frame');
  });

  it('includes the direct Auto Layout parent for a flow child', () => {
    const page = fake('PAGE', 'page');
    const card = append(page, fake('FRAME', 'card', true, { layoutMode: 'VERTICAL' }));
    const button = append(card, fake('FRAME', 'button', true, { layoutPositioning: 'AUTO' }));

    const result = resolveProposalScope([scene(button)]);

    expect(result.roots[0]?.node.id).toBe('card');
    expect(result.bindings[0]?.resolution).toBe('AUTO_LAYOUT_PARENT');
  });

  it('does not expand absolute children or Component Set variants', () => {
    const page = fake('PAGE', 'page');
    const frame = append(page, fake('FRAME', 'frame', true, { layoutMode: 'HORIZONTAL' }));
    const overlay = append(
      frame,
      fake('FRAME', 'overlay', true, { layoutPositioning: 'ABSOLUTE' }),
    );
    const set = append(page, fake('COMPONENT_SET', 'set', true, { layoutMode: 'HORIZONTAL' }));
    const variant = append(set, fake('COMPONENT', 'variant', true));

    expect(resolveProposalScope([scene(overlay)]).roots[0]?.node.id).toBe('overlay');
    expect(resolveProposalScope([scene(variant)]).roots[0]?.node.id).toBe('variant');
  });

  it('uses the nearest structural container for a leaf', () => {
    const page = fake('PAGE', 'page');
    const group = append(page, fake('GROUP', 'group', true));
    const text = append(group, fake('TEXT', 'text'));

    const result = resolveProposalScope([scene(text)]);

    expect(result.roots[0]?.node.id).toBe('group');
    expect(result.bindings[0]?.resolution).toBe('NEAREST_CONTAINER');
  });

  it('rejects a target inside an Instance but accepts the Instance itself', () => {
    const page = fake('PAGE', 'page');
    const instance = append(page, fake('INSTANCE', 'instance', true));
    const text = append(instance, fake('TEXT', 'text'));

    expectFault(() => resolveProposalScope([scene(text)]), 'NODE_INSIDE_INSTANCE');
    expect(resolveProposalScope([scene(instance)]).roots[0]?.node.id).toBe('instance');
  });

  it('deduplicates shared and nested clone roots while preserving target mappings', () => {
    const page = fake('PAGE', 'page');
    const parent = append(page, fake('FRAME', 'parent', true, { layoutMode: 'VERTICAL' }));
    const first = append(parent, fake('FRAME', 'first', true));
    const second = append(parent, fake('FRAME', 'second', true));

    const result = resolveProposalScope([scene(first), scene(second)]);

    expect(result.roots.map((root) => root.node.id)).toEqual(['parent']);
    expect(result.bindings).toHaveLength(2);
    expect(result.bindings.every((binding) => binding.resolution === 'SHARED_CONTEXT')).toBe(true);
  });

  it('falls back to the target when an automatically expanded context exceeds 1000 nodes', () => {
    const page = fake('PAGE', 'page');
    const parent = append(page, fake('FRAME', 'parent', true, { layoutMode: 'VERTICAL' }));
    const target = append(parent, fake('FRAME', 'target', true));
    for (let index = 0; index < 1_000; index += 1) {
      append(parent, fake('RECTANGLE', `sibling-${index}`));
    }

    const result = resolveProposalScope([scene(target)]);

    expect(result.roots[0]?.node.id).toBe('target');
    expect(result.bindings[0]?.resolution).toBe('LIMIT_FALLBACK');
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'CLONE_CONTEXT_TRUNCATED', nodeId: 'target' }),
    ]);
  });

  it('rejects a requested target whose own subtree exceeds the limit', () => {
    const page = fake('PAGE', 'page');
    const target = append(page, fake('FRAME', 'target', true));
    for (let index = 0; index < 1_000; index += 1) {
      append(target, fake('RECTANGLE', `child-${index}`));
    }

    expectFault(() => resolveProposalScope([scene(target)]), 'LIMIT_EXCEEDED');
  });
});

function fake(
  type: string,
  id: string,
  withChildren = false,
  extra: Partial<FakeNode> = {},
): FakeNode {
  return {
    id,
    type,
    name: id,
    parent: null,
    ...(withChildren ? { children: [] } : {}),
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...extra,
  };
}

function append(parent: FakeNode, child: FakeNode): FakeNode {
  parent.children ??= [];
  parent.children.push(child);
  child.parent = parent;
  return child;
}

function scene(node: FakeNode): SceneNode {
  return node as unknown as SceneNode;
}

function expectFault(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error('Expected the operation to fail.');
  } catch (error) {
    expect(error).toMatchObject({ bridgeError: { code } });
  }
}
