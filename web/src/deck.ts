// The deck, in the browser: open a PDF, draw each slide, read its words WITH their positions,
// and highlight the exact words the presenter points at. pdf.js knows where every piece of text sits
// on the slide, so pointing at "chlorophyll absorbs red and blue light" is exact, not a guess from a picture.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const MAX_SLIDES = 20;
type Piece = { str: string; x: number; y: number; w: number; h: number }; // position as fractions of the slide
export type Slide = { n: number; text: string; pieces: Piece[]; ratio: number };
export type Deck = { title: string; slides: Slide[]; total: number; draw: (n: number, canvas: HTMLCanvasElement, cssWidth: number) => Promise<void> };
export type Box = { x: number; y: number; w: number; h: number };

/** Letter-spaced headings come out as "W H Y": join them, but leave normal words like "I am" alone. */
const unspace = (s: string) => (/^([A-Z0-9]{1,2} )+[A-Z0-9]{1,2}$/.test(s) || /^(\S ){2,}\S$/.test(s) ? s.replace(/ /g, '') : s);

/** Opens a PDF (a URL or the bytes of an uploaded file) and reads up to 20 slides. */
export async function loadDeck(src: string | ArrayBuffer): Promise<Deck> {
  const doc = await pdfjs.getDocument(typeof src === 'string' ? { url: src } : { data: new Uint8Array(src) }).promise;
  const count = Math.min(doc.numPages, MAX_SLIDES);
  const slides: Slide[] = [];
  for (let n = 1; n <= count; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const pieces: Piece[] = []; let text = ''; let prev: { y: number; end: number; short: boolean } | null = null;
    for (const it of content.items as any[]) {
      if (!it.str) continue;
      const [, , c, d, e, f] = it.transform; const size = Math.hypot(c, d) || 12;
      const short = it.str.trim().length <= 2;
      if (prev) {
        if (Math.abs(f - prev.y) > size * 0.5) text += '\n';
        else if (e - prev.end > size * (short && prev.short ? 0.38 : 0.2) && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
      }
      text += unspace(it.str); prev = { y: f, end: e + it.width, short };
      // the piece's box on the slide (PDF y runs upwards from the bottom)
      const [x0, y0] = vp.convertToViewportPoint(e, f + size * 0.85);
      pieces.push({ str: unspace(it.str), x: x0 / vp.width, y: y0 / vp.height, w: it.width / vp.width, h: (size * 1.1) / vp.height });
    }
    slides.push({ n, text: text.replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim(), pieces, ratio: vp.width / vp.height });
  }
  if (!slides.some((s) => s.text.replace(/\W/g, '').length > 3)) throw new Error('no-text');
  const first = slides[0].text.split('\n').filter((l) => l.length > 3);
  const title = (first.find((l) => /[a-z]/.test(l)) || first[0] || 'The lesson').slice(0, 120);
  return {
    title, slides, total: doc.numPages,
    async draw(n, canvas, cssWidth) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (cssWidth / base.width) * dpr });
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
    },
  };
}

/**
 * Where are these words on the slide? Matches the quote against the slide's pieces of text, ignoring
 * spaces, case and punctuation, and returns one box per line of text it covers. Empty when not found.
 */
export function findQuote(slide: Slide, quote: string): Box[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const q = norm(quote); if (q.length < 3) return [];
  let all = ''; const owner: number[] = [];
  slide.pieces.forEach((p, i) => { const k = norm(p.str); all += k; for (let j = 0; j < k.length; j++) owner.push(i); });
  const at = all.indexOf(q); if (at < 0) return [];
  const used = [...new Set(owner.slice(at, at + q.length))].map((i) => slide.pieces[i]);
  const lines: Box[] = [];
  for (const p of used) {
    const line = lines.find((b) => Math.abs(b.y - p.y) < p.h * 0.5);
    if (line) { const r = Math.max(line.x + line.w, p.x + p.w); line.x = Math.min(line.x, p.x); line.w = r - line.x; line.h = Math.max(line.h, p.h); }
    else lines.push({ ...p });
  }
  return lines;
}
