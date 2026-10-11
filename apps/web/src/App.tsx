import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Laptop,
  Link2,
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  UserRound,
  WifiOff,
  Wrench,
  X,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { TranscriptScroll } from "@/components/transcript-scroll"
import {
  buildTranscript,
  segmentTurnParts,
  transcriptItemIsVisible,
  transcriptToolCount,
  type AgentSessionEvent,
  type TranscriptPart,
  type TranscriptTurn,
} from "@/message-flow"
import {
  countSessionStatuses,
  deriveVisibleSessions,
  groupSessionsByDevice,
  sessionIsArchived,
  sessionKey,
  type OrderedSession,
  type SessionStatusView,
} from "@/session-list"

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
  deviceId: string
  deviceName: string
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
  parentSessionId: string | null
  title: string | null
  status: string
  nativeStatus?: string | null
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  lastMessagePreview: string | null
  canSendMessage: boolean
}

interface CommandResponse {
  command: {
    id: string
    type: string
    status: "sent" | "failed"
  }
}

interface HistorySyncResponse {
  command: {
    id: string
    type: "session.history"
    status: "queued" | "sent" | "accepted" | "failed"
  } | null
  synced?: boolean
}

interface CommandStatus {
  id: string
  connectorId: string
  type: string
  sessionId: string | null
  status: "queued" | "sent" | "accepted" | "succeeded" | "failed"
  error: {
    code: string
    message: string | null
  } | null
}

interface TrackedCommand {
  id: string
  label: string
  status: CommandStatus["status"]
  historyRequestKey?: string
}

interface SessionSelection {
  connectorId: string
  sessionId: string
}

const providerLabels: Record<Provider, string> = {
  google: "Google",
  microsoft: "Microsoft",
  github: "GitHub",
}

const emptyEvents: AgentSessionEvent[] = []

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

function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return value
  const elapsed = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })
}

function sessionLabel(session: AgentSession): string {
  return session.title || session.lastMessagePreview || "Untitled session"
}

function sessionStatusLabel(status: string): string {
  switch (status) {
    case "queued":
    case "running":
      return "Active"
    case "waiting":
      return "Needs input"
    case "idle":
      return "Available"
    case "failed":
      return "Failed"
    case "closed":
      return "Ended"
    case "gone":
      return "Unavailable"
    default:
      return "Unknown"
  }
}

function eventLabel(event: AgentSessionEvent): string {
  if (event.type === "tool") return "Tool"
  if (event.type === "error") return "Error"
  if (event.role === "assistant") return "Copilot"
  if (event.role === "user") return "You"
  if (event.role === "system") return "System"
  return event.type[0].toUpperCase() + event.type.slice(1)
}

function eventBody(event: AgentSessionEvent): string {
  if (event.text) return event.text
  if (event.data) return JSON.stringify(event.data, null, 2)
  return "No additional details."
}

function MarkdownBody({ children }: { children: string }) {
  return (
    <div className="message-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}

function toolStateLabel(part: TranscriptPart): string {
  switch (part.event.data?.state) {
    case "started":
    case "running":
      return "Running"
    case "waiting":
      return "Waiting"
    case "succeeded":
      return "Succeeded"
    case "failed":
      return "Failed"
    case "cancelled":
      return "Cancelled"
    default:
      return "Updated"
  }
}

function ToolStateIcon({ part }: { part: TranscriptPart }) {
  const state = part.event.data?.state
  if (state === "succeeded") return <Check aria-hidden="true" />
  if (state === "failed" || state === "cancelled") {
    return <CircleAlert aria-hidden="true" />
  }
  return <LoaderCircle className="animate-spin" aria-hidden="true" />
}

function ToolDisclosure({ part }: { part: TranscriptPart }) {
  const state = part.event.data?.state
  const name = typeof part.event.data?.toolName === "string"
    ? part.event.data.toolName
    : "Tool"
  const [open, setOpen] = useState(state !== "succeeded")
  return (
    <details
      className="turn-tool"
      data-state={state ?? "updated"}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="turn-tool-state">
          <ToolStateIcon part={part} />
        </span>
        <strong>{name}</strong>
        <span>{toolStateLabel(part)}</span>
      </summary>
      <div className="turn-tool-detail">
        <p>{eventBody(part.event)}</p>
      </div>
    </details>
  )
}

function ToolGroup({ parts }: { parts: TranscriptPart[] }) {
  const failed = parts.some((part) =>
    part.event.data?.state === "failed"
    || part.event.data?.state === "cancelled"
  )
  const active = parts.some((part) =>
    part.event.data?.state === "started"
    || part.event.data?.state === "running"
    || part.event.data?.state === "waiting"
  )
  const summary = failed
    ? "Needs attention"
    : active
    ? "In progress"
    : "Completed"

  return (
    <section
      className="turn-tool-group"
      aria-label={`Tool activity, ${parts.length} ${
        parts.length === 1 ? "step" : "steps"
      }, ${summary.toLowerCase()}`}
    >
      <header>
        <span>
          <Wrench aria-hidden="true" />
          Tool activity · {parts.length}
        </span>
        <strong data-state={failed ? "failed" : active ? "running" : "succeeded"}>
          {summary}
        </strong>
      </header>
      {parts.map((part) => (
        <ToolDisclosure
          key={`${part.id}:${part.event.data?.state ?? "updated"}`}
          part={part}
        />
      ))}
    </section>
  )
}

function StructuredPart({ part }: { part: TranscriptPart }) {
  const body = eventBody(part.event)
  if (part.kind === "markdown") {
    return (
      <article
        className="turn-markdown"
        aria-label={`Copilot message sent ${formatTime(part.event.createdAt)}`}
      >
        <MarkdownBody>{body}</MarkdownBody>
      </article>
    )
  }
  if (part.kind === "system") {
    return (
      <div className="turn-system" aria-label="System notification">
        <strong>System</strong>
        <p>{body}</p>
      </div>
    )
  }
  if (part.kind === "error") {
    return (
      <div className="turn-error" aria-label="Agent error">
        <CircleAlert aria-hidden="true" />
        <div>
          <strong>Error</strong>
          <p>{body}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="turn-activity">
      <span aria-hidden="true" />
      <div>
        <strong>Activity</strong>
        <p>{body}</p>
      </div>
      <time dateTime={part.event.createdAt}>
        {formatRelativeTime(part.event.createdAt)}
      </time>
    </div>
  )
}

function TranscriptTurnView({
  turn,
  showTools,
}: {
  turn: TranscriptTurn
  showTools: boolean
}) {
  const segments = segmentTurnParts(turn.parts)
  const lastEvent = turn.parts.at(-1)?.event ?? turn.request
  return (
    <article
      className="transcript-turn"
      aria-label={`Agent turn started ${formatTime(turn.createdAt)}`}
    >
      {turn.request?.text && (
        <div
          className={`turn-request ${
            turn.request.role === "user" ? "is-user" : "is-system"
          }`}
          aria-label={`${eventLabel(turn.request)} message sent ${
            formatTime(turn.request.createdAt)
          }`}
        >
          <p>{turn.request.text}</p>
        </div>
      )}
      <div className="turn-response">
        <strong className="turn-response-label">Copilot</strong>
        {segments.map((segment, index) =>
          segment.kind === "tools"
            ? showTools && (
                <ToolGroup
                  key={`tools:${segment.parts[0]?.id ?? index}`}
                  parts={segment.parts}
                />
              )
            : (
                <StructuredPart
                  key={`${segment.part.kind}:${segment.part.id}`}
                  part={segment.part}
                />
              )
        )}
      </div>
      {lastEvent && (
        <time className="turn-time" dateTime={lastEvent.createdAt}>
          {formatTime(lastEvent.createdAt)}
        </time>
      )}
    </article>
  )
}

function LegacyEventView({ event }: { event: AgentSessionEvent }) {
  return event.type === "message"
    ? (
        <article
          className={`conversation-message message-${event.role ?? "system"}`}
          aria-label={`${eventLabel(event)} message sent ${
            formatTime(event.createdAt)
          }`}
        >
          {event.role === "assistant"
            ? <MarkdownBody>{eventBody(event)}</MarkdownBody>
            : <p>{eventBody(event)}</p>}
          <time className="message-time" dateTime={event.createdAt}>
            {formatTime(event.createdAt)}
          </time>
        </article>
      )
    : (
        <div className="activity-event" data-type={event.type}>
          <span className="activity-event-marker" aria-hidden="true" />
          <div>
            <strong>{eventLabel(event)}</strong>
            <pre>{eventBody(event)}</pre>
          </div>
          <time dateTime={event.createdAt}>
            {formatRelativeTime(event.createdAt)}
          </time>
        </div>
      )
}

function initials(value: string | null): string {
  if (!value?.trim()) return "SM"
  return value
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function selectionFromLocation(): SessionSelection | null {
  const params = new URLSearchParams(window.location.search)
  const connectorId = params.get("connector")
  const sessionId = params.get("session")
  return connectorId && sessionId ? { connectorId, sessionId } : null
}

function updateLocationSelection(
  selection: SessionSelection | null,
  mode: "push" | "replace",
) {
  const url = new URL(window.location.href)
  if (selection) {
    url.searchParams.set("connector", selection.connectorId)
    url.searchParams.set("session", selection.sessionId)
  } else {
    url.searchParams.delete("connector")
    url.searchParams.delete("session")
  }
  window.history[mode === "push" ? "pushState" : "replaceState"](
    {},
    "",
    `${url.pathname}${url.search}${url.hash}`,
  )
}

function App() {
  const [account, setAccount] = useState<Account | null>(null)
  const [tokens, setTokens] = useState<ConnectionToken[]>([])
  const [browserSessions, setBrowserSessions] = useState<BrowserSession[]>([])
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([])
  const [history, setHistory] = useState<{
    key: string
    events: AgentSessionEvent[]
  } | null>(null)
  const [selection, setSelection] = useState<SessionSelection | null>(
    () => selectionFromLocation(),
  )
  const [loading, setLoading] = useState(true)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsLoadedForKey, setSessionsLoadedForKey] = useState<
    string | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState("My device")
  const [expiresInDays, setExpiresInDays] = useState("90")
  const [revealedToken, setRevealedToken] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState("")
  const [sessionPrompt, setSessionPrompt] = useState("")
  const [followUp, setFollowUp] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newSessionConnectorId, setNewSessionConnectorId] = useState<
    string | null
  >(null)
  const [sessionQuery, setSessionQuery] = useState("")
  const [sessionStatusView, setSessionStatusView] =
    useState<SessionStatusView>("all")
  const [showEndedSessions, setShowEndedSessions] = useState(false)
  const [showUnavailableSessions, setShowUnavailableSessions] = useState(false)
  const [deviceGroupingEnabled, setDeviceGroupingEnabled] = useState(false)
  const [collapsedSessionKeys, setCollapsedSessionKeys] =
    useState<Set<string>>(() => new Set())
  const [expandedDeviceIds, setExpandedDeviceIds] =
    useState<Set<string>>(() => new Set())
  const [showToolEvents, setShowToolEvents] = useState(false)
  const [mobileView, setMobileView] = useState<"list" | "session">(
    () => selectionFromLocation() ? "session" : "list",
  )
  const [trackedCommand, setTrackedCommand] =
    useState<TrackedCommand | null>(null)
  const [historySyncFailure, setHistorySyncFailure] = useState<{
    key: string
    message: string
  } | null>(null)
  const [historySyncAttempt, setHistorySyncAttempt] = useState(0)
  const historyRequests = useRef(new Set<string>())
  const followUpInputRef = useRef<HTMLTextAreaElement>(null)
  const selectedConnectorId = selection?.connectorId ?? null
  const selectedSessionId = selection?.sessionId ?? null
  const selectionKey = JSON.stringify([selectedConnectorId, selectedSessionId])
  const events = history?.key === selectionKey ? history.events : emptyEvents
  const accountSessionId = account?.sessionId
  const connectorIdKey = useMemo(
    () => connectors.map((connector) => connector.id).sort().join("|"),
    [connectors],
  )

  const resizeFollowUpInput = useCallback(() => {
    const input = followUpInputRef.current
    if (!input) return
    input.style.height = "auto"
    const contentHeight = input.scrollHeight
    const maxHeight = Number.parseFloat(
      window.getComputedStyle(input).maxHeight,
    )
    const nextHeight = Number.isFinite(maxHeight)
      ? Math.min(contentHeight, maxHeight)
      : contentHeight
    input.style.height = `${nextHeight}px`
    input.style.overflowY =
      Number.isFinite(maxHeight) && contentHeight > maxHeight
        ? "auto"
        : "hidden"
  }, [])

  useLayoutEffect(() => {
    resizeFollowUpInput()
  }, [followUp, mobileView, resizeFollowUpInput, selectedSessionId])

  useEffect(() => {
    window.addEventListener("resize", resizeFollowUpInput)
    return () => window.removeEventListener("resize", resizeFollowUpInput)
  }, [resizeFollowUpInput])

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
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Initial remote state loads after mount.
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!account) return
    let active = true
    const poll = async () => {
      try {
        const items = await api<Connector[]>("/api/connectors")
        if (active) setConnectors(items)
      } catch (caught) {
        if (active && caught instanceof Error) setError(caught.message)
      }
    }
    const timer = window.setInterval(() => void poll(), 5_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [account])

  useEffect(() => {
    if (!account) return
    const connectorIds = connectorIdKey ? connectorIdKey.split("|") : []
    if (connectorIds.length === 0) {
      // oxlint-disable-next-line react/set-state-in-effect -- The remote index is empty when no Devices exist.
      setAgentSessions([])
      setSessionsLoading(false)
      setSessionsLoadedForKey("")
      return
    }
    let active = true
    let firstLoad = true
    const poll = async () => {
      if (firstLoad) setSessionsLoading(true)
      try {
        const groups = await Promise.all(
          connectorIds.map((connectorId) =>
            api<AgentSession[]>(
              `/api/connectors/${encodeURIComponent(connectorId)}/sessions`,
            )
          ),
        )
        if (active) {
          setAgentSessions(groups.flat())
          setSessionsLoadedForKey(connectorIdKey)
        }
      } catch (caught) {
        if (active && caught instanceof Error) setError(caught.message)
      } finally {
        if (active && firstLoad) setSessionsLoading(false)
        firstLoad = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 3_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [account, connectorIdKey])

  useEffect(() => {
    if (
      !account
      || sessionsLoading
      || sessionsLoadedForKey !== connectorIdKey
    ) {
      return
    }
    if (
      selection
      && agentSessions.some(
        (session) =>
          session.connectorId === selection.connectorId
          && session.id === selection.sessionId,
      )
    ) {
      return
    }
    const requested = selectionFromLocation()
    const requestedSession = requested
      ? agentSessions.find(
          (session) =>
            session.connectorId === requested.connectorId
            && session.id === requested.sessionId,
        )
      : null
    const fallback = requestedSession ?? agentSessions[0] ?? null
    // oxlint-disable-next-line react/set-state-in-effect -- A replacement Session restores the default transcript filters.
    setShowToolEvents(false)
    // oxlint-disable-next-line react/set-state-in-effect -- Selection follows the latest remote Session index.
    setSelection(
      fallback
        ? { connectorId: fallback.connectorId, sessionId: fallback.id }
        : null,
    )
    if (requested && !requestedSession) updateLocationSelection(null, "replace")
  }, [
    account,
    agentSessions,
    connectorIdKey,
    selection,
    sessionsLoadedForKey,
    sessionsLoading,
  ])

  useEffect(() => {
    const handlePopState = () => {
      const nextSelection = selectionFromLocation()
      setShowToolEvents(false)
      setSelection(nextSelection)
      setMobileView(nextSelection ? "session" : "list")
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  const selectAgentSession = useCallback((session: AgentSession) => {
    const nextSelection = {
      connectorId: session.connectorId,
      sessionId: session.id,
    }
    setShowToolEvents(false)
    setSelection(nextSelection)
    setMobileView("session")
    updateLocationSelection(nextSelection, "push")
  }, [])

  const openSessionList = useCallback(() => {
    setMobileView("list")
    updateLocationSelection(null, "push")
  }, [])

  const selectedSessionAvailable = Boolean(
    selectedConnectorId
    && selectedSessionId
    && agentSessions.some(
      (session) =>
        session.connectorId === selectedConnectorId
        && session.id === selectedSessionId,
    ),
  )
  const selectedConnector = useMemo(
    () =>
      connectors.find((connector) => connector.id === selectedConnectorId)
      ?? null,
    [connectors, selectedConnectorId],
  )
  const selectedAgentSession = useMemo(
    () =>
      agentSessions.find(
        (session) =>
          session.connectorId === selectedConnectorId
          && session.id === selectedSessionId,
      ) ?? null,
    [agentSessions, selectedConnectorId, selectedSessionId],
  )
  const selectedSessionArchived = selectedAgentSession
    ? sessionIsArchived(selectedAgentSession)
    : false
  const transcriptItems = useMemo(
    () => buildTranscript(events),
    [events],
  )
  const toolEventCount = useMemo(
    () => transcriptToolCount(transcriptItems),
    [transcriptItems],
  )
  const visibleTranscriptItems = useMemo(
    () =>
      transcriptItems.filter((item) =>
        transcriptItemIsVisible(item, showToolEvents)
      ),
    [showToolEvents, transcriptItems],
  )
  const toolEventToggleLabel = showToolEvents
    ? "Hide tool messages"
    : `Show ${toolEventCount} tool ${
      toolEventCount === 1 ? "message" : "messages"
    }`
  const canSyncSelectedHistory = selectedConnector?.status === "online"
    && selectedConnector.capabilities.streamEvents

  useEffect(() => {
    if (
      !accountSessionId
      || !selectedConnectorId
      || !selectedSessionId
      || !selectedSessionAvailable
      || !canSyncSelectedHistory
    ) {
      return
    }
    let active = true
    const connectorId = encodeURIComponent(selectedConnectorId)
    const sessionId = encodeURIComponent(selectedSessionId)
    const requestHistory = async () => {
      if (historyRequests.current.has(selectionKey)) return
      historyRequests.current.add(selectionKey)
      setHistorySyncFailure((current) =>
        current?.key === selectionKey ? null : current
      )
      try {
        const result = await api<HistorySyncResponse>(
          `/api/connectors/${connectorId}/sessions/${sessionId}/events/sync`,
          { method: "POST" },
        )
        if (active && result.command) {
          setTrackedCommand({
            id: result.command.id,
            label: "History sync",
            status: result.command.status,
            historyRequestKey: selectionKey,
          })
        }
      } catch (caught) {
        historyRequests.current.delete(selectionKey)
        if (active && caught instanceof Error) {
          setHistorySyncFailure({ key: selectionKey, message: caught.message })
        }
      }
    }
    void requestHistory()
    return () => { active = false }
  }, [
    accountSessionId,
    canSyncSelectedHistory,
    selectedConnectorId,
    selectedSessionAvailable,
    selectedSessionId,
    selectionKey,
    historySyncAttempt,
  ])

  useEffect(() => {
    if (
      !accountSessionId
      || !selectedConnectorId
      || !selectedSessionId
      || !selectedSessionAvailable
    ) {
      return
    }
    let active = true
    let after = -1
    let loadedEvents: AgentSessionEvent[] = []
    const connectorId = encodeURIComponent(selectedConnectorId)
    const sessionId = encodeURIComponent(selectedSessionId)
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
        setHistory({ key: selectionKey, events: loadedEvents })
      } catch (caught) {
        if (active && caught instanceof Error) setError(caught.message)
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [
    accountSessionId,
    selectedConnectorId,
    selectedSessionAvailable,
    selectedSessionId,
    selectionKey,
  ])

  const connectorById = useMemo(
    () => new Map(connectors.map((connector) => [connector.id, connector])),
    [connectors],
  )
  const activeTokenByDevice = useMemo(
    () =>
      new Map(
        tokens
          .filter((token) => !token.revokedAt)
          .map((token) => [token.deviceId, token]),
      ),
    [tokens],
  )
  const sessionStatusCounts = useMemo(
    () => countSessionStatuses(agentSessions),
    [agentSessions],
  )
  const visibleAgentSessions = useMemo(
    () =>
      deriveVisibleSessions(agentSessions, connectorById, {
        query: sessionQuery,
        statusView: sessionStatusView,
        showEnded: showEndedSessions,
        showUnavailable: showUnavailableSessions,
        collapsedSessionKeys,
      }),
    [
      agentSessions,
      collapsedSessionKeys,
      connectorById,
      sessionQuery,
      sessionStatusView,
      showEndedSessions,
      showUnavailableSessions,
    ],
  )
  const sessionDeviceGroups = useMemo(
    () => groupSessionsByDevice(visibleAgentSessions, connectorById),
    [connectorById, visibleAgentSessions],
  )
  const visibleSessionCount = visibleAgentSessions.filter(
    (item) => !item.isContext,
  ).length
  const hasCustomSessionView =
    showEndedSessions || showUnavailableSessions || deviceGroupingEnabled
  const toggleSessionCollapsed = useCallback((session: AgentSession) => {
    const key = sessionKey(session)
    setCollapsedSessionKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const toggleDeviceExpanded = useCallback((connectorId: string) => {
    setExpandedDeviceIds((current) => {
      const next = new Set(current)
      if (next.has(connectorId)) next.delete(connectorId)
      else next.add(connectorId)
      return next
    })
  }, [])
  const enableDeviceGrouping = useCallback((enabled: boolean) => {
    setDeviceGroupingEnabled(enabled)
    if (!enabled) return
    setExpandedDeviceIds((current) => {
      if (current.size > 0) return current
      const preferred = selectedConnectorId ?? sessionDeviceGroups[0]?.source.id
      return preferred ? new Set([preferred]) : current
    })
  }, [
    selectedConnectorId,
    sessionDeviceGroups,
  ])
  const onlineCreateConnectors = useMemo(
    () =>
      connectors.filter(
        (connector) =>
          connector.status === "online"
          && connector.capabilities.createSession,
      ),
    [connectors],
  )
  const newSessionConnector = useMemo(
    () =>
      onlineCreateConnectors.find(
        (connector) => connector.id === newSessionConnectorId,
      ) ?? null,
    [newSessionConnectorId, onlineCreateConnectors],
  )
  const canSendFollowUp = selectedConnector?.status === "online"
    && selectedConnector.capabilities.sendMessage
    && selectedAgentSession?.canSendMessage !== false
  const trackedCommandId = trackedCommand?.id ?? null
  const trackedCommandLabel = trackedCommand?.label ?? null
  const trackedHistoryRequestKey = trackedCommand?.historyRequestKey ?? null

  useEffect(() => {
    if (!trackedCommandId || !trackedCommandLabel) return
    let active = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const result = await api<CommandStatus>(
          `/api/commands/${encodeURIComponent(trackedCommandId)}`,
        )
        if (!active) return
        if (result.status === "succeeded") {
          if (timer !== undefined) window.clearInterval(timer)
          setTrackedCommand(null)
          setNotice(`${trackedCommandLabel} completed.`)
          if (trackedHistoryRequestKey) {
            setHistorySyncFailure((current) =>
              current?.key === trackedHistoryRequestKey ? null : current
            )
          }
          setError(null)
          return
        }
        if (result.status === "failed") {
          if (timer !== undefined) window.clearInterval(timer)
          setTrackedCommand(null)
          const message = result.error?.message
            || result.error?.code
            || `${trackedCommandLabel} failed.`
          setNotice(null)
          if (trackedHistoryRequestKey) {
            historyRequests.current.delete(trackedHistoryRequestKey)
            setHistorySyncFailure({
              key: trackedHistoryRequestKey,
              message,
            })
          } else {
            setError(message)
          }
          return
        }
        setTrackedCommand((current) =>
          current?.id === result.id
            ? { ...current, status: result.status }
            : current
        )
      } catch (caught) {
        if (active && caught instanceof Error) setError(caught.message)
      }
    }
    void poll()
    timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [trackedCommandId, trackedCommandLabel, trackedHistoryRequestKey])

  function openNewSession() {
    const preferred =
      onlineCreateConnectors.find(
        (connector) => connector.id === selectedConnectorId,
      ) ?? onlineCreateConnectors[0] ?? null
    setNewSessionConnectorId(preferred?.id ?? null)
    setNewSessionOpen(true)
  }

  async function createAgentSession(event: React.FormEvent) {
    event.preventDefault()
    if (!newSessionConnector || !sessionPrompt.trim() || trackedCommand) return
    setBusyAction("create-session")
    setNotice(null)
    setError(null)
    try {
      const connectorId = encodeURIComponent(newSessionConnector.id)
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
      setNewSessionOpen(false)
      setTrackedCommand({
        id: result.command.id,
        label: "Session",
        status: result.command.status,
      })
      setNotice(`Starting a Session on ${newSessionConnector.displayName}...`)
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
    if (
      !selectedConnector
      || !selectedAgentSession
      || !canSendFollowUp
      || !followUp.trim()
      || trackedCommand
    ) {
      return
    }
    setBusyAction("send-message")
    setNotice(null)
    setError(null)
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
      setTrackedCommand({
        id: result.command.id,
        label: "Follow-up",
        status: result.command.status,
      })
      setNotice("Delivering your follow-up...")
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
    setError(null)
    try {
      const result = await api<{ token: string; metadata: ConnectionToken }>(
        "/api/tokens",
        {
          method: "POST",
          body: JSON.stringify({
            name: deviceName,
            expiresInDays: expiresInDays ? Number(expiresInDays) : null,
          }),
        },
      )
      setRevealedToken(
        `version: 1\nrelay: ${relayOrigin}\ntoken: ${result.token}\n`,
      )
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Token creation failed")
    } finally {
      setBusyAction(null)
    }
  }

  async function revokeConnectionToken(id: string) {
    setError(null)
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
    setError(null)
    try {
      const result = await api<{ token: string }>(
        `/api/tokens/${id}/rotate`,
        { method: "POST" },
      )
      setRevealedToken(
        `version: 1\nrelay: ${relayOrigin}\ntoken: ${result.token}\n`,
      )
      await refresh()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Token rotation failed",
      )
    }
  }

  async function logout() {
    setError(null)
    try {
      await api("/api/logout", { method: "POST" })
      clearAuthenticatedState()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign out failed")
    }
  }

  function clearAuthenticatedState() {
    setAccount(null)
    setConnectors([])
    setAgentSessions([])
    setSessionsLoadedForKey(null)
    setHistory(null)
    setShowToolEvents(false)
    setSelection(null)
    setTrackedCommand(null)
    setSettingsOpen(false)
    setMobileView("list")
    updateLocationSelection(null, "replace")
  }

  async function copyRevealedToken() {
    if (!revealedToken) return
    try {
      await navigator.clipboard.writeText(revealedToken)
      setNotice("Connection token copied.")
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Copy failed")
    }
  }

  async function revokeBrowserSession(id: string) {
    setError(null)
    try {
      const revokingCurrent = browserSessions.some(
        (session) => session.id === id && session.current,
      )
      await api(`/api/sessions/${id}`, { method: "DELETE" })
      if (revokingCurrent) {
        clearAuthenticatedState()
      } else {
        await refresh()
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Session revocation failed",
      )
    }
  }

  async function unlinkIdentity(provider: Provider) {
    setError(null)
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
        <p className="text-muted-foreground">Loading your relay...</p>
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

  const accountName =
    account.user.displayName
    ?? account.identities[0]?.displayName
    ?? account.identities[0]?.email
    ?? "Relay user"
  const accountDetail =
    account.identities.find((identity) => identity.email)?.email
    ?? "Signed in"
  const onlineConnectorCount = connectors.filter(
    (connector) => connector.status === "online",
  ).length

  const renderSessionRow = (
    item: OrderedSession<AgentSession>,
    groupedByDevice: boolean,
  ) => {
    const { session } = item
    const connector = connectorById.get(session.connectorId)
    const isSelected =
      session.connectorId === selectedConnectorId
      && session.id === selectedSessionId
    const isCollapsed = collapsedSessionKeys.has(sessionKey(session))
    return (
      <div
        key={`${session.connectorId}:${session.id}`}
        className={`session-list-item${isSelected ? " is-selected" : ""}${item.isSubsession ? " is-subsession" : ""}${item.hasChildren ? " has-children" : ""}${item.isLastChild ? " is-last-child" : ""}${item.isContext ? " is-context" : ""}`}
      >
        <span className="session-tree-control">
          <span
            className="session-state-dot"
            data-status={session.status}
            aria-hidden="true"
          />
          {item.hasChildren && (
            <button
              type="button"
              className="session-tree-toggle"
              onClick={() => toggleSessionCollapsed(session)}
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${
                sessionLabel(session)
              }`}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed
                ? <ChevronRight aria-hidden="true" />
                : <ChevronDown aria-hidden="true" />}
            </button>
          )}
        </span>
        <button
          type="button"
          className="session-item-select"
          onClick={() => selectAgentSession(session)}
          aria-current={isSelected ? "page" : undefined}
        >
          <span className="session-item-main">
            <span className="session-item-title-line">
              <span className="session-item-title">
                {sessionLabel(session)}
              </span>
              {item.hasChildren && (
                <span className="session-child-count" aria-label="Has children">
                  {
                    visibleAgentSessions.filter((candidate) =>
                      candidate.session.connectorId === session.connectorId
                      && candidate.session.parentSessionId === session.id
                    ).length
                  }
                </span>
              )}
              {item.isContext && (
                <span className="session-context-label">Context</span>
              )}
            </span>
            <span
              className="session-item-meta"
              title={session.nativeStatus
                ? `Agent status: ${session.nativeStatus}`
                : undefined}
            >
              <span className="session-item-status">
                {sessionStatusLabel(session.status)}
              </span>
              {!groupedByDevice && (
                <span className="device-tag">
                  <Laptop aria-hidden="true" />
                  {connector?.displayName ?? "Unknown device"}
                </span>
              )}
            </span>
            {session.lastMessagePreview && !item.isContext && (
              <span className="session-item-preview">
                {session.lastMessagePreview}
              </span>
            )}
          </span>
          <time
            className="session-item-time"
            dateTime={session.lastActivityAt}
            title={formatTime(session.lastActivityAt)}
          >
            {formatRelativeTime(session.lastActivityAt)}
          </time>
        </button>
      </div>
    )
  }

  return (
    <>
      <main className={`relay-app mobile-view-${mobileView}`}>
        <header className="relay-brand">
          <RelayMark />
          <div className="brand-lockup">
            <strong>Silvermoon</strong>
            <span>Relay</span>
          </div>
        </header>

        <header className="session-topbar">
          <div className="mobile-topbar-context">
            {mobileView === "session" && (
              <button
                type="button"
                className="mobile-back-button"
                onClick={openSessionList}
                aria-label="Back to Sessions"
              >
                <ArrowLeft aria-hidden="true" />
              </button>
            )}
            <RelayMark compact />
            <span>{mobileView === "session" ? "Session" : "Sessions"}</span>
          </div>

          <div className="desktop-session-context">
            {selectedAgentSession
              ? (
                  <>
                    <div className="session-heading-copy">
                      <h1>{sessionLabel(selectedAgentSession)}</h1>
                      <span>
                        {selectedConnector?.displayName
                          ?? "Unknown device"}
                      </span>
                    </div>
                    <SessionStatus
                      status={selectedAgentSession.status}
                      nativeStatus={selectedAgentSession.nativeStatus}
                    />
                  </>
                )
              : (
                  <div className="session-heading-copy">
                    <h1>Select a Session</h1>
                    <span>Choose active work from the Session list</span>
                  </div>
                )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="account-trigger"
                aria-label={`Account menu for ${accountName}`}
              >
                <span className="account-avatar" aria-hidden="true">
                  {account.user.avatarUrl
                    ? <img src={account.user.avatarUrl} alt="" />
                    : initials(accountName)}
                </span>
                <span className="account-trigger-copy">
                  <strong>{accountName}</strong>
                  <span>{accountDetail}</span>
                </span>
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="account-menu">
              <DropdownMenuLabel>
                <span className="account-menu-name">{accountName}</span>
                <span className="account-menu-detail">{accountDetail}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                <Settings aria-hidden="true" />
                Account and connections
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => void logout()}
              >
                <LogOut aria-hidden="true" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <aside className="session-rail" aria-label="Sessions">
          <div className="session-rail-heading">
            <div>
              <h2>Sessions</h2>
              <p>
                {visibleSessionCount === 1
                  ? "1 current session"
                  : `${visibleSessionCount} current sessions`}
              </p>
            </div>
            <Button
              size="icon"
              className="new-session-button"
              onClick={openNewSession}
              disabled={onlineCreateConnectors.length === 0}
              title={
                onlineCreateConnectors.length === 0
                  ? "No online Device can create Sessions"
                  : "New Session"
              }
            >
              <Plus aria-hidden="true" />
              <span className="sr-only">New Session</span>
            </Button>
          </div>

          <div className="session-rail-tools">
            <label className="session-search">
              <Search aria-hidden="true" />
              <Input
                value={sessionQuery}
                onChange={(event) => setSessionQuery(event.target.value)}
                placeholder="Search Sessions, Agents, Devices"
                aria-label="Search Sessions, Agents, and Devices"
              />
            </label>
            <div className="session-filters" aria-label="Session filters">
              <button
                type="button"
                aria-pressed={sessionStatusView === "all"}
                onClick={() => setSessionStatusView("all")}
              >
                All
              </button>
              {sessionStatusCounts.active > 0 && (
                <button
                  type="button"
                  aria-pressed={sessionStatusView === "active"}
                  onClick={() => setSessionStatusView("active")}
                >
                  Active {sessionStatusCounts.active}
                </button>
              )}
              {sessionStatusCounts.waiting > 0 && (
                <button
                  type="button"
                  className="is-waiting"
                  aria-pressed={sessionStatusView === "waiting"}
                  onClick={() => setSessionStatusView("waiting")}
                >
                  Needs input {sessionStatusCounts.waiting}
                </button>
              )}
              {sessionStatusCounts.failed > 0 && (
                <button
                  type="button"
                  className="is-failed"
                  aria-pressed={sessionStatusView === "failed"}
                  onClick={() => setSessionStatusView("failed")}
                >
                  Failed {sessionStatusCounts.failed}
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="session-view-trigger"
                    data-active={hasCustomSessionView || undefined}
                    aria-label="Session view options"
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="session-view-menu"
                >
                  <DropdownMenuCheckboxItem
                    checked={showEndedSessions}
                    onCheckedChange={(checked) =>
                      setShowEndedSessions(checked === true)}
                  >
                    Show ended
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showUnavailableSessions}
                    onCheckedChange={(checked) =>
                      setShowUnavailableSessions(checked === true)}
                  >
                    Show unavailable
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={deviceGroupingEnabled}
                    onCheckedChange={(checked) =>
                      enableDeviceGrouping(checked === true)}
                  >
                    Group by Device
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="session-list">
            {sessionsLoading && agentSessions.length === 0 && (
              <div className="session-list-state" role="status">
                <LoaderCircle className="animate-spin" aria-hidden="true" />
                <strong>Loading Sessions</strong>
                <span>Reading recent work from your Devices.</span>
              </div>
            )}

            {!sessionsLoading && agentSessions.length === 0 && (
              <div className="session-list-state">
                <Laptop aria-hidden="true" />
                <strong>No Sessions yet</strong>
                <span>
                  Bring a Device online, then start the first Session.
                </span>
                {onlineCreateConnectors.length > 0 && (
                  <Button size="sm" onClick={openNewSession}>
                    <Plus aria-hidden="true" />
                    New Session
                  </Button>
                )}
              </div>
            )}

            {agentSessions.length > 0 && visibleAgentSessions.length === 0 && (
              <div className="session-list-state">
                <Search aria-hidden="true" />
                <strong>No matching Sessions</strong>
                <span>Try a different search or show all states.</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSessionQuery("")
                    setSessionStatusView("all")
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}

            {deviceGroupingEnabled
              ? sessionDeviceGroups.map((group, groupIndex) => {
                  const expanded = expandedDeviceIds.has(group.source.id)
                    || (
                      expandedDeviceIds.size === 0
                      && groupIndex === 0
                    )
                  const groupCounts = countSessionStatuses(
                    group.sessions.map((item) => item.session),
                  )
                  return (
                    <section
                      className="session-device-group"
                      key={group.source.id}
                      aria-labelledby={`device-${group.source.id}`}
                    >
                      <button
                        type="button"
                        className="session-device-heading"
                        onClick={() => toggleDeviceExpanded(group.source.id)}
                        aria-expanded={expanded}
                      >
                        {expanded
                          ? <ChevronDown aria-hidden="true" />
                          : <ChevronRight aria-hidden="true" />}
                        <strong id={`device-${group.source.id}`}>
                          {group.source.displayName}
                        </strong>
                        <span>{group.sessions.length}</span>
                        <span className="session-device-alerts">
                          {groupCounts.waiting > 0
                            && `${groupCounts.waiting} input`}
                          {groupCounts.waiting > 0 && groupCounts.failed > 0
                            && " · "}
                          {groupCounts.failed > 0
                            && `${groupCounts.failed} failed`}
                        </span>
                        <span
                          className="session-device-status"
                          data-status={group.source.status}
                        >
                          {group.source.status}
                        </span>
                      </button>
                      {expanded && group.sessions.map((item) =>
                        renderSessionRow(item, true)
                      )}
                    </section>
                  )
                })
              : visibleAgentSessions.map((item) =>
                  renderSessionRow(item, false)
                )}
          </div>

          <div className="session-rail-footer">
            <span>
              <span className="online-pin" aria-hidden="true" />
              {onlineConnectorCount} online
            </span>
            <button type="button" onClick={() => setSettingsOpen(true)}>
              {connectors.length === 1
                ? "1 Device"
                : `${connectors.length} Devices`}
            </button>
          </div>
        </aside>

        <section className="session-workspace" aria-label="Session workspace">
          {!selectedAgentSession
            ? (
                <div className="workspace-empty">
                  <RelayMark />
                  <h2>Select a Session to continue</h2>
                  <p>
                    The Session list keeps work from every Device in one place.
                  </p>
                </div>
              )
            : (
                <>
                  <div className="mobile-session-meta">
                    <div>
                      <h1>{sessionLabel(selectedAgentSession)}</h1>
                      <span>
                        {selectedConnector?.displayName ?? "Unknown device"}
                      </span>
                    </div>
                    <SessionStatus
                      status={selectedAgentSession.status}
                      nativeStatus={selectedAgentSession.nativeStatus}
                    />
                  </div>

                  <TranscriptScroll key={selectionKey}>
                      <div className="transcript-origin">
                        <span>Session opened</span>
                        <time dateTime={selectedAgentSession.createdAt}>
                          {formatTime(selectedAgentSession.createdAt)}
                        </time>
                        <span>
                          on {selectedConnector?.displayName ?? "Unknown device"}
                        </span>
                        {toolEventCount > 0 && (
                          <button
                            type="button"
                            className="transcript-tool-toggle"
                            aria-pressed={showToolEvents}
                            aria-label={toolEventToggleLabel}
                            onClick={() =>
                              setShowToolEvents((visible) => !visible)}
                          >
                            <Wrench aria-hidden="true" />
                            {toolEventToggleLabel}
                          </button>
                        )}
                      </div>

                      {selectedSessionArchived && (
                        <div className="history-state-notice" role="status">
                          <strong>This Session is archived and read-only.</strong>
                          <span>Its saved activity remains available.</span>
                        </div>
                      )}

                      {historySyncFailure?.key === selectionKey && (
                        <div
                          className="history-state-notice is-error"
                          role="alert"
                        >
                          <CircleAlert aria-hidden="true" />
                          <span>
                            <strong>History sync failed.</strong>
                            {historySyncFailure.message}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              historyRequests.current.delete(selectionKey)
                              setHistorySyncFailure(null)
                              setHistorySyncAttempt((attempt) => attempt + 1)
                            }}
                          >
                            Retry sync
                          </button>
                        </div>
                      )}

                      {events.length === 0 && (
                        <div className="transcript-empty" role="status">
                          {selectedConnector?.status === "offline"
                            ? <WifiOff aria-hidden="true" />
                            : <LoaderCircle className="animate-spin" aria-hidden="true" />}
                          <strong>
                            {selectedConnector?.status === "offline"
                              ? "Device is offline"
                              : "Waiting for activity"}
                          </strong>
                          <span>
                            {selectedConnector?.status === "offline"
                              ? "Recent events remain available. Reconnect the Device to continue."
                              : "Events will appear here as the agent works."}
                          </span>
                        </div>
                      )}

                      {events.length > 0
                        && visibleTranscriptItems.length === 0 && (
                        <div
                          className="transcript-empty transcript-empty-filtered"
                          role="status"
                        >
                          <Wrench aria-hidden="true" />
                          <strong>Tool messages are hidden</strong>
                          <span>
                            Use the control above to inspect tool activity for
                            this Session.
                          </span>
                        </div>
                      )}

                      {visibleTranscriptItems.map((item) =>
                        item.kind === "turn"
                          ? (
                              <TranscriptTurnView
                                key={`turn:${item.id}`}
                                turn={item}
                                showTools={showToolEvents}
                              />
                            )
                          : (
                              <LegacyEventView
                                key={`event:${item.event.id}`}
                                event={item.event}
                              />
                            )
                      )}
                  </TranscriptScroll>

                  <div className="session-composer-shell">
                    <form className="session-composer" onSubmit={sendFollowUp}>
                      <div className="composer-frame">
                        <label htmlFor="session-follow-up" className="sr-only">
                          Follow-up message
                        </label>
                        <Textarea
                          ref={followUpInputRef}
                          id="session-follow-up"
                          value={followUp}
                          onChange={(event) => setFollowUp(event.target.value)}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter"
                              && !event.shiftKey
                              && !event.nativeEvent.isComposing
                            ) {
                              event.preventDefault()
                              event.currentTarget.form?.requestSubmit()
                            }
                          }}
                          placeholder={
                            selectedAgentSession.canSendMessage === false
                              ? "This Session is read-only"
                              : canSendFollowUp
                              ? "Ask for the next step... Shift+Enter for a new line."
                              : "This Session cannot receive messages right now"
                          }
                          rows={2}
                          disabled={!canSendFollowUp}
                        />
                        <div className="composer-toolbar">
                          <div className="composer-status" aria-live="polite">
                            {trackedCommand
                              ? (
                                  <>
                                    <LoaderCircle
                                      className="animate-spin"
                                      aria-hidden="true"
                                    />
                                    {trackedCommand.label}{" "}
                                    {trackedCommand.status}
                                  </>
                                )
                              : selectedConnector?.status === "offline"
                              ? (
                                  <>
                                    <WifiOff aria-hidden="true" />
                                    Reconnect {selectedConnector.displayName} to
                                    send a follow-up.
                                  </>
                                )
                              : (
                                  <>
                                    <Laptop aria-hidden="true" />
                                    Send to{" "}
                                    {selectedConnector?.displayName
                                      ?? "current Device"}
                                  </>
                                )}
                          </div>
                          <Button
                            type="submit"
                            size="icon"
                            className="composer-send"
                            disabled={
                              !followUp.trim()
                              || !canSendFollowUp
                              || busyAction === "send-message"
                              || Boolean(trackedCommand)
                            }
                          >
                            {busyAction === "send-message"
                              ? (
                                  <LoaderCircle
                                    className="animate-spin"
                                    aria-hidden="true"
                                  />
                                )
                              : <Send aria-hidden="true" />}
                            <span className="sr-only">Send follow-up</span>
                          </Button>
                        </div>
                      </div>
                    </form>
                  </div>
                </>
              )}
        </section>
      </main>

      <div className="relay-notifications" aria-live="polite">
        {error && (
          <div className="relay-notice is-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )}
        {!error && notice && (
          <div className="relay-notice is-success" role="status">
            {trackedCommand
              ? <LoaderCircle className="animate-spin" aria-hidden="true" />
              : <Check aria-hidden="true" />}
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notification"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <Dialog open={newSessionOpen} onOpenChange={setNewSessionOpen}>
        <DialogContent className="new-session-dialog">
          <DialogHeader>
            <DialogTitle>Start a new Session</DialogTitle>
            <DialogDescription>
              Choose the Device that will own this agent Session, then give it
              the first instruction.
            </DialogDescription>
          </DialogHeader>
          <form className="dialog-form" onSubmit={createAgentSession}>
            <label className="field-stack">
              <span>Device</span>
              <select
                value={newSessionConnectorId ?? ""}
                onChange={(event) =>
                  setNewSessionConnectorId(event.target.value || null)}
                disabled={onlineCreateConnectors.length === 0}
                required
              >
                <option value="" disabled>Select an online Device</option>
                {onlineCreateConnectors.map((connector) => (
                  <option key={connector.id} value={connector.id}>
                    {connector.displayName}
                  </option>
                ))}
              </select>
            </label>
            {onlineCreateConnectors.length === 0 && (
              <div className="inline-callout">
                <WifiOff aria-hidden="true" />
                No online Device currently supports Session creation.
              </div>
            )}
            <label className="field-stack">
              <span>Title <small>Optional</small></span>
              <Input
                value={sessionTitle}
                onChange={(event) => setSessionTitle(event.target.value)}
                placeholder="Review the release plan"
              />
            </label>
            <label className="field-stack">
              <span>First instruction</span>
              <Textarea
                value={sessionPrompt}
                onChange={(event) => setSessionPrompt(event.target.value)}
                placeholder="Describe the outcome you want from the agent..."
                rows={5}
                required
              />
            </label>
            <DialogFooter className="dialog-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewSessionOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !newSessionConnector
                  || !sessionPrompt.trim()
                  || busyAction === "create-session"
                  || Boolean(trackedCommand)
                }
              >
                {busyAction === "create-session"
                  ? (
                      <LoaderCircle
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    )
                  : <Plus aria-hidden="true" />}
                Start Session
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="settings-dialog">
          <DialogHeader className="settings-dialog-header">
            <DialogTitle>Devices</DialogTitle>
            <DialogDescription>
              Add and manage devices that can connect to this account.
            </DialogDescription>
          </DialogHeader>

          <div className="settings-scroll">
            <Card className="settings-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus aria-hidden="true" />
                  Add device
                </CardTitle>
                <CardDescription>
                  Name the device once. Relay keeps this name with its token.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div className="token-create-grid">
                  <label className="field-stack">
                    <span>Device name</span>
                    <Input
                      value={deviceName}
                      onChange={(event) => setDeviceName(event.target.value)}
                    />
                  </label>
                  <label className="field-stack">
                    <span>Expires in days</span>
                    <Input
                      type="number"
                      min="1"
                      value={expiresInDays}
                      onChange={(event) => setExpiresInDays(event.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    onClick={() => void createConnectionToken()}
                    disabled={busyAction === "create-token" || !deviceName.trim()}
                  >
                    {busyAction === "create-token"
                      ? (
                          <LoaderCircle
                            className="animate-spin"
                            aria-hidden="true"
                          />
                        )
                      : <Plus aria-hidden="true" />}
                    Add device
                  </Button>
                </div>

                {revealedToken && (
                  <div className="token-reveal">
                    <div>
                      <strong>Copy this connector profile now</strong>
                      <span>
                        Save it as ~/.silvermoon/connector.yaml. The token will
                        not be shown again after you close it.
                      </span>
                    </div>
                    <code>{revealedToken}</code>
                    <div className="token-reveal-actions">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void copyRevealedToken()}
                      >
                        <Copy aria-hidden="true" />
                        Copy profile
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setRevealedToken(null)}
                      >
                        Hide
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="settings-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Laptop aria-hidden="true" />
                  Devices
                </CardTitle>
                <CardDescription>
                  Each Agent Session and connection token belongs to one Device.
                </CardDescription>
              </CardHeader>
              <CardContent className="settings-list">
                {connectors.length === 0 && (
                  <p className="settings-empty">
                    No Device has been added to this account yet.
                  </p>
                )}
                {connectors.map((connector) => {
                  const token = activeTokenByDevice.get(connector.id)
                  return (
                    <div className="settings-list-row" key={connector.id}>
                      <div className="settings-row-main">
                        <span
                          className="connector-status-dot"
                          data-status={connector.status}
                          aria-hidden="true"
                        />
                        <div>
                          <strong>{connector.displayName}</strong>
                          <span>
                            {connector.agent
                              ? `${connector.agent.name}${connector.agent.version ? ` ${connector.agent.version}` : ""}`
                              : "Not connected yet"}
                            {" · "}
                            {connector.sessionCount}{" "}
                            {connector.sessionCount === 1
                              ? "Session"
                              : "Sessions"}
                          </span>
                          <span>
                            {token
                              ? `${token.tokenHint} · Last used ${formatTime(token.lastUsedAt)}`
                              : "No active connection token"}
                          </span>
                        </div>
                      </div>
                      <div className="settings-row-actions">
                        <Badge variant="outline">{connector.status}</Badge>
                        {token && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void rotateConnectionToken(token.id)}
                            >
                              Rotate token
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void revokeConnectionToken(token.id)}
                            >
                              Revoke
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            <Card className="settings-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck aria-hidden="true" />
                  Linked identities
                </CardTitle>
                <CardDescription>
                  Keep at least one provider linked to sign in.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="settings-list">
                  {account.identities.map((identity) => (
                    <div
                      className="settings-list-row"
                      key={identity.provider}
                    >
                      <div>
                        <strong>{providerLabels[identity.provider]}</strong>
                        <span>
                          {identity.email
                            ?? identity.displayName
                            ?? "No profile email"}
                        </span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={account.identities.length <= 1}
                        onClick={() => void unlinkIdentity(identity.provider)}
                      >
                        Unlink
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="provider-links">
                  {(["google", "microsoft", "github"] as const)
                    .filter(
                      (provider) =>
                        !account.identities.some(
                          (identity) => identity.provider === provider,
                        ),
                    )
                    .map((provider) => (
                      <Button key={provider} asChild variant="outline" size="sm">
                        <a
                          href={`${relayOrigin}/auth/${provider}/start?mode=link`}
                        >
                          <Link2 aria-hidden="true" />
                          Link {providerLabels[provider]}
                        </a>
                      </Button>
                    ))}
                </div>
              </CardContent>
            </Card>

            <Card className="settings-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserRound aria-hidden="true" />
                  Browser sessions
                </CardTitle>
                <CardDescription>
                  Revoke browsers that should no longer access the relay.
                </CardDescription>
              </CardHeader>
              <CardContent className="settings-list">
                {browserSessions
                  .filter((session) => !session.revokedAt)
                  .map((session) => (
                    <div className="settings-list-row" key={session.id}>
                      <div>
                        <strong>
                          {session.current ? "This browser" : "Signed-in browser"}
                        </strong>
                        <span>
                          {session.userAgent ?? "Unknown browser"} · Expires{" "}
                          {formatTime(session.expiresAt)}
                        </span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={session.current ? "destructive" : "outline"}
                        onClick={() => void revokeBrowserSession(session.id)}
                      >
                        {session.current ? "Sign out here" : "Revoke"}
                      </Button>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function RelayMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`relay-mark${compact ? " is-compact" : ""}`}
      aria-hidden="true"
    >
      <span />
      <span />
    </span>
  )
}

function SessionStatus({
  status,
  nativeStatus,
}: {
  status: string
  nativeStatus?: string | null
}) {
  return (
    <span
      className="session-status"
      data-status={status}
      title={nativeStatus ? `Agent status: ${nativeStatus}` : undefined}
    >
      <span aria-hidden="true" />
      {sessionStatusLabel(status)}
    </span>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--relay-paper)] px-4 py-6 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-6">
        {children}
      </div>
    </main>
  )
}

export default App
