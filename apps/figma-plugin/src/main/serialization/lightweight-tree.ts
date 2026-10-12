import type { LightweightTreeNode } from '@figma-agent/protocol';

import { serializeGeometry } from './node-summary.js';
import { isSceneNode } from './resolve.js';

/**
 * 生成只用于导航的轻量节点，不查询图片尺寸、主组件或完整视觉属性。
 * order 由遍历器按过滤后的 SceneNode 兄弟顺序传入，避免再次扫描父节点。
 */
export function serializeLightweightTreeNode(
  node: SceneNode,
  order: number,
  maxTextLength: number,
): Omit<LightweightTreeNode, 'children'> {
  const childCount = 'children' in node ? node.children.filter(isSceneNode).length : 0;
  const textPreview =
    node.type === 'TEXT'
      ? {
          value: node.characters.slice(0, maxTextLength),
          truncated: node.characters.length > maxTextLength,
        }
      : undefined;
  const componentHint =
    node.type === 'INSTANCE' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
      ? { kind: node.type }
      : undefined;

  return {
    id: node.id,
    ...(node.parent ? { parentId: node.parent.id } : {}),
    order,
    name: node.name,
    type: node.type,
    visible: 'visible' in node ? node.visible : true,
    geometry: serializeGeometry(node),
    childCount,
    ...('layoutMode' in node ? { layoutMode: node.layoutMode } : {}),
    ...('layoutPositioning' in node ? { positioning: node.layoutPositioning } : {}),
    ...(textPreview ? { textPreview } : {}),
    ...(componentHint ? { componentHint } : {}),
    assetHints: {
      imagePaintCount: countImagePaints(node),
      exportSettingCount: 'exportSettings' in node ? node.exportSettings.length : 0,
      hasVector:
        node.type === 'VECTOR' ||
        node.type === 'BOOLEAN_OPERATION' ||
        ('vectorPaths' in node && node.vectorPaths.length > 0),
      isMask: 'isMask' in node && node.isMask,
    },
  };
}

function countImagePaints(node: SceneNode): number {
  let count = 0;
  for (const paints of [
    'fills' in node ? node.fills : undefined,
    'strokes' in node ? node.strokes : undefined,
  ]) {
    if (!Array.isArray(paints)) continue;
    count += paints.filter((paint) => paint.type === 'IMAGE').length;
  }
  return count;
}
