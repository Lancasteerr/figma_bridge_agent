import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
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
  return await withConfigLock(path, async () => {
    // 另一个并发进程可能已经完成迁移，因此拿锁后必须重新读取。
    const latest: unknown = JSON.parse(await readFile(path, 'utf8'));
    const latestCurrent = ServerConfigSchema.safeParse(latest);
    if (latestCurrent.success) return latestCurrent.data;
    const latestLegacy = LegacyServerConfigSchema.parse(latest);
    const migrated = freshConfig(latestLegacy.port);
    await saveConfig(migrated, path);
    return migrated;
  });
}

/** 首次运行自动创建配置，使普通用户不再需要单独执行 setup。 */
export async function ensureConfig(path = defaultConfigPath()): Promise<ServerConfig> {
  try {
    return await loadConfig(path);
  } catch (error) {
    if (!isMissingFile(error) && !isInvalidConfig(error)) throw error;
    return await withConfigLock(path, async () => {
      try {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'));
        const current = ServerConfigSchema.safeParse(value);
        if (current.success) return current.data;
        const legacy = LegacyServerConfigSchema.parse(value);
        const migrated = freshConfig(legacy.port);
        await saveConfig(migrated, path);
        return migrated;
      } catch (lockedError) {
        if (!isMissingFile(lockedError) && !isInvalidConfig(lockedError)) throw lockedError;
        // 保留损坏文件用于排障，同时生成全新的服务身份并要求插件重新配对。
        if (isInvalidConfig(lockedError)) {
          const backup = `${path}.corrupt-${Date.now()}-${randomBytes(4).toString('hex')}`;
          await rename(path, backup);
        }
        const config = freshConfig();
        await saveConfig(config, path);
        return config;
      }
    });
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isInvalidConfig(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof z.ZodError;
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

/** 使用旁路锁协调多个首次启动的 npx 进程，避免各自生成不同的服务身份。 */
async function withConfigLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }
  if (!handle) throw new Error('Timed out waiting for the local bridge configuration lock.');
  try {
    return await action();
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => undefined);
  }
}
