import type { Clip, ClipMeta } from './Clip';

/**
 * The global video feed. It needs a small server (see server/feed-server.mjs) that you run yourself: this game is a
 * static page and has no backend of its own. Point the game at it with `?feed=https://your-server` once (it is
 * remembered) or from the computer's GLOBAL tab. Without one, the global tab just says so.
 */
const KEY = 'satismonke.feed';

export function feedUrl(): string {
  try {
    const q = new URLSearchParams(location.search).get('feed');
    if (q !== null) { if (q) localStorage.setItem(KEY, q); else localStorage.removeItem(KEY); }
    return (localStorage.getItem(KEY) ?? '').replace(/\/+$/, '');
  } catch { return ''; }
}

const j = async <T>(r: Response): Promise<T> => { if (!r.ok) throw new Error(`${r.status}`); return r.json() as Promise<T>; };

export const globalFeed = {
  get configured(): boolean { return !!feedUrl(); },
  async list(): Promise<ClipMeta[]> { return j<ClipMeta[]>(await fetch(`${feedUrl()}/clips?limit=24`)); },
  async get(id: string): Promise<Clip> { return j<Clip>(await fetch(`${feedUrl()}/clips/${encodeURIComponent(id)}`)); },
  async publish(c: Clip): Promise<{ id: string }> {
    return j(await fetch(`${feedUrl()}/clips`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) }));
  },
  async report(id: string): Promise<void> { await fetch(`${feedUrl()}/clips/${encodeURIComponent(id)}/report`, { method: 'POST' }); },
};
