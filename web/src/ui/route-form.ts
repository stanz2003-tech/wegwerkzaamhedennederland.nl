/**
 * "Route plannen": Van and Naar, a swap button, "Mijn locatie" and one submit. Typed text without
 * a picked suggestion is resolved to PDOK's first hit on submit, as a route planner is expected
 * to do. The form only collects two stops; ui/route-controller.ts does everything after that.
 */
import type { Stop } from '../data/routing';
import { inStopBounds, type RouteStops } from '../data/url-state';
import { ICONS } from './icons';
import { mountStopInput } from './stop-input';

const GEO_TIMEOUT_MS = 10_000;
const MY_LOCATION = 'Mijn locatie';
/** "Mijn locatie" goes into the address bar: about 100 m is enough to start a route, and less precise to share. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface RouteForm {
  root: HTMLElement;
  /** Fills the fields (editing a route that is on screen) or clears them. */
  set(stops: RouteStops | null): void;
  focus(): void;
}

export interface RouteFormCallbacks {
  onSubmit(stops: RouteStops): void;
  onCancel(): void;
}

export function mountRouteForm(root: HTMLElement, cb: RouteFormCallbacks): RouteForm {
  root.innerHTML = `<form class="route-form" novalidate aria-labelledby="route-form-title">
      <div class="route-form__head">
        <h2 class="route-form__title" id="route-form-title">${ICONS.route}<span>Route plannen</span></h2>
        <button type="button" class="btn btn--ghost route-form__close" data-route-cancel aria-label="Route plannen sluiten">${ICONS.x}</button>
      </div>
      <p class="route-form__intro">Zie welke wegwerkzaamheden op je route liggen, en de snelste route eromheen.</p>
      <div class="route-form__stops">
        <div data-stop-from></div>
        <button type="button" class="btn btn--ghost route-form__swap" data-route-swap aria-label="Van en naar omwisselen" title="Omwisselen">${ICONS.arrowUpDown}</button>
        <div data-stop-to></div>
      </div>
      <button type="button" class="route-form__here" data-route-here>${ICONS.navigation}<span>Vertrek vanaf mijn locatie</span></button>
      <p class="route-form__error" role="alert" hidden></p>
      <button type="submit" class="btn btn--primary route-form__go">${ICONS.search}<span>Bekijk mijn route</span></button>
    </form>`;
  const form = root.querySelector<HTMLFormElement>('form');
  const fromEl = root.querySelector<HTMLElement>('[data-stop-from]');
  const toEl = root.querySelector<HTMLElement>('[data-stop-to]');
  const errorEl = root.querySelector<HTMLElement>('.route-form__error');
  const hereBtn = root.querySelector<HTMLButtonElement>('[data-route-here]');
  if (!form || !fromEl || !toEl || !errorEl || !hereBtn) throw new Error('route-form markup ontbreekt');

  const from = mountStopInput(fromEl, { id: 'route-from', label: 'Van', placeholder: 'Adres of plaats van vertrek' });
  const to = mountStopInput(toEl, { id: 'route-to', label: 'Naar', placeholder: 'Adres of plaats van bestemming' });
  if (!('geolocation' in navigator)) hereBtn.hidden = true;

  const showError = (text: string): void => {
    errorEl.textContent = text;
    errorEl.hidden = text === '';
  };

  const resolve = async (input: typeof from, what: string): Promise<Stop | null> => {
    let unreachable = false;
    const stop =
      input.get() ??
      (await input.resolveTyped().catch(() => {
        unreachable = true;
        return null;
      }));
    if (stop) return stop;
    if (unreachable) showError('De adreszoeker van PDOK is niet bereikbaar. Probeer het zo nog eens.');
    else showError(input.typed() ? `We vinden “${input.typed()}” niet. Kies een suggestie uit de lijst.` : `Vul ${what} in.`);
    return null;
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    showError('');
    void (async () => {
      const a = await resolve(from, 'een vertrekpunt');
      if (!a) return from.focus();
      const b = await resolve(to, 'een bestemming');
      if (!b) return to.focus();
      if (Math.abs(a.lon - b.lon) < 1e-4 && Math.abs(a.lat - b.lat) < 1e-4) {
        showError('Vertrek en bestemming zijn dezelfde plek.');
        return to.focus();
      }
      cb.onSubmit({ from: a, to: b });
    })();
  });

  root.querySelector('[data-route-swap]')?.addEventListener('click', () => {
    const a = from.get();
    const b = to.get();
    from.set(b);
    to.set(a);
  });

  root.querySelector('[data-route-cancel]')?.addEventListener('click', () => cb.onCancel());
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cb.onCancel();
    }
  });

  hereBtn.addEventListener('click', () => {
    showError('');
    hereBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        hereBtn.disabled = false;
        const lon = round3(pos.coords.longitude);
        const lat = round3(pos.coords.latitude);
        if (!inStopBounds(lon, lat)) {
          showError('Je locatie ligt buiten Nederland. Typ je vertrekpunt.');
          return;
        }
        from.set({ name: MY_LOCATION, lon, lat });
        to.focus();
      },
      () => {
        hereBtn.disabled = false;
        showError('Je locatie is niet beschikbaar. Typ je vertrekpunt.');
      },
      { timeout: GEO_TIMEOUT_MS, maximumAge: 60_000 },
    );
  });

  return {
    root,
    set(stops) {
      from.set(stops?.from ?? null);
      to.set(stops?.to ?? null);
      showError('');
    },
    focus() {
      if (from.get()) to.focus();
      else from.focus();
    },
  };
}
