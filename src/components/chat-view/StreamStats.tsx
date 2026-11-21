import { useEffect, useRef, useState } from 'react'

import { tokenCount } from '../../utils/llm/token'

export function formatDuration(seconds: number): string {
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`
}

// Tokens per second over the last few seconds, so a stalled stream drops to 0
const TPS_WINDOW_MS = 5000

export default function StreamStats({
  startedAt,
  text,
}: {
  startedAt: number
  text: string
}) {
  const [now, setNow] = useState(Date.now())
  const [tps, setTps] = useState<number | null>(null)
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    let countedChars = 0
    let tokens = 0
    const samples: { time: number; tokens: number }[] = []

    const tick = async () => {
      const current = textRef.current
      tokens += await tokenCount(current.slice(countedChars))
      countedChars = current.length
      if (cancelled) return

      const time = Date.now()
      samples.push({ time, tokens })
      while (samples.length > 1 && samples[1].time <= time - TPS_WINDOW_MS) {
        samples.shift()
      }
      const base = samples[0]
      setNow(time)
      setTps(
        time > base.time
          ? ((tokens - base.tokens) * 1000) / (time - base.time)
          : null,
      )
      timer = setTimeout(() => void tick(), 1000)
    }
    void tick()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  return (
    <span className="smtcmp-stream-stats">
      {formatDuration(Math.max(0, Math.floor((now - startedAt) / 1000)))}
      {tps !== null && ` · ${Math.round(tps)} tok/s`}
    </span>
  )
}
