import { expect, test, type Page } from "@playwright/test"
import type { AgentSessionEvent } from "../src/message-flow.ts"

function message(sequence: number, text = `Message ${sequence}`): AgentSessionEvent {
  return {
    id: `event-${sequence}`,
    sessionId: "session-1",
    sequence,
    type: "message",
    role: "assistant",
    text,
    data: null,
    createdAt: "2026-10-10T00:00:00.000Z",
  }
}

async function fixture(page: Page, initialEvents = 40) {
  const state = {
    events: Array.from({ length: initialEvents }, (_, index) => message(index)),
    status: "online",
    delaySecondSession: false,
    eventPolls: 0,
  }
  await page.route("https://relay.silvermoon.work/**", async (route) => {
    const url = new URL(route.request().url())
    const connector = (id: string) => ({
      id,
      displayName: `Device ${id}`,
      agent: null,
      capabilities: { listSessions: true, createSession: true, sendMessage: true, streamEvents: true },
      status: state.status,
      connectedAt: null,
      disconnectedAt: null,
      lastSeenAt: null,
      createdAt: "2026-10-10T00:00:00.000Z",
      sessionCount: 1,
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
      body = [connector("one"), connector("two")]
    } else if (url.pathname.endsWith("/events/sync")) {
      body = { command: { id: "sync", type: "sync", status: "sent" } }
    } else if (url.pathname.endsWith("/events")) {
      state.eventPolls++
      const second = url.pathname.includes("/two/")
      if (second && state.delaySecondSession) {
        await new Promise((resolve) => setTimeout(resolve, 600))
      }
      const source = second
        ? Array.from({ length: 30 }, (_, index) => message(index, `Second device ${index}`))
        : state.events
      const after = Number(url.searchParams.get("after"))
      body = { events: source.filter((event) => event.sequence > after), nextAfter: source.at(-1)?.sequence ?? -1 }
    } else if (url.pathname.endsWith("/sessions")) {
      const second = url.pathname.includes("/two/")
      body = [{
        id: "session-1",
        connectorId: second ? "two" : "one",
        parentSessionId: null,
        title: second ? "Second Session" : "First Session",
        status: "idle",
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
        lastActivityAt: "2026-10-10T00:00:00.000Z",
        lastMessagePreview: null,
        canSendMessage: true,
      }]
    } else {
      throw new Error(`Unexpected API request: ${route.request().method()} ${url.pathname}`)
    }
    await route.fulfill({ json: body })
  })
  await page.goto("/?connector=one&session=session-1")
  return state
}

const scrollRegion = (page: Page) => page.getByRole("region", { name: "Session messages" })
const jumpButton = (page: Page) => page.getByRole("button", { name: "Jump to latest" })

async function bottomDistance(page: Page) {
  return scrollRegion(page).evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop
  )
}

async function scrollFromBottom(page: Page, distance: number) {
  await scrollRegion(page).evaluate((element, value) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - value
    element.dispatchEvent(new Event("scroll"))
  }, distance)
}

test("initial history, the exact 64px threshold, and new events follow latest", async ({ page }) => {
  const state = await fixture(page)
  await expect(page.getByText("Message 39", { exact: true })).toBeVisible()
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await expect(jumpButton(page)).toHaveCount(0)
  await scrollFromBottom(page, 64)
  await expect(jumpButton(page)).toHaveCount(0)
  state.events.push(message(40, "Latest appended message"))
  await expect(page.getByText("Latest appended message", { exact: true })).toBeVisible()
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 65)
  await expect(jumpButton(page)).toBeVisible()
})

test("history survives new messages, empty polls, tool filtering, and reconnect", async ({ page }) => {
  const state = await fixture(page)
  state.events.push({ ...message(40, "Tool output"), type: "tool", role: null })
  await expect(page.getByRole("button", { name: "Show 1 tool message" })).toHaveCount(1)
  await scrollFromBottom(page, 900)
  const position = await scrollRegion(page).evaluate((element) => element.scrollTop)
  await expect(jumpButton(page)).toBeVisible()
  state.events.push(message(41, "Appended while reading"))
  await expect(page.getByText("Appended while reading", { exact: true })).toHaveCount(1)
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  const polls = state.eventPolls
  await expect.poll(() => state.eventPolls).toBeGreaterThan(polls)
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  await page.getByRole("button", { name: "Show 1 tool message" }).evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByRole("button", { name: "Hide tool messages" })).toHaveCount(1)
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  await page.getByRole("button", { name: "Hide tool messages" }).evaluate((button: HTMLButtonElement) => button.click())
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  state.status = "offline"
  await expect(page.getByText("Reconnect Device one to send a follow-up.", { exact: true })).toBeVisible({ timeout: 8000 })
  state.status = "online"
  await expect(page.getByText("Reconnect Device one to send a follow-up.", { exact: true })).toHaveCount(0, { timeout: 8000 })
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  await expect(jumpButton(page)).toBeVisible()
})

test("switching Devices with the same Session ID clears stale history and resets positioning", async ({ page, isMobile }) => {
  const state = await fixture(page)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 900)
  state.delaySecondSession = true
  if (isMobile) await page.getByRole("button", { name: "Back to Sessions" }).click()
  await page.getByRole("button", { name: /Second Session/ }).click()
  await expect(page.getByText("Message 39", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Second device 29", { exact: true })).toBeVisible()
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await expect(jumpButton(page)).toHaveCount(0)
})

test("pointer and keyboard jump are accessible, hide immediately, and respect reduced motion", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await fixture(page)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 900)
  await expect(jumpButton(page)).toBeVisible()
  const buttonBox = await jumpButton(page).boundingBox()
  const composerBox = await page.locator(".session-composer-shell").boundingBox()
  const transcriptBox = await scrollRegion(page).boundingBox()
  expect(buttonBox).not.toBeNull()
  expect(composerBox).not.toBeNull()
  if (!buttonBox || !composerBox || !transcriptBox) throw new Error("Missing layout boxes")
  expect(buttonBox.height).toBeGreaterThanOrEqual(44)
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(composerBox.y)
  expect(buttonBox.y).toBeGreaterThanOrEqual(transcriptBox.y + transcriptBox.height)
  expect(buttonBox.x).toBeGreaterThanOrEqual(0)
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: testInfo.outputPath("reading-history.png") })
  await jumpButton(page).click()
  await expect(jumpButton(page)).toHaveCount(0)
  expect(await bottomDistance(page)).toBeLessThanOrEqual(1)
  await expect(scrollRegion(page)).toBeFocused()
  await scrollFromBottom(page, 900)
  await scrollRegion(page).focus()
  await page.keyboard.press("Tab")
  await expect(jumpButton(page)).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(jumpButton(page)).toHaveCount(0)
  expect(await bottomDistance(page)).toBeLessThanOrEqual(1)
  await expect(scrollRegion(page)).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath("latest.png") })
})

test("smooth jump hides immediately and can be interrupted by history scrolling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await fixture(page)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 900)
  await jumpButton(page).click()
  await expect(jumpButton(page)).toHaveCount(0)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 1500)
  await jumpButton(page).click()
  await scrollRegion(page).dispatchEvent("wheel", { deltaY: -400 })
  await scrollFromBottom(page, 900)
  await expect(jumpButton(page)).toBeVisible()
})

test("layout changes follow only at latest, including a hidden mobile workspace", async ({ page, isMobile }) => {
  const state = await fixture(page, 0)
  await expect(page.getByText("Waiting for activity", { exact: true })).toBeVisible()
  state.events = Array.from({ length: 40 }, (_, index) => message(index))
  await expect(page.getByText("Message 39", { exact: true })).toBeVisible()
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await page.locator(".transcript").evaluate((element) => element.style.paddingBottom = "200px")
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await page.getByRole("textbox", { name: "Follow-up message" }).fill("line\n".repeat(8))
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 900)
  const position = await scrollRegion(page).evaluate((element) => element.scrollTop)
  await page.locator(".transcript").evaluate((element) => element.style.paddingBottom = "300px")
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  await expect(jumpButton(page)).toBeVisible()
  if (isMobile) {
    await page.getByRole("button", { name: "Back to Sessions" }).click()
    state.events.push(message(40, "Arrived while hidden"))
    await expect(page.getByText("Arrived while hidden", { exact: true })).toHaveCount(1)
    await page.getByRole("button", { name: /First Session/ }).click()
    expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
    await expect(jumpButton(page)).toBeVisible()
  }
})

test("structured streaming snapshots and delayed media layout preserve follow intent", async ({ page }) => {
  const state = await fixture(page)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  const snapshot = (sequence: number, text: string): AgentSessionEvent => ({
    ...message(sequence, text),
    data: {
      turnId: "streaming-turn",
      partId: "answer",
      partIndex: 0,
      partKind: "markdown",
      update: "snapshot",
    },
  })
  state.events.push(snapshot(40, "Streaming response"))
  await expect(page.getByText("Streaming response", { exact: true })).toBeVisible()
  state.events.push(snapshot(41, "Streaming response\n\n" + "Long response paragraph.\n\n".repeat(20)))
  await expect.poll(() => page.getByText("Long response paragraph.", { exact: true }).count()).toBe(20)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await page.locator(".transcript").evaluate((element) => {
    const image = document.createElement("img")
    image.alt = "Delayed media"
    image.style.height = "1px"
    image.style.width = "100%"
    element.append(image)
  })
  await page.getByAltText("Delayed media").evaluate((element) => element.style.height = "400px")
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 1000)
  const position = await scrollRegion(page).evaluate((element) => element.scrollTop)
  await page.getByAltText("Delayed media").evaluate((element) => element.style.height = "600px")
  await expect(jumpButton(page)).toBeVisible()
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  state.events.push(snapshot(42, "Streaming response\n\n" + "Long response paragraph.\n\n".repeat(30)))
  await expect.poll(() => page.getByText("Long response paragraph.", { exact: true }).count()).toBe(30)
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
})

test("short history needs no return control and follows after mobile list navigation", async ({ page, isMobile }) => {
  const state = await fixture(page, 1)
  await expect(page.getByText("Message 0", { exact: true })).toBeVisible()
  await expect(jumpButton(page)).toHaveCount(0)
  if (isMobile) await page.getByRole("button", { name: "Back to Sessions" }).click()
  state.events.push(...Array.from({ length: 39 }, (_, index) => message(index + 1)))
  await expect(page.getByText("Message 39", { exact: true })).toHaveCount(1)
  if (isMobile) await page.getByRole("button", { name: /First Session/ }).click()
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await expect(jumpButton(page)).toHaveCount(0)
})
