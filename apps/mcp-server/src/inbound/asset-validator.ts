import { createHash } from 'node:crypto';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import {
  BridgeFault,
  type StageAssetRpcInput,
  type SupportedAssetMime,
} from '@figma-agent/protocol';
import { fileTypeFromBuffer } from 'file-type';
import { imageSize } from 'image-size';

const MAX_RASTER_BYTES = 8 * 1024 * 1024;
const MAX_SVG_BYTES = 2 * 1024 * 1024;
const MAX_RASTER_DIMENSION = 4_096;
const MAX_SVG_DIMENSION = 16_384;
const MAX_SVG_ELEMENTS = 10_000;

export type ValidatedInboundAsset = Omit<StageAssetRpcInput, 'assetId'>;

/** 严格校验 Agent 提供的 Base64，不从 URL 或本地路径补取任何内容。 */
export async function validateInboundAsset(input: {
  name: string;
  mimeType: SupportedAssetMime;
  dataBase64: string;
}): Promise<ValidatedInboundAsset> {
  const bytes = decodeBase64(input.dataBase64);
  if (input.mimeType === 'image/svg+xml') return validateSvg(input.name, bytes);
  return await validateRaster(input.name, input.mimeType, bytes);
}

async function validateRaster(
  name: string,
  mimeType: Exclude<SupportedAssetMime, 'image/svg+xml'>,
  bytes: Buffer,
): Promise<ValidatedInboundAsset> {
  if (bytes.byteLength > MAX_RASTER_BYTES) {
    throw invalid(`Raster asset exceeds ${MAX_RASTER_BYTES} bytes.`);
  }
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || detected.mime !== mimeType || !['png', 'jpg', 'gif'].includes(detected.ext)) {
    throw invalid(`Asset content does not match declared MIME type ${mimeType}.`);
  }
  let dimensions: ReturnType<typeof imageSize>;
  try {
    dimensions = imageSize(bytes);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : 'Image dimensions could not be read.');
  }
  const { width, height } = dimensions;
  if (!width || !height || width > MAX_RASTER_DIMENSION || height > MAX_RASTER_DIMENSION) {
    throw invalid(`Raster dimensions must be between 1 and ${MAX_RASTER_DIMENSION} pixels.`);
  }
  return {
    name,
    kind: 'RASTER',
    mimeType,
    sha256: digest(bytes),
    bytes: bytes.byteLength,
    width,
    height,
    dataBase64: bytes.toString('base64'),
  };
}

function validateSvg(name: string, bytes: Buffer): ValidatedInboundAsset {
  if (bytes.byteLength > MAX_SVG_BYTES) throw invalid(`SVG exceeds ${MAX_SVG_BYTES} bytes.`);
  const source = decodeUtf8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw invalid('SVG declarations and entities are forbidden.');

  const parseErrors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: (message) => parseErrors.push(message),
      error: (message) => parseErrors.push(message),
      fatalError: (message) => parseErrors.push(message),
    },
  }).parseFromString(source, 'image/svg+xml');
  if (parseErrors.length > 0 || document.documentElement.tagName.toLowerCase() !== 'svg') {
    throw invalid('SVG XML is malformed or has no svg root element.');
  }

  let elementCount = 0;
  const visit = (element: Element): void => {
    elementCount += 1;
    if (elementCount > MAX_SVG_ELEMENTS) throw invalid('SVG contains too many elements.');
    const tag = element.tagName.toLowerCase();
    if (tag === 'script' || tag === 'foreignobject')
      throw invalid(`SVG element ${tag} is forbidden.`);
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (!attribute) continue;
      const key = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (key.startsWith('on')) throw invalid(`SVG event attribute ${key} is forbidden.`);
      if ((key === 'href' || key === 'xlink:href') && value && !value.startsWith('#')) {
        throw invalid('SVG external references are forbidden.');
      }
      if (/url\s*\(\s*["']?(?!#)/i.test(value)) {
        throw invalid('SVG external URL paints are forbidden.');
      }
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as Element);
    }
  };
  visit(document.documentElement);

  const { width, height } = svgDimensions(document.documentElement);
  const normalized = new XMLSerializer().serializeToString(document);
  const normalizedBytes = Buffer.from(normalized, 'utf8');
  return {
    name,
    kind: 'SVG',
    mimeType: 'image/svg+xml',
    sha256: digest(normalizedBytes),
    bytes: normalizedBytes.byteLength,
    width,
    height,
    svgText: normalized,
  };
}

function decodeBase64(value: string): Buffer {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw invalid('Asset data is not strict Base64.');
  }
  const bytes = Buffer.from(value, 'base64');
  const canonical = bytes.toString('base64');
  if (canonical !== value) throw invalid('Asset Base64 is not canonical.');
  return bytes;
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalid('SVG is not valid UTF-8.');
  }
}

function svgDimensions(root: Element): { width: number; height: number } {
  const width = parseSvgNumber(root.getAttribute('width'));
  const height = parseSvgNumber(root.getAttribute('height'));
  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const resolvedWidth = width ?? (viewBox?.length === 4 ? viewBox[2] : undefined);
  const resolvedHeight = height ?? (viewBox?.length === 4 ? viewBox[3] : undefined);
  if (
    !resolvedWidth ||
    !resolvedHeight ||
    !Number.isFinite(resolvedWidth) ||
    !Number.isFinite(resolvedHeight) ||
    resolvedWidth <= 0 ||
    resolvedHeight <= 0 ||
    resolvedWidth > MAX_SVG_DIMENSION ||
    resolvedHeight > MAX_SVG_DIMENSION
  ) {
    throw invalid(`SVG dimensions must be between 1 and ${MAX_SVG_DIMENSION}.`);
  }
  return { width: resolvedWidth, height: resolvedHeight };
}

function parseSvgNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = /^([0-9]+(?:\.[0-9]+)?)(?:px)?$/.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function invalid(message: string): BridgeFault {
  return new BridgeFault({ code: 'INVALID_ASSET', message, retryable: false });
}
