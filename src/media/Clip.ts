/** A short in-game video: a few JPEG frames played back like a flipbook. Small enough to share. */
export const CLIP_W = 320, CLIP_H = 180;
export const MAX_FRAMES = 120;

export type FilterId = 'none' | 'sepia' | 'noir' | 'vhs' | 'neon' | 'pixel';
export const FILTERS: { id: FilterId; name: string }[] = [
  { id: 'none', name: 'NORMAL' }, { id: 'sepia', name: 'SEPIA' }, { id: 'noir', name: 'NOIR' },
  { id: 'vhs', name: 'VHS' }, { id: 'neon', name: 'NEON' }, { id: 'pixel', name: 'PIXEL' },
];
/** Captions are picked from a list: no free text, so nothing can be written that was not put there by the game. */
export const CAPTIONS = ['', 'Epic!', 'Base tour', 'Look at this!', 'Monke moment', 'Factory flex', 'Night shift', 'Explorer log'];

export interface Clip {
  id: string;
  /** Who made it (the generated name and fur colour). */
  author: string; color: number;
  title: string; caption: string;
  /** Frames per second to play at. */
  fps: number;
  created: number;
  /** JPEG data URLs, CLIP_W x CLIP_H. */
  frames: string[];
  /** Where it came from when you see it in a list. */
  source?: 'mine' | 'lobby' | 'global';
}

/** Light-weight listing entry (the global feed sends these, without the frames). */
export interface ClipMeta { id: string; author: string; color: number; title: string; caption: string; fps: number; created: number; thumb: string; frameCount: number }

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Apply a filter to whatever is drawn on a canvas, in place. */
export function applyFilter(ctx: CanvasRenderingContext2D, w: number, h: number, f: FilterId, t = 0): void {
  if (f === 'none') return;
  if (f === 'pixel') {
    const tmp = document.createElement('canvas'); tmp.width = Math.round(w / 5); tmp.height = Math.round(h / 5);
    const g = tmp.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(ctx.canvas, 0, 0, tmp.width, tmp.height);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(tmp, 0, 0, w, h); ctx.imageSmoothingEnabled = true; return;
  }
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  if (f === 'vhs') {
    const src = new Uint8ClampedArray(d), shift = 4;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, xr = Math.min(w - 1, x + shift), xb = Math.max(0, x - shift), ir = (y * w + xr) * 4, ib = (y * w + xb) * 4;
      const scan = y % 3 === 0 ? 0.78 : 1, noise = (((x * 7 + y * 13 + Math.floor(t * 30) * 17) % 23) - 11) * 0.7;
      d[i] = Math.min(255, Math.max(0, src[ir] * scan + noise)); d[i + 1] = Math.min(255, Math.max(0, src[i + 1] * scan + noise)); d[i + 2] = Math.min(255, Math.max(0, src[ib + 2] * scan + noise));
    }
  } else for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (f === 'sepia') { d[i] = Math.min(255, l * 1.07 + 28); d[i + 1] = Math.min(255, l * 0.86 + 14); d[i + 2] = Math.min(255, l * 0.62); }
    else if (f === 'noir') { const v = Math.min(255, Math.max(0, (l - 128) * 1.35 + 124)); d[i] = d[i + 1] = d[i + 2] = v; }
    else if (f === 'neon') { const m = (r + g + b) / 3; d[i] = Math.min(255, m + (r - m) * 2.4 + 12); d[i + 1] = Math.min(255, m + (g - m) * 2.4); d[i + 2] = Math.min(255, m + (b - m) * 2.4 + 30); }
  }
  ctx.putImageData(img, 0, 0);
}

/** Draw a caption (if any) as a lower-third on a frame. */
export function drawCaption(ctx: CanvasRenderingContext2D, w: number, h: number, caption: string): void {
  if (!caption) return;
  ctx.fillStyle = 'rgba(8,12,24,0.65)'; ctx.fillRect(0, h - 34, w, 34);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(caption, w / 2, h - 17); ctx.textBaseline = 'alphabetic';
}

export const toJpeg = (c: HTMLCanvasElement, q = 0.62): string => c.toDataURL('image/jpeg', q);

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad frame')); i.src = url; });
}

/** Re-encode frames with edits: trim to [from, to), reverse, speed (the playback fps), filter and caption. */
export async function editFrames(clip: Clip, o: { from: number; to: number; reverse: boolean; filter: FilterId; caption: string }): Promise<string[]> {
  const frames = clip.frames.slice(o.from, Math.max(o.from + 1, o.to));
  if (o.reverse) frames.reverse();
  if (o.filter === 'none' && o.caption === clip.caption) return frames;
  const c = document.createElement('canvas'); c.width = CLIP_W; c.height = CLIP_H; const g = c.getContext('2d')!, out: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    g.drawImage(await loadImage(frames[i]), 0, 0, CLIP_W, CLIP_H);
    applyFilter(g, CLIP_W, CLIP_H, o.filter, i / clip.fps);
    if (o.caption && o.caption !== clip.caption) drawCaption(g, CLIP_W, CLIP_H, o.caption);
    out.push(toJpeg(c));
  }
  return out;
}

// ---- your clips live in the browser (IndexedDB) ----
const DB = 'satismonke-clips', STORE = 'clips';
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise((res, rej) => { const t = db.transaction(STORE, mode), r = fn(t.objectStore(STORE)); t.oncomplete = () => { db.close(); res(r.result); }; t.onerror = () => { db.close(); rej(t.error); }; });
};
export const clipStore = {
  put: (c: Clip) => tx('readwrite', s => s.put(c)).then(() => undefined),
  all: (): Promise<Clip[]> => tx('readonly', s => s.getAll() as IDBRequest<Clip[]>).then(a => a.sort((x, y) => y.created - x.created)),
  delete: (id: string) => tx('readwrite', s => s.delete(id)).then(() => undefined),
};

export const metaOf = (c: Clip): ClipMeta => ({ id: c.id, author: c.author, color: c.color, title: c.title, caption: c.caption, fps: c.fps, created: c.created, thumb: c.frames[0] ?? '', frameCount: c.frames.length });
