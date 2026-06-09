# Outbound AI Voice Agent — LiveKit + Whisper + ElevenLabs

An **outbound** voice agent that phones dealers over the phone network, talks to them in
Hinglish, and is driven by your **ElevenLabs Conversational-AI agent**. Built as a single
LiveKit Agent Worker in strict TypeScript.

```
Campaign dialer → LiveKit (Room + SIP) → Vobiz trunk → PSTN → dealer's phone
        once answered, per turn:
        dealer speaks → Silero VAD → Whisper STT → your ElevenLabs agent (LLM + voice) → dealer hears reply
```

**Who does what:** LiveKit moves the audio and places the call, **Whisper** does the
listening (speech → text), and **your ElevenLabs agent** does the thinking (its prompt +
knowledge) and the talking (its voice).

---

## Architecture

```
                          ┌───────────────────────────────┐
                          │  Campaign dialer               │  src/bin/call.ts
                          │  npm run call -- +91…          │  → src/telephony/dialer.ts
                          └───────────────┬───────────────┘
                                          │ livekit-server-sdk
            ┌─────────────────────────────┼─────────────────────────────┐
            ▼                             ▼                              ▼
     RoomServiceClient          AgentDispatchClient                 SipClient
       createRoom         createDispatch(room,"dealer-       createSipParticipant(
                                  outbound")                    trunk, +91…, room)
            │                             │                              │
   ┌────────┴─────────────────────────────┴──────────────────────────────┴────────┐
   │                              LiveKit Cloud                                     │
   │   Room (SFU) ──dispatch──► your worker      LiveKit SIP ──INVITE──► Vobiz      │
   │       │ media                               (ST_…)        70530e47.sip.vobiz.ai│
   └───────┼───────────────────────────────────────────────────────────┬──────────┘
           │                                                            │ PSTN
           │                                                            ▼
           │                                                   📞 Dealer's phone
           │
   ════════╪══════════ once the dealer ANSWERS, this loop runs ═════════════════════
           │
   ┌───────┴───────────────────  Agent worker (npm run dev)  ────────────────────────┐
   │                              src/worker/voice-agent.ts                           │
   │                                                                                  │
   │  dealer audio ─AudioStream@16k─► Silero VAD ──end of speech──► Whisper STT       │
   │    (from room)                   vad.service.ts                whisper.service.ts │
   │                                                                      │ text      │
   │                                                                      ▼           │
   │                                                       session.sendUserMessage()  │
   │                                                                      │           │
   │                                              ┌──────── WebSocket ────────────┐   │
   │  dealer hears ◄─AudioSource◄─ audio-bridge ◄─│  ElevenLabs ConvAI agent      │   │
   │    (into room)                (AudioInterface)│  Main_Agent_Itarang ("Priya") │   │
   │                                              │  text-in → LLM + voice → audio │  │
   │                                              └────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────────────────────---┘
```

Audio is **16 kHz, mono, Int16 PCM** inside the worker. SIP/PSTN is 8 kHz; LiveKit
resamples to/from 16 kHz at the room edge.

---

## How each part works

1. **Campaign dialer** (`src/bin/call.ts` → `src/telephony/dialer.ts`) — given a number, it
   uses the LiveKit **server** SDK to (a) create a room, (b) dispatch the agent into it, and
   (c) tell LiveKit SIP to dial the dealer. The dealer's number is passed as dispatch
   **metadata**. Replace this CLI with your real campaign queue later — nothing else changes.
2. **LiveKit Cloud** — the **Room/SFU** mixes/routes audio between the dealer and the agent;
   **LiveKit SIP** turns the phone call into a room participant.
3. **Vobiz SIP trunk** — your carrier. The LiveKit outbound trunk (created by
   `npm run trunk:setup`) points at Vobiz, which routes the call onto the PSTN and rings the
   dealer with your number as caller ID.
4. **Agent dispatch** — the worker registers under `AGENT_NAME` (explicit dispatch), so the
   dialer's `createDispatch` lands a job for it in that exact room.
5. **Silero VAD** (`src/vad/vad.service.ts`) — detects when the dealer starts/stops talking
   and emits a complete spoken segment via `onSpeechEnd(frames)`. Silence/half-words never go
   to Whisper.
6. **Whisper STT** (`src/services/whisper.service.ts`) — wraps the segment's PCM in a WAV
   header and transcribes it with OpenAI (`gpt-4o-transcribe`, Hinglish-tuned), retries once,
   logs latency.
7. **ElevenLabs agent session** (`src/elevenlabs-agent/agent-session.ts`) — opens an
   authenticated **WebSocket** to your Conversational-AI agent and runs it **text-in /
   audio-out**: the worker calls `sendUserMessage(text)` with Whisper's transcript; the
   agent's LLM + knowledge generate the reply and stream it back as speech. The agent's own
   ASR is unused — Whisper fills that role.
8. **Audio bridge** (`src/elevenlabs-agent/audio-bridge.ts`) — implements ElevenLabs'
   `AudioInterface`; pushes the agent's reply audio into a LiveKit `AudioSource` (played on
   the `agent-voice` track → room → SIP → dealer). `interrupt()` clears the buffer on barge-in.
9. **Turn loop & hangup** — steps 5→8 repeat each time the dealer speaks; on hangup
   (`participantDisconnected`/`disconnected`) the worker closes the VAD streams and ends the
   ElevenLabs session.

---

## Project structure

```
src/
├── index.ts                          worker entrypoint (env + cli.runApp, explicit dispatch)
├── worker/
│   └── voice-agent.ts                the bridge worker: VAD → Whisper → agent → audio out
├── elevenlabs-agent/
│   ├── agent-session.ts              opens the ConvAI WebSocket; sendUserMessage / start / end
│   └── audio-bridge.ts               AudioInterface → LiveKit AudioSource (plays agent audio)
├── telephony/
│   ├── livekit-clients.ts            SipClient / AgentDispatchClient / RoomServiceClient
│   ├── trunk.ts                      ensureOutboundTrunk() → creates the LiveKit↔Vobiz trunk
│   └── dialer.ts                     placeOutboundCall(): room → dispatch → SIP participant
├── bin/
│   ├── call.ts                       npm run call  (campaign dialer)
│   ├── setup-trunk.ts                npm run trunk:setup
│   └── voice-from-agent.ts           npm run voice:from-agent (reads the agent's voice id)
├── services/
│   └── whisper.service.ts            WhisperService — transcribe(Buffer) → text (Hinglish)
├── vad/
│   └── vad.service.ts                VadService — Silero wrapper, speech callbacks
├── config/
│   └── env.ts                        zod-validated env, fail-fast on startup
├── types/
│   └── index.ts                      shared types + audio constants
└── utils/
    └── logger.ts                     structured leveled logger (no console.log)
```

> Legacy from the earlier component-pipeline build and **not used in the agent-bridge path**:
> `services/elevenlabs.service.ts` (our own TTS), `services/transcript.service.ts`,
> `conversation/conversation.service.ts` (rule engine). They're kept for reference / as the
> basis of the "ElevenLabs as TTS-only + your own LLM" variant.

---

## Prerequisites

- **Node.js 20+** (tested on Node 22).
- A **LiveKit Cloud** project (free tier is fine): https://cloud.livekit.io
- An **OpenAI API key** with access to the transcription endpoint.
- An **ElevenLabs** account with a **Conversational-AI agent** and its **agent id** (`agent_…`).
- A **SIP trunk** with a provider (here: **Vobiz**) for outbound PSTN calls.

---

## Installation

```bash
npm install
```

Installs `@livekit/agents`, `@livekit/agents-plugin-silero`, `@livekit/rtc-node`,
`livekit-server-sdk`, `@livekit/protocol`, `openai`, `@elevenlabs/elevenlabs-js`, `zod`.

---

## Configuration

```bash
cp .env.example .env
```

| Variable | Required | Notes |
|---|---|---|
| `LIVEKIT_URL` | yes | `wss://<your-project>.livekit.cloud` |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | yes | from the LiveKit project |
| `AGENT_NAME` | no | explicit-dispatch name (default `dealer-outbound`) |
| `OPENAI_API_KEY` | yes | Whisper transcription |
| `WHISPER_MODEL` | no | default `gpt-4o-transcribe` (also `gpt-4o-mini-transcribe`, `whisper-1`) |
| `STT_LANGUAGE` | no | blank = auto-detect (best for Hinglish), or `hi` |
| `STT_PROMPT` | no | optional Hinglish biasing phrase |
| `ELEVENLABS_API_KEY` | yes | ElevenLabs API |
| `ELEVENLABS_AGENT_ID` | **yes** | your Conversational-AI agent (`agent_…`) — the brain + voice |
| `ELEVENLABS_VOICE_ID` | no | only for the legacy TTS-only path; not used in agent mode |
| `ELEVENLABS_MODEL_ID` | no | only for the legacy TTS-only path |
| `SIP_TRUNK_ADDRESS` | for calls | Vobiz outbound SIP host (e.g. `70530e47.sip.vobiz.ai`) |
| `SIP_TRUNK_USERNAME` / `SIP_TRUNK_PASSWORD` | for calls | Vobiz SIP credentials |
| `SIP_CALLER_NUMBER` | for calls | caller id in E.164 (e.g. `+9179…`) |
| `SIP_OUTBOUND_TRUNK_ID` | for calls | output of `npm run trunk:setup` |
| `SIP_TRANSPORT` | no | `auto` \| `udp` \| `tcp` \| `tls` (default `auto`) |
| `CALL_RINGING_TIMEOUT` / `CALL_MAX_DURATION` | no | seconds (default `30` / `600`) |
| `LOG_LEVEL` | no | `debug` \| `info` \| `warn` \| `error` (default `info`) |

The agent's **greeting/first message** is configured on the ElevenLabs agent itself (in the
ElevenLabs dashboard), not here — it plays automatically when the dealer answers.

Missing/empty required vars cause a fail-fast startup error that names exactly what's wrong.

---

## One-time setup

1. **(Optional) copy the agent's voice id** — only needed for the legacy TTS-only path:
   ```bash
   # set ELEVENLABS_AGENT_ID in .env, then:
   npm run voice:from-agent           # prints ELEVENLABS_VOICE_ID=…
   ```
2. **Add your Vobiz SIP trunk details** to `.env` (`SIP_TRUNK_ADDRESS`, `SIP_TRUNK_USERNAME`,
   `SIP_TRUNK_PASSWORD`, `SIP_CALLER_NUMBER`). Confirm India DLT / caller-ID rules with Vobiz.
3. **Create the LiveKit outbound trunk** (points LiveKit at Vobiz):
   ```bash
   npm run trunk:setup                # prints SIP_OUTBOUND_TRUNK_ID=… → paste into .env
   ```

---

## Running & placing a call

```bash
npm run build      # compile (or use npm run dev to run TypeScript directly)

npm run dev                          # terminal 1: the agent worker (stays running)
npm run call -- +919322957122        # terminal 2: dial a dealer
```

When the dealer answers they hear your agent's opening line, then a normal Hinglish
conversation. A healthy turn logs:

```
[agent] connected to room {"room":"dealer-call-…","dealer":"+91…"}
[agent] audio track subscribed {"participant":"dealer"}
[agent] elevenlabs agent session started {"agentId":"agent_…"}
[agent-session] agent response {"response":"नमस्कार sir, Priya बोल रही हूँ…"}
[agent] speech started → speech ended
[whisper] whisper latency: …ms
[agent] transcript received {"text":"मैं Xite battery use करता हूँ"}
[agent-session] agent response {"response":"बहुत अच्छा sir, …"}
```

> `npm run call` stands in for the **Campaign Backend** — replace it with your scheduler/queue.

---

## Hinglish ASR

For Hindi-English code-switching, keep `WHISPER_MODEL=gpt-4o-transcribe` and leave
`STT_LANGUAGE` blank (auto-detect usually beats forcing `hi`). Use `STT_PROMPT` to bias
brand/model spelling, e.g. `STT_PROMPT=Trontek, Xite, 51.2 volt, lithium battery, EMI`.

---

## Design notes & trade-offs

- **Why the agent is the brain.** Your ElevenLabs Conversational-AI agent already holds the
  persona, prompt, and product knowledge, so it drives the conversation. The worker only
  feeds it Whisper text and plays its audio back.
- **Text-in / audio-out.** We run the agent over a WebSocket, sending transcript **text**
  (not audio) so Whisper owns STT. We control turn-taking via Silero VAD.
- **Latency.** Each turn waits for end-of-speech, then Whisper (~1–2 s), then the agent —
  roughly 4–5 s round trip.
- **Audio quality (bridge vs native).** Because audio crosses an extra bridge
  (Vobiz → LiveKit → worker → WebSocket → ElevenLabs and back) with 8 k↔16 k resampling and
  no echo cancellation, call quality is capped. For the best telephony quality, ElevenLabs'
  **native SIP outbound** (`conversationalAi.sipTrunk.outboundCall`) runs the same agent in a
  telephony-native path with built-in echo cancellation + jitter buffer — at the cost of
  taking LiveKit out of the live-call path.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid environment configuration` at startup | A required `.env` value is missing/empty — the message lists which. |
| `SIP_OUTBOUND_TRUNK_ID is required` | Run `npm run trunk:setup` and paste the printed id into `.env`. |
| Call connects but agent doesn't respond to you | Check the worker shows `audio track subscribed` then `transcript received`; if not, your audio isn't reaching the worker. |
| Agent greeting plays before you pick up | Fixed — the session now starts only when the dealer's audio is subscribed (on answer). |
| Choppy audio / "can't hear you" | Bridge echo/jitter (see Design notes); consider ElevenLabs native SIP. |
| `401`/auth errors | Check the relevant API key (OpenAI / ElevenLabs / LiveKit) in `.env`. |
