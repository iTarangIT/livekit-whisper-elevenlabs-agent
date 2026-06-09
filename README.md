# Real-Time Voice Agent — LiveKit + Whisper + ElevenLabs

A production-style MVP voice agent built as a single **LiveKit Agent Worker** in strict
TypeScript. A user speaks in a LiveKit room; the agent detects speech, transcribes it,
generates a reply, speaks it back, and the user hears the response — all in real time.

```
User speaks → LiveKit → Silero VAD → Whisper STT → Conversation Engine → ElevenLabs TTS → LiveKit → User hears reply
```

The whole pipeline runs in one Node.js worker process. No Gemini, no chat LLMs, no RAG,
no Redis/Kafka, no database, no microservices — just the end-to-end voice loop.

---

## Architecture

```
                          LiveKit Agent Worker (Node.js)
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                               │
│  src/index.ts ──► cli.runApp(WorkerOptions{ agent: worker/voice-agent })      │
│                                                                               │
│  worker/voice-agent.ts  (defineAgent)                                         │
│     prewarm: silero VAD.load()                                                │
│     entry:                                                                     │
│       remote audio track ─► AudioStream @16kHz/mono ─► VadService             │
│                                                          │                    │
│                                       onSpeechEnd(frames)│                    │
│                                                          ▼                    │
│                                   WhisperService.transcribe(Buffer) ─► text   │
│                                                          │                    │
│                                                          ▼                    │
│                                   TranscriptService.addMessage('user', text)  │
│                                                          │                    │
│                                                          ▼                    │
│                                   ConversationService.respond(text, history)  │
│                                                          │  reply             │
│                                                          ▼                    │
│                                   TranscriptService.addMessage('assistant')   │
│                                                          │                    │
│                                                          ▼                    │
│                                   ElevenLabsService.generateSpeech ─► PCM     │
│                                                          │                    │
│                                                          ▼                    │
│                                   AudioSource.captureFrame ─► published track │
│                                                          │                    │
└──────────────────────────────────────────────────────────┼──────────────────┘
                                                             ▼
                                                    User hears reply
```

Audio is **16 kHz, mono, Int16 PCM** end to end. The inbound `AudioStream` is opened at
16 kHz so LiveKit resamples for us; ElevenLabs is asked for `pcm_16000`; LiveKit upsamples
on the wire. This keeps Silero VAD, Whisper, and the playback track on one consistent format.

### Sequence diagram

```
Participant      LiveKit Room      VadService      WhisperService   ConversationService   ElevenLabsService   AudioSource
    │                 │                 │                 │                  │                   │               │
    │ join room       │                 │                 │                  │                   │               │
    ├────────────────►│ participantConnected               │                  │                   │               │
    │                 ├── trackSubscribed ►│ (start VAD on 16k stream)          │                   │               │
    │ speaks…         │                 │                 │                  │                   │               │
    │ audio frames    │                 │                 │                  │                   │               │
    ├────────────────►├────────────────►│ onSpeechStart   │                  │                   │               │
    │ (silence)       │                 │ onSpeechEnd(frames)                 │                   │               │
    │                 │                 ├────────────────►│ transcribe(pcm)  │                   │               │
    │                 │                 │                 │── "text" ────────►│ respond(text)     │               │
    │                 │                 │                 │                  │── "reply" ────────►│ generateSpeech │
    │                 │                 │                 │                  │                   │── pcm ────────►│
    │                 │◄──────────────── published audio frames ──────────────────────────────────── captureFrame│
    │ hears reply ◄───┤                 │                 │                  │                   │               │
```

---

## Project structure

```
src/
├── index.ts                          worker entrypoint (env validation + cli.runApp)
├── worker/
│   └── voice-agent.ts                defineAgent: prewarm VAD, wire the pipeline
├── services/
│   ├── whisper.service.ts            WhisperService — transcribe(Buffer) → text
│   ├── elevenlabs.service.ts         ElevenLabsService — generateSpeech(text) → Buffer
│   └── transcript.service.ts         TranscriptService — in-memory history
├── vad/
│   └── vad.service.ts                VadService — Silero wrapper, speech callbacks
├── conversation/
│   └── conversation.service.ts       RuleBasedConversationService (swappable for an LLM)
├── config/
│   └── env.ts                        zod-validated env, fail-fast on startup
├── types/
│   └── index.ts                      shared types + audio constants
└── utils/
    └── logger.ts                     structured leveled logger (no console.log)
```

---

## Prerequisites

- **Node.js 20+** (tested on Node 22).
- A **LiveKit Cloud** project — free tier is enough: https://cloud.livekit.io
- An **OpenAI API key** with access to the transcription endpoint.
- An **ElevenLabs API key** and a **voice ID** (see Configuration).

---

## Installation

```bash
npm install
```

This installs `@livekit/agents`, `@livekit/agents-plugin-silero`, `@livekit/rtc-node`,
`openai`, `@elevenlabs/elevenlabs-js`, and `zod`.

---

## Configuration

Copy the example file and fill in the values:

```bash
cp .env.example .env
```

| Variable | Required | Notes |
|---|---|---|
| `LIVEKIT_URL` | yes | `wss://<your-project>.livekit.cloud` |
| `LIVEKIT_API_KEY` | yes | from the LiveKit project settings |
| `LIVEKIT_API_SECRET` | yes | from the LiveKit project settings |
| `AGENT_NAME` | no | explicit-dispatch name, default `dealer-outbound` |
| `OPENAI_API_KEY` | yes | used for Whisper transcription |
| `WHISPER_MODEL` | no | default `gpt-4o-transcribe` (better multilingual; also `gpt-4o-mini-transcribe`, `whisper-1`) |
| `STT_LANGUAGE` | no | blank = auto-detect (best for Hinglish), or `hi` |
| `STT_PROMPT` | no | optional Hinglish biasing phrase |
| `ELEVENLABS_API_KEY` | yes | ElevenLabs TTS |
| `ELEVENLABS_VOICE_ID` | yes | a **voice** ID, e.g. `JBFqnCBsd6RMkjVDRZzb` (George) |
| `ELEVENLABS_MODEL_ID` | no | default `eleven_flash_v2_5` (lowest latency) |
| `ELEVENLABS_AGENT_ID` | no | only used by `npm run voice:from-agent` to pull the voice id |
| `SIP_TRUNK_ADDRESS` | for calls | Vobiz SIP host/URI |
| `SIP_TRUNK_USERNAME` / `SIP_TRUNK_PASSWORD` | for calls | Vobiz SIP auth |
| `SIP_CALLER_NUMBER` | for calls | caller id in E.164, e.g. `+9180…` |
| `SIP_OUTBOUND_TRUNK_ID` | for calls | output of `npm run trunk:setup` |
| `SIP_TRANSPORT` | no | `auto` \| `udp` \| `tcp` \| `tls` (default `auto`) |
| `CALL_RINGING_TIMEOUT` / `CALL_MAX_DURATION` | no | seconds (default `30` / `600`) |
| `AGENT_OPENING_LINE` | no | what the agent says first when the dealer answers |
| `LOG_LEVEL` | no | `debug` \| `info` \| `warn` \| `error` (default `info`) |

> **`ELEVENLABS_VOICE_ID` must be a voice ID, not an agent ID.** An ID like `agent_…`
> is an ElevenLabs Conversational-AI agent and will return `voice_not_found`. Use a TTS
> voice ID. List your voices with:
> ```bash
> curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/voices | npx --yes json voices[].name
> ```

If any required variable is missing or empty, the worker prints exactly what's wrong and
exits before connecting — startup is fail-fast.

---

## Running

```bash
# Type-check only
npm run typecheck

# Development (runs TypeScript directly via tsx)
npm run dev

# Production (compile then run)
npm run build
npm run start
```

A healthy start looks like:

```
[INFO] [worker] starting voice agent worker {"livekit":"wss://…livekit.cloud"}
INFO: starting worker  version: "1.4.5"
INFO: registered worker  id: "AW_…"  server_info: { edition: "Cloud", region: "…" }
```

The worker is now connected to LiveKit Cloud and waiting for a room to join.

---

## Local testing guide (LiveKit Agents Playground)

You need something that joins the room and speaks. The fastest path is the hosted
playground — no extra UI code required.

1. Start the worker: `npm run dev` (leave it running).
2. Open the **Agents Playground**: https://agents-playground.livekit.io
3. Sign in / connect it to the **same** LiveKit Cloud project (same URL + keys as `.env`).
4. Click **Connect** to join a room and allow microphone access.
5. Say **"hello"**. You should hear: *"Hello sir, how can I help you today?"*
6. Say something with **"price"** (e.g. *"what's the price"*) → *"Sure sir, which vehicle
   model are you interested in?"*
7. Anything else → *"Could you please tell me more?"*

While you talk, the worker logs the full lifecycle:

```
[INFO] [agent] participant joined {"participant":"…"}
[INFO] [agent] audio track subscribed {"participant":"…"}
[INFO] [agent] speech started
[INFO] [agent] speech ended
[INFO] [whisper] whisper latency: 2218ms
[INFO] [agent] transcript received {"text":"hello"}
[INFO] [agent] response generated {"reply":"Hello sir, how can I help you today?"}
[INFO] [elevenlabs] elevenlabs latency: 1571ms
```

---

## Outbound calling (dealers via Vobiz SIP)

The agent can phone a dealer over PSTN: a **campaign step** dials the number through a
**Vobiz SIP trunk → LiveKit SIP**, drops the dialed dealer into a LiveKit room, and
**dispatches this worker** into the same room. When the dealer answers, the agent speaks
first (`AGENT_OPENING_LINE`) and then runs the normal VAD → STT → reply → TTS loop.

```
npm run call -- +91XXXXXXXXXX
   → creates room  → dispatches agent (AGENT_NAME)  → dials dealer via SIP trunk
```

### One-time setup

1. **Pull the voice from your ElevenLabs agent** (optional — keeps your chosen voice):
   ```bash
   # set ELEVENLABS_AGENT_ID in .env, then:
   npm run voice:from-agent          # prints ELEVENLABS_VOICE_ID=… → paste into .env
   ```
2. **Get a Vobiz SIP trunk** and put the details in `.env`: `SIP_TRUNK_ADDRESS`,
   `SIP_TRUNK_USERNAME`, `SIP_TRUNK_PASSWORD`, `SIP_CALLER_NUMBER` (E.164, e.g. `+9180…`).
   Confirm India DLT / caller-ID rules and any IP allow-listing with Vobiz.
3. **Create the outbound trunk in LiveKit**:
   ```bash
   npm run trunk:setup               # prints SIP_OUTBOUND_TRUNK_ID=… → paste into .env
   ```

### Placing a call

```bash
npm run dev                          # terminal 1: the agent worker (explicit dispatch)
npm run call -- +91XXXXXXXXXX        # terminal 2: the campaign dialer
```

Your phone rings; on answer you hear the opening line, then a normal conversation. The
worker logs `connected to room` (with the dialed number), `speaking opening line`, and the
usual pipeline events. `npm run call` stands in for the **Campaign Backend** in the
architecture — swap it for your own job queue / scheduler later.

> The worker uses **explicit dispatch** (`AGENT_NAME`), so it only joins rooms it is
> dispatched into. The dialer does that dispatch for every outbound call.

## Hinglish ASR

For Hindi-English code-switching, default to `WHISPER_MODEL=gpt-4o-transcribe` and leave
`STT_LANGUAGE` blank (auto-detect usually beats forcing `hi`). Use `STT_PROMPT` to bias
spelling of brand/model names, e.g. `STT_PROMPT=Bajaj Pulsar, on-road price, EMI, test ride`.

---

## How it works (by phase)

1. **LiveKit integration** — `voice-agent.ts` connects via `ctx.connect()` and listens for
   `ParticipantConnected`, `TrackSubscribed`, `ParticipantDisconnected`, and `Disconnected`.
   Handlers only delegate; no business logic lives in them.
2. **Voice activity detection** — `VadService` wraps a Silero `VADStream`. It consumes the
   16 kHz audio stream and fires `onSpeechStart()` / `onSpeechEnd(frames)`. Silence never
   reaches Whisper; only complete speech segments do.
3. **Whisper STT** — `WhisperService.transcribe(buffer)` wraps the raw PCM in a WAV header,
   uploads it via `toFile`, calls the transcription endpoint, **retries once** on failure,
   logs latency, and degrades to an empty string instead of throwing.
4. **Transcript pipeline** — `TranscriptService` keeps an in-memory list of user/assistant
   messages with `addMessage(role, text)` and `getHistory()`.
5. **Conversation engine** — `RuleBasedConversationService.respond(text, history)` returns a
   reply from simple keyword rules. It implements the `ConversationEngine` interface, so an
   LLM (e.g. Gemini) can replace it later without touching any caller.
6. **ElevenLabs TTS** — `ElevenLabsService.generateSpeech(text)` requests `pcm_16000`,
   collects the stream into a Buffer, logs latency, and degrades to empty audio on failure.
7. **Audio playback** — the PCM reply is sliced into 20 ms `AudioFrame`s and pushed through
   an `AudioSource` on a published `LocalAudioTrack`, so the participant hears the response.

---

## Design notes

- **SOLID / clean architecture.** Each capability sits behind a small interface
  (`SttService`, `TtsService`, `ConversationEngine`, `TranscriptStore`, `VadCallbacks`).
  Services are constructor-injected into the worker and can be swapped or unit-tested in
  isolation.
- **Swappable brain.** Replacing the rule engine with an LLM means writing one new class
  that implements `ConversationEngine` — the pipeline doesn't change.
- **Graceful degradation.** STT/TTS failures and disconnects are logged and absorbed; the
  worker stays alive. Missing config fails fast at startup.
- **MVP scope.** The loop is half-duplex: the agent listens, then speaks. There is no
  barge-in / interruption handling — that is a natural next step (LiveKit's `AgentSession`
  provides it out of the box if you later move orchestration into the framework).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid environment configuration` on startup | A required `.env` value is missing/empty — the message lists which. |
| `voice_not_found` in logs, no audio | `ELEVENLABS_VOICE_ID` is not a TTS voice ID (e.g. it's an `agent_…` id). Use a voice ID. |
| Worker registers but nothing happens | Make sure the Playground is connected to the **same** LiveKit project as `.env`. |
| `401`/auth errors from OpenAI or ElevenLabs | Check the corresponding API key in `.env`. |
