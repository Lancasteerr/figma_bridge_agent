const encoder = new TextEncoder();

function decodeBase64Url(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    asArrayBuffer(decodeBase64Url(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return encodeBase64Url(new Uint8Array(signature));
}

export function randomNonce(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

export async function createPluginProof(
  secret: string,
  serverNonce: string,
  pluginNonce: string,
): Promise<string> {
  return await hmac(secret, `figma-agent/plugin/v1|${serverNonce}|${pluginNonce}`);
}

export async function createServerProof(
  secret: string,
  serverNonce: string,
  pluginNonce: string,
): Promise<string> {
  return await hmac(secret, `figma-agent/server/v1|${serverNonce}|${pluginNonce}`);
}

export function equalProof(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
