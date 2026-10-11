export const sessionStatuses = [
  "queued",
  "running",
  "waiting",
  "idle",
  "failed",
  "closed",
  "gone",
  "unknown",
] as const

export type SessionStatus = typeof sessionStatuses[number]
export type SessionStatusView = "all" | "active" | "waiting" | "failed"

export interface HierarchicalSession {
  id: string
  connectorId: string
  parentSessionId: string | null
  lastActivityAt: string
}

export interface FilterableSession extends HierarchicalSession {
  title: string | null
  status: string
  lastMessagePreview: string | null
}

export interface SessionSource {
  id: string
  displayName: string
  status: "online" | "offline"
  agent: {
    name: string
  } | null
}

export interface OrderedSession<T extends HierarchicalSession> {
  session: T
  isSubsession: boolean
  depth: number
  hasChildren: boolean
  isLastChild: boolean
  isContext: boolean
}

export interface SessionStatusCounts {
  active: number
  waiting: number
  failed: number
}

export interface SessionListOptions {
  query: string
  statusView: SessionStatusView
  showEnded: boolean
  showUnavailable: boolean
  collapsedSessionKeys?: ReadonlySet<string>
}

export interface SessionDeviceGroup<T extends FilterableSession> {
  source: SessionSource
  sessions: OrderedSession<T>[]
  lastActivityAt: string
}

export function sessionKey(
  session: Pick<HierarchicalSession, "connectorId" | "id">,
) {
  return `${session.connectorId}\0${session.id}`
}

function compareActivity(
  left: HierarchicalSession,
  right: HierarchicalSession,
): number {
  const timestampDifference =
    (Date.parse(right.lastActivityAt) || 0)
    - (Date.parse(left.lastActivityAt) || 0)
  if (timestampDifference !== 0) return timestampDifference
  return sessionKey(left).localeCompare(sessionKey(right))
}

export function normalizedSessionStatus(status: string): SessionStatus {
  return (sessionStatuses as readonly string[]).includes(status)
    ? status as SessionStatus
    : "unknown"
}

export function sessionIsArchived(session: {
  status: string
  nativeStatus?: string | null
}): boolean {
  const nativeStatus = Number(session.nativeStatus)
  return session.status === "closed"
    || (Number.isInteger(nativeStatus) && (nativeStatus & 64) !== 0)
}

export function countSessionStatuses(
  sessions: readonly Pick<FilterableSession, "status">[],
): SessionStatusCounts {
  const counts: SessionStatusCounts = { active: 0, waiting: 0, failed: 0 }
  for (const session of sessions) {
    const status = normalizedSessionStatus(session.status)
    if (status === "queued" || status === "running") counts.active += 1
    if (status === "waiting") counts.waiting += 1
    if (status === "failed") counts.failed += 1
  }
  return counts
}

function statusMatchesView(
  status: SessionStatus,
  view: SessionStatusView,
): boolean {
  if (view === "active") return status === "queued" || status === "running"
  if (view === "waiting") return status === "waiting"
  if (view === "failed") return status === "failed"
  return true
}

function buildValidParentMap<T extends HierarchicalSession>(
  sessions: readonly T[],
): Map<string, string> {
  const sessionsByKey = new Map(
    sessions.map((session) => [sessionKey(session), session]),
  )
  const parentByKey = new Map<string, string>()

  for (const session of sessions) {
    if (!session.parentSessionId) continue
    const parentKey = sessionKey({
      connectorId: session.connectorId,
      id: session.parentSessionId,
    })
    if (sessionsByKey.has(parentKey)) {
      parentByKey.set(sessionKey(session), parentKey)
    }
  }

  for (const startKey of parentByKey.keys()) {
    const path = new Set<string>()
    let currentKey: string | undefined = startKey
    while (currentKey && parentByKey.has(currentKey)) {
      if (path.has(currentKey)) {
        for (const invalidKey of path) parentByKey.delete(invalidKey)
        break
      }
      path.add(currentKey)
      currentKey = parentByKey.get(currentKey)
    }
  }
  return parentByKey
}

function orderSessionTree<T extends HierarchicalSession>(
  sessions: readonly T[],
  includedKeys: ReadonlySet<string>,
  contextKeys: ReadonlySet<string>,
  collapsedKeys: ReadonlySet<string>,
): OrderedSession<T>[] {
  const parentByKey = buildValidParentMap(sessions)
  const childrenByKey = new Map<string, T[]>()
  const roots: T[] = []

  for (const session of sessions) {
    const key = sessionKey(session)
    if (!includedKeys.has(key)) continue
    const parentKey = parentByKey.get(key)
    if (!parentKey || !includedKeys.has(parentKey)) {
      roots.push(session)
      continue
    }
    const children = childrenByKey.get(parentKey) ?? []
    children.push(session)
    childrenByKey.set(parentKey, children)
  }

  roots.sort(compareActivity)
  for (const children of childrenByKey.values()) children.sort(compareActivity)

  const ordered: OrderedSession<T>[] = []
  const append = (session: T, depth: number, isLastChild: boolean) => {
    const key = sessionKey(session)
    const children = childrenByKey.get(key) ?? []
    ordered.push({
      session,
      isSubsession: depth > 0,
      depth,
      hasChildren: children.length > 0,
      isLastChild,
      isContext: contextKeys.has(key),
    })
    if (collapsedKeys.has(key)) return
    children.forEach((child, index) =>
      append(child, depth + 1, index === children.length - 1)
    )
  }
  roots.forEach((root, index) => append(root, 0, index === roots.length - 1))
  return ordered
}

export function deriveVisibleSessions<T extends FilterableSession>(
  sessions: readonly T[],
  sources: ReadonlyMap<string, SessionSource>,
  options: SessionListOptions,
): OrderedSession<T>[] {
  const query = options.query.trim().toLocaleLowerCase()
  const parentByKey = buildValidParentMap(sessions)
  const directlyIncluded = new Set<string>()

  for (const session of sessions) {
    const status = normalizedSessionStatus(session.status)
    if (status === "closed" && !options.showEnded) continue
    if (status === "gone" && !options.showUnavailable) continue
    if (!statusMatchesView(status, options.statusView)) continue
    if (query) {
      const source = sources.get(session.connectorId)
      const values = [
        session.title ?? "",
        session.lastMessagePreview ?? "",
        source?.displayName ?? "",
        source?.agent?.name ?? "",
      ]
      if (!values.some((value) => value.toLocaleLowerCase().includes(query))) {
        continue
      }
    }
    directlyIncluded.add(sessionKey(session))
  }

  const includedKeys = new Set(directlyIncluded)
  const contextKeys = new Set<string>()
  for (const key of directlyIncluded) {
    let parentKey = parentByKey.get(key)
    while (parentKey) {
      if (!includedKeys.has(parentKey)) {
        includedKeys.add(parentKey)
        contextKeys.add(parentKey)
      }
      parentKey = parentByKey.get(parentKey)
    }
  }

  const filtering = query.length > 0 || options.statusView !== "all"
  return orderSessionTree(
    sessions,
    includedKeys,
    contextKeys,
    filtering ? new Set() : options.collapsedSessionKeys ?? new Set(),
  )
}

export function groupSessionsByDevice<T extends FilterableSession>(
  sessions: readonly OrderedSession<T>[],
  sources: ReadonlyMap<string, SessionSource>,
): SessionDeviceGroup<T>[] {
  const groups = new Map<string, OrderedSession<T>[]>()
  for (const item of sessions) {
    const group = groups.get(item.session.connectorId) ?? []
    group.push(item)
    groups.set(item.session.connectorId, group)
  }
  return [...groups.entries()]
    .map(([connectorId, items]) => ({
      source: sources.get(connectorId) ?? {
        id: connectorId,
        displayName: "Unknown device",
        status: "offline" as const,
        agent: null,
      },
      sessions: items,
      lastActivityAt: items.reduce(
        (latest, item) =>
          (Date.parse(item.session.lastActivityAt) || 0)
              > (Date.parse(latest) || 0)
            ? item.session.lastActivityAt
            : latest,
        items[0]?.session.lastActivityAt ?? "",
      ),
    }))
    .sort((left, right) =>
      compareActivity(
        { ...left.sessions[0].session, lastActivityAt: left.lastActivityAt },
        { ...right.sessions[0].session, lastActivityAt: right.lastActivityAt },
      )
    )
}

export function orderSessionHierarchy<T extends HierarchicalSession>(
  sessions: readonly T[],
): OrderedSession<T>[] {
  return orderSessionTree(
    sessions,
    new Set(sessions.map(sessionKey)),
    new Set(),
    new Set(),
  )
}
