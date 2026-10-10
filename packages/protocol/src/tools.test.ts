import { describe, expect, it } from 'vitest';

import {
  DuplicateProposalInputSchema,
  ExportAssetInputSchema,
  ExportAssetRpcInputSchema,
  GetFingerprintInputSchema,
} from './tools.js';

describe('duplicate Proposal input', () => {
  it('accepts edit targets and rejects the removed nodeIds field', () => {
    expect(DuplicateProposalInputSchema.safeParse({ editTargetNodeIds: ['target'] }).success).toBe(
      true,
    );
    expect(DuplicateProposalInputSchema.safeParse({ nodeIds: ['target'] }).success).toBe(false);
  });
});

describe('aggregate fingerprint input', () => {
  it('accepts ordered unique node IDs', () => {
    expect(GetFingerprintInputSchema.parse({ nodeIds: ['root-b', 'root-a'] })).toEqual({
      nodeIds: ['root-b', 'root-a'],
    });
  });

  it('rejects empty and duplicate node IDs', () => {
    expect(GetFingerprintInputSchema.safeParse({ nodeIds: [] }).success).toBe(false);
    expect(GetFingerprintInputSchema.safeParse({ nodeIds: ['root', 'root'] }).success).toBe(false);
  });
});

describe('asset export input', () => {
  const fingerprint = '12345678';

  it('accepts RAW and strips local delivery fields from the plugin RPC contract', () => {
    const input = {
      nodeId: 'node:1',
      mode: 'RAW',
      paintSlot: 'FILLS',
      paintIndex: 0,
      expectedImageHash: 'image-hash',
      expectedNodeFingerprint: fingerprint,
      outputPathStem: 'src/assets/avatar',
    };
    expect(ExportAssetInputSchema.parse(input)).toMatchObject({ writePolicy: 'REUSE_OR_FAIL' });
    expect(
      ExportAssetRpcInputSchema.safeParse({
        nodeId: input.nodeId,
        mode: input.mode,
        paintSlot: input.paintSlot,
        paintIndex: input.paintIndex,
        expectedImageHash: input.expectedImageHash,
        expectedNodeFingerprint: input.expectedNodeFingerprint,
      }).success,
    ).toBe(true);
  });

  it('rejects absolute/traversal paths and RAW stems with extensions', () => {
    const base = {
      nodeId: 'node:1',
      mode: 'RAW',
      paintSlot: 'FILLS',
      paintIndex: 0,
      expectedImageHash: 'image-hash',
      expectedNodeFingerprint: fingerprint,
    };
    for (const outputPathStem of ['C:\\temp\\avatar', '../avatar', '/tmp/avatar', 'a.png']) {
      expect(ExportAssetInputSchema.safeParse({ ...base, outputPathStem }).success).toBe(false);
    }
  });

  it('rejects SVG scale and rendered extension mismatches', () => {
    expect(
      ExportAssetInputSchema.safeParse({
        nodeId: 'node:1',
        mode: 'RENDERED',
        format: 'SVG',
        scale: 2,
        expectedTreeFingerprint: fingerprint,
        outputPath: 'src/assets/logo.svg',
      }).success,
    ).toBe(false);
    expect(
      ExportAssetInputSchema.safeParse({
        nodeId: 'node:1',
        mode: 'RENDERED',
        format: 'PNG',
        expectedTreeFingerprint: fingerprint,
        outputPath: 'src/assets/logo.svg',
      }).success,
    ).toBe(false);
  });

  it('requires a checked existing hash for explicit overwrite', () => {
    expect(
      ExportAssetInputSchema.safeParse({
        nodeId: 'node:1',
        mode: 'RENDERED',
        format: 'PNG',
        expectedTreeFingerprint: fingerprint,
        outputPath: 'src/assets/image.png',
        writePolicy: 'OVERWRITE',
      }).success,
    ).toBe(false);
  });
});
