import { describe, expect, it } from "bun:test"
import {
  estimateTokens,
  medianRatio,
  pruneSamples,
  utf8Bytes,
  windowedTps,
  type Sample,
} from "./measure"

describe("utf8Bytes", () => {
  it("counts ASCII as 1 byte per char", () => expect(utf8Bytes("abc")).toBe(3))
  it("counts 2-byte code points", () => expect(utf8Bytes("é")).toBe(2))
  it("counts 3-byte code points", () => expect(utf8Bytes("€")).toBe(3))
  it("counts surrogate pairs as 4 bytes", () => expect(utf8Bytes("😀")).toBe(4))
  it("treats a lone surrogate as 3 bytes", () => expect(utf8Bytes("\uD800")).toBe(3))
})

describe("estimateTokens", () => {
  it("estimates ~4 bytes per token", () => expect(estimateTokens("12345678")).toBe(2))
  it("never estimates below one token for non-empty text", () => expect(estimateTokens("a")).toBe(1))
  it("returns zero for empty deltas", () => expect(estimateTokens("")).toBe(0))
})

describe("windowedTps", () => {
  const t = 1_000_000

  it("returns null when there are no samples", () => expect(windowedTps([], t)).toBeNull())

  it("floors the denominator so a single chunk can't imply a huge rate", () => {
    // 10 tokens in a sample dated "now": 300ms floor -> 10 / 0.3s
    expect(windowedTps([{ at: t, raw: 10 }], t)).toBeCloseTo(33.33, 1)
  })

  it("divides window tokens by wall-clock duration", () => {
    const samples: Sample[] = [
      { at: t, raw: 10 },
      { at: t + 1_000, raw: 10 },
    ]
    expect(windowedTps(samples, t + 1_000)).toBeCloseTo(20, 5)
  })

  it("applies the calibration ratio", () => {
    const samples: Sample[] = [
      { at: t, raw: 10 },
      { at: t + 1_000, raw: 10 },
    ]
    expect(windowedTps(samples, t + 1_000, 2)).toBeCloseTo(40, 5)
  })

  it("drops samples outside the window", () => {
    const samples: Sample[] = [
      { at: t - 6_000, raw: 100 },
      { at: t, raw: 10 },
    ]
    // window keeps only the "t" sample, so the 300ms floor applies again
    expect(windowedTps(samples, t)).toBeCloseTo(33.33, 1)
  })

  it("returns null when the stream went stale", () => {
    expect(windowedTps([{ at: t, raw: 10 }], t + 2_000)).toBeNull()
  })
})

describe("medianRatio", () => {
  it("defaults to 1 with no calibration data", () => expect(medianRatio([])).toBe(1))
  it("returns the middle value for odd counts", () => expect(medianRatio([1, 2, 10])).toBe(2))
  it("uses the upper middle for even counts", () => expect(medianRatio([1, 3])).toBe(3))
})

describe("pruneSamples", () => {
  it("removes samples older than the window", () => {
    const samples: Sample[] = [
      { at: 0, raw: 1 },
      { at: 5_000, raw: 2 },
    ]
    expect(pruneSamples(samples, 10_000)).toEqual([{ at: 5_000, raw: 2 }])
  })
})
