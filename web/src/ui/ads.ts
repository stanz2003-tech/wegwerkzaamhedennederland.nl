/**
 * Ad slots on the content pages, and one in the panel of the map page, under the text of an
 * opened melding (`panel`, wired by `renewableSlot` for ui/panel-ad.ts); never on the map itself.
 * Markup: <div class="ad-slot ad-slot--article" data-ad-slot="article" aria-hidden="true"></div>
 * Filled only when site.config `ads.enabled` is true: one <ins> per slot, fixed height reserved so
 * nothing jumps when the ad arrives. A slot AdSense leaves unfilled collapses (components.css),
 * and so does one whose script is blocked: that moves the text below it up once, which beats a
 * permanent empty box. Otherwise the slots stay hidden with zero height.
 * Two kinds of slot: `top` stands high on the page (under the small map, or between two sections
 * of a guide), keeps its room from the first paint and asks for its ad as soon as the script is
 * there; `side` is its neighbour in the same row, on screens wide enough for two columns only;
 * `feed` stands inside the list of meldingen, after the first dozen rows, on narrower screens only
 * (ui/entity-list.ts builds the list around it and never takes it out of the page);
 * every other slot stands further down and only opens when the reader comes near
 * (ui/ad-lazy.ts), so an ad nobody scrolls to is never requested.
 * The AdSense script itself loads once, when the page is done (`load`,
 * the page's own start-up, an idle moment: ui/ad-loader.ts); the slots wait in the
 * `window.adsbygoogle` queue until it arrives.
 * Consent: Google's own CMP ("Privacy & messaging") ships with the AdSense script; `openCmp()`
 * re-opens it for the footer link (`data-cmp-open`).
 */
import site from '../../site.config.json';
import { hideIfNotTaken, slotTaken } from './ad-fill';
import { standsApart, whenNear, type Span } from './ad-lazy';
import { deferAdScript, type AdScript } from './ad-loader';
import { pageAllowsAds } from './ad-policy';
import { createCmpOpener, type GoogleFc } from './cmp';

type SlotName = 'panel' | 'list' | 'article' | 'top' | 'side' | 'feed';

const SLOT_HEIGHT: Record<SlotName, number> = { panel: 250, list: 100, article: 280, top: 280, side: 280, feed: 280 };
/**
 * The ad shape that fits each reserved box: the 250 and 280 px boxes take a rectangle (300×250,
 * 336×280); a horizontal banner there would leave most of the box empty.
 */
const SLOT_FORMAT: Record<SlotName, 'rectangle' | 'horizontal'> = { panel: 'rectangle', list: 'horizontal', article: 'rectangle', top: 'rectangle', side: 'rectangle', feed: 'rectangle' };
/** The slots high on the page: shown from the first paint. The others wait for the reader (ui/ad-lazy.ts). */
const EAGER_SLOTS: ReadonlySet<SlotName> = new Set<SlotName>(['top', 'side']);
/**
 * From here the road and place pages have two columns (pages.css): room for two rectangles side by
 * side. Narrower, `side` would stand right under `top`: two ads on one screen.
 */
const TWO_COLUMNS = '(min-width: 1024px)';
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
  return v === 'panel' || v === 'list' || v === 'article' || v === 'top' || v === 'side' || v === 'feed';
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

/** Opens the slot's box: its reserved room and the "Advertenties" label. */
function openBox(el: HTMLElement, name: SlotName): void {
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
}

/** Back to the state before `openBox`: no room, no label, nothing for a screen reader. */
function closeBox(el: HTMLElement): void {
  delete el.dataset.adFilled;
  el.classList.remove('is-enabled');
  el.style.height = '';
  el.removeAttribute('aria-label');
  el.setAttribute('aria-hidden', 'true');
  el.replaceChildren();
}

/** Puts a new `<ins>` in the slot's open box and queues it for AdSense. */
function requestAd(el: HTMLElement, name: SlotName, client: string, slotId: string): HTMLElement {
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
  return ins;
}

/** Opens the slot and asks for its ad; null when the slot was already filled. */
function fillSlot(el: HTMLElement, name: SlotName, client: string, slotId: string): HTMLElement | null {
  if (el.dataset.adFilled === '1') return null;
  openBox(el, name);
  return requestAd(el, name, client, slotId);
}

/** A slot of this page that has an AdSense ad unit to show. */
interface PageSlot {
  el: HTMLElement;
  name: SlotName;
  slotId: string;
}

/**
 * The ad unit of a slot. `top` and `side` borrow the unit of the slot before them until they have
 * one of their own in site.config, and so does `feed`. A screen shows either `side` (room for two
 * columns: three ads with the one under the list) or `feed` (one column, where the list is long).
 */
function slotIdFor(name: SlotName): string {
  const slots = site.ads.slots;
  if (name === 'top') return slots.top || slots.article;
  if (name === 'side') return window.matchMedia(TWO_COLUMNS).matches ? slots.side || slots.top || slots.article : '';
  if (name === 'feed') return window.matchMedia(TWO_COLUMNS).matches ? '' : slots.feed || slots.article;
  return slots[name];
}

/** The slots in `root` that can show an ad and are not wired yet. */
function pageSlots(root: ParentNode): PageSlot[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-ad-slot]')).flatMap((el) => {
    const name = el.dataset.adSlot;
    if (!isSlotName(name) || el.dataset.adFilled === '1' || el.dataset.adSkipped === '1' || el.classList.contains('is-waiting')) return [];
    const slotId = slotIdFor(name);
    return slotId ? [{ el, name, slotId }] : [];
  });
}

/** Where a slot stands on the page right now; a hidden or collapsed slot has no height. */
function spanOf(el: HTMLElement): Span {
  const box = el.getBoundingClientRect();
  return { top: box.top, bottom: box.bottom };
}

/** True when AdSense has taken this slot's `<ins>`: an ad is there or on its way. */
function hasAd(el: HTMLElement): boolean {
  const ins = el.querySelector('ins.adsbygoogle');
  return ins !== null && slotTaken(ins);
}

/** True when ads are on for the site and this page may carry them (ui/ad-policy.ts). */
function pageShowsAds(): boolean {
  const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content;
  const adsMeta = document.querySelector<HTMLMetaElement>('meta[name="wegwerk-ads"]')?.content;
  return adsEnabled() && pageAllowsAds(robots, adsMeta);
}

/** Wires every `[data-ad-slot]` in `root`. Safe to call more than once (idempotent per slot). */
export function mountAds(root: ParentNode = document): void {
  const enabled = pageShowsAds();
  window.__ADS_ENABLED__ = enabled;
  if (!enabled) {
    root.querySelectorAll<HTMLElement>('[data-ad-slot]').forEach((el) => {
      el.hidden = true;
    });
    return;
  }
  const client = site.ads.adsenseClient;
  const script = loadAdsenseScript(client);
  const slots = pageSlots(root);
  let retired = false;
  let cancels: ReadonlyArray<() => void> = [];
  /**
   * No ad will come: the script is blocked, or an ad blocker's stand-in loaded in its place and
   * never takes a slot (ui/ad-fill.ts). No empty box with an "Advertenties" label then, neither
   * the slots on screen nor the ones still waiting; a slot that does carry an ad stays.
   */
  const retire = (): void => {
    retired = true;
    cancels.forEach((cancel) => cancel());
    slots.forEach(({ el }) => {
      if (hasAd(el)) return;
      el.dataset.adSkipped = '1';
      el.hidden = true;
    });
  };
  const show = (slot: PageSlot): void => {
    if (retired) return;
    slot.el.classList.remove('is-waiting');
    const ins = fillSlot(slot.el, slot.name, client, slot.slotId);
    if (ins) script?.onLoaded(() => hideIfNotTaken(ins, retire));
  };
  /** A waiting slot opens only with a screen of page between it and the ads already shown. */
  const showIfApart = (slot: PageSlot): void => {
    if (retired) return;
    const shown = slots.filter((other) => other !== slot && other.el.classList.contains('is-enabled')).map((other) => spanOf(other.el));
    if (standsApart(spanOf(slot.el), shown.filter((span) => span.bottom > span.top), window.innerHeight)) {
      show(slot);
      return;
    }
    slot.el.classList.remove('is-waiting');
    slot.el.dataset.adSkipped = '1'; // for this page view: a second mountAds() leaves it alone
    slot.el.hidden = true;
  };
  cancels = slots.map((slot) => {
    slot.el.hidden = false;
    if (EAGER_SLOTS.has(slot.name)) {
      show(slot);
      return () => undefined;
    }
    slot.el.classList.add('is-waiting');
    return whenNear(slot.el, () => showIfApart(slot));
  });
  script?.onFail(retire);
}

/** A slot whose ad can be replaced by a new one (ui/panel-ad.ts decides when). */
export interface RenewableSlot {
  /** Puts a fresh ad in the slot; the one before it, if any, leaves the page. */
  show(): void;
  /** Calls `cb` once, when the slot comes within reach of the reader; returns the cancel. */
  whenInReach(cb: () => void): () => void;
  /** Takes the ad and its box out of the page: the reader left what it stood in. */
  clear(): void;
}

const NO_CANCEL = (): void => undefined;

/**
 * The slot inside an opened melding on the map (`panel`). Unlike the slots `mountAds` wires it
 * loads nothing by itself: the AdSense script, and Google's consent dialog with it, are fetched
 * when the first melding is opened (`whenInReach`), so a visitor who only looks at the map never
 * downloads them. Null when this page or this slot shows no ads.
 */
export function renewableSlot(el: HTMLElement | null): RenewableSlot | null {
  const name = el?.dataset.adSlot;
  if (!el || !isSlotName(name)) return null;
  const slotId = pageShowsAds() ? slotIdFor(name) : '';
  if (!slotId) {
    el.hidden = true;
    return null;
  }
  const client = site.ads.adsenseClient;
  let script: AdScript | null = null;
  let retired = false;
  /** No ad will come (script blocked, or an ad blocker's stand-in): the slot leaves for good. */
  const retire = (): void => {
    retired = true;
    el.classList.remove('is-waiting');
    el.hidden = true;
  };
  const ensureScript = (): AdScript | null => {
    if (script) return script;
    script = loadAdsenseScript(client);
    script?.onFail(retire);
    return script;
  };

  return {
    show() {
      if (retired) return;
      el.classList.remove('is-waiting');
      // The ad that was there leaves the page; its box stays, so nothing around it moves.
      el.querySelector('ins.adsbygoogle')?.remove();
      if (el.dataset.adFilled !== '1') openBox(el, name);
      const ins = requestAd(el, name, client, slotId);
      ensureScript()?.onLoaded(() =>
        hideIfNotTaken(ins, () => {
          if (ins.isConnected) retire();
        }),
      );
    },
    whenInReach(cb) {
      if (retired) return NO_CANCEL;
      ensureScript();
      // A box AdSense left unfilled is collapsed (components.css) and could never come into reach.
      if (el.querySelector("ins.adsbygoogle[data-ad-status='unfilled']")) closeBox(el);
      if (el.dataset.adFilled !== '1') el.classList.add('is-waiting');
      return whenNear(el, cb);
    },
    clear() {
      if (retired) return;
      el.classList.remove('is-waiting');
      closeBox(el);
    },
  };
}

/** The AdSense script also waits for this work of the page (its data, answer and map). */
export function holdAdsUntil(work: Promise<unknown>): void {
  adScript?.holdUntil(work);
}

/**
 * Re-opens Google's consent dialog, also before the deferred AdSense script has arrived (ui/cmp.ts).
 * Returns false when the CMP is not on the page (no ads here, or the script was blocked) so the
 * caller can explain that no ad cookies are in use; `onUnavailable` is also called when a script
 * that was still on its way fails afterwards. On the map the script is not there before the first
 * melding is opened, while the reader may have answered the dialog on a text page: the link
 * fetches it then.
 */
export function openCmp(onUnavailable?: () => void): boolean {
  if (!adScript && pageShowsAds()) loadAdsenseScript(site.ads.adsenseClient);
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
