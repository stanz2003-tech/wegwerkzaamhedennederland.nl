/** Minimal toast: one message at a time, announced via a polite live region. */

const TOAST_MS = 3200;
let container: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function ensureContainer(): HTMLElement {
  if (container && document.body.contains(container)) return container;
  container = document.createElement('div');
  container.className = 'toast';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');
  container.hidden = true;
  document.body.appendChild(container);
  return container;
}

export function showToast(message: string, kind: 'info' | 'error' = 'info'): void {
  const el = ensureContainer();
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = false;
  // Re-trigger the enter animation.
  el.classList.remove('is-visible');
  void el.offsetWidth;
  el.classList.add('is-visible');
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    el.classList.remove('is-visible');
    hideTimer = setTimeout(() => {
      el.hidden = true;
    }, 300);
  }, TOAST_MS);
}
