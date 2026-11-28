// Steps of a swipe: turns the wheel events of two fingers moved on a
// trackpad (or of a wheel turned) into steps along a list, by distance,
// either way. A stroke is the events that follow each other in one
// direction without a pause (STROKE_GAP_MS): its first FIRST_STEP_PX of
// travel are a step, so a short flick is one, and every STEP_PX after
// another; a turn the other way is a new stroke, so the fingers can go
// back and forth.
//
// A trackpad goes on sending events after the fingers leave it (momentum),
// which would step on and on. Browsers do not tell those events apart, so a
// stroke is taken as coasting when, after it went faster than COAST_SPEED,
// its smoothed speed falls for two events of a stream (at most
// STREAM_GAP_MS apart) to DROP of its peak; it steps no further until it
// speeds up again by RESUME (the fingers pushing again) or a new stroke
// starts. A step reached while the stroke slows down is held until the
// next event shows whether momentum follows (it is dropped) or not (it is
// taken); when no event follows, the caller takes it with flush() after
// STREAM_GAP_MS. The fingers' own slowing down is taken alike, which costs
// a little travel; a slow, careful move never coasts. A wheel's notches in
// lines or pages (deltaMode 1, 2) are a step each, and a mouse's notches in
// pixels are of one size, which is neither a fall nor a rise.

/** How far (CSS pixels) a swipe goes for each step, and for a stroke's first. */
export const STEP_PX = 40;
export const FIRST_STEP_PX = 24;
/** The pause that ends a stroke. */
export const STROKE_GAP_MS = 80;
/** The longest gap between two events of a stream (a trackpad sends one a
 * frame, every 8 to 17 ms); also how long a held step waits. */
export const STREAM_GAP_MS = 30;
/** The least speed (px/ms) whose slowing down may be momentum. */
export const COAST_SPEED = 0.3;
/** The share of its peak speed a stroke falls to before it coasts. */
export const DROP = 0.95;
/** How much faster than its slowest a coasting stroke must go to step again. */
export const RESUME = 1.3;
/** The time constant (ms) that smooths a stroke's speed. */
const SMOOTH_MS = 12;
/** The duration (ms) the first event of a stroke stands for. */
const FRAME_MS = 16;

export type Step = -1 | 0 | 1;

export class SwipeSteps {
  private dir = 0;
  private last = -Infinity;
  /** Travel since the last step, and whether the stroke stepped. */
  private acc = 0;
  private stepped = false;
  /** Smoothed speed (px/ms), its peak, and its least while coasting. */
  private speed = 0;
  private peak = 0;
  private low = 0;
  /** The last event's size, and how many of the stream's events fell in a row. */
  private prev = 0;
  private falls = 0;
  private falling = false;
  private coast = false;
  private held: Step = 0;

  /** The step an event of dy pixels at time t (ms) makes: 1 (down the list;
   * the fingers up with natural scrolling), -1 or 0. discrete: a wheel's
   * notch counted in lines or pages. */
  feed(dy: number, t: number, discrete = false): Step {
    const dir = Math.sign(dy) as Step;
    if (dir === 0) return 0;
    const gap = t - this.last;
    this.last = t;
    const size = Math.abs(dy);
    if (discrete) {
      this.begin(0, 0);
      return dir;
    }
    if (gap > STROKE_GAP_MS || dir !== this.dir) this.begin(dir, size);
    else this.follow(size, gap);
    if (this.coast) {
      this.held = 0;
      return 0;
    }
    let step: Step = 0;
    if (this.held && !this.falling) step = this.flush();
    this.acc += size;
    if (this.acc >= (this.stepped ? STEP_PX : FIRST_STEP_PX)) {
      this.acc = 0;
      this.stepped = true;
      if (this.falling && this.peak >= COAST_SPEED) this.held = dir;
      else step = dir;
    }
    return step;
  }

  /** Whether the stroke under way is taken as momentum. */
  get coasting(): boolean {
    return this.coast;
  }

  /** Whether a step is held, for flush() when no event comes within
   * STREAM_GAP_MS. */
  get holding(): boolean {
    return this.held !== 0;
  }

  /** The step held, once: no momentum followed it. */
  flush(): Step {
    const step = this.held;
    this.held = 0;
    return step;
  }

  /** Forgets the stroke under way. */
  reset() {
    this.last = -Infinity;
    this.begin(0, 0);
  }

  private begin(dir: number, size: number) {
    this.dir = dir;
    this.acc = 0;
    this.stepped = false;
    this.speed = this.peak = this.low = size / FRAME_MS;
    this.prev = size;
    this.falls = 0;
    this.falling = false;
    this.coast = false;
    this.held = 0;
  }

  private follow(size: number, gap: number) {
    const dt = Math.min(Math.max(gap, 4), STROKE_GAP_MS);
    const before = this.speed;
    this.speed += (1 - Math.exp(-dt / SMOOTH_MS)) * (size / dt - before);
    const prev = this.prev;
    this.prev = size;
    if (this.coast) {
      this.low = Math.min(this.low, this.speed);
      if (this.speed > this.low * RESUME && this.speed > COAST_SPEED / 2) {
        this.coast = false;
        this.falls = 0;
        this.falling = false;
        this.peak = this.speed;
      }
      return;
    }
    this.peak = Math.max(this.peak, this.speed);
    // An event the size of the last (a mouse's notch, momentum's rounding)
    // is neither a fall nor a rise.
    if (size === prev) return;
    this.falling = gap <= STREAM_GAP_MS && this.speed < before;
    this.falls = this.falling ? this.falls + 1 : 0;
    if (this.falls >= 2 && this.peak >= COAST_SPEED && this.speed <= this.peak * DROP) {
      this.coast = true;
      this.low = this.speed;
    }
  }
}
