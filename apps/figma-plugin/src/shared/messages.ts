import { z } from 'zod';

export const SelectionSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
});

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

export const UiToMainMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('bridge-state'), state: z.enum(['disconnected', 'connecting', 'authenticated']) }),
  z.object({ type: z.literal('rpc-request'), payload: z.unknown() }),
  z.object({ type: z.literal('save-secret'), secret: z.string().min(16) }),
  z.object({ type: z.literal('smoke-duplicate') }),
]);

export type MainToUiMessage = z.infer<typeof MainToUiMessageSchema>;

