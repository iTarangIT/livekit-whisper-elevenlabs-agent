# Outbound AI Voice Agent — LiveKit + GPT-4o Realtime (voice-to-voice)

An **outbound** voice agent that phones dealers over the phone network and talks to them in
Hinglish. A single **OpenAI Realtime (GPT-4o) voice-to-voice** model does the listening,
thinking, and speaking in one streaming session. Built as a single LiveKit Agent Worker in
strict TypeScript.

```
Campaign dialer → LiveKit (Room + SIP) → Vobiz trunk → PSTN → dealer's phone
        once answered:
        dealer audio ⇄ GPT-4o Realtime (STT + LLM + TTS, server VAD, barge-in) ⇄ dealer hears reply
```

**Who does what:** LiveKit moves the audio and places the call; **GPT-4o Realtime** does
everything else — transcription, reasoning (from `prompts/agent-instructions.md`), turn
detection, and speech — over one WebSocket the LiveKit OpenAI plugin manages for you.

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
   │   voice.AgentSession(llm: openai.realtime.RealtimeModel) drives the call.        │
   │   RoomIO auto-subscribes the dealer's audio and auto-publishes the agent's.      │
   │                                                                                  │
   │            ┌────────────────────── WebSocket ───────────────────────┐           │
   │  dealer  ──┤  OpenAI Realtime (GPT-4o)                               ├──► dealer │
   │  audio     │  server VAD → STT → LLM (prompts/agent-instructions.md) │   hears   │
   │            │  → TTS (voice: cedar), barge-in handled natively        │   reply   │
   │            └─────────────────────────────────────────────────────────┘          │
   └─────────────────────────────────────────────────────────────────────────────---┘
```

Inside the worker, the LiveKit OpenAI plugin handles all audio plumbing: it resamples
to/from the Realtime API's **24 kHz mono PCM**, while SIP/PSTN stays at 8 kHz and LiveKit
resamples at the room edge.

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
5. **Realtime session** (`src/worker/voice-agent.ts`) — a `voice.AgentSession` with
   `openai.realtime.RealtimeModel` as its `llm`. `session.start({ agent, room })` makes the
   plugin's `RoomIO` auto-subscribe to the dealer's audio track and auto-publish the agent's
   audio track. The model streams audio both ways: it transcribes, reasons, and speaks in one
   step. Turn-taking and barge-in are handled by the model's **server VAD** (`semantic_vad`
   by default, `server_vad` optional). On answer the worker calls `session.say(openingLine)`.
6. **Instructions** (`prompts/agent-instructions.md`) — the agent's persona, goal, and
   Hinglish behavior live here as the `voice.Agent` system instructions, loaded at startup.
7. **Metrics** (`src/metrics/metrics.ts`) — session events feed a per-call JSONL log:
   `UserInputTranscribed` → transcript + turn, `AgentStateChanged` → response latency,
   `ConversationItemAdded` → agent reply + barge-in count, `MetricsCollected` → raw OpenAI
   realtime metrics. `npm run metrics:report` summarizes them.
8. **Turn loop & hangup** — the model runs the whole conversation; on hangup
   (`participantDisconnected`/`disconnected`) the worker finalizes metrics and closes the
   session.

---

## Project structure

```
src/
├── index.ts                          worker entrypoint (env + cli.runApp, explicit dispatch)
├── worker/
│   └── voice-agent.ts                AgentSession + RealtimeModel; wires metrics + lifecycle
├── telephony/
│   ├── livekit-clients.ts            SipClient / AgentDispatchClient / RoomServiceClient
│   ├── trunk.ts                      ensureOutboundTrunk() → creates the LiveKit↔Vobiz trunk
│   └── dialer.ts                     placeOutboundCall(): room → dispatch → SIP participant
├── bin/
│   ├── call.ts                       npm run call  (campaign dialer)
│   ├── setup-trunk.ts                npm run trunk:setup
│   └── metrics-report.ts             npm run metrics:report
├── metrics/
│   └── metrics.ts                    CallMetrics — per-call JSONL from session events
├── config/
│   └── env.ts                        zod-validated env, fail-fast on startup
└── utils/
    └── logger.ts                     structured leveled logger (no console.log)

prompts/
└── agent-instructions.md             the agent's persona / goal / Hinglish behavior
```

---

## Prerequisites

- **Node.js 20+** (tested on Node 22).
- A **LiveKit Cloud** project (free tier is fine): https://cloud.livekit.io
- An **OpenAI API key** with access to the **Realtime** API (`gpt-realtime`).
- A **SIP trunk** with a provider (here: **Vobiz**) for outbound PSTN calls.

---

## Installation

```bash
npm install
```

Installs `@livekit/agents`, `@livekit/agents-plugin-openai`, `@livekit/rtc-node`,
`livekit-server-sdk`, `@livekit/protocol`, and `zod`.

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
| `OPENAI_API_KEY` | yes | OpenAI Realtime API |
| `REALTIME_MODEL` | no | default `gpt-realtime` (also `gpt-realtime-mini`, `gpt-4o-realtime-preview`) |
| `REALTIME_VOICE` | no | default `cedar` (also `marin`, `alloy`, `echo`, `shimmer`, …) |
| `AGENT_INSTRUCTIONS_PATH` | no | default `prompts/agent-instructions.md` |
| `TURN_DETECTION` | no | `semantic_vad` (default) or `server_vad` |
| `VAD_SILENCE_MS` | no | silence before end-of-turn for `server_vad` (default `500`) |
| `AGENT_OPENING_LINE` | no | greeting spoken on answer (default provided) |
| `SIP_TRUNK_ADDRESS` | for calls | Vobiz outbound SIP host (e.g. `70530e47.sip.vobiz.ai`) |
| `SIP_TRUNK_USERNAME` / `SIP_TRUNK_PASSWORD` | for calls | Vobiz SIP credentials |
| `SIP_CALLER_NUMBER` | for calls | caller id in E.164 (e.g. `+9179…`) |
| `SIP_OUTBOUND_TRUNK_ID` | for calls | output of `npm run trunk:setup` |
| `SIP_TRANSPORT` | no | `auto` \| `udp` \| `tcp` \| `tls` (default `auto`) |
| `CALL_RINGING_TIMEOUT` / `CALL_MAX_DURATION` | no | seconds (default `30` / `600`) |
| `LOG_LEVEL` | no | `debug` \| `info` \| `warn` \| `error` (default `info`) |

The agent's persona, goal, and language behavior live in **`prompts/agent-instructions.md`**;
edit that file to change how the agent talks. Missing/empty required vars cause a fail-fast
startup error that names exactly what's wrong.

---

## One-time setup

1. **Add your Vobiz SIP trunk details** to `.env` (`SIP_TRUNK_ADDRESS`, `SIP_TRUNK_USERNAME`,
   `SIP_TRUNK_PASSWORD`, `SIP_CALLER_NUMBER`). Confirm India DLT / caller-ID rules with Vobiz.
2. **Create the LiveKit outbound trunk** (points LiveKit at Vobiz):
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

When the dealer answers they hear the opening line in the `cedar` voice, then a normal
Hinglish conversation with natural turn-taking and barge-in. A healthy call logs:

```
[agent] connected to room {"room":"dealer-call-…","dealer":"+91…"}
[agent] audio track subscribed {"participant":"dealer"}
[agent] realtime session started {"model":"gpt-realtime","voice":"cedar"}
[agent] user transcript {"text":"मैं Xite battery use करता हूँ"}
```

> `npm run call` stands in for the **Campaign Backend** — replace it with your scheduler/queue.

---

## Hinglish

Hinglish is steered through `prompts/agent-instructions.md`, not a config flag: the
instructions tell the model to speak Hindi-base Hinglish and to mirror the dealer's language.
GPT-4o Realtime handles code-switched conversational speech in one model. Note that the
inner transcription model (`gpt-4o-mini-transcribe`) treats a turn as a single language, so
logged transcripts on heavily code-switched turns can be noisier than the actual spoken reply.

---

## Tuning turn-taking

- **`semantic_vad`** (default) lets the model decide when the dealer is done — most natural.
  Adjust `eagerness` in `src/worker/voice-agent.ts` if it cuts in too early/late.
- **`server_vad`** (`TURN_DETECTION=server_vad`) uses fixed silence-based endpointing; raise
  `VAD_SILENCE_MS` on noisy phone lines so it waits longer before responding.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid environment configuration` at startup | A required `.env` value is missing/empty — the message lists which. |
| `SIP_OUTBOUND_TRUNK_ID is required` | Run `npm run trunk:setup` and paste the printed id into `.env`. |
| Worker fails to read instructions at startup | Check `AGENT_INSTRUCTIONS_PATH` points at an existing file relative to the working directory. |
| Agent cuts in too early / waits too long | Tune `semantic_vad` eagerness or switch to `server_vad` + `VAD_SILENCE_MS`. |
| `401`/auth errors | Check the relevant API key (OpenAI / LiveKit) in `.env`. |
```
