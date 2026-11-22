import { describe, expect, it } from 'vitest';
import { DeleteNodesInputSchema, EditInPlaceInputSchema } from './in-place.js';

const guard = { editMode: 'IN_PLACE', scopeRootId: 'frame', expectedFingerprint: '12345678' };
describe('original-artwork write contracts', () => {
  it('requires an explicit mode, scope, and complete-tree fingerprint', () => {
    const operations = [{ type: 'RESIZE', nodeId: 'frame', width: 100, height: 100 }];
    expect(EditInPlaceInputSchema.safeParse({ ...guard, operations }).success).toBe(true);
    for (const field of Object.keys(guard)) {
      const input: Record<string, unknown> = { ...guard, operations };
      delete input[field];
      expect(EditInPlaceInputSchema.safeParse(input).success).toBe(false);
    }
    expect(
      EditInPlaceInputSchema.safeParse({ ...guard, editMode: 'PROPOSAL', operations }).success,
    ).toBe(false);
  });
  it('rejects unknown operations, extra properties, empty and oversized batches', () => {
    for (const operations of [
      [],
      [{ type: 'JAVASCRIPT', code: 'x' }],
      [{ type: 'RESIZE', nodeId: 'frame', width: 1, height: 1, script: 'x' }],
      Array.from({ length: 101 }, () => ({ type: 'TEXT', nodeId: 'text', characters: 'x' })),
    ]) {
      expect(EditInPlaceInputSchema.safeParse({ ...guard, operations }).success).toBe(false);
    }
  });
  it('bounds carousel size and deletion targets', () => {
    expect(
      EditInPlaceInputSchema.safeParse({
        ...guard,
        operations: [
          { type: 'CAROUSEL', parentId: 'frame', assetIds: [], width: 100, height: 100 },
        ],
      }).success,
    ).toBe(false);
    expect(DeleteNodesInputSchema.safeParse({ ...guard, nodeIds: ['a', 'a'] }).success).toBe(false);
    expect(DeleteNodesInputSchema.safeParse({ ...guard, nodeIds: [] }).success).toBe(false);
    expect(DeleteNodesInputSchema.safeParse({ ...guard, nodeIds: ['a'] }).success).toBe(true);
  });
});
