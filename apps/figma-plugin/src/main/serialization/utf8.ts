/**
 * 在不依赖 TextEncoder 的 Figma main 沙箱中编码 UTF-8。
 * 孤立代理项按 WHATWG TextEncoder 语义替换为 U+FFFD。
 */
export function encodeUtf8(value: string): Uint8Array {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const { codePoint, width } = readCodePoint(value, index);
    byteLength += utf8Width(codePoint);
    index += width - 1;
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (let index = 0; index < value.length; index += 1) {
    const { codePoint, width } = readCodePoint(value, index);
    index += width - 1;
    if (codePoint <= 0x7f) {
      bytes[offset++] = codePoint;
    } else if (codePoint <= 0x7ff) {
      bytes[offset++] = 0xc0 | (codePoint >>> 6);
      bytes[offset++] = 0x80 | (codePoint & 0x3f);
    } else if (codePoint <= 0xffff) {
      bytes[offset++] = 0xe0 | (codePoint >>> 12);
      bytes[offset++] = 0x80 | ((codePoint >>> 6) & 0x3f);
      bytes[offset++] = 0x80 | (codePoint & 0x3f);
    } else {
      bytes[offset++] = 0xf0 | (codePoint >>> 18);
      bytes[offset++] = 0x80 | ((codePoint >>> 12) & 0x3f);
      bytes[offset++] = 0x80 | ((codePoint >>> 6) & 0x3f);
      bytes[offset++] = 0x80 | (codePoint & 0x3f);
    }
  }
  return bytes;
}

function readCodePoint(value: string, index: number): { codePoint: number; width: 1 | 2 } {
  const first = value.charCodeAt(index);
  if (first >= 0xd800 && first <= 0xdbff) {
    const second = value.charCodeAt(index + 1);
    if (second >= 0xdc00 && second <= 0xdfff) {
      return {
        codePoint: 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00),
        width: 2,
      };
    }
    return { codePoint: 0xfffd, width: 1 };
  }
  if (first >= 0xdc00 && first <= 0xdfff) return { codePoint: 0xfffd, width: 1 };
  return { codePoint: first, width: 1 };
}

function utf8Width(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}
