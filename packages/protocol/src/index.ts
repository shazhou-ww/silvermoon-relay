import { z } from "zod";

export const PROTOCOL_VERSION = 2 as const;

const namedIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const connectorIdSchema = namedIdSchema;
export const sessionIdSchema = z.string().trim().min(1).max(256);
export const requestIdSchema = z.uuid();
export const eventIdSchema = z.string().trim().min(1).max(256);
export const timestampSchema = z.string().datetime({ offset: true });

export const sessionStatusSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "idle",
  "failed",
  "closed",
  "gone",
  "unknown",
]);

export const connectorCapabilitiesSchema = z.object({
  listSessions: z.boolean(),
  createSession: z.boolean(),
  sendMessage: z.boolean(),
  streamEvents: z.boolean(),
});

export const agentDescriptorSchema = z.object({
  name: z.string().trim().min(1).max(128),
  version: z.string().trim().min(1).max(64).optional(),
});

export const agentSessionSchema = z.object({
  id: sessionIdSchema,
  title: z.string().trim().min(1).max(256).nullable(),
  status: sessionStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastMessagePreview: z.string().max(512).nullable().default(null),
});

export const agentSessionEventSchema = z.object({
  id: eventIdSchema,
  sessionId: sessionIdSchema,
  sequence: z.number().int().nonnegative(),
  type: z.enum(["message", "activity", "tool", "status", "error"]),
  role: z.enum(["user", "assistant", "system"]).optional(),
  text: z.string().max(65_536).optional(),
  status: sessionStatusSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  createdAt: timestampSchema,
});

const commandBaseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: requestIdSchema,
});

export const listSessionsCommandSchema = commandBaseSchema.extend({
  type: z.literal("sessions.list"),
});

export const createSessionCommandSchema = commandBaseSchema.extend({
  type: z.literal("session.create"),
  prompt: z.string().trim().min(1).max(32_768),
  title: z.string().trim().min(1).max(256).optional(),
});

export const sendSessionMessageCommandSchema = commandBaseSchema.extend({
  type: z.literal("session.message"),
  sessionId: sessionIdSchema,
  message: z.string().trim().min(1).max(32_768),
});

export const connectorCommandSchema = z.discriminatedUnion("type", [
  listSessionsCommandSchema,
  createSessionCommandSchema,
  sendSessionMessageCommandSchema,
]);

export type ConnectorId = z.infer<typeof connectorIdSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type ConnectorCapabilities = z.infer<typeof connectorCapabilitiesSchema>;
export type AgentDescriptor = z.infer<typeof agentDescriptorSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type AgentSessionEvent = z.infer<typeof agentSessionEventSchema>;
export type ConnectorCommand = z.infer<typeof connectorCommandSchema>;

export const daemonIdSchema = connectorIdSchema;
export type DaemonId = ConnectorId;
