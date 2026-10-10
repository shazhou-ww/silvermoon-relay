import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const relayOrigin =
  import.meta.env.VITE_RELAY_ORIGIN ?? "https://relay.silvermoon.work"

type Provider = "google" | "microsoft" | "github"

interface Identity {
  provider: Provider
  email: string | null
  displayName: string | null
  emailVerified: boolean
}

interface Account {
  user: {
    id: string
    displayName: string | null
    avatarUrl: string | null
  }
  identities: Identity[]
  sessionId: string
}

interface ConnectionToken {
  id: string
  label: string
  tokenHint: string
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
}

interface BrowserSession {
  id: string
  current: boolean
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  userAgent: string | null
}

interface Connector {
  id: string
  displayName: string
  agent: {
    name: string
    version: string | null
  } | null
  capabilities: {
    listSessions: boolean
    createSession: boolean
    sendMessage: boolean
    streamEvents: boolean
  }
  status: "online" | "offline"
  connectedAt: string | null
  disconnectedAt: string | null
  lastSeenAt: string | null
  createdAt: string
  sessionCount: number
}

interface AgentSession {
  id: string
  connectorId: string
  title: string | null
  status: string
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  lastMessagePreview: string | null
}

interface AgentSessionEvent {
  id: string
  sessionId: string
  sequence: number
  type: "message" | "activity" | "tool" | "status" | "error"
  role: "user" | "assistant" | "system" | null
  text: string | null
  data: Record<string, unknown> | null
  createdAt: string
}

interface CommandResponse {
  command: {
    id: string
    type: string
    status: "sent" | "failed"
  }
}

const providerLabels: Record<Provider, string> = {
  google: "Google",
  microsoft: "Microsoft",
  github: "GitHub",
}

function csrfToken(): string {
  const item = document.cookie
    .split("; ")
    .find((value) => value.startsWith("sm_csrf="))
  return item ? decodeURIComponent(item.slice("sm_csrf=".length)) : ""
}

async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = init.method ?? "GET"
  const headers = new Headers(init.headers)
  if (method !== "GET") headers.set("x-csrf-token", csrfToken())
  if (init.body) headers.set("content-type", "application/json")
  const response = await fetch(`${relayOrigin}${path}`, {
    ...init,
    headers,
    credentials: "include",
  })
  const value = await response.json() as T & { error?: string }
  if (!response.ok) {
    throw new Error(value.error ?? `Request failed: ${response.status}`)
  }
  return value
}

function formatTime(value: string | null): string {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function sessionLabel(session: AgentSession): string {
  return session.title || session.lastMessagePreview || "Untitled session"
}

function eventLabel(event: AgentSessionEvent): string {
  if (event.type === "tool") return "Tool"
  if (event.type === "error") return "Error"
  if (event.role === "assistant") return "Copilot"
  if (event.role === "user") return "You"
  if (event.role === "system") return "System"
  return event.type[0].toUpperCase() + event.type.slice(1)
}

function App() {
  const [account, setAccount] = useState<Account | null>(null)
  const [tokens, setTokens] = useState<ConnectionToken[]>([])
  const [browserSessions, setBrowserSessions] = useState<BrowserSession[]>([])
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([])
  const [events, setEvents] = useState<AgentSessionEvent[]>([])
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(
    null,
  )
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [label, setLabel] = useState("My connector")
  const [expiresInDays, setExpiresInDays] = useState("90")
  const [revealedToken, setRevealedToken] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState("")
  const [sessionPrompt, setSessionPrompt] = useState("")
  const [followUp, setFollowUp] = useState("")
  const historyRequests = useRef(new Set<string>())

  const selectConnector = useCallback((items: Connector[]) => {
    setSelectedConnectorId((current) => {
      if (current && items.some((item) => item.id === current)) return current
      return items.find((item) => item.status === "online")?.id
        ?? items[0]?.id
        ?? null
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      const current = await api<Account>("/api/me")
      const [tokenItems, sessionItems, connectorItems] = await Promise.all([
        api<ConnectionToken[]>("/api/tokens"),
        api<BrowserSession[]>("/api/sessions"),
        api<Connector[]>("/api/connectors"),
      ])
      setAccount(current)
      setTokens(tokenItems)
      setBrowserSessions(sessionItems)
      setConnectors(connectorItems)
      selectConnector(connectorItems)
      setError(null)
    } catch (caught) {
      if (
        caught instanceof Error
        && caught.message === "authentication-required"
      ) {
        setAccount(null)
      } else if (caught instanceof Error) {
        setError(caught.message)
      }
    } finally {
      setLoading(false)
    }
  }, [selectConnector])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- The first remote snapshot is loaded after mount.
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!account) return
    let active = true
    const poll = async () => {
      try {
        const items = await api<Connector[]>("/api/connectors")
        if (!active) return
        setConnectors(items)
        selectConnector(items)
      } catch (caught) {
        if (active && caught instanceof Error) setError(caught.message)
      }
    }
    const timer = window.setInterval(() => void poll(), 5_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [account, selectConnector])

  useEffect(() => {
    if (!account || !selectedConnectorId) return
    let active = true
    const connectorId = encodeURIComponent(selectedConnectorId)
    const poll = async () => {
      try {
        const items = await api<AgentSession[]>(
          `/api/connectors/${connectorId}/sessions`,
        )
        if (!active) return
        setAgentSessions(items)
        setSelectedSessionId((current) => {
          if (current && items.some((item) => item.id === current)) return current
          return items[0]?.id ?? null
        })
      } catch (caught) {
        if (active && caught instanceof Error) setError(caught.message)
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 3_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [account, selectedConnectorId])

  const selectedSessionAvailable = Boolean(
    selectedConnectorId
    && selectedSessionId
    && agentSessions.some(
      (item) =>
        item.connectorId === selectedConnectorId
        && item.id === selectedSessionId,
    ),
  )

  const selectedConnector = useMemo(
    () => connectors.find((item) => item.id === selectedConnectorId) ?? null,
    [connectors, selectedConnectorId],
  )
  const canSyncSelectedHistory = selectedConnector?.status === "online"
    && selectedConnector.capabilities.streamEvents

  useEffect(() => {
    if (
      !account
      || !selectedConnectorId
      || !selectedSessionId
      || !selectedSessionAvailable
    ) return
    let active = true
    let after = -1
    let loadedEvents: AgentSessionEvent[] = []
    const connectorId = encodeURIComponent(selectedConnectorId)
    const sessionId = encodeURIComponent(selectedSessionId)
    const requestKey = `${selectedConnectorId}:${selectedSessionId}`
    const requestHistory = async () => {
      if (
        !canSyncSelectedHistory
        || historyRequests.current.has(requestKey)
      ) {
        return
      }
      historyRequests.current.add(requestKey)
      try {
        await api(
          `/api/connectors/${connectorId}/sessions/${sessionId}/events/sync`,
          { method: "POST" },
        )
      } catch (caught) {
        historyRequests.current.delete(requestKey)
        if (active && caught instanceof Error) setError(caught.message)
      }
    }
    const poll = async () => {
      try {
        const result = await api<{
          events: AgentSessionEvent[]
          nextAfter: number
        }>(
          `/api/connectors/${connectorId}/sessions/${sessionId}/events?after=${after}`,
        )
        if (!active) return
        if (result.events.length > 0) {
          loadedEvents = [...loadedEvents, ...result.events]
          after = result.nextAfter
        }
        setEvents(loadedEvents)
      } catch (caught) {
        if (active && caught instanceof Error) setError(caught.message)
      }
    }
    void requestHistory()
    void poll()
    const timer = window.setInterval(() => void poll(), 2_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [
    account,
    canSyncSelectedHistory,
    selectedConnectorId,
    selectedSessionAvailable,
    selectedSessionId,
  ])

  const visibleAgentSessions = useMemo(
    () => selectedConnectorId
      ? agentSessions.filter(
          (item) => item.connectorId === selectedConnectorId,
        )
      : [],
    [agentSessions, selectedConnectorId],
  )
  const selectedAgentSession = useMemo(
    () =>
      visibleAgentSessions.find((item) => item.id === selectedSessionId)
      ?? null,
    [selectedSessionId, visibleAgentSessions],
  )
  const visibleEvents = useMemo(
    () => selectedSessionId
      ? events.filter((event) => event.sessionId === selectedSessionId)
      : [],
    [events, selectedSessionId],
  )

  async function createAgentSession(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedConnector || !sessionPrompt.trim()) return
    setBusyAction("create-session")
    setNotice(null)
    try {
      const connectorId = encodeURIComponent(selectedConnector.id)
      const result = await api<CommandResponse>(
        `/api/connectors/${connectorId}/sessions`,
        {
          method: "POST",
          body: JSON.stringify({
            prompt: sessionPrompt.trim(),
            ...(sessionTitle.trim() ? { title: sessionTitle.trim() } : {}),
          }),
        },
      )
      setSessionTitle("")
      setSessionPrompt("")
      setNotice(`Session request sent (${result.command.id.slice(0, 8)}).`)
      setError(null)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Session creation failed",
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function sendFollowUp(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedConnector || !selectedAgentSession || !followUp.trim()) return
    setBusyAction("send-message")
    setNotice(null)
    try {
      const connectorId = encodeURIComponent(selectedConnector.id)
      const sessionId = encodeURIComponent(selectedAgentSession.id)
      const result = await api<CommandResponse>(
        `/api/connectors/${connectorId}/sessions/${sessionId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ message: followUp.trim() }),
        },
      )
      setFollowUp("")
      setNotice(`Follow-up sent (${result.command.id.slice(0, 8)}).`)
      setError(null)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Message delivery failed",
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function createConnectionToken() {
    setBusyAction("create-token")
    try {
      const result = await api<{ token: string; metadata: ConnectionToken }>(
        "/api/tokens",
        {
          method: "POST",
          body: JSON.stringify({
            label,
            expiresInDays: expiresInDays ? Number(expiresInDays) : null,
          }),
        },
      )
      setRevealedToken(result.token)
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Token creation failed")
    } finally {
      setBusyAction(null)
    }
  }

  async function revokeConnectionToken(id: string) {
    try {
      await api(`/api/tokens/${id}`, { method: "DELETE" })
      await refresh()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Token revocation failed",
      )
    }
  }

  async function rotateConnectionToken(id: string) {
    try {
      const result = await api<{ token: string }>(
        `/api/tokens/${id}/rotate`,
        { method: "POST" },
      )
      setRevealedToken(result.token)
      await refresh()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Token rotation failed",
      )
    }
  }

  async function logout() {
    try {
      await api("/api/logout", { method: "POST" })
      setAccount(null)
      setConnectors([])
      setAgentSessions([])
      setEvents([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign out failed")
    }
  }

  async function revokeBrowserSession(id: string) {
    try {
      await api(`/api/sessions/${id}`, { method: "DELETE" })
      await refresh()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Session revocation failed",
      )
    }
  }

  async function unlinkIdentity(provider: Provider) {
    try {
      await api(`/api/identities/${provider}`, { method: "DELETE" })
      await refresh()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Identity unlink failed",
      )
    }
  }

  if (loading) {
    return (
      <Shell>
        <p className="text-muted-foreground">Loading your relay…</p>
      </Shell>
    )
  }

  if (!account) {
    return (
      <Shell>
        <div className="grid min-h-[68vh] overflow-hidden rounded-[1.75rem] border bg-card lg:grid-cols-[1.35fr_0.65fr]">
          <section className="flex flex-col justify-between gap-16 bg-[var(--relay-ink)] p-8 text-white sm:p-12">
            <div className="flex items-center gap-3">
              <span className="status-pulse" />
              <span className="text-sm text-white/70">Silvermoon Relay</span>
            </div>
            <div className="max-w-2xl">
              <h1 className="text-4xl leading-[1.04] font-semibold tracking-[-0.04em] sm:text-6xl">
                Your local agents, reachable from one control room.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-white/65 sm:text-lg">
                Connect each device, open GitHub Copilot sessions, and follow
                their work without moving between machines.
              </p>
            </div>
            <p className="max-w-md text-sm leading-6 text-white/50">
              Agent traffic stays on authenticated connector channels.
              Identity provider credentials never enter the relay protocol.
            </p>
          </section>
          <section className="flex flex-col justify-center p-8 sm:p-12">
            <h2 className="text-2xl font-semibold tracking-tight">
              Enter the control room
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Use an identity already linked to your relay account.
            </p>
            <div className="mt-8 grid gap-3">
              {(["google", "microsoft", "github"] as const).map((provider) => (
                <Button
                  asChild
                  key={provider}
                  variant="outline"
                  className="h-11 w-full justify-start px-4"
                >
                  <a href={`${relayOrigin}/auth/${provider}/start`}>
                    Continue with {providerLabels[provider]}
                  </a>
                </Button>
              ))}
            </div>
            {error && (
              <p role="alert" className="mt-5 text-sm text-destructive">
                {error}
              </p>
            )}
          </section>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="status-pulse" />
            Relay control room
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
            {account.user.displayName ?? "Your devices"}
          </h1>
        </div>
        <Button variant="outline" onClick={() => void logout()}>
          Sign out
        </Button>
      </header>

      {(error || notice) && (
        <div
          role={error ? "alert" : "status"}
          className={
            error
              ? "rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              : "rounded-xl border border-[var(--online)]/30 bg-[var(--online-soft)] p-3 text-sm text-[var(--online-deep)]"
          }
        >
          {error ?? notice}
        </div>
      )}

      <section className="control-surface grid min-h-[42rem] overflow-hidden rounded-[1.5rem] border bg-card lg:grid-cols-[15rem_21rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
          <div className="border-b p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Devices</h2>
              <Badge variant="outline">{connectors.length}</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Connectors currently known to this account.
            </p>
          </div>
          <div className="signal-list flex max-h-72 flex-col overflow-y-auto p-2 lg:max-h-none lg:flex-1">
            {connectors.length === 0 && (
              <div className="m-3 border-l-2 border-primary pl-4">
                <p className="text-sm font-medium">No device connected</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Create a token below, then run silvermoon-connector on a
                  device.
                </p>
              </div>
            )}
            {connectors.map((connector) => (
              <button
                key={connector.id}
                type="button"
                aria-pressed={connector.id === selectedConnectorId}
                className="connector-item"
                onClick={() => {
                  setSelectedConnectorId(connector.id)
                  setSelectedSessionId(null)
                }}
              >
                <span
                  className={
                    connector.status === "online"
                      ? "connector-dot connector-dot-online"
                      : "connector-dot"
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {connector.displayName}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {connector.agent?.name ?? connector.id}
                  </span>
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {connector.sessionCount}
                </span>
              </button>
            ))}
          </div>
          {selectedConnector && (
            <div className="border-t p-4 text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">
                {selectedConnector.status === "online" ? "Online" : "Offline"}
              </span>
              <br />
              Last seen {formatTime(selectedConnector.lastSeenAt)}
            </div>
          )}
        </aside>

        <section className="flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
          <div className="border-b p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Sessions</h2>
              <Badge variant="outline">{visibleAgentSessions.length}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {selectedConnector?.displayName ?? "Select a device"}
            </p>
          </div>

          {selectedConnector?.capabilities.createSession && (
            <form
              className="grid gap-2 border-b bg-muted/35 p-4"
              onSubmit={(event) => void createAgentSession(event)}
            >
              <Input
                aria-label="New session title"
                placeholder="Optional title"
                value={sessionTitle}
                maxLength={256}
                disabled={selectedConnector.status !== "online"}
                onChange={(event) => setSessionTitle(event.target.value)}
              />
              <Textarea
                aria-label="New session prompt"
                placeholder="What should Copilot work on?"
                value={sessionPrompt}
                maxLength={32_000}
                disabled={selectedConnector.status !== "online"}
                onChange={(event) => setSessionPrompt(event.target.value)}
              />
              <Button
                type="submit"
                disabled={
                  selectedConnector.status !== "online"
                  || !sessionPrompt.trim()
                  || busyAction === "create-session"
                }
              >
                {busyAction === "create-session"
                  ? "Sending request…"
                  : "Create session"}
              </Button>
            </form>
          )}

          <div className="max-h-96 flex-1 overflow-y-auto p-2 lg:max-h-none">
            {selectedConnector && visibleAgentSessions.length === 0 && (
              <p className="p-4 text-sm leading-6 text-muted-foreground">
                No sessions reported by this connector yet.
              </p>
            )}
            {!selectedConnector && (
              <p className="p-4 text-sm text-muted-foreground">
                Select a device to see its sessions.
              </p>
            )}
            {visibleAgentSessions.map((agentSession) => (
              <button
                key={agentSession.id}
                type="button"
                aria-pressed={agentSession.id === selectedSessionId}
                className="session-item"
                onClick={() => setSelectedSessionId(agentSession.id)}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">
                    {sessionLabel(agentSession)}
                  </span>
                  <span className={`session-state session-state-${agentSession.status}`}>
                    {agentSession.status}
                  </span>
                </span>
                <span className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {agentSession.lastMessagePreview ?? agentSession.id}
                </span>
                <span className="mt-2 block text-[0.7rem] text-muted-foreground">
                  {formatTime(agentSession.lastActivityAt)}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="flex min-h-[32rem] min-w-0 flex-col">
          <div className="flex items-start justify-between gap-4 border-b p-5">
            <div className="min-w-0">
              <h2 className="truncate font-semibold">
                {selectedAgentSession
                  ? sessionLabel(selectedAgentSession)
                  : "Session activity"}
              </h2>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {selectedAgentSession?.id
                  ?? "Choose a session to inspect its live activity."}
              </p>
            </div>
            {selectedAgentSession && (
              <Badge variant="outline">{selectedAgentSession.status}</Badge>
            )}
          </div>

          <div
            aria-live="polite"
            className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7"
          >
            {!selectedAgentSession && (
              <div className="flex h-full min-h-64 items-center justify-center">
                <p className="max-w-xs text-center text-sm leading-6 text-muted-foreground">
                  Activity, messages, tool calls, and status changes appear
                  here as the local agent works.
                </p>
              </div>
            )}
            {selectedAgentSession && visibleEvents.length === 0 && (
              <div className="flex h-full min-h-64 items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {canSyncSelectedHistory
                    ? "Loading session history from this device."
                    : "No session activity has been synced."}
                </p>
              </div>
            )}
            <div className="activity-stream">
              {visibleEvents.map((event) => (
                <article
                  key={event.id}
                  className="activity-entry"
                  data-event-type={event.type}
                >
                  <span className="activity-marker" aria-hidden="true" />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold">
                      {eventLabel(event)}
                    </span>
                    <time className="text-[0.7rem] text-muted-foreground">
                      {formatTime(event.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                    {event.text ?? "Activity reported without text."}
                  </p>
                </article>
              ))}
            </div>
          </div>

          {selectedAgentSession && (
            <form
              className="border-t bg-muted/30 p-4 sm:p-5"
              onSubmit={(event) => void sendFollowUp(event)}
            >
              <label className="mb-2 block text-xs font-medium" htmlFor="follow-up">
                Continue this session
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Textarea
                  id="follow-up"
                  className="min-h-10 flex-1"
                  placeholder="Send a follow-up to Copilot"
                  value={followUp}
                  maxLength={32_000}
                  disabled={
                    selectedConnector?.status !== "online"
                    || !selectedConnector.capabilities.sendMessage
                  }
                  onChange={(event) => setFollowUp(event.target.value)}
                />
                <Button
                  type="submit"
                  className="sm:self-end"
                  disabled={
                    selectedConnector?.status !== "online"
                    || !selectedConnector?.capabilities.sendMessage
                    || !followUp.trim()
                    || busyAction === "send-message"
                  }
                >
                  {busyAction === "send-message" ? "Sending…" : "Send"}
                </Button>
              </div>
            </form>
          )}
        </section>
      </section>

      <details className="settings-panel rounded-[1.25rem] border bg-card">
        <summary className="cursor-pointer px-5 py-4 font-medium sm:px-6">
          Connection and account settings
        </summary>
        <div className="grid gap-5 border-t p-5 sm:p-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>New connection token</CardTitle>
              <CardDescription>
                The complete token is shown once. Store it in a protected file
                on the connector device.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]">
              <Input
                aria-label="Token label"
                value={label}
                maxLength={80}
                onChange={(event) => setLabel(event.target.value)}
              />
              <Input
                aria-label="Expires in days"
                value={expiresInDays}
                inputMode="numeric"
                onChange={(event) => setExpiresInDays(event.target.value)}
              />
              <Button
                disabled={busyAction === "create-token"}
                onClick={() => void createConnectionToken()}
              >
                Create token
              </Button>
            </CardContent>
            {revealedToken && (
              <CardContent className="space-y-3 border-t pt-4">
                <p className="text-sm font-medium">Copy this token now</p>
                <code className="block overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
                  {revealedToken}
                </code>
                <div className="flex gap-2">
                  <Button
                    onClick={() =>
                      void navigator.clipboard.writeText(revealedToken)}
                  >
                    Copy token
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setRevealedToken(null)}
                  >
                    I have saved it
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Linked identities</CardTitle>
              <CardDescription>
                Sign-in identities are linked by provider subject, not email.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(["google", "microsoft", "github"] as const).map((provider) => {
                const identity = account.identities.find(
                  (item) => item.provider === provider,
                )
                return (
                  <div
                    key={provider}
                    className="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium">{providerLabels[provider]}</p>
                      <p className="text-xs text-muted-foreground">
                        {identity?.email
                          ?? (identity ? "No email shared" : "Not linked")}
                      </p>
                    </div>
                    {identity ? (
                      account.identities.length > 1
                        ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void unlinkIdentity(provider)}
                            >
                              Unlink
                            </Button>
                          )
                        : <Badge variant="secondary">Linked</Badge>
                    ) : (
                      <Button asChild size="sm" variant="outline">
                        <a href={`${relayOrigin}/auth/${provider}/start?mode=link`}>
                          Link
                        </a>
                      </Button>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Connection tokens</CardTitle>
              <CardDescription>
                Revoking a token closes connectors currently using it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {tokens.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No connection tokens yet.
                </p>
              )}
              {tokens.map((token) => (
                <div
                  key={token.id}
                  className="flex flex-col gap-3 border-b pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {token.label}
                      {token.revokedAt && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          Revoked
                        </span>
                      )}
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      smr1_{token.id}_••••{token.tokenHint}
                    </p>
                  </div>
                  {!token.revokedAt && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void rotateConnectionToken(token.id)}
                      >
                        Rotate
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void revokeConnectionToken(token.id)}
                      >
                        Revoke
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Browser sessions</CardTitle>
              <CardDescription>
                Revoke signed-in browsers you no longer recognize.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {browserSessions
                .filter((session) => !session.revokedAt)
                .map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {session.userAgent ?? "Unknown browser"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Expires {formatTime(session.expiresAt)}
                      </p>
                    </div>
                    {session.current ? (
                      <Badge>Current</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void revokeBrowserSession(session.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      </details>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-[100rem] flex-col gap-6 px-4 py-5 sm:px-7 sm:py-8">
        {children}
      </div>
    </main>
  )
}

export default App
