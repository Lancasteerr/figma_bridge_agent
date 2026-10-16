import type { RegisteredTool } from '@modelcontextprotocol/server';

/** 注册模块返回的工具句柄表，用于连接级可见性切换。 */
export type RegisteredToolMap = Record<string, RegisteredTool>;
