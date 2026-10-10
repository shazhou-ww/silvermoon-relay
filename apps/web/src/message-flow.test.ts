import { describe, expect, it } from "vitest"
import {
  buildTranscript,
  segmentTurnParts,
  transcriptItemIsVisible,
  transcriptToolCount,
  type AgentSessionEvent,
} from "./message-flow"

function event(
  input: Partial<AgentSessionEvent> & Pick<AgentSessionEvent, "id" | "sequence">,
): AgentSessionEvent {
  return {
    sessionId: "session-1",
    type: "message",
    role: "assistant",
    text: null,
    data: null,
    createdAt: `2026-10-10T00:00:0${input.sequence}.000Z`,
    ...input,
  }
}

describe("message flow projection", () => {
  it("keeps response-part order and folds snapshots by stable identity", () => {
    const items = buildTranscript([
      event({
        id: "request",
        sequence: 1,
        role: "user",
        text: "Inspect and test.",
        data: {
          turnId: "turn-1",
          partId: "request",
          partIndex: 0,
          partKind: "request",
          update: "snapshot",
        },
      }),
      event({
        id: "markdown-initial",
        sequence: 2,
        text: "I will inspect.",
        data: {
          turnId: "turn-1",
          partId: "markdown-1",
          partIndex: 0,
          partKind: "markdown",
          update: "snapshot",
        },
      }),
      event({
        id: "tool-start",
        sequence: 3,
        type: "tool",
        role: null,
        text: "Started Read",
        data: {
          turnId: "turn-1",
          partId: "tool-1",
          partIndex: 1,
          partKind: "tool",
          update: "snapshot",
          toolName: "Read",
          toolCallId: "tool-1",
          state: "started",
        },
      }),
      event({
        id: "tool-complete",
        sequence: 4,
        type: "tool",
        role: null,
        text: "Read succeeded",
        data: {
          turnId: "turn-1",
          partId: "tool-1",
          partIndex: 1,
          partKind: "tool",
          update: "snapshot",
          toolName: "Read",
          toolCallId: "tool-1",
          state: "succeeded",
        },
      }),
      event({
        id: "markdown-final",
        sequence: 5,
        text: "I will inspect the connector.",
        data: {
          turnId: "turn-1",
          partId: "markdown-1",
          partIndex: 0,
          partKind: "markdown",
          update: "snapshot",
        },
      }),
      event({
        id: "answer",
        sequence: 6,
        text: "The tests pass.",
        data: {
          turnId: "turn-1",
          partId: "markdown-2",
          partIndex: 2,
          partKind: "markdown",
          update: "snapshot",
        },
      }),
    ])

    expect(items).toHaveLength(1)
    const turn = items[0]
    expect(turn.kind).toBe("turn")
    if (turn.kind !== "turn") throw new Error("Expected a turn")
    expect(turn.request?.text).toBe("Inspect and test.")
    expect(turn.parts.map((part) => ({
      id: part.id,
      text: part.event.text,
      state: part.event.data?.state,
    }))).toEqual([
      {
        id: "markdown-1",
        text: "I will inspect the connector.",
        state: undefined,
      },
      { id: "tool-1", text: "Read succeeded", state: "succeeded" },
      { id: "markdown-2", text: "The tests pass.", state: undefined },
    ])
  })

  it("groups only adjacent tools and preserves surrounding markdown", () => {
    const items = buildTranscript([
      event({
        id: "markdown-1",
        sequence: 1,
        text: "Start",
        data: {
          turnId: "turn-1",
          partId: "markdown-1",
          partIndex: 0,
          partKind: "markdown",
        },
      }),
      ...["tool-1", "tool-2"].map((id, index) =>
        event({
          id,
          sequence: index + 2,
          type: "tool",
          role: null,
          data: {
            turnId: "turn-1",
            partId: id,
            partIndex: index + 1,
            partKind: "tool",
            toolCallId: id,
            state: "succeeded",
          },
        })
      ),
      event({
        id: "markdown-2",
        sequence: 4,
        text: "Done",
        data: {
          turnId: "turn-1",
          partId: "markdown-2",
          partIndex: 3,
          partKind: "markdown",
        },
      }),
    ])
    const turn = items[0]
    if (turn.kind !== "turn") throw new Error("Expected a turn")

    expect(segmentTurnParts(turn.parts).map((segment) =>
      segment.kind === "tools"
        ? segment.parts.map((part) => part.id)
        : segment.part.id
    )).toEqual(["markdown-1", ["tool-1", "tool-2"], "markdown-2"])
  })

  it("counts merged structured tools and keeps legacy filtering compatible", () => {
    const items = buildTranscript([
      event({
        id: "tool-start",
        sequence: 1,
        type: "tool",
        role: null,
        data: {
          turnId: "turn-1",
          partId: "tool-1",
          partIndex: 0,
          partKind: "tool",
          toolCallId: "tool-1",
          state: "started",
        },
      }),
      event({
        id: "tool-complete",
        sequence: 2,
        type: "tool",
        role: null,
        data: {
          turnId: "turn-1",
          partId: "tool-1",
          partIndex: 0,
          partKind: "tool",
          toolCallId: "tool-1",
          state: "succeeded",
        },
      }),
      event({
        id: "legacy-tool",
        sequence: 3,
        type: "tool",
        role: null,
      }),
    ])

    expect(transcriptToolCount(items)).toBe(2)
    expect(items.map((item) => transcriptItemIsVisible(item, false))).toEqual([
      false,
      false,
    ])
    expect(items.every((item) => transcriptItemIsVisible(item, true))).toBe(
      true,
    )
  })
})
