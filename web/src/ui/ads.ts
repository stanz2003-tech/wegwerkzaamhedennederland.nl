/**
 * Ad slots on content pages only (never on the map canvas).
 * Markup: <div class="ad-slot ad-slot--article" data-ad-slot="article" aria-hidden="true"></div>
 * Filled only when site.config `ads.enabled` is true: AdSense script once, one <ins> per slot,
 * fixed height reserved (CLS 0). Otherwise the slots stay hidden with zero height.
 * Consent: Google's own CMP ("Privacy & messaging") ships with the AdSense script; `openCmp()`
 * re-opens it for the footer link (`data-cmp-open`).
 */
import site from '../../site.config.json';
import { robotsAllowAds } from './ad-policy';

type SlotName = 'panel' | 'list' | 'article';

const SLOT_HEIGHT: Record<SlotName, number> = { panel: 250, list: 100, article: 280 };
/** Reclamecode: ads must be recognisable; AdSense allows only "Advertenties" or "Gesponsorde links". */
const AD_LABEL = 'Advertenties';
/** Must match --ad-label-h in components.css; reserved up front so the page does not jump. */
const LABEL_HEIGHT = 20;
const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

interface GoogleFc {
  callbackQueue?: { push(cb: Record<string, () => void>): void };
  showRevocationMessage?(): void;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
    __ADS_ENABLED__?: boolean;
    googlefc?: GoogleFc;
  }
}

function isSlotName(v: string | undefined): v is SlotName {
  return v === 'panel' || v === 'list' || v === 'article';
}

export function adsEnabled(): boolean {
  return site.ads?.enabled === true && typeof site.ads.adsenseClient === 'string' && site.ads.adsenseClient.length > 0;
}

let scriptLoaded = false;

function loadAdsenseScript(client: string): void {
  if (scriptLoaded || document.querySelector(`script[src^="${ADSENSE_SRC}"]`)) {
    scriptLoaded = true;
    return;
  }
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `${ADSENSE_SRC}?client=${encodeURIComponent(client)}`;
  document.head.appendChild(s);
  scriptLoaded = true;
}

function fillSlot(el: HTMLElement, name: SlotName, client: string, slotId: string): void {
  if (el.dataset.adFilled === '1') return;
  el.dataset.adFilled = '1';
  el.classList.add('is-enabled');
  el.style.height = `${SLOT_HEIGHT[name] + LABEL_HEIGHT}px`;
  el.removeAttribute('aria-hidden');
  el.setAttribute('aria-label', 'Advertentie');
  const label = document.createElement('span');
  label.className = 'ad-slot__label';
  label.textContent = AD_LABEL;
  label.setAttribute('aria-hidden', 'true'); // the slot's aria-label already says it
  el.appendChild(label);
  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.style.height = `${SLOT_HEIGHT[name]}px`;
  ins.dataset.adClient = client;
  ins.dataset.adSlot = slotId;
  ins.dataset.adFormat = name === 'panel' ? 'rectangle' : 'horizontal';
  ins.dataset.fullWidthResponsive = 'false';
  el.appendChild(ins);
  (window.adsbygoogle = window.adsbygoogle ?? []).push({});
}

/** Wires every `[data-ad-slot]` in `root`. Safe to call more than once (idempotent per slot). */
export function mountAds(root: ParentNode = document): void {
  const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content;
  const enabled = adsEnabled() && robotsAllowAds(robots);
  window.__ADS_ENABLED__ = enabled;
  const slots = root.querySelectorAll<HTMLElement>('[data-ad-slot]');
  if (!enabled) {
    slots.forEach((el) => {
      el.hidden = true;
    });
    return;
  }
  const client = site.ads.adsenseClient;
  loadAdsenseScript(client);
  slots.forEach((el) => {
    const name = el.dataset.adSlot;
    if (!isSlotName(name)) return;
    const slotId = site.ads.slots[name];
    if (!slotId) return;
    el.hidden = false;
    fillSlot(el, name, client, slotId);
  });
}

/**
 * Re-opens Google's consent dialog. Returns false when the CMP is not on the page (ads disabled
 * or script blocked) so the caller can explain that no ad cookies are in use.
 */
export function openCmp(): boolean {
  const fc = window.googlefc;
  if (!fc?.callbackQueue) return false;
  fc.callbackQueue.push({
    CONSENT_DATA_READY: () => {
      fc.showRevocationMessage?.();
    },
  });
  return true;
}

/** Wires `[data-cmp-open]` links; `onUnavailable` is called when there is no CMP to open. */
export function wireCmpLinks(onUnavailable: () => void, root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-cmp-open]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      if (!openCmp()) onUnavailable();
    });
  });
}
