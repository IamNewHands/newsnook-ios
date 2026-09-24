const TICK_MS = 1_000
const FLUSH_MS = 60_000
const PAUSE_UNLESS_SCROLLED_MS = 3 * 60_000
const MAX_TRACKING_PER_POST_MS = 6 * 60_000
const RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000]
const RETRYABLE_STATUSES = new Set([405, 429, 500, 501, 502, 503, 504])

export interface LinuxDoTimingBatch {
  topicId: number
  topicTime: number
  timings: Record<number, number>
}
interface PendingTimingBatch extends LinuxDoTimingBatch { highestSeen: number }
export interface LinuxDoReadTrackerOptions {
  send: (batch: LinuxDoTimingBatch) => Promise<void>
  onSent?: (topicId: number, highestSeen: number, postNumbers: number[]) => void
  onError?: (error: unknown, batch: LinuxDoTimingBatch, retrying: boolean) => void
  now?: () => number
}

/**
 * Discourse-style screen tracking.
 *
 * Visibility is sampled once per second while the topic has focus. Scrolling only
 * refreshes the three-minute activity timeout; it never clears per-post timings.
 * A newly observed unread post rushes the accumulated batch on the next tick,
 * which naturally distinguishes normal reading from a fast fling that never
 * survives a visibility sample. The 60-second flush is only a fallback.
 *
 * An unacknowledged batch stays pending. Security/authentication failures pause
 * the queue for explicit session recovery; they never become local read state.
 */
export class LinuxDoReadTracker {
  private readonly send: LinuxDoReadTrackerOptions['send']
  private readonly onSent?: LinuxDoReadTrackerOptions['onSent']
  private readonly onError?: LinuxDoReadTrackerOptions['onError']
  private readonly now: () => number
  private topicId?: number
  private generation = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private lastTick = 0
  private lastScrolled = 0
  private elapsedSinceFlush = 0
  private topicTime = 0
  private focused = true
  private visiblePosts = new Set<number>()
  private readVisiblePosts = new Set<number>()
  private readPosts = new Set<number>()
  private timings = new Map<number, number>()
  // Reserved duration includes pending batches; this is a budget, NOT read state.
  private totalTimings = new Map<number, number>()
  private pending: PendingTimingBatch[] = []
  private sending = false
  private blocked = false
  private retryCount = 0
  private retryNotBefore = 0

  constructor(options: LinuxDoReadTrackerOptions) {
    this.send = options.send
    this.onSent = options.onSent
    this.onError = options.onError
    this.now = options.now ?? Date.now
  }

  start(topicId: number): void {
    if (!Number.isSafeInteger(topicId) || topicId <= 0) return
    this.stop(false)
    const now = this.now()
    this.topicId = topicId
    this.lastTick = now
    this.lastScrolled = now
    this.elapsedSinceFlush = 0
    this.focused = true
    this.blocked = false
    this.retryCount = 0
    this.retryNotBefore = 0
    this.totalTimings.clear()
    this.readPosts.clear()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  setVisiblePosts(postNumbers: Iterable<number>, readPostNumbers: Iterable<number> = []): void {
    const next = new Set<number>()
    for (const raw of postNumbers) if (Number.isSafeInteger(raw) && raw > 0) next.add(raw)
    const read = new Set<number>()
    for (const raw of readPostNumbers) if (Number.isSafeInteger(raw) && raw > 0) read.add(raw)
    this.visiblePosts = next
    this.readVisiblePosts = read
  }

  scrolled(): void {
    // Match Discourse: scrolling means the reader is still active. It must not
    // discard timings, otherwise slow continuous reading can never become read.
    this.lastScrolled = this.now()
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return
    this.focused = focused
    this.lastTick = this.now()
    this.elapsedSinceFlush = 0
    if (focused) this.lastScrolled = this.now()
  }

  /** Call only after retry was requested or the SAME account was re-verified. */
  resume(): void {
    if (!this.topicId || this.now() < this.retryNotBefore) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.blocked = false
    this.retryCount = 0
    void this.sendNext()
  }

  stop(flush = true): void {
    if (flush && this.topicId) {
      this.tick()
      if (this.focused && !this.blocked && !this.sending) this.flushTimings()
    }
    if (this.timer) clearInterval(this.timer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.timer = null
    this.retryTimer = null
    this.topicId = undefined
    this.visiblePosts.clear()
    this.readVisiblePosts.clear()
    this.readPosts.clear()
    this.timings.clear()
    this.topicTime = 0
    this.pending = []
    this.blocked = false
    this.retryNotBefore = 0
    if (!flush) { this.generation++; this.sending = false }
  }

  private tick(): void {
    if (!this.topicId) return
    const now = this.now()
    const diff = Math.max(0, now - this.lastTick)
    this.lastTick = now
    if (!this.focused || now - this.lastScrolled > PAUSE_UNLESS_SCROLLED_MS) return
    this.elapsedSinceFlush += diff

    // Discourse checks whether the previous sample introduced a new unread post
    // before recording this tick's viewport. With a 1s timer that produces the
    // observed ~1s request cadence without posting directly from scroll events.
    if (!this.blocked && !this.sending && !this.retryTimer) {
      const rush = Array.from(this.timings).some(([post, timing]) =>
        timing > 0 && !this.totalTimings.has(post) && !this.readPosts.has(post))
      if (rush || this.elapsedSinceFlush > FLUSH_MS) this.flushTimings()
    }

    if (!this.sending) void this.sendNext()
    if (!this.focused) return

    this.topicTime += diff
    for (const post of this.visiblePosts) {
      this.timings.set(post, Math.min(MAX_TRACKING_PER_POST_MS, (this.timings.get(post) ?? 0) + diff))
    }
    for (const post of this.readVisiblePosts) this.readPosts.add(post)
  }

  private flushTimings(): void {
    if (!this.topicId || this.blocked) return
    const timings: Record<number, number> = {}
    let highestSeen = 0
    for (const [post, duration] of this.timings) {
      if (duration <= 0) continue
      const total = this.totalTimings.get(post) ?? 0
      const accepted = Math.min(duration, MAX_TRACKING_PER_POST_MS - total)
      this.timings.set(post, 0)
      if (accepted <= 0) continue
      this.totalTimings.set(post, total + accepted)
      timings[post] = accepted
      highestSeen = Math.max(highestSeen, post)
    }
    if (!highestSeen) { this.elapsedSinceFlush = 0; return }
    this.pending.push({ topicId: this.topicId, topicTime: this.topicTime, timings, highestSeen })
    this.topicTime = 0
    this.elapsedSinceFlush = 0
    void this.sendNext()
  }

  private async sendNext(): Promise<void> {
    if (this.sending || this.blocked || this.retryTimer || !this.pending.length) return
    const next = this.pending[0]
    const generation = this.generation
    this.sending = true
    let failure: unknown
    let failed = false
    try { await this.send(next) } catch (error) { failed = true; failure = error }
    if (generation !== this.generation) return
    this.sending = false
    if (!failed) {
      if (this.pending[0] === next) this.pending.shift()
      this.retryCount = 0
      this.retryNotBefore = 0
      this.onSent?.(next.topicId, next.highestSeen, Object.keys(next.timings).map(Number))
      if (this.topicId && this.pending.length) void this.sendNext()
      return
    }
    // The view may have left while the request was in flight. Do not schedule
    // another request under a stopped or replaced account/topic lifecycle.
    if (!this.topicId) return
    const error = failure && typeof failure === 'object' ? failure as { kind?: string; status?: number; retryAfterSeconds?: number } : {}
    const securityFailure = ['browser-verification', 'auth-required', 'forbidden', 'csrf'].includes(error.kind ?? '')
    const transient = !securityFailure && (error.kind === 'network' || typeof error.status === 'number' && RETRYABLE_STATUSES.has(error.status))
    const retrying = transient && this.retryCount < RETRY_DELAYS_MS.length
    if (retrying) {
      const advertised = Number.isFinite(error.retryAfterSeconds) ? Math.max(0, error.retryAfterSeconds!) * 1000 : 0
      const delay = Math.max(RETRY_DELAYS_MS[this.retryCount++], advertised)
      this.retryNotBefore = this.now() + delay
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        if (generation === this.generation && this.topicId) void this.sendNext()
      }, delay)
    } else {
      this.blocked = true
    }
    this.onError?.(failure, next, retrying)
  }
}
