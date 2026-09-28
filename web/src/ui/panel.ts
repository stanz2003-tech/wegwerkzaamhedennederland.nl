/**
 * Panel behaviour: floating side panel on desktop; on ≤ 768 px a bottom sheet with a drag handle
 * and three snap states (peek / half / full). The map stays usable.
 *
 * Everything below the grip is ONE scroll container (`[data-panel-scroll]`) whose top part
 * (`[data-panel-sticky]`: search, vehicle mode, "Wanneer?") is sticky. Before, only the list
 * scrolled and the controls above it could fill the whole sheet, leaving the list 0 px high in
 * road mode on a phone (mobiel-1, overzicht-1).
 *
 * The sheet is dragged by the handle, and by touch anywhere on the sticky header that is not a
 * control; a swipe up in the content first opens the sheet fully, a swipe down with the content
 * at its top lowers it one step (mobiel-9). `scrollTo` scrolls only the panel's own container,
 * never the page: a plain `focus()` inside the clipped sheet used to scroll the document to the
 * uitleg text under the map (mobiel-2).
 */
import { prefersReducedMotion } from './theme';

export type SheetSnap = 'peek' | 'half' | 'full';

const MOBILE_QUERY = '(max-width: 768px)';
/** The 44 px grip row plus the search row (was 128 with a 28 px grip; toeg-8). */
const PEEK_PX = 144;
const HALF_RATIO = 0.5;
const FULL_GAP_PX = 8;
const DRAG_THRESHOLD_PX = 6;
const VELOCITY_SNAP = 0.5; // px/ms
/** Room kept between the sticky header and an element scrolled to. */
const SCROLL_GAP_PX = 8;
/** Touches on these start no sheet drag: typing, choosing and tapping must keep working. */
const INTERACTIVE = 'input, textarea, select, button, a, label, summary, [role="option"], [role="listbox"]';

export interface PanelController {
  isMobile(): boolean;
  getSnap(): SheetSnap;
  snap(to: SheetSnap): void;
  /** Ensures at least `min` is visible (never shrinks the sheet). */
  ensureAtLeast(min: SheetSnap): void;
  /** Bottom padding (px) the sheet currently covers, for map camera padding. */
  coveredPx(): number;
  onChange(cb: (snap: SheetSnap, mobile: boolean) => void): void;
  /** The panel's scroll container. */
  scrollEl: HTMLElement;
  /**
   * Scrolls the panel (not the page) so `target` sits just under the sticky header: `start`
   * always, `nearest` only when it is not fully in the visible part of the sheet already.
   */
  scrollTo(target: HTMLElement, align?: 'start' | 'nearest'): void;
}

const ORDER: SheetSnap[] = ['peek', 'half', 'full'];

function step(snap: SheetSnap, dir: 1 | -1): SheetSnap {
  const i = ORDER.indexOf(snap) + dir;
  return ORDER[Math.min(Math.max(i, 0), ORDER.length - 1)] ?? snap;
}

export function mountPanel(panel: HTMLElement, handle: HTMLElement, host: HTMLElement): PanelController {
  const mq = window.matchMedia(MOBILE_QUERY);
  const scrollEl = panel.querySelector<HTMLElement>('[data-panel-scroll]');
  const sticky = panel.querySelector<HTMLElement>('[data-panel-sticky]');
  if (!scrollEl || !sticky) throw new Error('panel markup ontbreekt');
  let snap: SheetSnap = 'half';
  const listeners: ((snap: SheetSnap, mobile: boolean) => void)[] = [];

  const hostHeight = (): number => host.clientHeight || window.innerHeight;
  const visibleFor = (s: SheetSnap): number => {
    const h = hostHeight();
    if (s === 'peek') return PEEK_PX;
    if (s === 'half') return Math.round(h * HALF_RATIO);
    return h - FULL_GAP_PX;
  };
  const sheetHeight = (): number => hostHeight() - FULL_GAP_PX;

  const setY = (visible: number, animate: boolean): void => {
    const y = Math.max(0, sheetHeight() - visible);
    panel.style.transition = animate && !prefersReducedMotion() ? 'transform var(--dur-2) var(--ease-out)' : 'none';
    panel.style.setProperty('--sheet-y', `${y}px`);
  };

  const apply = (animate: boolean): void => {
    const mobile = mq.matches;
    panel.dataset.snap = mobile ? snap : 'desktop';
    if (mobile) {
      setY(visibleFor(snap), animate);
      // The map's own controls (zoom, the collapsed attribution ⓘ) sit in the bottom-right
      // corner of the stage, which is exactly where the sheet is. Publish how much of the stage
      // the sheet covers so styles/map.css can lift that corner above it. Only on a snap change,
      // never per drag frame, so the buttons do not jitter under the finger.
      host.style.setProperty('--sheet-visible', `${visibleFor(snap)}px`);
      // The part of the sheet below the screen edge: a spacer of this height at the end of the
      // scroll container (panel.css) lets the last rows of the list scroll into view in 'half'.
      panel.style.setProperty('--sheet-hidden', `${Math.max(0, sheetHeight() - visibleFor(snap))}px`);
      handle.setAttribute('aria-label', snap === 'full' ? 'Paneel verkleinen' : 'Paneel vergroten');
      handle.setAttribute('aria-expanded', snap === 'peek' ? 'false' : 'true');
    } else {
      panel.style.removeProperty('--sheet-y');
      panel.style.removeProperty('--sheet-hidden');
      panel.style.transition = '';
      host.style.removeProperty('--sheet-visible');
    }
    for (const l of listeners) l(snap, mobile);
  };

  const setSnap = (to: SheetSnap, animate = true): void => {
    snap = to;
    apply(animate);
  };

  /* drag: one state machine for the handle (pointer events) and the sheet itself (touch events) */
  let dragging = false;
  let startY = 0;
  let startVisible = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let moved = false;

  const beginDrag = (y: number, t: number): void => {
    dragging = true;
    moved = false;
    startY = y;
    lastY = y;
    lastT = t;
    velocity = 0;
    startVisible = visibleFor(snap);
    panel.classList.add('is-dragging');
  };
  const moveDrag = (y: number, t: number): void => {
    const dy = y - startY;
    if (Math.abs(dy) > DRAG_THRESHOLD_PX) moved = true;
    const dt = Math.max(1, t - lastT);
    velocity = (y - lastY) / dt;
    lastY = y;
    lastT = t;
    const visible = Math.min(sheetHeight(), Math.max(PEEK_PX * 0.6, startVisible - dy));
    setY(visible, false);
  };
  const endDrag = (y: number): void => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('is-dragging');
    if (!moved) {
      // Tap: toggle peek ↔ half, full → half.
      setSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half');
      return;
    }
    const visible = startVisible - (y - startY);
    let target: SheetSnap;
    if (Math.abs(velocity) > VELOCITY_SNAP) {
      target = step(snap, velocity < 0 ? 1 : -1);
    } else {
      target = ORDER.reduce<SheetSnap>(
        (best, s) => (Math.abs(visibleFor(s) - visible) < Math.abs(visibleFor(best) - visible) ? s : best),
        'peek',
      );
    }
    setSnap(target);
  };

  handle.addEventListener('pointerdown', (e) => {
    if (!mq.matches) return;
    beginDrag(e.clientY, e.timeStamp);
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (dragging) moveDrag(e.clientY, e.timeStamp);
  });
  handle.addEventListener('pointerup', (e) => endDrag(e.clientY));
  handle.addEventListener('pointercancel', (e) => endDrag(e.clientY));
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const i = ORDER.indexOf(snap);
      setSnap(ORDER[(i + 1) % ORDER.length] ?? 'half');
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSnap(step(snap, 1));
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSnap(step(snap, -1));
    }
  });

  wireSheetTouch(scrollEl, sticky, {
    active: () => mq.matches,
    snap: () => snap,
    begin: beginDrag,
    move: moveDrag,
    end: (y, wasDrag) => (wasDrag ? endDrag(y) : undefined),
  });

  // A mouse (or pen) can drag the sheet by the sticky header too; touch goes through
  // wireSheetTouch, because without `touch-action: none` the browser cancels a touch pointer
  // as soon as it starts to scroll.
  sticky.addEventListener('pointerdown', (e) => {
    if (!mq.matches || e.pointerType === 'touch' || e.button !== 0) return;
    if ((e.target as Element).closest(INTERACTIVE)) return;
    beginDrag(e.clientY, e.timeStamp);
    sticky.setPointerCapture(e.pointerId);
  });
  sticky.addEventListener('pointermove', (e) => {
    if (dragging && e.pointerType !== 'touch') moveDrag(e.clientY, e.timeStamp);
  });
  const stickyUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' || !dragging) return;
    // A click on the header background is no tap on the grip: leave the snap alone.
    if (!moved) {
      dragging = false;
      panel.classList.remove('is-dragging');
      setY(visibleFor(snap), false);
      return;
    }
    endDrag(e.clientY);
  };
  sticky.addEventListener('pointerup', stickyUp);
  sticky.addEventListener('pointercancel', stickyUp);

  // Custom properties the stylesheet needs: the sticky height for `scroll-margin-top`, so a
  // row focused by Tab is not scrolled in under the header.
  const publishSticky = (): void => panel.style.setProperty('--sticky-h', `${sticky.offsetHeight}px`);
  if ('ResizeObserver' in window) new ResizeObserver(publishSticky).observe(sticky);
  publishSticky();

  mq.addEventListener('change', () => apply(false));
  // `--sheet-y` and `--sheet-visible` are absolute pixel values derived from the stage height,
  // so a resize that does not cross the mobile breakpoint (rotation, the mobile URL bar) leaves
  // both stale: the sheet lands at the wrong height and the map controls no longer sit above it.
  window.addEventListener('resize', () => apply(false));
  apply(false);

  const scrollTo = (target: HTMLElement, align: 'start' | 'nearest' = 'start'): void => {
    const box = scrollEl.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const stickyH = sticky.offsetHeight;
    // The visible part of the container: the sheet may reach below the screen edge.
    const visibleBottom = Math.min(box.bottom, window.innerHeight);
    const inView = rect.top >= box.top + stickyH && rect.bottom <= visibleBottom;
    if (align === 'nearest' && inView) return;
    const top = rect.top - box.top + scrollEl.scrollTop - stickyH - SCROLL_GAP_PX;
    scrollEl.scrollTo({ top: Math.max(0, top) });
    // A guard for the phone: whatever scrolled the page away from the map, the sheet is where
    // the reader is looking now.
    if (mq.matches && window.scrollY > 0) window.scrollTo({ top: 0 });
  };

  return {
    isMobile: () => mq.matches,
    getSnap: () => snap,
    snap: (to) => setSnap(to),
    ensureAtLeast(min) {
      if (ORDER.indexOf(snap) < ORDER.indexOf(min)) setSnap(min);
    },
    coveredPx: () => (mq.matches ? visibleFor(snap) : 0),
    onChange(cb) {
      listeners.push(cb);
    },
    scrollEl,
    scrollTo,
  };
}

interface SheetTouchHooks {
  active(): boolean;
  snap(): SheetSnap;
  begin(y: number, t: number): void;
  move(y: number, t: number): void;
  end(y: number, wasDrag: boolean): void;
}

/**
 * Standard bottom-sheet touch behaviour on the scroll container. On the sticky header (outside
 * its controls) a vertical swipe moves the sheet. In the content it does so only at the edges:
 * up while the sheet is not full yet, down while the content is scrolled to its top. Everything
 * else is a normal scroll of the panel, which `overscroll-behavior: contain` keeps from reaching
 * the page. Taps are never touched: a drag is decided only after the finger moved.
 */
function wireSheetTouch(scrollEl: HTMLElement, sticky: HTMLElement, hooks: SheetTouchHooks): void {
  let startX = 0;
  let startY = 0;
  let fromSticky = false;
  let state: 'idle' | 'deciding' | 'sheet' | 'native' = 'idle';

  scrollEl.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      if (!hooks.active() || e.touches.length !== 1 || !t) {
        state = 'idle';
        return;
      }
      const target = e.target as Element;
      fromSticky = sticky.contains(target);
      // Inputs keep their own gestures (text selection, the date picker, the suggestion list).
      state = target.closest('input, textarea, select, [role="listbox"]') ? 'native' : 'deciding';
      startX = t.clientX;
      startY = t.clientY;
    },
    { passive: true },
  );

  scrollEl.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0];
      if (!t || state === 'idle' || state === 'native') return;
      if (state === 'deciding') {
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          state = 'native';
          return;
        }
        const up = dy < 0;
        const sheet = fromSticky || (up ? hooks.snap() !== 'full' : scrollEl.scrollTop <= 0);
        if (!sheet) {
          state = 'native';
          return;
        }
        state = 'sheet';
        hooks.begin(startY, e.timeStamp);
      }
      e.preventDefault();
      hooks.move(t.clientY, e.timeStamp);
    },
    { passive: false },
  );

  const finish = (e: TouchEvent): void => {
    const t = e.changedTouches[0];
    if (state === 'sheet') hooks.end(t ? t.clientY : startY, true);
    state = 'idle';
  };
  scrollEl.addEventListener('touchend', finish);
  scrollEl.addEventListener('touchcancel', finish);
}
