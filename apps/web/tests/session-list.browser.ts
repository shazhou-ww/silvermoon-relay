import { expect, test, type Page } from "@playwright/test"

interface SessionFixture {
  id: string
  connectorId: string
  parentSessionId: string | null
  title: string
  status: string
  lastActivityAt: string
}

const sessions: SessionFixture[] = [
  {
    id: "release",
    connectorId: "studio",
    parentSessionId: null,
    title: "Release desktop client",
    status: "running",
    lastActivityAt: "2026-10-10T12:00:00.000Z",
  },
  {
    id: "signing",
    connectorId: "studio",
    parentSessionId: "release",
    title: "Confirm signing identity",
    status: "waiting",
    lastActivityAt: "2026-10-10T11:55:00.000Z",
  },
  {
    id: "ended",
    connectorId: "studio",
    parentSessionId: null,
    title: "Completed migration",
    status: "closed",
    lastActivityAt: "2026-10-09T12:00:00.000Z",
  },
  {
    id: "browser",
    connectorId: "work",
    parentSessionId: null,
    title: "Investigate browser tests",
    status: "idle",
    lastActivityAt: "2026-10-10T11:30:00.000Z",
  },
  {
    id: "unavailable",
    connectorId: "work",
    parentSessionId: null,
    title: "Unavailable connector work",
    status: "gone",
    lastActivityAt: "2026-10-09T11:00:00.000Z",
  },
  {
    id: "preview",
    connectorId: "travel",
    parentSessionId: null,
    title: "Repair preview deployment",
    status: "failed",
    lastActivityAt: "2026-10-10T10:00:00.000Z",
  },
]

async function fixture(page: Page) {
  await page.route("https://relay.silvermoon.work/**", async (route) => {
    const url = new URL(route.request().url())
    const connector = (id: string, displayName: string, status = "online") => ({
      id,
      displayName,
      agent: { name: id === "work" ? "Other Agent" : "GitHub Copilot", version: null },
      capabilities: {
        listSessions: true,
        createSession: true,
        sendMessage: true,
        streamEvents: true,
      },
      status,
      connectedAt: null,
      disconnectedAt: null,
      lastSeenAt: null,
      createdAt: "2026-10-10T00:00:00.000Z",
      sessionCount: sessions.filter((session) => session.connectorId === id).length,
    })
    let body: unknown
    if (url.pathname === "/api/me") {
      body = {
        user: { id: "user", displayName: "Reviewer", avatarUrl: null },
        identities: [],
        sessionId: "browser-session",
      }
    } else if (["/api/tokens", "/api/sessions"].includes(url.pathname)) {
      body = []
    } else if (url.pathname === "/api/connectors") {
      body = [
        connector("studio", "Studio laptop"),
        connector("work", "Work desktop"),
        connector("travel", "Travel laptop", "offline"),
      ]
    } else if (url.pathname.endsWith("/events/sync")) {
      body = { command: { id: "sync", type: "sync", status: "sent" } }
    } else if (url.pathname.endsWith("/events")) {
      body = { events: [], nextAfter: -1 }
    } else if (url.pathname.endsWith("/sessions")) {
      const connectorId = url.pathname.split("/")[3]
      body = sessions
        .filter((session) => session.connectorId === connectorId)
        .map((session) => ({
          ...session,
          title: session.title,
          createdAt: session.lastActivityAt,
          updatedAt: session.lastActivityAt,
          lastMessagePreview: `${session.title} preview`,
          canSendMessage: true,
        }))
    } else {
      throw new Error(
        `Unexpected API request: ${route.request().method()} ${url.pathname}`,
      )
    }
    await route.fulfill({ json: body })
  })
  await page.goto("/")
  await expect(
    page.locator(".session-list").getByText(
      "Release desktop client",
      { exact: true },
    ).first(),
  )
    .toBeVisible()
}

test("status views, parent context, and hover disclosure stay coherent", async ({ page }) => {
  await fixture(page)
  await expect(page.getByRole("button", { name: "Active 1" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Needs input 1" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Failed 1" })).toBeVisible()
  await expect(page.getByText("Completed migration", { exact: true }))
    .toHaveCount(0)
  await expect(page.getByText("Unavailable connector work", { exact: true }))
    .toHaveCount(0)

  const parent = page.locator(".session-list-item.has-children").first()
  await expect(parent.locator(".session-state-dot")).toHaveCSS("opacity", "1")
  await expect(parent.locator(".session-tree-toggle")).toHaveCSS("opacity", "0")
  await parent.hover()
  await expect(parent.locator(".session-state-dot")).toHaveCSS("opacity", "0")
  await expect(parent.locator(".session-tree-toggle")).toHaveCSS("opacity", "1")
  await page.mouse.move(0, 0)
  await expect(parent.locator(".session-state-dot")).toHaveCSS("opacity", "1")
  const collapseButton = parent.getByRole("button", {
    name: "Collapse Release desktop client",
  })
  await collapseButton.focus()
  await expect(parent.locator(".session-tree-toggle")).toHaveCSS("opacity", "1")
  await collapseButton.press("Enter")
  await expect(page.getByText("Confirm signing identity", { exact: true }))
    .toHaveCount(0)
  await parent.getByRole("button", {
    name: "Expand Release desktop client",
  }).press("Enter")
  await expect(page.getByText("Confirm signing identity", { exact: true }))
    .toBeVisible()

  await page.getByRole("textbox", {
    name: "Search Sessions, Agents, and Devices",
  }).fill("signing")
  await expect(page.locator(".session-list-item.is-context")).toContainText(
    "Release desktop client",
  )
  await expect(page.getByText("Confirm signing identity", { exact: true }))
    .toBeVisible()
  await expect(page.locator(".session-list-item.is-subsession")).toHaveCount(1)
})

test("view options reveal hidden states and focus device groups", async ({ page }) => {
  await fixture(page)
  await page.getByRole("button", { name: "Session view options" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Show ended" }).click()
  await page.getByRole("button", { name: "Session view options" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Show unavailable" }).click()
  await expect(page.getByText("Completed migration", { exact: true }))
    .toBeVisible()
  await expect(page.getByText("Unavailable connector work", { exact: true }))
    .toBeVisible()

  await page.getByRole("button", { name: "Session view options" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Group by Device" }).click()
  await expect(page.getByRole("button", { name: /Studio laptop/ }))
    .toHaveAttribute("aria-expanded", "true")
  await expect(page.getByRole("button", { name: /Work desktop/ }))
    .toHaveAttribute("aria-expanded", "false")
  await expect(page.getByText("Investigate browser tests", { exact: true }))
    .toHaveCount(0)
  await page.getByRole("button", { name: /Studio laptop/ }).click()
  await expect(page.getByRole("button", { name: /Studio laptop/ }))
    .toHaveAttribute("aria-expanded", "false")
  await expect(
    page.locator(".session-list").getByText(
      "Release desktop client",
      { exact: true },
    ),
  ).toHaveCount(0)
  await page.getByRole("button", { name: /Studio laptop/ }).click()
  await page.getByRole("button", { name: /Work desktop/ }).click()
  await expect(page.getByText("Investigate browser tests", { exact: true }))
    .toBeVisible()
  await expect(page.getByRole("button", { name: /Studio laptop/ }))
    .toHaveAttribute("aria-expanded", "true")
})

test("mobile selection and back navigation preserve the list workflow", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile navigation only")
  await fixture(page)
  await page.locator(".session-item-select").filter({
    hasText: "Repair preview deployment",
  }).click()
  await expect(page).toHaveURL(/connector=travel&session=preview/u)
  await expect(page.getByRole("button", { name: "Back to Sessions" }))
    .toBeVisible()
  await page.getByRole("button", { name: "Back to Sessions" }).click()
  await expect(page).not.toHaveURL(/connector=/u)
  await expect(page.getByText("Release desktop client", { exact: true }))
    .toBeVisible()
})
