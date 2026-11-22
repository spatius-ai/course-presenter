// Course presenter: a Spatius avatar presents your PDF slides, and stops to answer when you raise your hand.
import './presenter.css';
import { canDraw, initSdk, loadSeat, type Seat } from './seat';
import { loadDeck, findQuote, type Deck } from './deck';

type Lang = 'en' | 'es' | 'zh' | 'ar' | 'fr';
type Choices = { lang: Lang; face: string };
type Q = { question: string; options: string[]; answer: number; explain: string };
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const $$ = <T extends HTMLElement = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
const esc = (t: string) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const track = (name: string, props: Record<string, unknown> = {}) => { if (parent !== window) parent.postMessage({ type: 'spatius-event', demo: 'course-presenter', name, props }, '*'); };
const SAMPLE = 'assets/cp/sample-deck.pdf';

// words on the page itself, in the language the learner picked
const UI: Record<Lang, { listening: string; back: string; right: string; wrong: string; next: string; done: string; again: string; check: string; quiz: string; slide: string; turned: string; over: string; noText: string; noFile: string; first20: string; presenter: string }> = {
  en: { listening: 'Yes? What is your question?', back: 'Good question. Back to where we were.', right: 'Correct!', wrong: 'Not quite.', next: 'Continue', done: 'Finish', again: 'Start again', check: 'Quick check', quiz: 'Final quiz', slide: 'Slide', turned: 'From slide', over: 'That is the end of this session. Press Start the lesson to begin again.', noText: "These slides have no text I can read. Try a PDF exported from your slide app.", noFile: "This file can't be opened. Export your slides as a PDF and try again.", first20: 'Only the first 20 slides are used.', presenter: 'Presenter' },
  es: { listening: '¿Sí? ¿Cuál es tu pregunta?', back: 'Buena pregunta. Volvamos a donde estábamos.', right: '¡Correcto!', wrong: 'No exactamente.', next: 'Continuar', done: 'Terminar', again: 'Empezar de nuevo', check: 'Comprobación rápida', quiz: 'Cuestionario final', slide: 'Diapositiva', turned: 'De la diapositiva', over: 'Aquí termina esta sesión. Pulsa Start the lesson para empezar de nuevo.', noText: 'Estas diapositivas no tienen texto que pueda leer. Prueba con un PDF exportado desde tu aplicación.', noFile: 'No se puede abrir este archivo. Exporta tus diapositivas como PDF e inténtalo de nuevo.', first20: 'Solo se usan las primeras 20 diapositivas.', presenter: 'Presentador' },
  zh: { listening: '请问你的问题是什么？', back: '好问题。我们回到刚才的地方。', right: '正确！', wrong: '不太对。', next: '继续', done: '完成', again: '重新开始', check: '小测验', quiz: '最后测验', slide: '幻灯片', turned: '来自幻灯片', over: '本次课程到此结束。点击 Start the lesson 重新开始。', noText: '这些幻灯片里没有可读的文字。请试试从幻灯片软件导出的 PDF。', noFile: '无法打开这个文件。请把幻灯片导出为 PDF 再试。', first20: '只使用前 20 张幻灯片。', presenter: '讲师' },
  ar: { listening: 'نعم؟ ما سؤالك؟', back: 'سؤال جيد. لنعد إلى حيث كنا.', right: 'صحيح!', wrong: 'ليس تمامًا.', next: 'متابعة', done: 'إنهاء', again: 'ابدأ من جديد', check: 'سؤال سريع', quiz: 'الاختبار النهائي', slide: 'الشريحة', turned: 'من الشريحة', over: 'انتهت هذه الجلسة. اضغط Start the lesson للبدء من جديد.', noText: 'لا تحتوي هذه الشرائح على نص يمكنني قراءته. جرّب ملف PDF مُصدَّرًا من تطبيق العروض.', noFile: 'لا يمكن فتح هذا الملف. صدّر الشرائح بصيغة PDF وحاول مرة أخرى.', first20: 'تُستخدم أول 20 شريحة فقط.', presenter: 'المقدّم' },
  fr: { listening: 'Oui ? Quelle est ta question ?', back: 'Bonne question. Reprenons là où nous en étions.', right: 'Correct !', wrong: 'Pas tout à fait.', next: 'Continuer', done: 'Terminer', again: 'Recommencer', check: 'Petite vérification', quiz: 'Quiz final', slide: 'Diapo', turned: 'Diapo', over: 'Cette session est terminée. Appuie sur Start the lesson pour recommencer.', noText: "Ces diapos n'ont pas de texte lisible. Essaie un PDF exporté depuis ton logiciel de présentation.", noFile: "Impossible d'ouvrir ce fichier. Exporte tes diapos en PDF et réessaie.", first20: 'Seules les 20 premières diapos sont utilisées.', presenter: 'Présentateur' },
};

const st = { face: 'victor', lang: 'en' as Lang, n: 1, si: 0, shown: 0, playing: false, hand: false, wasPlaying: false, started: 0, sessionSeconds: 0, checked: new Set<number>() };
const stage = $('#stage'), stateEl = $('#state');
let cfg: { appId: string; region: string; faces: Record<string, { name: string; avatarId: string }>; choices?: Choices; sessionSeconds?: number } | null = null;
let deck: Deck | null = null;
const ui = () => UI[st.lang];
const presenter = () => cfg?.faces[st.face]?.name || 'Victor';
let seat: Seat | null = null, seatLoading: Promise<Seat | null> | null = null, seatFor = '', drawable = true, timer = 0;
let run = 0; // every play loop has a number; a newer number stops the older loop

// ---------- the avatar ----------
const FIT = { x: 0, y: 0.06, scale: 0.92 };
function fitAvatar(view: any, tries = 40) { try { view.avatarTransform = FIT; } catch { if (tries > 0) setTimeout(() => fitAvatar(view, tries - 1), 150); } }
function getSeat(): Promise<Seat | null> {
  if (!cfg || !drawable) return Promise.resolve(null);
  if (seatFor !== st.face) { seat?.dispose(); seat = null; seatLoading = null; $('#avatarBox').classList.remove('live'); }
  seatFor = st.face; const face = st.face;
  return (seatLoading ??= (async () => {
    $('#load').textContent = `${presenter()} is getting ready…`; $('#load').classList.add('on');
    try {
      const r = await fetch('api/session', { method: 'POST' }); const s = await r.json();
      if (!r.ok) throw new Error(s.error || 'No session.');
      await initSdk(s);
      const { start, view } = await loadSeat($('#avatar'), cfg!.faces[face].avatarId, (f) => ($('#load').textContent = `${presenter()} is getting ready… ${Math.round(f * 100)}%`));
      if (face !== st.face) return null;
      (window as any).__pv = view; fitAvatar(view);
      seat = await start(); void seat.connect().catch(() => undefined);
      $('#avatarBox').classList.add('live');
      return seat;
    } catch (e) { console.warn('[presenter] voice only', e); drawable = false; return null; }
    finally { $('#load').classList.remove('on'); }
  })());
}

// ---------- the voice: one sentence at a time, the next one fetched while this one plays ----------
const voices = new Map<string, Promise<() => Promise<Int16Array | null>>>();
function voice(text: string) {
  const key = `${st.face}|${st.lang}|${text}`;
  if (!voices.has(key)) voices.set(key, (async () => {
    const r = await fetch('api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang: st.lang, face: st.face }) });
    if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error || 'The voice did not come through.');
    const reader = r.body.getReader(); let held = new Uint8Array(0); let ended = false;
    return async (): Promise<Int16Array | null> => {
      for (;;) {
        if (held.length >= 9600 || (ended && held.length >= 2)) { const whole = held.length - (held.length % 2); const out = new Int16Array(held.slice(0, whole).buffer); held = held.slice(whole); return out; }
        if (ended) return null;
        const { value, done } = await reader.read();
        if (done) { ended = true; continue; }
        const n = new Uint8Array(held.length + value.length); n.set(held); n.set(value, held.length); held = n;
      }
    };
  })());
  const p = voices.get(key)!; voices.delete(key); // each stream can be played once
  return p;
}
const prefetched = new Map<string, ReturnType<typeof voice>>();
const prefetch = (text: string) => { const key = `${st.face}|${st.lang}|${text}`; if (!prefetched.has(key)) prefetched.set(key, voice(text)); };
let plainCtx: AudioContext | null = null;
async function playPlain(next: () => Promise<Int16Array | null>) {
  const ctx = new AudioContext({ sampleRate: 24000 }); plainCtx = ctx; let at = ctx.currentTime + 0.05;
  for (let c = await next(); c && ctx.state !== 'closed'; c = await next()) { const buf = ctx.createBuffer(1, c.length, 24000); const ch = buf.getChannelData(0); for (let i = 0; i < c.length; i++) ch[i] = c[i] / 32768; const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(at); at += buf.duration; }
  if (ctx.state !== 'closed') await new Promise((r) => setTimeout(r, Math.max(0, (at - ctx.currentTime) * 1000)));
}
/** Stops whatever the presenter is saying, right now. */
function hush() { seat?.interrupt(); if (plainCtx && plainCtx.state !== 'closed') void plainCtx.close(); plainCtx = null; }
const setState = (t: string) => { stateEl.textContent = t; };
async function say(text: string) {
  if (!text) return;
  showSaid(text); setState('Speaking');
  try {
    const key = `${st.face}|${st.lang}|${text}`;
    const next = await (prefetched.get(key) || voice(text)); prefetched.delete(key);
    const s = await getSeat();
    if (s) await s.stream(next).done; else await playPlain(next);
  } catch (e) { console.warn(e); showSaid((e as Error).message); }
}
function showSaid(text: string) { $('#who').textContent = `${presenter()} · ${ui().presenter}`; $('#said').textContent = text; }

// ---------- the deck on screen ----------
function lessonBody() { return { title: deck!.title, slides: deck!.slides.map((s) => s.text), lang: st.lang, face: st.face }; }
async function display(n: number) {
  if (!deck) return;
  st.shown = n; clearMarks();
  const box = $('#slidebox'); await deck.draw(n, $<HTMLCanvasElement>('#slide'), box.clientWidth).catch(() => undefined);
  $('#num').textContent = `${ui().slide} ${n} / ${deck.slides.length}`;
  $$('#strip button').forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.n) === st.n)));
  $('#turned').classList.toggle('on', n !== st.n);
  if (n !== st.n) $('#turned').textContent = `${ui().turned} ${n}`;
}
/** The part of the slide box the slide is drawn in (the canvas keeps the slide's own shape). */
function slideRect() {
  const box = $('#slidebox'); const W = box.clientWidth, H = box.clientHeight; const r = deck!.slides[st.shown - 1]?.ratio || 16 / 9;
  return W / H > r ? { x: (W - H * r) / 2, y: 0, w: H * r, h: H } : { x: 0, y: (H - W / r) / 2, w: W, h: W / r };
}
function clearMarks() { $('#marks').innerHTML = ''; }
function highlight(n: number, quote: string) {
  if (!deck || !quote) return false;
  const boxes = findQuote(deck.slides[n - 1], quote); if (!boxes.length) return false;
  const r = slideRect();
  $('#marks').innerHTML = boxes.map((b, i) => `<i style="left:${r.x + (b.x - 0.006) * r.w}px;top:${r.y + (b.y - 0.004) * r.h}px;width:${(b.w + 0.012) * r.w}px;height:${(b.h + 0.004) * r.h}px;animation-delay:${i * 0.25}s"></i>`).join('');
  return true;
}
async function buildStrip() {
  const strip = $('#strip'); strip.innerHTML = '';
  for (const s of deck!.slides) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.n = String(s.n); b.setAttribute('aria-label', `${ui().slide} ${s.n}`);
    b.innerHTML = `<canvas></canvas><span class="hp-type-label">${s.n}</span>`; strip.appendChild(b);
  }
  const d = deck!; // if another deck opens while the thumbnails are drawing, stop drawing this one
  for (const s of d.slides) { if (deck !== d) return; await d.draw(s.n, strip.querySelector<HTMLCanvasElement>(`button[data-n="${s.n}"] canvas`)!, 112).catch(() => undefined); }
}
async function useDeck(src: string | ArrayBuffer, name: string) {
  stop(); $('#empty').hidden = false; $('#empty').textContent = 'Loading the deck…'; $('#note').textContent = '';
  try {
    deck = await loadDeck(src);
  } catch (e) {
    $('#empty').textContent = (e as Error).message === 'no-text' ? ui().noText : ui().noFile;
    if (!deck) return; await display(st.n); $('#empty').hidden = true; return;
  }
  scripts.clear(); st.n = 1; st.si = 0; st.checked.clear();
  $('#deckName').textContent = name; $('#empty').hidden = true;
  if (deck.total > 20) $('#note').textContent = ui().first20;
  await display(1); await buildStrip();
}

// ---------- the script for each slide, asked for once and kept ----------
const scripts = new Map<string, Promise<string[]>>();
function script(n: number): Promise<string[]> {
  const key = `${st.lang}|${st.face}|${n}`;
  if (!scripts.has(key)) {
    const p = fetch('api/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lesson: lessonBody(), n }) })
      .then((r) => r.json()).then((a) => { if (a.error) throw new Error(a.error); return a.sentences as string[]; });
    p.catch(() => scripts.delete(key)); scripts.set(key, p);
  }
  return scripts.get(key)!;
}

// ---------- presenting ----------
function setPlayIcon() {
  $('#play').innerHTML = st.playing ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  $('#play').setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
}
function startSession() {
  if (st.started) return; st.started = Date.now();
  if (st.sessionSeconds) timer = window.setTimeout(() => { stop(); lowerHand(); st.started = 0; showSaid(ui().over); setState('Done'); }, st.sessionSeconds * 1000);
}
function stop() { run++; st.playing = false; hush(); setPlayIcon(); if (stateEl.textContent === 'Speaking') setState('Paused'); }
async function play() {
  if (!deck) return;
  const my = ++run; st.playing = true; setPlayIcon(); startSession(); void getSeat();
  $('#check').classList.remove('on'); // a check left open by a pause or a jump closes when we carry on
  const count = deck.slides.length;
  while (my === run) {
    if (st.shown !== st.n) await display(st.n);
    let sentences: string[];
    try { setState('Thinking'); sentences = await script(st.n); } catch (e) { showSaid((e as Error).message); stop(); return; }
    if (st.n < count) void script(st.n + 1); // the next slide's script is ready before we need it
    while (st.si < sentences.length) {
      if (my !== run) return;
      if (sentences[st.si + 1]) prefetch(sentences[st.si + 1]);
      await say(sentences[st.si]);
      if (my !== run) return; // stopped mid-sentence: this sentence is said again when we carry on
      st.si++;
    }
    if (st.n % 3 === 0 && st.n < count && !st.checked.has(st.n)) { st.checked.add(st.n); await runCheck(st.n, my); if (my !== run) return; }
    if (st.n >= count) break;
    st.n++; st.si = 0; track('slide', { n: st.n });
  }
  if (my !== run) return;
  st.playing = false; setPlayIcon(); await runQuiz(my);
}
async function goTo(n: number) {
  if (!deck) return;
  const was = st.playing; stop(); lowerHand(false);
  st.n = Math.max(1, Math.min(deck.slides.length, n)); st.si = 0; await display(st.n);
  if (was) void play();
}
$('#start').onclick = () => { track('start', { lang: st.lang, face: st.face }); stage.scrollIntoView({ behavior: 'smooth', block: 'center' }); st.n = st.n || 1; void play(); };
$('#play').onclick = () => (st.playing ? stop() : void play());
$('#prev').onclick = () => void goTo(st.n - 1);
$('#next').onclick = () => void goTo(st.n + 1);
$('#strip').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) void goTo(Number(b.dataset.n)); });

// ---------- raise your hand ----------
async function raiseHand() {
  if (!deck || st.hand) { $('#q').focus(); return; }
  st.wasPlaying = st.playing; stop();                       // stops mid-sentence
  st.hand = true; stage.classList.add('hand'); setState('Listening'); track('hand', { slide: st.n });
  $<HTMLInputElement>('#q').value = '';
  void say(ui().listening);
  void listen(); $('#q').focus();
}
function lowerHand(resume = true) {
  if (!st.hand) return;
  st.hand = false; stage.classList.remove('hand'); stopListening();
  if (resume && st.wasPlaying) void play();                  // carries on from the sentence it stopped in
}
async function answer(question: string) {
  question = question.trim(); if (!question || !deck) return;
  stopListening(); hush(); setState('Thinking'); showSaid(question); $('#who').textContent = 'You';
  try {
    const r = await fetch('api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lesson: lessonBody(), question, current: st.n }) });
    const a = await r.json(); if (!r.ok || a.error) { showSaid(a.error || 'Something went wrong.'); return; }
    track('answer', { inDeck: a.inDeck, turned: a.slide && a.slide !== st.n });
    if (a.slide && a.slide !== st.shown) await display(a.slide);  // turn to the slide that has the answer
    const marked = highlight(a.slide || st.n, a.quote);
    track('highlight', { found: marked });
    await say(a.say);
    if (!st.hand) return;
    await say(ui().back);
    if (st.shown !== st.n) await display(st.n);
    clearMarks();
  } finally { lowerHand(); }
}
$('#hand').onclick = () => void raiseHand();
$('#lower').onclick = () => lowerHand();
$('#askbar').addEventListener('submit', (e) => { e.preventDefault(); void answer($<HTMLInputElement>('#q').value); });
document.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).closest('input, textarea');
  if (!typing && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); void raiseHand(); }
  if (e.key === 'Escape' && st.hand) lowerHand();
});

// ---------- the microphone, for a spoken question ----------
let rec: MediaRecorder | null = null, cancelRec = false;
function stopListening() { if (rec) { cancelRec = true; rec.stop(); } }
$('#mic').onclick = () => (rec ? rec.stop() : void listen());
async function listen() {
  if (rec) return;
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { return; } // no microphone: typing still works
  if (!st.hand) { stream.getTracks().forEach((t) => t.stop()); return; }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined); rec = r; cancelRec = false;
  const mic = $('#mic'); const parts: Blob[] = []; r.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 1024; ac.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize); let heard = false, quiet = performance.now(); const began = performance.now();
  const tick = window.setInterval(() => {
    an.getFloatTimeDomainData(buf); const rms = Math.sqrt(buf.reduce((n, x) => n + x * x, 0) / buf.length);
    if (rms > 0.03) { heard = true; quiet = performance.now(); }
    const now = performance.now();
    if ((heard && now - quiet > 1500) || now - began > 20000 || (!heard && now - began > 10000)) r.stop();
  }, 100);
  r.onstop = async () => {
    window.clearInterval(tick); void ac.close(); stream.getTracks().forEach((t) => t.stop()); rec = null;
    mic.classList.remove('on'); mic.setAttribute('aria-pressed', 'false');
    if (cancelRec || !heard || !parts.length || !st.hand) return;
    setState('Listening');
    const res = await fetch('api/hear', { method: 'POST', headers: { 'Content-Type': r.mimeType || 'audio/webm', 'x-lang': st.lang }, body: new Blob(parts, { type: r.mimeType || 'audio/webm' }) });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.text) { $<HTMLInputElement>('#q').value = d.text; void answer(d.text); }
  };
  r.start(250); mic.classList.add('on'); mic.setAttribute('aria-pressed', 'true');
}

// ---------- quick checks and the final quiz ----------
function ask(q: Q, label: string): Promise<boolean> {
  return new Promise((resolve) => {
    $('#checkK').textContent = label; $('#checkQ').textContent = q.question; $('#checkSum').hidden = true;
    $('#explain').textContent = ''; $('#checkRow').innerHTML = '';
    $('#opts').innerHTML = q.options.map((o, i) => `<button type="button" data-i="${i}" dir="auto">${esc(o)}</button>`).join('');
    $('#check').classList.add('on');
    void say(q.question);
    $('#opts').onclick = async (e) => {
      const b = (e.target as HTMLElement).closest('button'); if (!b) return;
      const right = Number(b.dataset.i) === q.answer;
      $$<HTMLButtonElement>('#opts button').forEach((x) => { x.disabled = true; if (Number(x.dataset.i) === q.answer) x.classList.add('right'); });
      if (!right) b.classList.add('wrong');
      $('#explain').textContent = q.explain; track('check_answer', { right });
      $('#checkRow').innerHTML = `<button class="btn btn-brand hp-type-action" type="button">${esc(ui().next)}</button>`;
      $('#checkRow button')!.addEventListener('click', () => { hush(); resolve(right); }, { once: true });
      hush(); await say(`${right ? ui().right : ui().wrong} ${q.explain}`);
    };
  });
}
async function runCheck(upTo: number, my: number) {
  setState('Thinking');
  const r = await fetch('api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lesson: lessonBody(), upTo }) });
  const q = await r.json(); if (!r.ok || q.error || !q.options?.length || my !== run) return;
  await ask(q, ui().check);
  $('#check').classList.remove('on');
}
async function runQuiz(my: number) {
  setState('Thinking');
  const r = await fetch('api/quiz', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lesson: lessonBody() }) });
  const z = await r.json(); if (!r.ok || z.error || my !== run) return;
  let score = 0;
  for (const [i, q] of (z.questions as Q[]).entries()) { if (my !== run) return; if (await ask(q, `${ui().quiz} · ${i + 1} / ${z.questions.length}`)) score++; }
  $('#checkK').textContent = `${ui().quiz} · ${score} / ${z.questions.length}`; $('#checkQ').textContent = deck!.title;
  $('#checkSum').hidden = false; $('#checkSum').textContent = z.summary; $('#opts').innerHTML = ''; $('#explain').textContent = '';
  $('#checkRow').innerHTML = `<button class="btn btn-brand hp-type-action" type="button" id="again">${esc(ui().again)}</button>`;
  $('#check').classList.add('on'); setState('Done'); track('quiz_done', { score });
  void say(z.summary);
  $('#again').onclick = () => { hush(); $('#check').classList.remove('on'); st.checked.clear(); void goTo(1).then(() => play()); };
}

// ---------- your own PDF ----------
$('#upload').onclick = () => $<HTMLInputElement>('#file').click();
$('#file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = '';
  if (!f) return;
  track('upload', { kb: Math.round(f.size / 1024) });
  await useDeck(await f.arrayBuffer(), f.name.replace(/\.pdf$/i, ''));
});

// ---------- choices ----------
function pickIn(id: string, attr: string, value: string) { $$(`${id} button`).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset[attr] === value))); }
$('#langs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b || b.dataset.lang === st.lang) return;
  const was = st.playing; stop(); st.lang = b.dataset.lang as Lang; st.si = 0; pickIn('#langs', 'lang', st.lang);
  document.querySelector('.subs')!.setAttribute('dir', st.lang === 'ar' ? 'rtl' : 'ltr'); $<HTMLInputElement>('#q').dir = st.lang === 'ar' ? 'rtl' : 'auto';
  if (deck) $('#num').textContent = `${ui().slide} ${st.shown} / ${deck.slides.length}`;
  track('lang_pick', { lang: st.lang }); if (was) void play();
});
$('#faces').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b || b.dataset.face === st.face) return;
  const was = st.playing; stop(); st.face = b.dataset.face!; pickIn('#faces', 'face', st.face);
  $<HTMLImageElement>('#still').src = b.dataset.still || $<HTMLImageElement>(`#faces [data-face="${st.face}"] img`).src;
  showSaid($('#said').textContent || ''); track('face_pick', { face: st.face });
  if (seat || seatLoading) void getSeat();
  if (was) void play();
});
$$<HTMLButtonElement>('.info-btn').forEach((b) => (b.onclick = () => { const box = document.getElementById(b.getAttribute('aria-controls')!)!; const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); box.hidden = !open; }));
let resizeT = 0;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = window.setTimeout(() => { if (deck && st.shown) void display(st.shown); }, 200); });

// ---------- build it (only on the demo page): the download starts with the learner's choices ----------
$('#download')?.addEventListener('click', (e) => {
  (e.currentTarget as HTMLAnchorElement).href = `api/download?${new URLSearchParams({ lang: st.lang, face: st.face })}`;
  track('download', { lang: st.lang, face: st.face });
});
$('#deploy')?.addEventListener('click', () => track('deploy_click'));
$('#github')?.addEventListener('click', () => track('github_click'));

// ---------- start ----------
function useChoices(c: Choices) {
  const press = (sel: string) => { const b = document.querySelector<HTMLButtonElement>(sel); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); };
  press(`#faces [data-face="${c.face}"]`); press(`#langs [data-lang="${c.lang}"]`);
}
// choices in the address (?lang=fr&face=grace, used by embed.js) win over the server's starting choices
const fromUrl = (c: Partial<Choices> = {}) => { const q = new URLSearchParams(location.search); for (const k of ['lang', 'face'] as const) { const v = q.get(k); if (v && /^[a-z]{2,12}$/.test(v)) (c as any)[k] = v; } return c as Choices; };
fetch('api/config').then((r) => r.json()).then(async (c) => { cfg = c; st.sessionSeconds = Number(c.sessionSeconds) || 0; useChoices(fromUrl({ ...(c.choices || {}) })); showSaid($('#said').textContent || ''); drawable = await canDraw(); }).catch(() => { drawable = false; });
void useDeck(SAMPLE, 'Sample: Photosynthesis');
const report = () => parent !== window && parent.postMessage({ type: 'spatius-embed-height', demo: 'course-presenter', height: document.documentElement.scrollHeight }, '*');
new ResizeObserver(report).observe(document.body);
