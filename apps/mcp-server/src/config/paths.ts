import { homedir } from 'node:os';
import { join } from 'node:path';

/** 根据操作系统约定选择用户级配置目录，不把密钥写入项目目录。 */
export function defaultConfigDirectory(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === 'win32') {
    return join(env.LOCALAPPDATA ?? env.APPDATA ?? homedir(), 'figma-agent-mcp');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'figma-agent-mcp');
  }
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'figma-agent-mcp');
}

/** 本地桥接配置文件的默认位置。 */
export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultConfigDirectory(env), 'config.json');
}

/** 后台 Daemon 的结构化诊断日志与配置放在同一用户级目录。 */
export function defaultDaemonLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultConfigDirectory(env), 'bridge.log');
}
