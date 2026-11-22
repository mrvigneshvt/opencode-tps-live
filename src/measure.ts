// Pure measurement math for the TPS meter. No OpenCode or OpenTUI imports:
// every function here is unit-testable (src/measure.test.ts, `bun test`).

export const WINDOW_MS = 5_000
export const STALE_MS = 1_500
export const MIN_TPS_DURATION_MS = 300

export type Sample = { at: number; raw: number }

export function utf8Bytes(s: string): number {
  let bytes = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const n = s.charCodeAt(i + 1)
      if (n >= 0xdc00 && n <= 0xdfff) {
        bytes += 4
        i++
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

/**
 * Rough per-delta token estimate: ~4 bytes per token. Non-empty text always
 * estimates at least one token; empty deltas estimate zero.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  return Math.ceil(utf8Bytes(text) / 4)
}

export function pruneSamples(samples: Sample[], now: number, windowMs: number = WINDOW_MS): Sample[] {
  return samples.filter((s) => now - s.at <= windowMs)
}

/**
 * Live tokens/second over the rolling window, or null when idle.
 * Wall-clock denominator (now - oldest sample) avoids inflation from network
 * buffering; MIN_TPS_DURATION_MS floors it so a single fast chunk cannot
 * imply a huge rate. `ratio` rescales estimates toward real token counts.
 */
export function windowedTps(samples: Sample[], now: number, ratio = 1): number | null {
  const arr = pruneSamples(samples, now)
  if (arr.length === 0) return null
  if (now - arr[arr.length - 1].at > STALE_MS) return null
  const durMs = Math.max(now - arr[0].at, MIN_TPS_DURATION_MS)
  const raw = arr.reduce((sum, s) => sum + s.raw, 0)
  const tps = (raw * ratio) / (durMs / 1000)
  return tps > 0 ? tps : null
}

/** Median of calibration ratios (real/estimated tokens); 1 when no data yet. */
export function medianRatio(ratios: number[]): number {
  if (ratios.length === 0) return 1
  const sorted = [...ratios].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
