import { randomUUID } from 'node:crypto';

import { DOMParser } from '@xmldom/xmldom';
import {
  BridgeFault,
  BindExportRootInputSchema,
  BindExportRootResultSchema,
  ExportAssetInputSchema,
  ExportAssetResultSchema,
  ExportAssetRpcInputSchema,
  ExportAssetRpcResultSchema,
  RenderNodeInputSchema,
  RenderRpcResultSchema,
  RenderResultSchema,
  StageAssetInputSchema,
  StageAssetRpcInputSchema,
  StagedAssetResultSchema,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';
import { fileTypeFromBuffer } from 'file-type';

import type { BridgeTransport } from '../bridge/transport.js';
import type { ExportStore } from '../export/export-store.js';
import { validateInboundAsset } from '../inbound/asset-validator.js';
import type { TemporaryArtifactStore } from '../temp/artifact-store.js';
import { structuredResult, toolError } from './result.js';

const MAX_EXPORT_BYTES = 9 * 1024 * 1024;

/** 注册素材暂存、工程导出和视觉预览工具。 */
export function registerMediaTools(
  server: McpServer,
  broker: BridgeTransport,
  previews: TemporaryArtifactStore,
  exports: ExportStore,
): void {
  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'figma_export_asset',
    {
      description:
        'Export an exact Figma image paint or a strongly versioned node render to a relative path under the session-bound workspace, or to the staged session when no workspace is bound.',
      inputSchema: ExportAssetInputSchema,
      outputSchema: ExportAssetResultSchema,
      annotations: {
        title: 'Export Figma Asset',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = ExportAssetInputSchema.parse(input);
        validateRequestedExtension(parsed);
        const rpcInput = toRpcInput(parsed);
        const result = ExportAssetRpcResultSchema.parse(
          await broker.request('exportAsset', rpcInput, 60_000),
        );
        const validated = await validateExportPayload(result);
        const relativePath =
          parsed.mode === 'RAW'
            ? `${parsed.outputPathStem}.${validated.extension}`
            : parsed.outputPath;
        const stored = await exports.write({
          relativePath,
          data: validated.data,
          writePolicy: parsed.writePolicy,
          ...(parsed.expectedExistingSha256
            ? { expectedExistingSha256: parsed.expectedExistingSha256 }
            : {}),
        });
        return structuredResult(
          ExportAssetResultSchema.parse({
            nodeId: result.nodeId,
            mode: result.mode,
            format: validated.format,
            mimeType: validated.mimeType,
            status: stored.status,
            delivery: exports.status.delivery,
            projectRelativePath: stored.projectRelativePath,
            absolutePath: stored.absolutePath,
            requiresCopy: exports.status.delivery === 'STAGED',
            sha256: stored.sha256,
            bytes: stored.bytes,
            width: result.width,
            height: result.height,
            source: result.source,
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
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
        const stored = await previews.write(`${result.nodeId}.png`, data);
        return structuredResult(
          RenderResultSchema.parse({
            nodeId: result.nodeId,
            mimeType: result.mimeType,
            width: result.width,
            height: result.height,
            fingerprint: result.fingerprint,
            ...stored,
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

function toRpcInput(input: ReturnType<typeof ExportAssetInputSchema.parse>) {
  if (input.mode === 'RAW') {
    return ExportAssetRpcInputSchema.parse({
      nodeId: input.nodeId,
      mode: input.mode,
      paintSlot: input.paintSlot,
      paintIndex: input.paintIndex,
      expectedImageHash: input.expectedImageHash,
      expectedNodeFingerprint: input.expectedNodeFingerprint,
    });
  }
  return ExportAssetRpcInputSchema.parse({
    nodeId: input.nodeId,
    mode: input.mode,
    format: input.format,
    ...(input.format === 'SVG' ? {} : { scale: input.scale }),
    expectedTreeFingerprint: input.expectedTreeFingerprint,
  });
}

function validateRequestedExtension(input: ReturnType<typeof ExportAssetInputSchema.parse>): void {
  if (input.mode === 'RAW') return;
  const path = input.outputPath.toLowerCase();
  const valid =
    (input.format === 'PNG' && path.endsWith('.png')) ||
    (input.format === 'JPG' && (path.endsWith('.jpg') || path.endsWith('.jpeg'))) ||
    (input.format === 'SVG' && path.endsWith('.svg'));
  if (!valid) {
    throw new BridgeFault({
      code: 'EXPORT_PATH_INVALID',
      message: `Output extension does not match rendered format ${input.format}.`,
      retryable: false,
    });
  }
}

interface ValidatedExport {
  data: Uint8Array | string;
  extension: 'png' | 'jpg' | 'gif' | 'webp' | 'svg';
  format: 'PNG' | 'JPG' | 'GIF' | 'WEBP' | 'SVG';
  mimeType: string;
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
    return { data, extension: detected!.ext as 'png' | 'jpg' | 'gif' | 'webp', ...match };
  }

  if (result.format === 'SVG') {
    if (typeof data !== 'string' || !hasSvgRoot(data)) {
      throw unsupported(result.nodeId, 'Rendered SVG is malformed.');
    }
    return { data, extension: 'svg', format: 'SVG', mimeType: 'image/svg+xml' };
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
  return {
    data,
    extension: expectedExtension,
    format: result.format,
    mimeType: result.format === 'PNG' ? 'image/png' : 'image/jpeg',
  };
}

function hasSvgRoot(source: string): boolean {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  return document.documentElement?.tagName.toLowerCase() === 'svg';
}

function unsupported(nodeId: string, message: string): BridgeFault {
  return new BridgeFault({
    code: 'UNSUPPORTED_ASSET_FORMAT',
    message,
    retryable: false,
    nodeId,
  });
}
