import { describe, expect, it } from "vitest"
import {
  countSessionStatuses,
  deriveVisibleSessions,
  groupSessionsByDevice,
  orderSessionHierarchy,
  sessionIsArchived,
  sessionKey,
  type SessionSource,
} from "./session-list"

interface TestSession {
  id: string
  connectorId: string
  parentSessionId: string | null
  title: string | null
  status: string
  lastActivityAt: string
  lastMessagePreview: string | null
}

function session(
  id: string,
  parentSessionId: string | null,
  lastActivityAt: string,
  connectorId = "device-1",
  status = "idle",
): TestSession {
  return {
    id,
    connectorId,
    parentSessionId,
    title: id,
    status,
    lastActivityAt,
    lastMessagePreview: `${id} preview`,
  }
}

const sources = new Map<string, SessionSource>([
  ["device-1", {
    id: "device-1",
    displayName: "Studio laptop",
    status: "online",
    agent: { name: "GitHub Copilot" },
  }],
  ["device-2", {
    id: "device-2",
    displayName: "Work desktop",
    status: "offline",
    agent: { name: "Other Agent" },
  }],
])

describe("orderSessionHierarchy", () => {
  it("keeps children beside their parent and sorts siblings by activity", () => {
    const ordered = orderSessionHierarchy([
      session("child-old", "parent", "2026-10-10T10:00:00.000Z"),
      session("unrelated", null, "2026-10-10T11:00:00.000Z"),
      session("parent", null, "2026-10-10T09:00:00.000Z"),
      session("child-new", "parent", "2026-10-10T12:00:00.000Z"),
    ])

    expect(ordered.map(({ session: item, depth, hasChildren }) => [
      item.id,
      depth,
      hasChildren,
    ])).toEqual([
      ["unrelated", 0, false],
      ["parent", 0, true],
      ["child-new", 1, false],
      ["child-old", 1, false],
    ])
  })

  describe("sessionIsArchived", () => {
    it("recognizes normalized and legacy Agent Host archive states", () => {
      expect(sessionIsArchived({ status: "closed" })).toBe(true)
      expect(sessionIsArchived({ status: "gone", nativeStatus: "65" }))
        .toBe(true)
      expect(sessionIsArchived({ status: "gone", nativeStatus: "1" }))
        .toBe(false)
    })
  })

  it("shows a child as top-level when its parent is unavailable", () => {
    const [item] = orderSessionHierarchy([
      session("child", "filtered-parent", "2026-10-10T10:00:00.000Z"),
    ])
    expect(item).toMatchObject({
      session: { id: "child" },
      isSubsession: false,
      depth: 0,
    })
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

describe("session list derivation", () => {
  it("counts only the predefined actionable status views", () => {
    expect(countSessionStatuses([
      session("queued", null, "", "device-1", "queued"),
      session("running", null, "", "device-1", "running"),
      session("waiting", null, "", "device-1", "waiting"),
      session("failed", null, "", "device-1", "failed"),
      session("unknown", null, "", "device-1", "vendor-specific"),
    ])).toEqual({ active: 2, waiting: 1, failed: 1 })
  })

  it("hides ended and unavailable sessions by default", () => {
    const visible = deriveVisibleSessions([
      session("idle", null, "2026-10-10T12:00:00.000Z"),
      session("closed", null, "2026-10-10T11:00:00.000Z", "device-1", "closed"),
      session("gone", null, "2026-10-10T10:00:00.000Z", "device-1", "gone"),
      session("unknown", null, "2026-10-10T09:00:00.000Z", "device-1", "new-agent-state"),
    ], sources, {
      query: "",
      statusView: "all",
      showEnded: false,
      showUnavailable: false,
    })
    expect(visible.map((item) => item.session.id)).toEqual(["idle", "unknown"])
  })

  it("searches agent and device names and preserves unmatched parents", () => {
    const parent = session("parent", null, "2026-10-10T10:00:00.000Z")
    parent.title = "Release desktop client"
    const child = session(
      "child",
      "parent",
      "2026-10-10T11:00:00.000Z",
      "device-1",
      "waiting",
    )
    child.title = "Confirm signing identity"

    const visible = deriveVisibleSessions([parent, child], sources, {
      query: "signing",
      statusView: "all",
      showEnded: false,
      showUnavailable: false,
    })
    expect(visible.map((item) => [
      item.session.id,
      item.isContext,
      item.depth,
    ])).toEqual([
      ["parent", true, 0],
      ["child", false, 1],
    ])

    expect(deriveVisibleSessions([parent], sources, {
      query: "github copilot",
      statusView: "all",
      showEnded: false,
      showUnavailable: false,
    })).toHaveLength(1)
  })

  it("applies collapse only outside active filters", () => {
    const parent = session("parent", null, "2026-10-10T10:00:00.000Z")
    const child = session(
      "child",
      "parent",
      "2026-10-10T11:00:00.000Z",
      "device-1",
      "waiting",
    )
    const collapsed = new Set([sessionKey(parent)])
    expect(deriveVisibleSessions([parent, child], sources, {
      query: "",
      statusView: "all",
      showEnded: false,
      showUnavailable: false,
      collapsedSessionKeys: collapsed,
    }).map((item) => item.session.id)).toEqual(["parent"])
    expect(deriveVisibleSessions([parent, child], sources, {
      query: "",
      statusView: "waiting",
      showEnded: false,
      showUnavailable: false,
      collapsedSessionKeys: collapsed,
    }).map((item) => item.session.id)).toEqual(["parent", "child"])
  })

  it("groups visible trees by device and orders groups by latest activity", () => {
    const visible = deriveVisibleSessions([
      session("studio", null, "2026-10-10T10:00:00.000Z"),
      session("work", null, "2026-10-10T12:00:00.000Z", "device-2"),
    ], sources, {
      query: "",
      statusView: "all",
      showEnded: false,
      showUnavailable: false,
    })
    const groups = groupSessionsByDevice(visible, sources)
    expect(groups.map((group) => [
      group.source.displayName,
      group.sessions.map((item) => item.session.id),
    ])).toEqual([
      ["Work desktop", ["work"]],
      ["Studio laptop", ["studio"]],
    ])
  })
})
