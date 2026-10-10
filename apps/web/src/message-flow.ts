import type {
  AgentSessionEventData,
  AgentSessionEvent as ProtocolAgentSessionEvent,
} from "@silvermoon-ai/protocol"

export interface AgentSessionEvent {
  id: string
  sessionId: string
  sequence: number
  type: ProtocolAgentSessionEvent["type"]
  role: ProtocolAgentSessionEvent["role"] | null
  text: string | null
  data: AgentSessionEventData | null
  createdAt: string
}

type StructuredPartKind = Exclude<
  NonNullable<AgentSessionEventData["partKind"]>,
  "request"
>

export interface TranscriptPart {
  id: string
  kind: StructuredPartKind
  index: number
  firstSequence: number
  event: AgentSessionEvent
}

export interface TranscriptTurn {
  kind: "turn"
  id: string
  sequence: number
  createdAt: string
  request: AgentSessionEvent | null
  parts: TranscriptPart[]
}

export interface TranscriptEvent {
  kind: "event"
  sequence: number
  event: AgentSessionEvent
}

export type TranscriptItem = TranscriptTurn | TranscriptEvent

export interface TranscriptPartSegment {
  kind: "part"
  part: TranscriptPart
}

export interface TranscriptToolSegment {
  kind: "tools"
  parts: TranscriptPart[]
}

export type TranscriptSegment =
  | TranscriptPartSegment
  | TranscriptToolSegment

interface PartMetadata {
  turnId: string
  partId: string
  partIndex: number
  partKind: NonNullable<AgentSessionEventData["partKind"]>
}

interface TurnBuilder {
  id: string
  sequence: number
  createdAt: string
  request: AgentSessionEvent | null
  parts: Map<string, TranscriptPart>
}

function partMetadata(event: AgentSessionEvent): PartMetadata | null {
  const data = event.data
  if (
    !data
    || typeof data.turnId !== "string"
    || !data.turnId
    || typeof data.partId !== "string"
    || !data.partId
    || !Number.isSafeInteger(data.partIndex)
    || (data.partIndex as number) < 0
    || typeof data.partKind !== "string"
    || ![
      "request",
      "markdown",
      "tool",
      "system",
      "activity",
      "error",
    ].includes(data.partKind)
  ) {
    return null
  }
  return {
    turnId: data.turnId,
    partId: data.partId,
    partIndex: data.partIndex as number,
    partKind: data.partKind,
  }
}

export function buildTranscript(
  events: readonly AgentSessionEvent[],
): TranscriptItem[] {
  const ordered = [...events].sort(
    (left, right) =>
      left.sequence - right.sequence || left.id.localeCompare(right.id),
  )
  const turns = new Map<string, TurnBuilder>()
  const items: Array<TurnBuilder | TranscriptEvent> = []

  for (const event of ordered) {
    const metadata = partMetadata(event)
    if (!metadata) {
      items.push({ kind: "event", sequence: event.sequence, event })
      continue
    }

    let turn = turns.get(metadata.turnId)
    if (!turn) {
      turn = {
        id: metadata.turnId,
        sequence: event.sequence,
        createdAt: event.createdAt,
        request: null,
        parts: new Map(),
      }
      turns.set(metadata.turnId, turn)
      items.push(turn)
    }

    if (metadata.partKind === "request") {
      if (!turn.request || event.sequence >= turn.request.sequence) {
        turn.request = event
        turn.createdAt = event.createdAt
      }
      continue
    }

    const key = `${metadata.partKind}:${metadata.partId}`
    const existing = turn.parts.get(key)
    if (!existing) {
      turn.parts.set(key, {
        id: metadata.partId,
        kind: metadata.partKind,
        index: metadata.partIndex,
        firstSequence: event.sequence,
        event,
      })
      continue
    }
    existing.index = Math.min(existing.index, metadata.partIndex)
    if (event.sequence >= existing.event.sequence) existing.event = event
  }

  return items.map((item) => {
    if ("kind" in item) return item
    return {
      kind: "turn",
      id: item.id,
      sequence: item.sequence,
      createdAt: item.createdAt,
      request: item.request,
      parts: [...item.parts.values()].sort(
        (left, right) =>
          left.index - right.index
          || left.firstSequence - right.firstSequence
          || left.id.localeCompare(right.id),
      ),
    }
  })
}

export function segmentTurnParts(
  parts: readonly TranscriptPart[],
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  for (const part of parts) {
    const previous = segments.at(-1)
    if (part.kind === "tool" && previous?.kind === "tools") {
      previous.parts.push(part)
    } else if (part.kind === "tool") {
      segments.push({ kind: "tools", parts: [part] })
    } else {
      segments.push({ kind: "part", part })
    }
  }
  return segments
}

export function transcriptToolCount(
  items: readonly TranscriptItem[],
): number {
  return items.reduce((count, item) => {
    if (item.kind === "event") {
      return count + (item.event.type === "tool" ? 1 : 0)
    }
    return count + item.parts.filter((part) => part.kind === "tool").length
  }, 0)
}

export function transcriptItemIsVisible(
  item: TranscriptItem,
  showTools: boolean,
): boolean {
  if (item.kind === "event") {
    return showTools || item.event.type !== "tool"
  }
  return Boolean(
    item.request
    || item.parts.some((part) => showTools || part.kind !== "tool"),
  )
}
