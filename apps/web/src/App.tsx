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

function App() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-8 sm:px-8 lg:py-14">
        <header className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                className="size-3 rounded-full bg-primary shadow-[0_0_24px_var(--primary)]"
              />
              <span className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Silvermoon Relay
              </span>
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
              Daemon command,
              <span className="block text-muted-foreground">without the orbit drift.</span>
            </h1>
          </div>
          <Badge variant="secondary" className="w-fit">
            Scaffold environment
          </Badge>
        </header>

        <section
          aria-label="Relay status"
          className="grid gap-4 md:grid-cols-[1.5fr_1fr]"
        >
          <Card className="overflow-hidden">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Relay endpoint</CardTitle>
                  <CardDescription>
                    Secure upstream for every Silvermoon daemon.
                  </CardDescription>
                </div>
                <Badge>WSS ready</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <code className="block overflow-x-auto rounded-lg border border-border bg-muted px-4 py-3 font-mono text-sm">
                {relayOrigin.replace(/^http/, "ws")}/v1/daemon/connect
              </code>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Connection model</CardTitle>
              <CardDescription>
                One Durable Object coordination atom per daemon.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Transport" value="WSS" />
              <Metric label="State" value="D1 + DO" />
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
          <Card>
            <CardHeader>
              <CardTitle>Daemons</CardTitle>
              <CardDescription>
                Connected devices will appear after authentication.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <p className="font-medium">No daemon connected</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Start a daemon with its user access token to establish an
                  upstream session.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Publish a task</CardTitle>
              <CardDescription>
                Task delivery unlocks when an authenticated daemon is online.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="daemon">
                    Daemon
                  </label>
                  <Input id="daemon" disabled placeholder="No daemon available" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="task">
                    Task
                  </label>
                  <Input
                    id="task"
                    disabled
                    placeholder="Describe the work for this daemon"
                  />
                </div>
                <Button disabled type="submit" className="w-full sm:w-auto">
                  Publish task
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono font-medium">{value}</p>
    </div>
  )
}

export default App
