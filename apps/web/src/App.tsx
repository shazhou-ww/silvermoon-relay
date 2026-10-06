import { useCallback, useEffect, useState } from "react"
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
  if (!response.ok) throw new Error(value.error ?? `Request failed: ${response.status}`)
  return value
}

function App() {
  const [account, setAccount] = useState<Account | null>(null)
  const [tokens, setTokens] = useState<ConnectionToken[]>([])
  const [sessions, setSessions] = useState<BrowserSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState("My daemon")
  const [expiresInDays, setExpiresInDays] = useState("90")
  const [revealedToken, setRevealedToken] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const current = await api<Account>("/api/me")
      const [tokenItems, sessionItems] = await Promise.all([
        api<ConnectionToken[]>("/api/tokens"),
        api<BrowserSession[]>("/api/sessions"),
      ])
      setAccount(current)
      setTokens(tokenItems)
      setSessions(sessionItems)
      setError(null)
    } catch (caught) {
      if (caught instanceof Error && caught.message === "authentication-required") {
        setAccount(null)
      } else if (caught instanceof Error) {
        setError(caught.message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function createConnectionToken() {
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
    }
  }

  async function revokeConnectionToken(id: string) {
    try {
      await api(`/api/tokens/${id}`, { method: "DELETE" })
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Token revocation failed")
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
      setError(caught instanceof Error ? caught.message : "Token rotation failed")
    }
  }

  async function logout() {
    try {
      await api("/api/logout", { method: "POST" })
      setAccount(null)
      setTokens([])
      setSessions([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign out failed")
    }
  }

  async function revokeBrowserSession(id: string) {
    try {
      await api(`/api/sessions/${id}`, { method: "DELETE" })
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Session revocation failed")
    }
  }

  async function unlinkIdentity(provider: Provider) {
    try {
      await api(`/api/identities/${provider}`, { method: "DELETE" })
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Identity unlink failed")
    }
  }

  if (loading) {
    return <Shell><p className="text-muted-foreground">Loading account…</p></Shell>
  }

  if (!account) {
    return (
      <Shell>
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <Card>
            <CardHeader>
              <Badge className="mb-4 w-fit">Secure relay access</Badge>
              <CardTitle className="text-3xl sm:text-5xl">
                Connect your Silvermoon identity.
              </CardTitle>
              <CardDescription className="max-w-xl text-base">
                Sign in to create and revoke connection tokens for your daemons.
                Provider credentials are never shared with the relay protocol.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>Choose an identity provider.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {(["google", "microsoft", "github"] as const).map((provider) => (
                <Button asChild key={provider} variant="outline" className="w-full">
                  <a href={`${relayOrigin}/auth/${provider}/start`}>
                    Continue with {providerLabels[provider]}
                  </a>
                </Button>
              ))}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </CardContent>
          </Card>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <header className="flex flex-col gap-4 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
            Security console
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">
            {account.user.displayName ?? "Silvermoon account"}
          </h1>
        </div>
        <Button variant="outline" onClick={() => void logout()}>Sign out</Button>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Connected identities</CardTitle>
            <CardDescription>
              Identities are linked by provider subject, never by matching email.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(["google", "microsoft", "github"] as const).map((provider) => {
              const identity = account.identities.find((item) => item.provider === provider)
              return (
                <div key={provider} className="flex items-center justify-between gap-4 rounded-xl border p-3">
                  <div>
                    <p className="font-medium">{providerLabels[provider]}</p>
                    <p className="text-sm text-muted-foreground">
                      {identity?.email ?? (identity ? "No email shared" : "Not linked")}
                    </p>
                  </div>
                  {identity ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Linked</Badge>
                      {account.identities.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void unlinkIdentity(provider)}
                        >
                          Unlink
                        </Button>
                      )}
                    </div>
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
            <CardTitle>Browser sessions</CardTitle>
            <CardDescription>Revoke sessions you no longer recognize.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sessions.filter((session) => !session.revokedAt).map((session) => (
              <div key={session.id} className="flex items-center justify-between gap-4 rounded-xl border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {session.userAgent ?? "Unknown browser"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Expires {new Date(session.expiresAt).toLocaleDateString()}
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
      </section>

      <Card>
        <CardHeader>
          <CardTitle>New connection token</CardTitle>
          <CardDescription>
            The complete token is shown once. Store it in the daemon’s protected user config.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
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
          <Button onClick={() => void createConnectionToken()}>Create token</Button>
        </CardContent>
      </Card>

      {revealedToken && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>Copy this token now</CardTitle>
            <CardDescription>
              It cannot be recovered after you dismiss this panel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="block overflow-x-auto rounded-lg bg-muted p-3 font-mono text-sm">
              {revealedToken}
            </code>
            <div className="flex gap-2">
              <Button onClick={() => void navigator.clipboard.writeText(revealedToken)}>
                Copy token
              </Button>
              <Button variant="outline" onClick={() => setRevealedToken(null)}>
                I have saved it
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Connection tokens</CardTitle>
          <CardDescription>
            Revocation prevents new handshakes and closes matching online daemons.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {tokens.length === 0 && (
            <p className="text-sm text-muted-foreground">No connection tokens yet.</p>
          )}
          {tokens.map((token) => (
            <div key={token.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{token.label}</p>
                  {token.revokedAt && <Badge variant="secondary">Revoked</Badge>}
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  smr1_{token.id}_••••{token.tokenHint}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {token.expiresAt
                    ? `Expires ${new Date(token.expiresAt).toLocaleDateString()}`
                    : "No expiration"}
                  {token.lastUsedAt
                    ? ` · Used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                    : " · Never used"}
                </p>
              </div>
              {!token.revokedAt && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void rotateConnectionToken(token.id)}>
                    Rotate
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void revokeConnectionToken(token.id)}>
                    Revoke
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-7 px-5 py-8 sm:px-8 lg:py-14">
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="size-3 rounded-full bg-primary shadow-[0_0_24px_var(--primary)]" />
          <span className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
            Silvermoon Relay
          </span>
        </div>
        {children}
      </div>
    </main>
  )
}

export default App
