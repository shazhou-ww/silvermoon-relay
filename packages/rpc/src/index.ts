import {
  agentSessionEventSchema,
  agentSessionSchema,
  connectorCapabilitiesSchema,
  connectorIdSchema,
  requestIdSchema,
  type AgentSession,
  type AgentSessionEvent,
  type ConnectorCommand,
  type ConnectorId,
  PROTOCOL_VERSION,
  timestampSchema,
} from "@silvermoon-relay/protocol";
import { initTRPC } from "@trpc/server";
import { z } from "zod";

export const connectorRegistrationSchema = z.object({
  connectorId: connectorIdSchema,
  displayName: z.string().trim().min(1).max(128),
  agent: z.object({
    name: z.string().trim().min(1).max(128),
    version: z.string().trim().min(1).max(64).optional(),
  }),
  capabilities: connectorCapabilitiesSchema,
});

export const sessionSyncSchema = z.object({
  commandId: requestIdSchema.optional(),
  sessions: z.array(agentSessionSchema).max(10_000),
});

export const commandCompletedInputSchema = z.object({
  commandId: requestIdSchema,
  outcome: z.enum(["succeeded", "failed"]),
  session: agentSessionSchema.optional(),
  error: z.object({
    code: z.string().trim().min(1).max(128),
    message: z.string().trim().min(1).max(2_048),
  }).optional(),
}).superRefine((value, context) => {
  if (value.outcome === "failed" && !value.error) {
    context.addIssue({
      code: "custom",
      message: "Failed commands require an error.",
      path: ["error"],
    });
  }
});

export interface ConnectorRpcContext {
  readonly connectorId: ConnectorId;
  register(
    input: z.infer<typeof connectorRegistrationSchema>,
  ): Promise<{
    protocolVersion: typeof PROTOCOL_VERSION;
    connectionId: string;
    connectorId: ConnectorId;
  }>;
  heartbeat(observedAt: string): Promise<void>;
  syncSessions(
    sessions: AgentSession[],
    commandId?: string,
  ): Promise<void>;
  commandAccepted(commandId: string): Promise<void>;
  commandCompleted(
    input: z.infer<typeof commandCompletedInputSchema>,
  ): Promise<void>;
  sessionUpdated(session: AgentSession): Promise<void>;
  sessionEvent(event: AgentSessionEvent): Promise<void>;
  commands(signal: AbortSignal): AsyncIterable<ConnectorCommand>;
}

const t = initTRPC.context<ConnectorRpcContext>().create();
const procedure = t.procedure;

export const connectorRouter = t.router({
  register: procedure
    .input(connectorRegistrationSchema)
    .mutation(({ ctx, input }) => ctx.register(input)),
  heartbeat: procedure
    .input(z.object({ observedAt: timestampSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.heartbeat(input.observedAt);
      return { ok: true as const };
    }),
  syncSessions: procedure
    .input(sessionSyncSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.syncSessions(input.sessions, input.commandId);
      return { ok: true as const };
    }),
  commandAccepted: procedure
    .input(z.object({ commandId: requestIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.commandAccepted(input.commandId);
      return { ok: true as const };
    }),
  commandCompleted: procedure
    .input(commandCompletedInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.commandCompleted(input);
      return { ok: true as const };
    }),
  sessionUpdated: procedure
    .input(agentSessionSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.sessionUpdated(input);
      return { ok: true as const };
    }),
  sessionEvent: procedure
    .input(agentSessionEventSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.sessionEvent(input);
      return { ok: true as const };
    }),
  commands: procedure.subscription(({ ctx, signal }) =>
    ctx.commands(signal ?? new AbortController().signal)
  ),
});

export type ConnectorRouter = typeof connectorRouter;
