import { isSceneNode } from '../serialization/resolve.js';

/** 按克隆前后的同序子树递归建立源节点 ID 到 Proposal 节点 ID 的映射。 */
export function mapClonedSubtree(
  source: SceneNode,
  clone: SceneNode,
  output: Record<string, string> = {},
): Record<string, string> {
  output[source.id] = clone.id;
  if ('children' in source && 'children' in clone) {
    // clone() 保留子节点顺序；只遍历两侧共有长度，避免类型差异导致越界。
    const sourceChildren = source.children.filter(isSceneNode);
    const cloneChildren = clone.children.filter(isSceneNode);
    for (let index = 0; index < Math.min(sourceChildren.length, cloneChildren.length); index += 1) {
      const sourceChild = sourceChildren[index];
      const cloneChild = cloneChildren[index];
      if (sourceChild && cloneChild) mapClonedSubtree(sourceChild, cloneChild, output);
    }
  }
  return output;
}
