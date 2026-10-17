import type { RegisteredTool } from '@modelcontextprotocol/server';

/** 注册模块返回工具句柄表，便于模块级合约测试核对静态注册结果。 */
export type RegisteredToolMap = Record<string, RegisteredTool>;
