import { describe, expect, it } from 'vitest';

import { DuplicateProposalInputSchema, GetFingerprintInputSchema } from './tools.js';

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
