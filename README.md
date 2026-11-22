# Course presenter

## Overview

Course presenter turns a slide deck into a lesson with a face. You open a PDF of your slides, or use the sample deck, and a live Spatius avatar presents it slide by slide, out loud and with subtitles, in the language you pick, even when the slides are in another language. Every few slides there is a quick check question, and at the end a short quiz and summary.

Its standout feature is **Raise your hand**. At any moment the learner presses the button (or the H key). The presenter stops mid-sentence and listens. It answers from the deck, highlights the exact words on the slide it means (turning to another slide when the answer is there), says "back to where we were", and carries on from the sentence it stopped in.

This repository is a small, complete template. It runs on your computer in a few minutes with only your Spatius API key and App ID. It is for training teams, course creators, schools and companies that already have slides, and for developers who want to see how an avatar, a document and an LLM work together.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/spatius-ai/course-presenter)

## Why this matters

Slide decks are everywhere, but a deck alone does not teach, and a recorded video cannot answer a question. A presenter who explains each slide in plain words and can be interrupted like a real teacher turns the same deck into a lesson for every learner, in their own language and at their own pace.

## User flow

1. The learner picks a language and a presenter. The sample deck is already open; "Use your own PDF" opens theirs (up to 20 slides).
2. They press "Start the lesson". The presenter greets them and explains the first slide.
3. Slide by slide, the presenter explains what is on screen in 3 to 5 spoken sentences. The slide strip shows where they are; previous, pause and next are always there.
4. At any moment they press "Raise your hand". The presenter stops and listens; they say or type a question.
5. The presenter answers from the deck and highlights the words it means, turning to the slide with the answer if it is another one. Then it goes back and carries on from the same sentence.
6. After every third slide, a quick check question with three answers. At the end, a 3-question quiz with a score and a two-sentence summary.

## Architecture

```text
course-presenter/
  README.md
  LICENSE
  package.json
  vite.config.mjs           builds the web page and copies the avatar engine files
  wrangler.jsonc            Cloudflare Workers settings
  .env.example              settings for running on your computer
  .dev.vars.example         secrets for Cloudflare
  server/
    brain.mjs               the presenter itself: slide scripts, answers with what to highlight, checks, the quiz
    voices.mjs              optional ElevenLabs voices, one per person (used when ELEVENLABS_API_KEY is set)
    app.mjs                 the API: session token, hearing, scripts, answers, checks, quiz, voice (uses brain.mjs)
    node.mjs                runs the app on your computer
    worker.mjs              runs the app on Cloudflare Workers
  web/
    index.html              the page: the slide, the presenter, the controls and the slide strip
    src/main.ts             the lesson: playing sentence by sentence, raising a hand, checks and the quiz
    src/deck.ts             opens the PDF (pdf.js), draws slides, finds words on a slide to highlight
    src/presenter.css       the look of the stage, the highlight and the checks
    src/seat.ts             the Spatius avatar: load, connect, speak, stop
    public/embed.js         puts the presenter on any page with one line
    public/assets/          fonts, faces, the room picture and the sample deck (sample-deck.pdf)
```

The code has three parts, so you can keep the part you need. `server/brain.mjs` is what makes it a presenter; `server/app.mjs` connects it to OpenAI and the browser; `web/src/seat.ts` connects the avatar. The same `server/app.mjs` runs in both places.

**How Raise your hand works.** The presenter speaks one sentence at a time, and fetches the voice for the next sentence while the current one plays. Raising a hand stops the avatar mid-sentence (`seat.interrupt()`), and the lesson remembers which sentence it was in. The answer comes from `answerMessages()` in `brain.mjs`, which asks the LLM for the answer, the slide that shows it, and a few words copied exactly from that slide. The browser then finds those words on the slide with pdf.js, which knows the position of every piece of text, and highlights them (`findQuote()` in `deck.ts`). So the highlight is exact; it is not a guess from a picture of the slide. When the answer is done, the lesson carries on by saying the interrupted sentence again.

**What leaves the browser.** The PDF itself stays in the browser. Only the text of each slide (at most 20 slides of 1,500 characters) is sent to your server, to write the script and answer questions.

## Runtime modes

| Mode | Command |
| --- | --- |
| On your computer | `npm start` |
| Cloudflare Workers, local | `cp .dev.vars.example .dev.vars`, then `npm run dev:cf` |
| Cloudflare Workers, online | `npm run deploy` or the Deploy button |

**Starter minutes or your own OpenAI key.** Hearing, the scripts, answers, checks and the voice use OpenAI. Without `OPENAI_API_KEY`, the presenter uses free Spatius starter minutes (30 minutes per Spatius key), sent through `starter.spatius.app` with your Spatius key. When the minutes are used up, the page says so, and you add your own key. With `OPENAI_API_KEY` set, the presenter calls OpenAI directly and the starter service is not used.

## Protocols and contracts

The browser talks to the server through eight routes. A `lesson` is `{ title, slides: [text of each slide], lang, face }`.

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/config` | none | `appId`, `region`, `faces`, `choices` (where the page starts), `starter` |
| `POST /api/session` | none | `appId`, `region`, `sessionToken` |
| `POST /api/hear` | Recorded audio as the body, header `x-lang` | `{ text }` |
| `POST /api/script` | JSON `{ lesson, n }` | `{ sentences }`: what to say while slide `n` is on screen |
| `POST /api/answer` | JSON `{ lesson, question, current }` | `{ say, slide, quote, inDeck }`: the answer, the slide that shows it, the words to highlight |
| `POST /api/check` | JSON `{ lesson, upTo }` | `{ question, options, answer, explain }` |
| `POST /api/quiz` | JSON `{ lesson }` | `{ summary, questions }` |
| `POST /api/speak` | JSON `{ text, face, lang }` | The voice as raw PCM16, mono, 24 kHz, streamed |

Errors come back as `{ "error": "..." }` with a matching HTTP status. When starter minutes are used up, the status is 402 and `starterUsed` is `true`.

## Make it yours

- **Your deck.** Replace `web/public/assets/cp/sample-deck.pdf` with your own PDF, and change the name shown in `web/src/main.ts` (`SAMPLE` and the call to `useDeck`).
- **How it presents.** Change the presenter's style, length and checks in `scriptMessages()`, `checkMessages()` and `quizMessages()` in `server/brain.mjs`. The check comes every 3 slides (`st.n % 3` in `main.ts`).
- **Presenters.** The five presenters are in `FACES` in `server/app.mjs`, each with a Spatius avatar and a matching voice. You can use any avatar from your Spatius account.
- **The look.** The room picture is `web/public/assets/cp/room.webp`; the stage, highlight and checks are in `web/src/presenter.css`.

## Use it in your own app

Pick the row that matches what you have.

| You have | Do this |
| --- | --- |
| Any website or web app, and you want the presenter inside it | Deploy this template (Cloudflare button or your own server), then add one line where it should appear: `<script src="https://YOUR-PRESENTER-ADDRESS/embed.js" data-lang="es" async></script>`. The `data-` choices are optional. Events arrive on your page as `window` event `spatius:event`. |
| Your own backend, in any language | Copy `server/brain.mjs` (or port it: plain functions, no network). Call `scriptMessages()` / `readScript()` for each slide and `answerMessages()` / `readAnswer()` for a raised hand. |
| Your own web page, and you want the avatar or the highlight | Copy `web/src/seat.ts` for the avatar (24 kHz PCM16 audio with lip sync, and `interrupt()` to stop it), and `web/src/deck.ts` to open a PDF and highlight words on a slide. |
| A LiveKit or Agora voice agent | Start from Spatius's official example, [livekit-demo](https://github.com/spatius-ai/spatius-integration-demo/tree/main/livekit-demo) or [agora-demo](https://github.com/spatius-ai/spatius-integration-demo/tree/main/agora-demo), then call the brain's functions from your agent's LLM step. The brain is plain functions, so the presenter works the same over LiveKit or Agora. |
| Another LLM, or an OpenAI-compatible gateway | Set `OPENAI_BASE_URL` with your own `OPENAI_API_KEY`. The brain works with any chat model that can return JSON. |

Spatius's official examples show how to connect an avatar (Direct, LiveKit, Agora, iOS, Android, Flutter): [spatius-integration-demo](https://github.com/spatius-ai/spatius-integration-demo), [livekit-plugins-spatius](https://github.com/spatius-ai/livekit-plugins-spatius) and [create-spatius-app](https://github.com/spatius-ai/create-spatius-app). This template shows what to build on top: the use case and its standout feature, in a brain you can plug into any of them.

## Technical stack

- Spatius avatar SDK (`@spatius/avatarkit`) in Direct mode, drawn in the browser
- pdf.js (`pdfjs-dist`) to open PDFs, draw slides and read the position of their text, in the browser
- OpenAI: `gpt-4o-mini-transcribe` (speech to text), `gpt-4.1-mini` (scripts, answers, checks, quiz), `gpt-4o-mini-tts` (voice); all can be changed in settings
- Vite for the web page, plain Node for the local server, Cloudflare Workers for hosting
- No database and no framework

## Setup and local development

You need Node 20.3 or newer and a Spatius account, for an API key and App ID from [app.spatius.ai](https://app.spatius.ai). You also need a browser with WebGPU or WebGL2, and a microphone if you want to ask questions by voice.

```sh
git clone https://github.com/spatius-ai/course-presenter
cd course-presenter
cp .env.example .env      # paste SPATIUS_API_KEY and SPATIUS_APP_ID
npm install
npm start                 # open http://localhost:3000
```

The page calls `/api/...` and loads `/assets/...` on the same address as the page, so the page, the built files and the API must be served from one origin. `server/node.mjs` and Cloudflare both do this.

## Environment configuration

| Setting | Needed | What it does |
| --- | --- | --- |
| `SPATIUS_API_KEY` | Yes | Your Spatius API key |
| `SPATIUS_APP_ID` | Yes | Your Spatius App ID |
| `SPATIUS_REGION` | No | `us-west` (default) or your region |
| `OPENAI_API_KEY` | No | Your OpenAI key; without it, starter minutes are used |
| `ELEVENLABS_API_KEY` | No | ElevenLabs voices: each person has their own voice, and a native voice for Arabic. Without it, the OpenAI voice is used, and it is also used if ElevenLabs refuses a request. Model: `ELEVENLABS_MODEL` (default `eleven_v4_turbo`) |
| `OPENAI_BASE_URL` | No | Another OpenAI-compatible address for your own key. Your OpenAI key is never sent to the starter service. |
| `SPATIUS_STARTER_URL` | No | Another starter service address (for testing) |
| `PRESENTER_LANG` | No | Starting language: `en`, `es`, `zh`, `ar` or `fr` |
| `PRESENTER_FACE` | No | `victor`, `grace`, `julian`, `nadia` or `camille` |
| `OPENAI_CHAT_MODEL`, `OPENAI_STT_MODEL`, `OPENAI_TTS_MODEL` | No | Models |
| `PORT` | No | Local port, 3000 by default |

The learner can still change the language and presenter on the page. On Cloudflare, put the keys in `.dev.vars` (local) or as secrets (online); the other settings are in `wrangler.jsonc` under `vars`.

## Security and deployment guidance

- Keys stay on the server. The browser only receives a short-lived Spatius session token.
- The `/api` routes are open to anyone who can reach your site, and each slide and question spends your OpenAI key or starter minutes and your Spatius minutes. The server allows 40 API requests per minute per visitor; for a public site, also turn on your host's rate limiting (for example Cloudflare rate limiting rules) and set a monthly limit in your OpenAI account.
- Uploaded PDFs stay in the browser; only the slides' text is sent, and nothing is stored on the server.
- `.env` and `.dev.vars` are ignored by git. Never commit them.
- The avatar SDK sends basic performance data to Spatius so failures can be found. See the [Spatius Terms of Service](https://www.spatius.ai/terms-of-service/).

## License and use constraints

The code in this repository is under the MIT License (see `LICENSE`). The Spatius avatar SDK (`@spatius/avatarkit`) and the Spatius service are not part of this license; they are covered by the [Spatius Terms of Service](https://www.spatius.ai/terms-of-service/). pdf.js (`pdfjs-dist`) is by Mozilla, under the Apache License 2.0. The fonts in `web/public/assets/fonts/` (Inter, Geist Mono, Space Grotesk) are under the SIL Open Font License; their license texts are in `web/public/assets/licenses/`. The room picture, the sample deck and the face photos are examples for this template.
