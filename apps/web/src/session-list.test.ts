import { describe, expect, it } from "vitest"
import { orderSessionHierarchy } from "./session-list"

interface TestSession {
  id: string
  connectorId: string
  parentSessionId: string | null
  lastActivityAt: string
}

function session(
  id: string,
  parentSessionId: string | null,
  lastActivityAt: string,
  connectorId = "device-1",
): TestSession {
  return { id, connectorId, parentSessionId, lastActivityAt }
}

describe("orderSessionHierarchy", () => {
  it("keeps children beside their parent and sorts siblings by activity", () => {
    const ordered = orderSessionHierarchy([
      session("child-old", "parent", "2026-10-10T10:00:00.000Z"),
      session("unrelated", null, "2026-10-10T11:00:00.000Z"),
      session("parent", null, "2026-10-10T09:00:00.000Z"),
      session("child-new", "parent", "2026-10-10T12:00:00.000Z"),
    ])

    expect(ordered.map(({ session: item, isSubsession }) => [
      item.id,
      isSubsession,
    ])).toEqual([
      ["unrelated", false],
      ["parent", false],
      ["child-new", true],
      ["child-old", true],
    ])
  })

  it("shows a child as top-level when its parent is not visible", () => {
    expect(orderSessionHierarchy([
      session("child", "filtered-parent", "2026-10-10T10:00:00.000Z"),
    ])).toEqual([{
      session: expect.objectContaining({ id: "child" }),
      isSubsession: false,
    }])
  })

  it("scopes relationships by connector and safely flattens cycles", () => {
    const ordered = orderSessionHierarchy([
      session("parent", null, "2026-10-10T08:00:00.000Z", "device-2"),
      session("orphan", "parent", "2026-10-10T11:00:00.000Z"),
      session("cycle-a", "cycle-b", "2026-10-10T10:00:00.000Z"),
      session("cycle-b", "cycle-a", "2026-10-10T09:00:00.000Z"),
      session("self", "self", "2026-10-10T07:00:00.000Z"),
    ])

    expect(ordered.every((item) => !item.isSubsession)).toBe(true)
    expect(ordered.map((item) => item.session.id)).toEqual([
      "orphan",
      "cycle-a",
      "cycle-b",
      "parent",
      "self",
    ])
  })
})
