import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"

const latestThreshold = 64

export function TranscriptScroll({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const jumping = useRef(false)
  const layout = useRef({ scrollHeight: 0, clientHeight: 0 })
  const [showJump, setShowJump] = useState(false)

  function nearBottom(element: HTMLDivElement) {
    return element.scrollHeight - element.clientHeight - element.scrollTop
      <= latestThreshold
  }

  useLayoutEffect(() => {
    const element = scrollRef.current
    const content = contentRef.current
    if (!element || !content) return

    const updateLayout = () => {
      if (element.clientHeight === 0) return
      if (following.current) {
        element.scrollTop = element.scrollHeight
        jumping.current = false
      }
      const near = nearBottom(element)
      following.current = near
      layout.current = {
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }
      setShowJump(!near)
    }
    updateLayout()
    const observer = new ResizeObserver(updateLayout)
    observer.observe(element)
    observer.observe(content)
    return () => observer.disconnect()
  }, [children])

  function updateScroll() {
    const element = scrollRef.current
    if (!element || element.clientHeight === 0) return
    // A queued layout-induced scroll must not override the prior follow intent.
    if (
      element.scrollHeight !== layout.current.scrollHeight
      || element.clientHeight !== layout.current.clientHeight
    ) return
    const near = nearBottom(element)
    if (jumping.current && !near) return
    jumping.current = false
    following.current = near
    setShowJump(!near)
  }

  function interruptJump() {
    if (!jumping.current) return
    jumping.current = false
    const element = scrollRef.current
    if (element) {
      element.scrollTo({ top: element.scrollTop, behavior: "instant" })
      updateScroll()
    }
  }

  function jumpToLatest() {
    const element = scrollRef.current
    if (!element) return
    following.current = true
    jumping.current = true
    setShowJump(false)
    element.focus({ preventScroll: true })
    element.scrollTo({
      top: element.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    })
  }

  return (
    <div className="transcript-shell">
      <div
        ref={scrollRef}
        id="session-transcript"
        className="transcript-scroll"
        role="region"
        aria-label="Session messages"
        tabIndex={0}
        onScroll={updateScroll}
        onWheel={(event) => {
          interruptJump()
          if (event.deltaY < 0 && (scrollRef.current?.scrollTop ?? 0) > 0) {
            following.current = false
          }
        }}
        onTouchStart={interruptJump}
        onKeyDown={(event) => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]
            .includes(event.key)) interruptJump()
        }}
      >
        <div ref={contentRef} className="transcript">{children}</div>
      </div>
      {showJump && (
        <Button
          type="button"
          variant="outline"
          className="transcript-jump"
          aria-controls="session-transcript"
          onClick={jumpToLatest}
        >
          <ArrowDown aria-hidden="true" />
          Jump to latest
        </Button>
      )}
    </div>
  )
}
