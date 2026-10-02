import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeUtf8 } from '../src/main/serialization/utf8.js';

afterEach(() => vi.unstubAllGlobals());

describe('Figma main UTF-8 encoder', () => {
  it.each(['ASCII', '中文', '😀', 'A中😀', '\ud800', '\udc00'])(
    'matches UTF-8 semantics for %j without TextEncoder',
    (value) => {
      vi.stubGlobal('TextEncoder', undefined);

      expect(encodeUtf8(value)).toEqual(Uint8Array.from(Buffer.from(value, 'utf8')));
    },
  );
});
