import {
  StageAssetRpcInputSchema,
  StagedAssetResultSchema,
  type StagedAssetResult,
} from '@figma-agent/protocol';

import { assetCache } from '../assets/asset-cache.js';

/** MCP Server 已完成内容校验；插件仅复核 wire schema 和内存配额。 */
export function stageAsset(params: unknown): StagedAssetResult {
  return StagedAssetResultSchema.parse(assetCache.put(StageAssetRpcInputSchema.parse(params)));
}
