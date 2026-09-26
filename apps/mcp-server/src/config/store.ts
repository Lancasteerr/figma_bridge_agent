import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

import { DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT } from '@figma-agent/protocol';

import { defaultConfigPath } from './paths.js';

const ServerConfigSchema = z.object({
  version: z.literal(1),
  secret: z.string().min(32),
  host: z.literal(DEFAULT_BRIDGE_HOST),
  port: z.number().int().positive().max(65_535),
});
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export async function createConfig(path = defaultConfigPath()): Promise<ServerConfig> {
  const config: ServerConfig = {
    version: 1,
    secret: randomBytes(32).toString('base64url'),
    host: DEFAULT_BRIDGE_HOST,
    port: DEFAULT_BRIDGE_PORT,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
  return config;
}

export async function loadConfig(path = defaultConfigPath()): Promise<ServerConfig> {
  const raw = await readFile(path, 'utf8');
  return ServerConfigSchema.parse(JSON.parse(raw));
}

