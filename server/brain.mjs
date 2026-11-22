// The brain of the Course presenter: what makes it a presenter, and nothing else.
// Plain functions with no network, no avatar and no web server, so you can copy this file
// into any app or agent (your own backend, a LiveKit or Agora agent) and keep the same behaviour.
//
//   scriptMessages(lesson, n)     -> messages asking an LLM for the spoken script of slide n (JSON mode)
//   readScript(raw)               -> { sentences } : 3 to 5 sentences, said one at a time
//   answerMessages(lesson, q)     -> messages asking for an answer to a raised hand, from the deck only
//   readAnswer(raw, lesson)       -> { say, slide, quote, inDeck } : the answer, and the exact words to highlight
//   checkMessages(lesson, upTo)   -> messages asking for one quick check question on the slides so far
//   quizMessages(lesson)          -> messages asking for a 3-question quiz and a short summary at the end
//   readCheck(raw) / readQuiz(raw)
//   hearingHint(lang), voiceStyle(lang)
//
// A "lesson" is { title, slides: [text of slide 1, text of slide 2, ...], lang, name }.

export const LANGS = { en: 'English', es: 'Spanish', zh: 'Chinese (Simplified)', ar: 'Arabic', fr: 'French' };
const HINTS = {
  en: 'A learner asking a question about a lesson.',
  es: 'Un estudiante hace una pregunta sobre la lección.',
  zh: '学生在问关于这节课的问题。',
  ar: 'متعلم يطرح سؤالًا عن الدرس.',
  fr: 'Un apprenant pose une question sur la leçon.',
};
/** Told which language to expect, speech to text keeps Arabic in Arabic script and copes better with accents. */
export const hearingHint = (lang) => HINTS[lang] || '';

const L = (lang) => LANGS[lang] || 'English';
const deckText = (lesson) => lesson.slides.map((t, i) => `[Slide ${i + 1}]\n${String(t).slice(0, 1500)}`).join('\n\n');
const parse = (raw) => { try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}; } catch { return {}; } };

/** The spoken script for one slide: what a good teacher says while this slide is on screen. */
export function scriptMessages(lesson, n) {
  return [{ role: 'system', content: `You are ${lesson.name}, a warm, clear presenter teaching the lesson "${lesson.title}". You speak ${L(lesson.lang)} out loud; the slides may be in another language.
Write what you say while slide ${n} is on screen: 3 to 5 short spoken sentences that explain it in your own words, with one small example or comparison when it helps. Do not read the slide word for word, do not say "this slide", and do not repeat what earlier slides already said.${n === 1 ? ' This is the first slide: greet the learners in one short sentence and say what the lesson is about.' : ''}${n === lesson.slides.length ? ' This is the last slide: end with one sentence that wraps up the lesson.' : ''}
Return JSON only: {"sentences": [the sentences, in ${L(lesson.lang)}]}

The whole deck:
${deckText(lesson)}` }];
}
/** Splits text into spoken sentences (also for Chinese and Arabic punctuation), so the presenter can stop and resume at a sentence. */
export const sentencesOf = (text) => String(text).match(/[^.!?。！？؟]+[.!?。！？؟]+["'”’)]*|[^.!?。！？؟]+$/g)?.map((s) => s.trim()).filter(Boolean) || [];
export function readScript(raw) {
  const out = parse(raw);
  const sentences = (Array.isArray(out.sentences) ? out.sentences : []).flatMap((s) => sentencesOf(s)).slice(0, 8);
  return { sentences: sentences.length ? sentences : ['…'] };
}

/**
 * A raised hand: answer from the deck only, and say exactly where on which slide the answer is,
 * by copying a few words from that slide. The browser finds those words on the slide and highlights them.
 */
export function answerMessages(lesson, { question, current }) {
  return [{ role: 'system', content: `You are ${lesson.name}, presenting the lesson "${lesson.title}". A learner raised their hand while slide ${current} was on screen. Answer out loud in ${L(lesson.lang)}, in 1 to 3 short spoken sentences, using ONLY the deck below. If the deck does not cover it, say so kindly in one sentence.
Return JSON only: {"say": your answer, "slide": the number of the slide that best shows the answer (or ${current}), "quote": 2 to 8 words copied EXACTLY, character for character, from that slide's text, that you are pointing at (or "" if nothing fits), "inDeck": true or false}

The whole deck:
${deckText(lesson)}` }, { role: 'user', content: String(question).slice(0, 600) }];
}
export function readAnswer(raw, lesson) {
  const out = parse(raw);
  const slide = Number.isInteger(out.slide) && out.slide >= 1 && out.slide <= lesson.slides.length ? out.slide : 0;
  return { say: String(out.say || '').trim() || '…', slide, quote: slide ? String(out.quote || '').slice(0, 120) : '', inDeck: out.inDeck !== false };
}

/** One quick check question about the slides so far, with three answers to pick from. */
export function checkMessages(lesson, upTo) {
  return [{ role: 'system', content: `Write ONE quick check question, in ${L(lesson.lang)}, about slides 1 to ${upTo} of the lesson "${lesson.title}". It should test understanding, not memory of exact words. Give 3 short answers, exactly one correct.
Return JSON only: {"question": string, "options": [3 strings], "answer": index of the correct option (0, 1 or 2), "explain": one short sentence that explains the right answer}

The deck:
${deckText({ ...lesson, slides: lesson.slides.slice(0, upTo) })}` }];
}
const readQ = (q) => {
  const options = (Array.isArray(q?.options) ? q.options : []).map(String).slice(0, 3);
  const answer = Number.isInteger(q?.answer) && q.answer >= 0 && q.answer < options.length ? q.answer : 0;
  // LLMs like to put the right answer first: shuffle, so the learner cannot just pick the first one
  const order = options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { question: String(q?.question || ''), options: order.map((i) => options[i]), answer: order.indexOf(answer), explain: String(q?.explain || '') };
};
export const readCheck = (raw) => readQ(parse(raw));

/** The end of the lesson: a 3-question quiz and a short summary. */
export function quizMessages(lesson) {
  return [{ role: 'system', content: `The lesson "${lesson.title}" has ended. In ${L(lesson.lang)}, write a 3-question quiz on the whole deck (3 short answers each, exactly one correct) and a summary of 2 sentences.
Return JSON only: {"summary": string, "questions": [{"question": string, "options": [3 strings], "answer": 0, 1 or 2, "explain": one short sentence}]}

The deck:
${deckText(lesson)}` }];
}
export function readQuiz(raw) {
  const out = parse(raw);
  return { summary: String(out.summary || ''), questions: (Array.isArray(out.questions) ? out.questions : []).slice(0, 3).map(readQ).filter((q) => q.question && q.options.length >= 2) };
}

/** How the presenter's voice should sound. */
export const voiceStyle = (lang) => `Speak ${L(lang)} like an engaging teacher presenting a lesson: clear, warm and lively, at a relaxed pace, with natural pauses between ideas.`;
