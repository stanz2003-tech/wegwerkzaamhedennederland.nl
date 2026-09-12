/**
 * Panel behaviour: floating side panel on desktop; on ≤ 768 px a bottom sheet with a drag handle
 * and three snap states (peek / half / full) driven by pointer events. The map stays usable.
 */
import { prefersReducedMotion } from './theme';

export type SheetSnap = 'peek' | 'half' | 'full';

const MOBILE_QUERY = '(max-width: 768px)';
const PEEK_PX = 128;
const HALF_RATIO = 0.5;
const FULL_GAP_PX = 8;
const DRAG_THRESHOLD_PX = 6;
const VELOCITY_SNAP = 0.5; // px/ms

export interface PanelController {
  isMobile(): boolean;
  getSnap(): SheetSnap;
  snap(to: SheetSnap): void;
  /** Ensures at least `min` is visible (never shrinks the sheet). */
  ensureAtLeast(min: SheetSnap): void;
  /** Bottom padding (px) the sheet currently covers, for map camera padding. */
  coveredPx(): number;
  onChange(cb: (snap: SheetSnap, mobile: boolean) => void): void;
}

const ORDER: SheetSnap[] = ['peek', 'half', 'full'];

export function mountPanel(panel: HTMLElement, handle: HTMLElement, host: HTMLElement): PanelController {
  const mq = window.matchMedia(MOBILE_QUERY);
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
      handle.setAttribute('aria-label', snap === 'full' ? 'Paneel verkleinen' : 'Paneel vergroten');
      handle.setAttribute('aria-expanded', snap === 'peek' ? 'false' : 'true');
    } else {
      panel.style.removeProperty('--sheet-y');
      panel.style.transition = '';
      host.style.removeProperty('--sheet-visible');
    }
    for (const l of listeners) l(snap, mobile);
  };

  const setSnap = (to: SheetSnap, animate = true): void => {
    snap = to;
    apply(animate);
  };

  /* drag */
  let dragging = false;
  let startY = 0;
  let startVisible = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let moved = false;

  handle.addEventListener('pointerdown', (e) => {
    if (!mq.matches) return;
    dragging = true;
    moved = false;
    startY = e.clientY;
    lastY = e.clientY;
    lastT = e.timeStamp;
    velocity = 0;
    startVisible = visibleFor(snap);
    handle.setPointerCapture(e.pointerId);
    panel.classList.add('is-dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > DRAG_THRESHOLD_PX) moved = true;
    const dt = Math.max(1, e.timeStamp - lastT);
    velocity = (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = e.timeStamp;
    const visible = Math.min(sheetHeight(), Math.max(PEEK_PX * 0.6, startVisible - dy));
    setY(visible, false);
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('is-dragging');
    if (!moved) {
      // Tap: toggle peek ↔ half, full → half.
      setSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half');
      return;
    }
    const visible = startVisible - (e.clientY - startY);
    let target: SheetSnap;
    if (Math.abs(velocity) > VELOCITY_SNAP) {
      const i = ORDER.indexOf(snap);
      target = velocity < 0 ? (ORDER[Math.min(i + 1, 2)] ?? 'full') : (ORDER[Math.max(i - 1, 0)] ?? 'peek');
    } else {
      target = ORDER.reduce<SheetSnap>(
        (best, s) => (Math.abs(visibleFor(s) - visible) < Math.abs(visibleFor(best) - visible) ? s : best),
        'peek',
      );
    }
    setSnap(target);
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const i = ORDER.indexOf(snap);
      setSnap(ORDER[(i + 1) % ORDER.length] ?? 'half');
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSnap(ORDER[Math.min(ORDER.indexOf(snap) + 1, 2)] ?? 'full');
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSnap(ORDER[Math.max(ORDER.indexOf(snap) - 1, 0)] ?? 'peek');
    }
  });

  mq.addEventListener('change', () => apply(false));
  // `--sheet-y` and `--sheet-visible` are absolute pixel values derived from the stage height,
  // so a resize that does not cross the mobile breakpoint (rotation, the mobile URL bar) leaves
  // both stale: the sheet lands at the wrong height and the map controls no longer sit above it.
  window.addEventListener('resize', () => apply(false));
  window.addEventListener('resize', () => apply(false));
  apply(false);

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
  };
}
