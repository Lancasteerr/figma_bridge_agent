import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

import { DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT } from '@figma-agent/protocol';

import { defaultConfigPath } from './paths.js';

const PairedClientSchema = z.object({
  token: z.string().min(32),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  pluginVersion: z.string().min(1),
});

const ServerConfigSchema = z.object({
  version: z.literal(2),
  serverId: z.string().uuid(),
  daemonSecret: z.string().min(32),
  host: z.literal(DEFAULT_BRIDGE_HOST),
  port: z.number().int().positive().max(65_535),
  pairedClients: z.record(z.string().uuid(), PairedClientSchema),
});

const LegacyServerConfigSchema = z.object({
  version: z.literal(1),
  secret: z.string().min(32),
  host: z.literal(DEFAULT_BRIDGE_HOST),
  port: z.number().int().positive().max(65_535),
});

export type PairedClient = z.infer<typeof PairedClientSchema>;
/** v2 将 Daemon 内部认证和每个 Figma 插件凭据分离。 */
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

const writeQueues = new Map<string, Promise<void>>();

function freshConfig(port = DEFAULT_BRIDGE_PORT): ServerConfig {
  return {
    version: 2,
    serverId: randomUUID(),
    daemonSecret: randomBytes(32).toString('base64url'),
    host: DEFAULT_BRIDGE_HOST,
    port,
    pairedClients: {},
  };
}

/** 创建随机服务身份；不会把任何密钥打印到终端。 */
export async function createConfig(path = defaultConfigPath()): Promise<ServerConfig> {
  const config = freshConfig();
  await saveConfig(config, path);
  return config;
}

/**
 * 读取并校验配置。v1 迁移会旋转 Daemon 密钥并清空插件凭据，避免旧共享密钥跨角色复用。
 */
export async function loadConfig(path = defaultConfigPath()): Promise<ServerConfig> {
  const raw = await readFile(path, 'utf8');
  const value: unknown = JSON.parse(raw);
  const current = ServerConfigSchema.safeParse(value);
  if (current.success) return current.data;

  const legacy = LegacyServerConfigSchema.safeParse(value);
  if (!legacy.success) return ServerConfigSchema.parse(value);
  const migrated = freshConfig(legacy.data.port);
  await saveConfig(migrated, path);
  return migrated;
}

/** 首次运行自动创建配置，使普通用户不再需要单独执行 setup。 */
export async function ensureConfig(path = defaultConfigPath()): Promise<ServerConfig> {
  try {
    return await loadConfig(path);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    return await createConfig(path);
  }
}

/** 原子替换配置文件，并按路径串行化并发设备更新。 */
export async function saveConfig(config: ServerConfig, path = defaultConfigPath()): Promise<void> {
  const validated = ServerConfigSchema.parse(config);
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const write = previous.then(async () => {
    await writeAtomic(validated, path);
  });
  writeQueues.set(path, write);
  try {
    await write;
  } finally {
    if (writeQueues.get(path) === write) writeQueues.delete(path);
  }
}

/** 在最新磁盘状态上执行一次串行更新，防止设备增删互相覆盖。 */
export async function updateConfig(
  updater: (config: ServerConfig) => ServerConfig,
  path = defaultConfigPath(),
): Promise<ServerConfig> {
  const previous = writeQueues.get(path) ?? Promise.resolve();
  let updated: ServerConfig | undefined;
  const write = previous.then(async () => {
    const raw = await readFile(path, 'utf8');
    const current = ServerConfigSchema.parse(JSON.parse(raw));
    updated = ServerConfigSchema.parse(updater(current));
    await writeAtomic(updated, path);
  });
  writeQueues.set(path, write);
  try {
    await write;
    if (!updated) throw new Error('Config update did not produce a value.');
    return updated;
  } finally {
    if (writeQueues.get(path) === write) writeQueues.delete(path);
  }
}

async function writeAtomic(config: ServerConfig, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => undefined);
}
