/** @jsxImportSource @opentui/solid */
//
// @vixyz/opencode-tps-live — real-time tokens/second meter for the OpenCode TUI.
//
// Renders `TPS x.x | AVG x.x | TTFT x.xs` into the prompt footer status row.
// TUI-only plugin: the package exports just "./tui" and has no server part,
// so the OpenCode server never imports this module.
//
// Module shape is the plain `{ id, setup }` object accepted by the OpenCode 2.x
// TUI runtime. Structural context types below keep this file dependency-free
// at dev time; OpenCode resolves "solid-js" and the JSX runtime from its own
// bundled copies (peerDependencies, never shipped in this package).

import { createSignal } from "solid-js"
import { estimateTokens, medianRatio, windowedTps, WINDOW_MS, type Sample } from "./measure"

type V2Event = Record<string, any> // event payload shapes vary by type; fields read defensively
type SlotInput = { sessionID?: string }

type Ctx = {
  theme?: { text?: { base?: string; muted?: string } }
  data: { on: (type: string, handler: (event: V2Event) => void) => () => void }
  ui: {
    slot: (input: { append: string; render: (input: SlotInput) => unknown }) => () => void
    router: { current: () => { type: string; sessionID?: string } }
  }
  renderer?: { requestRender?: () => void }
}

type Track = {
  startedAt?: number
  firstAt?: number
  lastAt?: number
  raw: number
  sawReasoning: boolean
}

const MIN_AVG_DURATION_MS = 500 // ignore noise-fast steps in AVG
const MIN_RAW_FOR_CALIBRATION = 20 // don't calibrate off a handful of tokens
const TICK_MS = 250

const debug = process.env.TPS_LIVE_DEBUG === "1"
const log = (...args: unknown[]) => {
  if (debug) console.error("[opencode-tps-live]", ...args)
}

export default {
  id: "vixyz.tps-live",

  setup(ctx: Ctx) {
    const samples: Record<string, Sample[]> = {}
    const tracks: Record<string, Track> = {}
    const ttftBySession: Record<string, number> = {}
    const totals: Record<string, { tokens: number; ms: number }> = {}
    let calibRatios: number[] = []
    let ratio = 1

    // Per-session footer lines; read reactively inside the slot render.
    const [lines, setLines] = createSignal<Record<string, string>>({})

    const muted = ctx.theme?.text?.muted ?? ctx.theme?.text?.base
    const requestRender = () => {
      try {
        ctx.renderer?.requestRender?.()
      } catch (error) {
        log("requestRender failed:", error)
      }
    }

    const track = (messageID: string): Track => (tracks[messageID] ??= { raw: 0, sawReasoning: false })

    const setLine = (sessionID: string, line: string) => {
      setLines((prev) => ({ ...prev, [sessionID]: line }))
      requestRender()
    }

    const recompute = (sessionID: string) => {
      const now = Date.now()
      const arr = (samples[sessionID] ?? []).filter((s) => now - s.at <= WINDOW_MS)
      if (arr.length === 0) delete samples[sessionID]
      else samples[sessionID] = arr

      const tps = windowedTps(samples[sessionID] ?? [], now, ratio)

      const total = totals[sessionID]
      const avg = total && total.ms > 0 ? (total.tokens / (total.ms / 1000)).toFixed(1) : "--"

      const ttft = ttftBySession[sessionID]
      const ttftStr = ttft !== undefined ? `${(ttft / 1000).toFixed(1)}s` : "--"

      setLine(
        sessionID,
        `TPS ${tps !== null ? tps.toFixed(1) : "--"} | AVG ${avg} | TTFT ${ttftStr}`,
      )
    }

    const recomputeAll = () => {
      for (const sid of Object.keys(samples)) recompute(sid)
    }

    const recordDelta = (
      sessionID: string,
      messageID: string,
      kind: "text" | "reasoning" | "tool",
      text: string,
    ) => {
      if (typeof text !== "string") return
      const now = Date.now()
      const t = track(messageID)
      if (kind === "reasoning") t.sawReasoning = true
      if (t.firstAt === undefined) {
        t.firstAt = now
        if (t.startedAt !== undefined) ttftBySession[sessionID] = now - t.startedAt
      }
      t.lastAt = now
      const raw = estimateTokens(text)
      t.raw += raw
      ;(samples[sessionID] ??= []).push({ at: now, raw })
      recompute(sessionID)
    }

    const offs: (() => void)[] = []
    const on = (type: string, handler: (event: V2Event) => void) => {
      offs.push(
        ctx.data.on(type, (event) => {
          try {
            handler(event)
          } catch (error) {
            log(`error in ${type}:`, error)
          }
        }),
      )
    }

    on("session.step.started", (event) => {
      const { sessionID, assistantMessageID, started } = event.data ?? {}
      if (typeof assistantMessageID !== "string") return
      tracks[assistantMessageID] = {
        startedAt: typeof started === "number" ? started : Date.now(),
        raw: 0,
        sawReasoning: false,
      }
      log("step started", assistantMessageID)
    })

    const onDelta = (kind: "text" | "reasoning" | "tool") => (event: V2Event) => {
      const { sessionID, assistantMessageID, delta } = event.data ?? {}
      if (typeof sessionID !== "string" || typeof assistantMessageID !== "string") return
      recordDelta(sessionID, assistantMessageID, kind, delta)
    }
    on("session.text.delta", onDelta("text"))
    on("session.reasoning.delta", onDelta("reasoning"))
    on("session.tool.input.delta", onDelta("tool"))

    on("session.step.ended", (event) => {
      const { sessionID, assistantMessageID, tokens } = event.data ?? {}
      if (typeof assistantMessageID !== "string") return
      const t = tracks[assistantMessageID]
      delete tracks[assistantMessageID]
      if (!t || typeof sessionID !== "string") return

      const real =
        (typeof tokens?.output === "number" ? tokens.output : 0) +
        (t.sawReasoning && typeof tokens?.reasoning === "number" ? tokens.reasoning : 0)
      const dur = t.lastAt !== undefined && t.firstAt !== undefined ? t.lastAt - t.firstAt : 0

      if (real > 0) {
        const total = (totals[sessionID] ??= { tokens: 0, ms: 0 })
        if (dur >= MIN_AVG_DURATION_MS) {
          total.tokens += real
          total.ms += dur
        }
        if (t.raw >= MIN_RAW_FOR_CALIBRATION) {
          calibRatios.push(real / t.raw)
          if (calibRatios.length > 10) calibRatios.shift()
          ratio = medianRatio(calibRatios)
          log("calibration ratio", ratio.toFixed(3))
        }
      }
      recompute(sessionID)
    })

    on("session.step.failed", (event) => {
      const { sessionID, assistantMessageID } = event.data ?? {}
      if (typeof assistantMessageID === "string") delete tracks[assistantMessageID]
      if (typeof sessionID === "string") recompute(sessionID)
    })

    const clearLive = (event: V2Event) => {
      const { sessionID } = event.data ?? {}
      if (typeof sessionID !== "string") return
      delete samples[sessionID]
      recompute(sessionID)
    }
    for (const type of [
      "session.execution.succeeded",
      "session.execution.failed",
      "session.execution.interrupted",
    ]) {
      on(type, clearLive)
    }

    // Decay the rolling window while no deltas arrive so TPS drops to "--".
    const timer = setInterval(recomputeAll, TICK_MS)

    const routeSessionID = () => {
      try {
        const route = ctx.ui.router.current()
        return route.type === "session" ? route.sessionID : undefined
      } catch {
        return undefined
      }
    }

    const unregisterSlot = ctx.ui.slot({
      append: "prompt.footer.status",
      render: (input: SlotInput) => (
        <text fg={muted}>{lines()[input.sessionID ?? routeSessionID() ?? ""] ?? "TPS --"}</text>
      ),
    })

    log("loaded")

    return () => {
      clearInterval(timer)
      for (const off of offs) {
        try {
          off()
        } catch (error) {
          log("unsubscribe failed:", error)
        }
      }
      try {
        unregisterSlot()
      } catch (error) {
        log("slot unregister failed:", error)
      }
    }
  },
}
