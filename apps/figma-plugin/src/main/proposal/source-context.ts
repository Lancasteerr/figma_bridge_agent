import { fingerprintValue } from '../serialization/fingerprint.js';
import { toJsonValue } from '../serialization/json.js';
import { serializeNodeSummary } from '../serialization/node-summary.js';
import { fingerprintNodeTree, serializeNode } from '../serialization/node-snapshot.js';
import { isSceneNode } from '../serialization/resolve.js';

/**
 * 捕获克隆根和其直接布局父级。Page 不参与，因为 Proposal 自身会成为新的 Page 子节点。
 */
export async function sourceContextFingerprint(roots: readonly SceneNode[]): Promise<string> {
  const parents = uniqueSceneParents(roots);
  const value = {
    roots: await Promise.all(
      roots.map(async (root) => ({ id: root.id, tree: await fingerprintNodeTree([root]) })),
    ),
    parents: await Promise.all(parents.map(serializeParentContext)),
  };
  return fingerprintValue(toJsonValue(value));
}

async function serializeParentContext(parent: SceneNode): Promise<unknown> {
  const snapshot = await serializeNode(parent, { maxTextLength: 0 });
  return {
    id: parent.id,
    type: parent.type,
    visible: snapshot.visible,
    locked: snapshot.locked,
    layout: snapshot.layout,
    children:
      'children' in parent
        ? parent.children.filter(isSceneNode).map((child) => ({
            ...serializeNodeSummary(child),
            ...('visible' in child ? { visible: child.visible } : {}),
            ...('locked' in child ? { locked: child.locked } : {}),
            ...('layoutPositioning' in child ? { layoutPositioning: child.layoutPositioning } : {}),
            ...('layoutSizingHorizontal' in child
              ? {
                  layoutSizingHorizontal: child.layoutSizingHorizontal,
                  layoutSizingVertical: child.layoutSizingVertical,
                }
              : {}),
          }))
        : [],
  };
}

function uniqueSceneParents(roots: readonly SceneNode[]): SceneNode[] {
  const parents = new Map<string, SceneNode>();
  for (const root of roots) {
    const parent = root.parent;
    if (parent && isSceneNode(parent)) parents.set(parent.id, parent);
  }
  return [...parents.values()];
}
