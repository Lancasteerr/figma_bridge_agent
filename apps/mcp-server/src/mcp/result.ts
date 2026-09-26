import { toBridgeError } from '@figma-agent/protocol';

export function structuredResult<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

export function toolError(value: unknown) {
  const error = toBridgeError(value);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error }) }],
    isError: true,
  };
}
