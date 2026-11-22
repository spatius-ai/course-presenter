// Course presenter server: one request handler, written with standard Request and Response,
// so the same code runs in Node (server/node.mjs) and on Cloudflare Workers (server/worker.mjs).
//
//   GET  /api/config   -> { appId, region, faces, choices }   the presenters and your starting choices
//   POST /api/session  -> { appId, region, sessionToken }      a short Spatius session for the avatar
//   POST /api/hear     -> recorded audio (x-lang header) -> { text }
//   POST /api/script   -> { lesson, n }                     -> { sentences }               what to say on slide n
//   POST /api/answer   -> { lesson, question, current }     -> { say, slide, quote, inDeck } a raised hand
//   POST /api/check    -> { lesson, upTo }                  -> { question, options, answer, explain }
//   POST /api/quiz     -> { lesson }                        -> { summary, questions }
//   POST /api/speak    -> { text, face, lang }              -> the voice, PCM16 mono 24 kHz (streamed)
//
// A "lesson" is { title, slides: [text of each slide], lang, face }. The PDF itself never leaves the browser.
// OpenAI is reached through OPENAI_BASE_URL. With your own OPENAI_API_KEY it is OpenAI itself.
// Without it, the requests go to the Spatius starter service, signed with your Spatius key.
// The rules of the presenter itself are in brain.mjs.

import { LANGS, hearingHint, scriptMessages, readScript, answerMessages, readAnswer, checkMessages, readCheck, quizMessages, readQuiz, voiceStyle } from './brain.mjs';
import { elevenSpeech, elevenOf } from './voices.mjs';

// The presenters a learner can pick: a Spatius avatar and a matching OpenAI voice.
export const FACES = {
  victor: { name: 'Victor', avatarId: '566981dd-1d95-4844-953e-d67e18b2fde8', voice: 'onyx' },
  grace: { name: 'Grace', avatarId: 'fc259540-c009-44f3-a6ed-ccaedb999dba', voice: 'sage' },
  julian: { name: 'Julian', avatarId: 'dbb01388-7c57-47bf-ab59-c492caeb9d90', voice: 'ash' },
  nadia: { name: 'Nadia', avatarId: '9078fde3-8e55-4311-a8d6-7740185b5b0d', voice: 'nova' },
  camille: { name: 'Camille', avatarId: '82d7dce9-ec05-4102-969f-2fe341af28cd', voice: 'coral' },
};
const STARTER_URL = 'https://starter.spatius.app/v1';
const isStarter = (u) => /starter\.spatius\.app|demotius-starter/.test(u || '');
const pick = (v, list, d) => (list.includes(v) ? v : d);

export function settings(env) {
  const ownKey = !!env.OPENAI_API_KEY;
  // Your own OpenAI key only ever goes to OpenAI (or the OPENAI_BASE_URL you set), never to the starter service.
  const starterUrl = env.SPATIUS_STARTER_URL || STARTER_URL;
  const base = ownKey ? (env.OPENAI_BASE_URL && !isStarter(env.OPENAI_BASE_URL) ? env.OPENAI_BASE_URL : 'https://api.openai.com/v1') : starterUrl;
  return {
    apiKey: env.SPATIUS_API_KEY || '',
    eleven: elevenOf(env), // ElevenLabs voices when ELEVENLABS_API_KEY is set
    appId: env.SPATIUS_APP_ID || '',
    region: env.SPATIUS_REGION || 'us-west',
    // where the page starts: the choices from the demo, or your own
    choices: { lang: pick(env.PRESENTER_LANG, Object.keys(LANGS), 'en'), face: pick(env.PRESENTER_FACE, Object.keys(FACES), 'victor') },
    openai: {
      base: base.replace(/\/$/, ''),
      key: ownKey ? env.OPENAI_API_KEY : env.SPATIUS_API_KEY,
      starter: !ownKey,
      chat: env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini',
      stt: env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
      tts: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    },
  };
}

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
const bad = (message) => Object.assign(new Error(message), { status: 400 });
const readJson = async (request, max) => {
  const text = await request.text();
  if (text.length > max) throw bad('Too large.');
  try { return JSON.parse(text || '{}'); } catch { throw bad('Bad request.'); }
};

// Starter minutes left, passed on from the starter service when it sends them.
function starterHeaders(res) {
  const left = res.headers.get('x-starter-minutes-left');
  return left === null ? {} : { 'X-Starter-Minutes-Left': left };
}

// A clear message for each way OpenAI or the starter service can say no.
async function openaiError(res, s) {
  if (s.openai.starter && res.status === 402)
    return { status: 402, error: 'Your starter minutes are used. Add your own OPENAI_API_KEY to .env to keep going.', starterUsed: true };
  if (s.openai.starter && (res.status === 404 || res.status >= 500 || res.status === 0))
    return { status: 503, error: 'The starter service is not available right now. Try again, or add your own OPENAI_API_KEY to .env.' };
  if (res.status === 401) return { status: 401, error: s.openai.starter ? 'Your Spatius API key was not accepted. Check it at app.spatius.ai.' : 'Your OPENAI_API_KEY was not accepted.' };
  if (res.status === 429) return { status: 429, error: 'Too many requests to the language service. Please wait a moment.' };
  return { status: 502, error: `The language service answered with HTTP ${res.status}.` };
}

async function callOpenAI(s, path, init) {
  try {
    const starter = s.openai.starter ? { 'X-Spatius-Region': s.region } : {};
    return await fetch(`${s.openai.base}${path}`, { ...init, headers: { Authorization: `Bearer ${s.openai.key}`, ...starter, ...(init.headers || {}) } });
  } catch {
    // network failure: a plain object, because a Response cannot have status 0
    return { ok: false, status: 0, body: null, headers: new Headers(), json: async () => ({}), text: async () => '' };
  }
}

// ---------- Spatius session token (reused for 20 minutes) ----------
let tokenCache = { token: '', until: 0, key: '' };
async function sessionToken(s) {
  if (tokenCache.token && tokenCache.key === s.apiKey && Date.now() < tokenCache.until) return tokenCache.token;
  const domain = s.region.startsWith('cn') ? 'spatialwalk.top' : 'spatius.ai';
  const res = await fetch(`https://console.${s.region}.${domain}/v1/console/session-tokens`, {
    method: 'POST',
    headers: { 'X-Api-Key': s.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expireAt: Math.floor(Date.now() / 1000) + 3600 }),
  });
  // a wrong key can still come back as HTTP 200, so check for the token itself
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 || !body.sessionToken) {
    const refused = res.status === 401 || res.status === 403 || (res.status === 200 && !body.sessionToken);
    const err = new Error(refused ? 'Your Spatius API key was not accepted. Check it at app.spatius.ai.' : `Spatius did not give a session (HTTP ${res.status}).`);
    err.status = refused ? 401 : 502;
    throw err;
  }
  tokenCache = { token: body.sessionToken, until: Date.now() + 20 * 60_000, key: s.apiKey };
  return body.sessionToken;
}

/** The lesson as the page sends it: at most 20 slides of at most 1,500 characters each. */
function lessonOf(s, b) {
  const l = b && typeof b.lesson === 'object' ? b.lesson : {};
  const slides = (Array.isArray(l.slides) ? l.slides : []).slice(0, 20).map((t) => String(t).slice(0, 1500));
  if (!slides.length) throw bad('Open a deck first.');
  return { title: String(l.title || 'The lesson').slice(0, 120), slides, lang: pick(l.lang, Object.keys(LANGS), s.choices.lang), name: (FACES[l.face] || FACES[s.choices.face]).name };
}
async function ask(s, messages, maxTokens, read) {
  const res = await callOpenAI(s, '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.openai.chat, temperature: 0.4, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages }),
  });
  if (!res.ok) { const e = await openaiError(res, s); return json(e.status, e); }
  return json(200, read((await res.json().catch(() => ({}))).choices?.[0]?.message?.content), starterHeaders(res));
}

// ---------- hear: speech to text, told which language to expect ----------
async function hear(s, request) {
  const lang = pick(request.headers.get('x-lang') || '', Object.keys(LANGS), s.choices.lang);
  const audio = await request.arrayBuffer();
  if (audio.byteLength > 3_000_000) return json(413, { error: 'That recording was too long. Try a shorter question.' });
  const type = request.headers.get('content-type') || 'audio/webm';
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `speech.${type.includes('mp4') ? 'mp4' : 'webm'}`);
  form.append('model', s.openai.stt);
  if (hearingHint(lang)) form.append('prompt', hearingHint(lang));
  const res = await callOpenAI(s, '/audio/transcriptions', { method: 'POST', body: form });
  if (!res.ok) { const e = await openaiError(res, s); return json(e.status, e); }
  const body = await res.json().catch(() => ({}));
  return json(200, { text: String(body.text || '').trim().slice(0, 600) }, starterHeaders(res));
}

// ---------- speak: the presenter's voice ----------
async function speak(s, request) {
  const b = await readJson(request, 20_000);
  const lang = pick(b.lang, Object.keys(LANGS), s.choices.lang);
  const input = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  if (!input) return json(400, { error: 'Nothing to say.' });
  // response_format "pcm" is raw PCM16 mono at 24 kHz: exactly what the avatar takes, so it is passed on untouched
  // ElevenLabs first when ELEVENLABS_API_KEY is set (each person has their own voice); the OpenAI voice if it is not set or says no
  const el = await elevenSpeech(s.eleven, (FACES[b.face] || FACES[s.choices.face]).avatarId, input, lang);
  if (el) return new Response(el.body, { status: 200, headers: { 'Content-Type': 'audio/pcm;rate=24000', 'Cache-Control': 'no-store' } });
  const res = await callOpenAI(s, '/audio/speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.openai.tts, voice: (FACES[b.face] || FACES[s.choices.face]).voice, input, response_format: 'pcm', instructions: voiceStyle(lang) }),
  });
  if (!res.ok || !res.body) { const e = await openaiError(res, s); return json(e.status, e); }
  return new Response(res.body, { status: 200, headers: { 'Content-Type': 'audio/pcm;rate=24000', 'Cache-Control': 'no-store', ...starterHeaders(res) } });
}

// A simple limit per visitor, so nobody can spend your keys by calling the API in a loop.
// It is kept in memory: enough for one server; use your host's rate limiting for more.
const hits = new Map();
function tooMany(request) {
  const ip = request.headers.get('cf-connecting-ip') || String(request.headers.get('x-forwarded-for') || '').split(',').pop().trim() || 'local';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 10_000) hits.clear();
  return list.length > 40;
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const s = settings(env);
  if (url.pathname.startsWith('/api/') && tooMany(request)) return json(429, { error: 'Too many requests. Please wait a minute.' });
  try {
    const p = url.pathname;
    if (p === '/api/config' && request.method === 'GET') {
      return json(200, {
        appId: s.appId, region: s.region, starter: s.openai.starter, choices: s.choices,
        faces: Object.fromEntries(Object.entries(FACES).map(([k, v]) => [k, { name: v.name, avatarId: v.avatarId }])),
      });
    }
    if (p === '/api/session' && request.method === 'POST') {
      if (!s.apiKey || !s.appId) return json(500, { error: 'Add SPATIUS_API_KEY and SPATIUS_APP_ID to .env, then restart.' });
      return json(200, { appId: s.appId, region: s.region, sessionToken: await sessionToken(s) });
    }
    if (p === '/api/hear' && request.method === 'POST') return await hear(s, request);
    if (p === '/api/speak' && request.method === 'POST') return await speak(s, request);
    if (request.method !== 'POST' || !['/api/script', '/api/answer', '/api/check', '/api/quiz'].includes(p)) return null;
    const b = await readJson(request, 60_000);
    const lesson = lessonOf(s, b);
    if (p === '/api/script') {
      const n = Number.isInteger(b.n) && b.n >= 1 && b.n <= lesson.slides.length ? b.n : 1;
      return await ask(s, scriptMessages(lesson, n), 500, readScript);
    }
    if (p === '/api/answer') {
      const question = String(b.question || '').trim();
      if (!question) return json(400, { error: 'Ask a question first.' });
      const current = Number.isInteger(b.current) && b.current >= 1 && b.current <= lesson.slides.length ? b.current : 1;
      return await ask(s, answerMessages(lesson, { question, current }), 400, (raw) => readAnswer(raw, lesson));
    }
    if (p === '/api/check') {
      const upTo = Number.isInteger(b.upTo) && b.upTo >= 1 && b.upTo <= lesson.slides.length ? b.upTo : lesson.slides.length;
      return await ask(s, checkMessages(lesson, upTo), 300, readCheck);
    }
    return await ask(s, quizMessages(lesson), 700, readQuiz);
  } catch (err) {
    return json(err.status || 500, { error: err.status === 400 ? err.message : err.message || 'Something went wrong.' });
  }
}
