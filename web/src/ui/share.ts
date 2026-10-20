/**
 * The "Deel" button of an open melding. On a phone it opens the system share sheet (WhatsApp,
 * Berichten, Mail …); until 2026-10-20 it only copied the link with a small toast, which on a
 * phone looked like nothing happened. Where the browser has no share sheet (most desktops) the
 * link goes to the clipboard as before.
 */
import { showToast } from './toast';

export interface ShareTarget {
  url: string;
  /** What the melding is about, e.g. "Nieuwe Dijk, Exloërveen". */
  title: string;
}

/** The browser features this needs, injectable for tests. */
export interface ShareEnv {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  writeText?: (text: string) => Promise<void>;
  toast: (message: string, kind?: 'info' | 'error') => void;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'failed';

export function browserShareEnv(): ShareEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return {
    share: typeof nav?.share === 'function' ? nav.share.bind(nav) : undefined,
    canShare: typeof nav?.canShare === 'function' ? nav.canShare.bind(nav) : undefined,
    writeText: nav?.clipboard ? (text) => nav.clipboard.writeText(text) : undefined,
    toast: showToast,
  };
}

/** Text for the share sheet: the melding first, so the chat preview says what it is. */
export function shareData(target: ShareTarget): ShareData {
  const title = target.title.trim();
  return { title: title ? `${title} · Wegwerk` : 'Wegwerk', text: title || undefined, url: target.url };
}

export async function shareLink(target: ShareTarget, env: ShareEnv = browserShareEnv()): Promise<ShareOutcome> {
  const data = shareData(target);
  if (env.share && (!env.canShare || env.canShare(data))) {
    try {
      await env.share(data);
      return 'shared';
    } catch (err) {
      // Closing the share sheet is a choice, not an error: no toast.
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      // Anything else (no user activation, blocked by policy): fall through to copying.
    }
  }
  try {
    if (!env.writeText) throw new Error('no clipboard');
    await env.writeText(target.url);
    env.toast('Link gekopieerd. Plak hem in een bericht om te delen.');
    return 'copied';
  } catch {
    env.toast('Delen lukte niet. Kopieer de link uit de adresbalk.', 'error');
    return 'failed';
  }
}
