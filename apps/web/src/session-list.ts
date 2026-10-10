export interface HierarchicalSession {
  id: string
  connectorId: string
  parentSessionId: string | null
  lastActivityAt: string
}

export interface OrderedSession<T extends HierarchicalSession> {
  session: T
  isSubsession: boolean
}

function sessionKey(session: Pick<HierarchicalSession, "connectorId" | "id">) {
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

export function orderSessionHierarchy<T extends HierarchicalSession>(
  sessions: readonly T[],
): OrderedSession<T>[] {
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

  const childrenByKey = new Map<string, T[]>()
  const roots: T[] = []
  for (const session of sessions) {
    const key = sessionKey(session)
    const parentKey = parentByKey.get(key)
    if (!parentKey) {
      roots.push(session)
      continue
    }
    const children = childrenByKey.get(parentKey) ?? []
    children.push(session)
    childrenByKey.set(parentKey, children)
  }

  roots.sort(compareActivity)
  for (const children of childrenByKey.values()) {
    children.sort(compareActivity)
  }

  const ordered: OrderedSession<T>[] = []
  for (const root of roots) {
    const pending: OrderedSession<T>[] = [{
      session: root,
      isSubsession: false,
    }]
    while (pending.length > 0) {
      const item = pending.pop()
      if (!item) break
      ordered.push(item)
      const children = childrenByKey.get(sessionKey(item.session)) ?? []
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push({ session: children[index], isSubsession: true })
      }
    }
  }
  return ordered
}
