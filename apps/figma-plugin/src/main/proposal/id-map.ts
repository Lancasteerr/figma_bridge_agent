import { isSceneNode } from '../serialization/resolve.js';

export function mapClonedSubtree(
  source: SceneNode,
  clone: SceneNode,
  output: Record<string, string> = {},
): Record<string, string> {
  output[source.id] = clone.id;
  if ('children' in source && 'children' in clone) {
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
