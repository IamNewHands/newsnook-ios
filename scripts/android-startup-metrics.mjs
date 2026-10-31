/** Parse Android's independently reported first- and fully-drawn metrics. */
export function readStartupMetrics(log, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const activity = `${escaped}\\/(?:com\\.aizeek\\.newsnook)?\\.MainActivity`
  const duration = String.raw`\+(?:(\d+)s)?(\d+)ms`
  const displayed = log.match(new RegExp(`Displayed ${activity}[^\\n]*?${duration}`))
  const fullyDrawn = log.match(new RegExp(`Fully drawn ${activity}[^\\n]*?${duration}`))
  const nativeEvent = name => {
    const match = log.match(new RegExp(`NewsNookStartup[^\\n]*?${name}[^\\n]*?elapsed=(\\d+)ms`))
    return match ? Number(match[1]) : null
  }
  const ms = match => match ? Number(match[1] || 0) * 1000 + Number(match[2]) : null
  const start = nativeEvent('application-attachBaseContext')
  const commit = nativeEvent('(?:js:|__NNSTART )first-app-commit\\b')
  const frame = nativeEvent('(?:js:|__NNSTART )first-ui-frame\\b')
  return {
    ttidMs: ms(displayed),
    ttfdMs: ms(fullyDrawn),
    appCommitFromAttachMs: start === null || commit === null ? null : commit - start,
    frameFromAttachMs: start === null || frame === null ? null : frame - start,
  }
}

export function summarizeTimes(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const midpoint = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2
  return { n: sorted.length, median, p90: sorted[Math.ceil(sorted.length * 0.9) - 1] }
}
