import { z } from 'zod';

/** UI 只展示选区摘要，避免把完整节点树复制到面板状态。 */
export const SelectionSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
});

/** Main 线程发往 UI 的封闭消息集合。 */
export const MainToUiMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('plugin-state'),
    payload: z.object({
      page: z.object({ id: z.string(), name: z.string() }),
      selection: z.array(SelectionSummarySchema),
      bridge: z.enum(['disconnected', 'connecting', 'authenticated']),
    }),
  }),
  z.object({ type: z.literal('rpc-response'), payload: z.unknown() }),
  z.object({ type: z.literal('client-secret'), payload: z.object({ secret: z.string() }) }),
]);

/** UI 发往 Main 的封闭消息集合；所有 RPC payload 仍由协议层再次校验。 */
export const UiToMainMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('bridge-state'),
    state: z.enum(['disconnected', 'connecting', 'authenticated']),
  }),
  z.object({ type: z.literal('rpc-request'), payload: z.unknown() }),
  z.object({ type: z.literal('save-secret'), secret: z.string().min(16) }),
  z.object({ type: z.literal('smoke-duplicate') }),
  z.object({ type: z.literal('generate-fixtures') }),
]);

/** Main -> UI 消息的推导类型。 */
export type MainToUiMessage = z.infer<typeof MainToUiMessageSchema>;
