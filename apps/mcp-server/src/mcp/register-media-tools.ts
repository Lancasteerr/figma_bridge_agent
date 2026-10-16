import { randomUUID } from 'node:crypto';

import { DOMParser } from '@xmldom/xmldom';
import {
  BridgeFault,
  BindExportRootInputSchema,
  BindExportRootResultSchema,
  CheckAssetSourceGuardRpcInputSchema,
  CheckAssetSourceGuardRpcResultSchema,
  type ExportAssetItemSchema,
  ExportAssetRpcInputSchema,
  ExportAssetRpcResultSchema,
  ExportAssetsInputSchema,
  ExportAssetsResultSchema,
  RenderNodeInputSchema,
  RenderRpcResultSchema,
  RenderResultSchema,
  StageAssetInputSchema,
  StageAssetRpcInputSchema,
  StagedAssetResultSchema,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';
import { fileTypeFromBuffer } from 'file-type';
import { imageSize } from 'image-size';

import type { BridgeTransport } from '../bridge/transport.js';
import type { ExportStore } from '../export/export-store.js';
import { validateInboundAsset } from '../inbound/asset-validator.js';
import type { TemporaryArtifactStore } from '../temp/artifact-store.js';
import { structuredResult, toolError } from './result.js';
import type { RegisteredToolMap } from './tool-registry.js';

const MAX_EXPORT_BYTES = 9 * 1024 * 1024;
const MAX_EXPORT_BATCH_BYTES = 64 * 1024 * 1024;

/** 注册素材暂存、工程导出和视觉预览工具。 */
export function registerMediaTools(
  server: McpServer,
  broker: BridgeTransport,
  previews: TemporaryArtifactStore,
  exports: ExportStore,
): RegisteredToolMap {
  const tools: RegisteredToolMap = {};
  tools.figma_bind_export_root = server.registerTool(
    'figma_bind_export_root',
    {
      description:
        'Bind the current MCP session to the exact absolute workspace root reported by the Agent execution environment. Call figma_status first and bind before the first export.',
      inputSchema: BindExportRootInputSchema,
      outputSchema: BindExportRootResultSchema,
      annotations: {
        title: 'Bind Figma export root',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = BindExportRootInputSchema.parse(input);
        const status = await exports.bindRoot(parsed.rootPath, parsed.expectedSessionId);
        return structuredResult(BindExportRootResultSchema.parse({ rootPath: status.rootPath }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tools.figma_stage_asset = server.registerTool(
    'figma_stage_asset',
    {
      description:
        'Validate Agent-provided Base64 PNG, JPEG, GIF, or SVG data and stage it in the connected Figma plugin memory. URLs and local paths are not accepted.',
      inputSchema: StageAssetInputSchema,
      outputSchema: StagedAssetResultSchema,
      annotations: {
        title: 'Stage Figma Design Asset',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = StageAssetInputSchema.parse(input);
        const validated = await validateInboundAsset(parsed);
        const rpcInput = StageAssetRpcInputSchema.parse({ assetId: randomUUID(), ...validated });
        return structuredResult(
          StagedAssetResultSchema.parse(await broker.request('stageAsset', rpcInput, 30_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tools.figma_export_assets = server.registerTool(
    'figma_export_assets',
    {
      description:
        'Atomically export up to 32 exact Figma image paints or node renders under the session-bound workspace. An optional sourceGuard reuses one semantic sourceFingerprint for the entire batch.',
      inputSchema: ExportAssetsInputSchema,
      outputSchema: ExportAssetsResultSchema,
      annotations: {
        title: 'Export Figma Assets',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = ExportAssetsInputSchema.parse(input);
        // 持久素材在调用插件前检查绑定，未绑定时不会执行昂贵导出。
        exports.workspace.beginWrite();
        const guardedNodeIds = [...new Set(parsed.items.map((item) => item.nodeId))];
        if (parsed.sourceGuard) {
          await assertSourceGuard(broker, parsed.sourceGuard, guardedNodeIds);
        }

        const staged: Array<{
          relativePath: string;
          data: Uint8Array | string;
          writePolicy: 'REUSE_OR_FAIL' | 'OVERWRITE';
          expectedExistingSha256?: string;
          mimeType: string;
          width: number;
          height: number;
          dimensionUnit: 'PIXEL' | 'FIGMA_UNIT';
        }> = [];
        let stagedBytes = 0;
        for (const item of parsed.items) {
          const result = ExportAssetRpcResultSchema.parse(
            await broker.request('exportAsset', toRpcInput(item), 60_000),
          );
          const validated = await validateExportPayload(result);
          stagedBytes += validated.bytes;
          if (stagedBytes > MAX_EXPORT_BATCH_BYTES) {
            throw new BridgeFault({
              code: 'PAYLOAD_TOO_LARGE',
              message: `Asset batch is ${stagedBytes} bytes; the maximum is ${MAX_EXPORT_BATCH_BYTES} bytes.`,
              retryable: true,
              details: { bytes: stagedBytes, maximumBytes: MAX_EXPORT_BATCH_BYTES },
            });
          }
          staged.push({
            relativePath:
              item.mode === 'RAW'
                ? `${item.outputPathStem}.${validated.extension}`
                : item.outputPath,
            data: validated.data,
            writePolicy: item.writePolicy,
            ...(item.expectedExistingSha256
              ? { expectedExistingSha256: item.expectedExistingSha256 }
              : {}),
            mimeType: validated.mimeType,
            width: validated.width,
            height: validated.height,
            dimensionUnit: validated.dimensionUnit,
          });
        }

        if (parsed.sourceGuard) {
          await assertSourceGuard(broker, parsed.sourceGuard, guardedNodeIds);
        }
        const stored = await exports.writeBatch(staged);
        return structuredResult(
          ExportAssetsResultSchema.parse({
            assets: stored.map((file, index) => ({
              path: file.projectRelativePath,
              status: file.status,
              mimeType: staged[index]!.mimeType,
              width: staged[index]!.width,
              height: staged[index]!.height,
              dimensionUnit: staged[index]!.dimensionUnit,
            })),
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tools.figma_render_node = server.registerTool(
    'figma_render_node',
    {
      description:
        'Render one node from the current Figma page as a bounded PNG for visual inspection. Combine this with tree and geometry data.',
      inputSchema: RenderNodeInputSchema,
      outputSchema: RenderResultSchema,
      annotations: {
        title: 'Render Figma node',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = RenderNodeInputSchema.parse(input);
        const result = RenderRpcResultSchema.parse(
          await broker.request('renderNode', parsed, 30_000),
        );
        const data = Buffer.from(result.data, 'base64');
        if (data.byteLength > MAX_EXPORT_BYTES) {
          throw new BridgeFault({
            code: 'PAYLOAD_TOO_LARGE',
            message: `Rendered PNG exceeds ${MAX_EXPORT_BYTES} bytes.`,
            retryable: true,
            nodeId: result.nodeId,
          });
        }
        const detected = await fileTypeFromBuffer(data);
        if (detected?.ext !== 'png') {
          throw unsupported(result.nodeId, 'Rendered PNG magic bytes do not match.');
        }
        const dimensions = readRasterDimensions(data, result.nodeId);
        const stored = await previews.write(`${result.nodeId}.png`, data);
        return structuredResult(
          RenderResultSchema.parse({
            localPath: stored.localPath,
            width: dimensions.width,
            height: dimensions.height,
            expiresAt: stored.expiresAt,
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
  return tools;
}

function toRpcInput(input: ReturnType<typeof ExportAssetItemSchema.parse>) {
  if (input.mode === 'RAW') {
    return ExportAssetRpcInputSchema.parse({
      nodeId: input.nodeId,
      mode: input.mode,
      paintSlot: input.paintSlot,
      paintIndex: input.paintIndex,
    });
  }
  return ExportAssetRpcInputSchema.parse({
    nodeId: input.nodeId,
    mode: input.mode,
    format: input.format,
    ...(input.format === 'SVG' ? {} : { scale: input.scale }),
  });
}

interface ValidatedExport {
  data: Uint8Array | string;
  extension: 'png' | 'jpg' | 'gif' | 'webp' | 'svg';
  format: 'PNG' | 'JPG' | 'GIF' | 'WEBP' | 'SVG';
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
  dimensionUnit: 'PIXEL' | 'FIGMA_UNIT';
}

async function validateExportPayload(
  result: ReturnType<typeof ExportAssetRpcResultSchema.parse>,
): Promise<ValidatedExport> {
  const data = result.encoding === 'base64' ? Buffer.from(result.data, 'base64') : result.data;
  const bytes = typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength;
  if (bytes > MAX_EXPORT_BYTES) {
    throw new BridgeFault({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Export payload exceeds ${MAX_EXPORT_BYTES} bytes.`,
      retryable: true,
      nodeId: result.nodeId,
    });
  }

  if (result.mode === 'RAW') {
    if (typeof data === 'string') throw unsupported(result.nodeId, 'RAW payload must be binary.');
    const detected = await fileTypeFromBuffer(data);
    const supported = {
      png: { format: 'PNG' as const, mimeType: 'image/png' },
      jpg: { format: 'JPG' as const, mimeType: 'image/jpeg' },
      gif: { format: 'GIF' as const, mimeType: 'image/gif' },
      webp: { format: 'WEBP' as const, mimeType: 'image/webp' },
    };
    const match = detected ? supported[detected.ext as keyof typeof supported] : undefined;
    if (!match) throw unsupported(result.nodeId, 'RAW image is not PNG, JPEG, GIF, or WebP.');
    const dimensions = readRasterDimensions(data, result.nodeId);
    return {
      data,
      bytes,
      extension: detected!.ext as 'png' | 'jpg' | 'gif' | 'webp',
      ...dimensions,
      dimensionUnit: 'PIXEL',
      ...match,
    };
  }

  if (result.format === 'SVG') {
    if (typeof data !== 'string') {
      throw unsupported(result.nodeId, 'Rendered SVG is malformed.');
    }
    const dimensions = readSvgDimensions(data, result.nodeId);
    return {
      data,
      bytes,
      extension: 'svg',
      format: 'SVG',
      mimeType: 'image/svg+xml',
      ...dimensions,
      dimensionUnit: 'FIGMA_UNIT',
    };
  }

  if (typeof data === 'string') throw unsupported(result.nodeId, 'Rendered raster must be binary.');
  if (result.format !== 'PNG' && result.format !== 'JPG') {
    throw unsupported(result.nodeId, 'Rendered raster format is invalid.');
  }
  const detected = await fileTypeFromBuffer(data);
  const expectedExtension = result.format === 'PNG' ? 'png' : 'jpg';
  if (detected?.ext !== expectedExtension) {
    throw unsupported(result.nodeId, `Rendered ${result.format} magic bytes do not match.`);
  }
  const dimensions = readRasterDimensions(data, result.nodeId);
  return {
    data,
    extension: expectedExtension,
    format: result.format,
    mimeType: result.format === 'PNG' ? 'image/png' : 'image/jpeg',
    bytes,
    ...dimensions,
    dimensionUnit: 'PIXEL',
  };
}

async function assertSourceGuard(
  broker: BridgeTransport,
  guard: { rootNodeId: string; expectedSourceFingerprint: string },
  nodeIds: string[],
): Promise<void> {
  const result = CheckAssetSourceGuardRpcResultSchema.parse(
    await broker.request(
      'checkAssetSourceGuard',
      CheckAssetSourceGuardRpcInputSchema.parse({ rootNodeId: guard.rootNodeId, nodeIds }),
      60_000,
    ),
  );
  if (result.sourceFingerprint !== guard.expectedSourceFingerprint) {
    throw new BridgeFault({
      code: 'ASSET_SOURCE_CHANGED',
      message: 'The guarded Figma source no longer matches the semantic snapshot.',
      retryable: true,
      nodeId: guard.rootNodeId,
    });
  }
}

function readSvgDimensions(source: string, nodeId: string): { width: number; height: number } {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (root?.tagName.toLowerCase() !== 'svg') {
    throw unsupported(nodeId, 'Rendered SVG is malformed.');
  }

  const viewBox = parseViewBox(root.getAttribute('viewBox'));
  const width = parseSvgLength(root.getAttribute('width')) ?? viewBox?.width;
  const height = parseSvgLength(root.getAttribute('height')) ?? viewBox?.height;
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
    throw unsupported(nodeId, 'Rendered SVG has no valid intrinsic width and height.');
  }
  return { width, height };
}

/** SVG 根尺寸只接受无单位数值或 px；其他单位回退到 viewBox。 */
function parseSvgLength(value: string | null): number | undefined {
  if (value === null || !/^\s*(?:\d+(?:\.\d+)?|\.\d+)(?:px)?\s*$/i.test(value)) return undefined;
  const parsed = Number.parseFloat(value);
  return isPositiveFinite(parsed) ? parsed : undefined;
}

function parseViewBox(
  value: string | null,
): { width: number; height: number } | undefined {
  if (value === null) return undefined;
  const values = value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (values.length !== 4 || !isPositiveFinite(values[2]) || !isPositiveFinite(values[3])) {
    return undefined;
  }
  return { width: values[2], height: values[3] };
}

/** 位图尺寸始终从最终字节读取，拒绝插件提供的逻辑尺寸估计。 */
function readRasterDimensions(data: Uint8Array, nodeId: string): { width: number; height: number } {
  try {
    const { width, height } = imageSize(data);
    if (isPositiveFinite(width) && isPositiveFinite(height)) return { width, height };
  } catch {
    // 统一转换为 MCP 可识别的结构化格式错误。
  }
  throw unsupported(nodeId, 'Image bytes have no valid intrinsic width and height.');
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function unsupported(nodeId: string, message: string): BridgeFault {
  return new BridgeFault({
    code: 'UNSUPPORTED_ASSET_FORMAT',
    message,
    retryable: false,
    nodeId,
  });
}
