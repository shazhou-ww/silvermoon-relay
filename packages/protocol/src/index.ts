import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

export const daemonIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const requestIdSchema = z.uuid();

export const taskRequestSchema = z.object({
  type: z.literal("task.submit"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  prompt: z.string().trim().min(1).max(32_768),
});

export const daemonReadySchema = z.object({
  type: z.literal("ready"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  daemonId: daemonIdSchema,
});

export const requestAcceptedSchema = z.object({
  type: z.literal("request.accepted"),
  requestId: requestIdSchema,
  duplicate: z.boolean(),
});

export const requestRejectedSchema = z.object({
  type: z.literal("request.rejected"),
  requestId: requestIdSchema,
  reason: z.enum([
    "invalid-request",
    "unauthorized",
    "daemon-offline",
    "request-id-conflict",
    "unsupported",
  ]),
});

export const relayMessageSchema = z.discriminatedUnion("type", [
  taskRequestSchema,
  daemonReadySchema,
  requestAcceptedSchema,
  requestRejectedSchema,
]);

export type DaemonId = z.infer<typeof daemonIdSchema>;
export type TaskRequest = z.infer<typeof taskRequestSchema>;
export type RelayMessage = z.infer<typeof relayMessageSchema>;

export function parseRelayMessage(value: unknown): RelayMessage {
  return relayMessageSchema.parse(value);
}
