/**
 * Ad slots on content pages only (never on the map canvas).
 * Markup: <div class="ad-slot ad-slot--article" data-ad-slot="article" aria-hidden="true"></div>
 * Filled only when site.config `ads.enabled` is true: one <ins> per slot, fixed height reserved so
 * nothing jumps when the ad arrives. A slot AdSense leaves unfilled collapses (components.css),
 * and so does one whose script is blocked: that moves the text below it up once, which beats a
 * permanent empty box. Otherwise the slots stay hidden with zero height. The AdSense script itself loads once, when the page is done (`load`,
 * the page's own start-up, an idle moment: ui/ad-loader.ts); the slots wait in the
 * `window.adsbygoogle` queue until it arrives.
 * Consent: Google's own CMP ("Privacy & messaging") ships with the AdSense script; `openCmp()`
 * re-opens it for the footer link (`data-cmp-open`).
 */
import site from '../../site.config.json';
import { deferAdScript, type AdScript } from './ad-loader';
import { robotsAllowAds } from './ad-policy';
import { createCmpOpener, type GoogleFc } from './cmp';

type SlotName = 'panel' | 'list' | 'article';

const SLOT_HEIGHT: Record<SlotName, number> = { panel: 250, list: 100, article: 280 };
/**
 * The ad shape that fits each reserved box: the 250 and 280 px boxes take a rectangle (300×250,
 * 336×280); a horizontal banner there would leave most of the box empty.
 */
const SLOT_FORMAT: Record<SlotName, 'rectangle' | 'horizontal'> = { panel: 'rectangle', list: 'horizontal', article: 'rectangle' };
/** Reclamecode: ads must be recognisable; AdSense allows only "Advertenties" or "Gesponsorde links". */
const AD_LABEL = 'Advertenties';
/** Must match --ad-label-h in components.css; reserved up front so the page does not jump. */
const LABEL_HEIGHT = 20;
const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

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

/** The deferred AdSense script of this page; null until mountAds() schedules it. */
let adScript: AdScript | null = null;
const openConsentDialog = createCmpOpener(window);

/** Schedules the AdSense script once per page, for when the page is done (ui/ad-loader.ts). */
function loadAdsenseScript(client: string): AdScript | null {
  if (!adScript && !document.querySelector(`script[src^="${ADSENSE_SRC}"]`)) {
    adScript = deferAdScript(`${ADSENSE_SRC}?client=${encodeURIComponent(client)}`);
  }
  return adScript;
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
  ins.dataset.adFormat = SLOT_FORMAT[name];
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
  const script = loadAdsenseScript(client);
  slots.forEach((el) => {
    const name = el.dataset.adSlot;
    if (!isSlotName(name)) return;
    const slotId = site.ads.slots[name];
    if (!slotId) return;
    el.hidden = false;
    fillSlot(el, name, client, slotId);
    // A blocked script brings no ad: no empty box with an "Advertenties" label either.
    script?.onFail(() => {
      el.hidden = true;
    });
  });
}

/** The AdSense script also waits for this work of the page (its data, answer and map). */
export function holdAdsUntil(work: Promise<unknown>): void {
  adScript?.holdUntil(work);
}

/**
 * Re-opens Google's consent dialog, also before the deferred AdSense script has arrived (ui/cmp.ts).
 * Returns false when the CMP is not on the page (no ads here, or the script was blocked) so the
 * caller can explain that no ad cookies are in use; `onUnavailable` is also called when a script
 * that was still on its way fails afterwards.
 */
export function openCmp(onUnavailable?: () => void): boolean {
  return openConsentDialog(adScript, onUnavailable);
}

/** Wires `[data-cmp-open]` links; `onUnavailable` is called when there is no CMP to open. */
export function wireCmpLinks(onUnavailable: () => void, root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-cmp-open]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      if (!openCmp(onUnavailable)) onUnavailable();
    });
  });
}
