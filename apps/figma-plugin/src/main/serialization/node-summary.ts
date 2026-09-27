import type { Geometry, NodeSummary } from '@figma-agent/protocol';

/** 同时保留 local 和 absolute 几何，供布局修改计算坐标变换。 */
export function serializeGeometry(node: SceneNode): Geometry {
  const absolute = node.absoluteBoundingBox;
  return {
    local: { x: node.x, y: node.y, width: node.width, height: node.height },
    absolute: absolute
      ? { x: absolute.x, y: absolute.y, width: absolute.width, height: absolute.height }
      : null,
    rotation: 'rotation' in node ? node.rotation : 0,
  };
}

/** 生成轻量节点摘要，供选区和父节点 children 使用。 */
export function serializeNodeSummary(node: SceneNode): NodeSummary {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    ...(node.parent ? { parentId: node.parent.id } : {}),
    geometry: serializeGeometry(node),
  };
}
