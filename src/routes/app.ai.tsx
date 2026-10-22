import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Droplets,
  Fan,
  Flame,
  Lightbulb,
  Loader2,
  Mic,
  Send,
  Square,
  Thermometer,
  type LucideIcon,
} from "lucide-react";
import {
  askAssistant,
  annotateVoiceTurn,
  createVoiceSession,
  getAssistantSensors,
} from "@/lib/api/assistant.functions";
import { AiStatusBadge, isStale } from "@/components/ai-status";
import type { VoiceSegment } from "@/lib/avatar-actions";
import { ExplorerAvatar, type ExplorerAvatarHandle } from "@/components/ExplorerAvatar";
import {
  Button,
  ErrorState,
  RelativeTime,
  Select,
  Skeleton,
  StatusDot,
  formatDateTime,
  formatNumber,
  formatTemp,
  tempUnit,
  toTemp,
  toTempDelta,
  useDisplayPrefs,
  type Status,
} from "@/components/ui-kit";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };
type Mode = "chat" | "voice";

/* The mode lives in the URL (?mode=voice) so voice can be linked to directly. */
export const Route = createFileRoute("/app/ai")({
  validateSearch: (s: Record<string, unknown>): { mode?: Mode } => ({
    mode: s.mode === "voice" ? "voice" : undefined,
  }),
  component: AiAssistant,
});

const BLOB = "/ai/bloub.gif";

const sensorsQuery = {
  queryKey: ["assistant-sensors"],
  queryFn: () => getAssistantSensors(),
  refetchInterval: 10_000,
};

function AiAssistant() {
  // Re-render when the temperature unit or clock preference changes.
  useDisplayPrefs();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const mode: Mode = search.mode ?? "chat";
  // The 3D model is ~24 MB: only load it once voice mode is first opened,
  // then keep it mounted so switching back and forth is instant.
  const [voiceOpened, setVoiceOpened] = useState(false);
  const showVoice = voiceOpened || mode === "voice";
  const toggle = (voice: boolean) => {
    if (voice || mode === "voice") setVoiceOpened(true);
    void navigate({ search: { mode: voice ? "voice" : undefined }, replace: true });
  };

  return (
    <div className="ai-page">
      <header className="ai-head">
        <div className="min-w-0">
          <h1 className="pg-t-h2">AI assistant</h1>
          <p className="ai-head-sub">
            {mode === "chat"
              ? "Ask Ama about your farm in any language."
              : "Talk to Ama out loud. She answers out loud too."}
          </p>
        </div>
        <ModeToggle voice={mode === "voice"} onChange={toggle} />
      </header>

      <div className="ai-layout">
        <div className={cn("ai-stage", mode === "voice" && "ai-stage--voice")}>
          <div className={mode === "chat" ? "contents" : "hidden"}>
            <TextChat />
          </div>
          {showVoice && (
            <div className={mode === "voice" ? "contents" : "hidden"}>
              <VoiceChat active={mode === "voice"} />
            </div>
          )}
        </div>
        <SensorRail />
      </div>
      <style>{pageCss}</style>
    </div>
  );
}

// Day/night toggle: night = text chat, day = voice ------------------------------

function ModeToggle({ voice, onChange }: { voice: boolean; onChange: (voice: boolean) => void }) {
  return (
    <div role="group" aria-label="Assistant mode" className="flex items-center gap-1 select-none">
      <button
        type="button"
        onClick={() => onChange(false)}
        aria-pressed={!voice}
        className={cn("ai-mode-btn", !voice && "ai-mode-btn--on")}
      >
        Chat
      </button>
      <div className="dn-wrap">
        <input
          type="checkbox"
          id="ai-mode-toggle"
          className="dn-checkbox"
          checked={voice}
          onChange={(e) => onChange(e.target.checked)}
          aria-label="Voice mode"
        />
        <label className="dn-btn" htmlFor="ai-mode-toggle">
          <span className="dn-feature" />
        </label>
      </div>
      <button
        type="button"
        onClick={() => onChange(true)}
        aria-pressed={voice}
        className={cn("ai-mode-btn", voice && "ai-mode-btn--on")}
      >
        Voice
      </button>
    </div>
  );
}

// Sensor readings, stacked vertically on the right --------------------------------

const fmt = (v: number | null | undefined, digits = 1) =>
  formatNumber(v, { maximumFractionDigits: digits });

const SEVERITY: Record<string, Status> = { info: "info", warning: "warn", critical: "crit" };

function SensorRail() {
  useDisplayPrefs();
  const q = useQuery(sensorsQuery);
  const [deviceId, setDeviceId] = useState<string>();
  const readings = q.data?.readings ?? [];
  const r = readings.find((x) => x.device_id === deviceId) ?? readings[0];
  const stale = !!r && isStale(r);
  const alerts = q.data?.alerts ?? [];

  const tempDiff =
    r?.temperature != null && r.target_temp != null ? r.temperature - r.target_temp : null;
  const rows: {
    label: string;
    value: number | null | undefined;
    digits?: number;
    unit?: string;
    icon: LucideIcon;
    hint?: ReactNode;
  }[] = r
    ? [
        {
          label: "Temperature",
          value: toTemp(r.temperature),
          unit: tempUnit(),
          icon: Thermometer,
          hint:
            r.target_temp != null ? (
              <>
                Target {formatTemp(r.target_temp)}
                {tempDiff != null && Math.abs(tempDiff) >= 0.5 && (
                  <span
                    className={cn(
                      "ml-1",
                      !stale && Math.abs(tempDiff) >= 2 ? "text-warn" : "text-ink-3",
                    )}
                  >
                    · {tempDiff > 0 ? "+" : "−"}
                    {fmt(Math.abs(toTempDelta(tempDiff)!))}
                  </span>
                )}
              </>
            ) : undefined,
        },
        { label: "Humidity", value: r.humidity, unit: "% RH", icon: Droplets, hint: "DHT22" },
        { label: "Gas index", value: r.gas_index, digits: 1, icon: Flame, hint: "MQ-135" },
        {
          // The LDR reports 0-50 (relative brightness, not lux); show it as a percentage.
          label: "Light",
          value: r.light == null ? null : r.light * 2,
          digits: 0,
          unit: "%",
          icon: Lightbulb,
          hint: "Relative, from the LDR",
        },
        {
          label: "Fan",
          value: r.fan_rpm,
          digits: 0,
          unit: "rpm",
          icon: Fan,
          hint:
            [
              r.fan_level && `Level ${r.fan_level}`,
              r.fan_duty != null && `${Math.round(r.fan_duty * 100)}% duty`,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
        },
      ]
    : [];

  return (
    <aside className="ai-rail pg-panel" aria-labelledby="ai-rail-h">
      <div className="border-b border-hairline px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="ai-rail-h" className="pg-t-h3">
            Readings
          </h2>
          {r && <AiStatusBadge status={r.ai_status} at={r.created_at} />}
        </div>
        {q.isPending ? (
          <Skeleton className="mt-2 h-3 w-32" />
        ) : (
          r && (
            <p className="pg-t-caption mt-1 truncate">
              {r.house_name ?? r.device_code} · <RelativeTime iso={r.created_at} />
            </p>
          )
        )}
        {readings.length > 1 && (
          <div className="mt-3">
            <label htmlFor="ai-rail-house" className="sr-only">
              House
            </label>
            <Select
              id="ai-rail-house"
              name="house"
              value={r?.device_id}
              onChange={(e) => setDeviceId(e.target.value)}
              className="ai-rail-select"
            >
              {readings.map((x) => (
                <option key={x.device_id} value={x.device_id}>
                  {x.house_name ?? x.device_code}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {stale && r && (
        <p className="border-b border-hairline bg-offline-tint px-4 py-2 text-[12px] leading-4 text-ink-2">
          Last seen <RelativeTime iso={r.created_at} />. Showing the values from{" "}
          {formatDateTime(r.created_at)}.
        </p>
      )}

      {q.isPending ? (
        <ul className="ai-rail-list" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="ai-rail-row">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="ml-auto h-4 w-12" />
            </li>
          ))}
        </ul>
      ) : q.isError ? (
        <ErrorState
          variant="inline"
          className="px-4"
          title="Couldn’t load readings"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : !r ? (
        <div className="px-4 py-5">
          <p className="pg-t-h3">No sensor readings yet</p>
          <p className="mt-1 text-[13px] leading-[18px] text-ink-2">
            Readings appear here once the Raspberry Pi reports.
          </p>
          <Link
            to="/app/devices"
            className="mt-3 inline-block text-[13px] font-medium text-brand underline-offset-4 hover:underline"
          >
            Go to devices
          </Link>
        </div>
      ) : (
        <ul className="ai-rail-list">
          {rows.map((row) => (
            <li key={row.label} className="ai-rail-row">
              <row.icon className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-[18px] text-ink-2">{row.label}</span>
                {row.hint && (
                  <span className="block text-[12px] leading-4 text-ink-3">{row.hint}</span>
                )}
              </span>
              {row.value == null ? (
                <span className="text-[12px] leading-4 text-ink-3">No sensor</span>
              ) : (
                <span
                  className={cn(
                    "pg-mono text-[15px] leading-5 font-medium whitespace-nowrap",
                    stale ? "text-ink-2" : "text-ink",
                  )}
                >
                  {fmt(row.value, row.digits ?? 1)}
                  {row.unit && (
                    <span className="ml-1 font-sans text-[12px] font-normal text-ink-3">
                      {row.unit}
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {alerts.length > 0 && (
        <div className="border-t border-hairline px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13px] leading-[18px] font-semibold text-ink">
              {alerts.length} open alert{alerts.length > 1 ? "s" : ""}
            </h3>
            <Link
              to="/app/alerts"
              className="text-[12px] leading-4 font-medium text-brand underline-offset-4 hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="mt-2 flex items-start gap-2">
            <StatusDot
              status={SEVERITY[alerts[0].severity] ?? "neutral"}
              label={alerts[0].severity}
              className="mt-[5px]"
            />
            <div className="min-w-0">
              <p className="text-[13px] leading-[18px] text-ink-2">{alerts[0].message}</p>
              <RelativeTime iso={alerts[0].created_at} className="pg-t-caption" />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

// Text chat with the blob (night mode) --------------------------------------------

function BlobAvatar({ size = 28 }: { size?: number }) {
  return (
    <img
      src={BLOB}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full border border-hairline bg-white object-cover"
      style={{ width: size, height: size }}
    />
  );
}

/** Replies sometimes use **bold**; render it instead of showing the asterisks. */
function withBold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 ? (
      <strong key={i} className="font-semibold">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

type Snapshot = Awaited<ReturnType<typeof getAssistantSensors>>;

/** Starter questions grounded in the latest readings. */
function suggestions(data: Snapshot | undefined) {
  const out: string[] = [];
  const r = data?.readings[0];
  if (r) {
    const name = r.house_name ?? r.device_code;
    const diff =
      r.temperature != null && r.target_temp != null ? r.temperature - r.target_temp : null;
    out.push(
      diff != null && Math.abs(diff) >= 2
        ? `Why is ${name} at ${formatTemp(r.temperature)}?`
        : `Is ${name} at the right temperature?`,
    );
    const cause = r.ai_causes?.[0];
    if (cause) out.push(`What should I do about ${cause.label.toLowerCase()}?`);
    if (r.gas_index != null) out.push(`Is the gas level in ${name} safe?`);
  }
  if (data?.alerts.length) out.push("Explain the open alerts");
  out.push("What should I check on the farm today?");
  return out.slice(0, 4);
}

function TextChat() {
  useDisplayPrefs();
  const sensors = useQuery(sensorsQuery);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const run = async (next: Msg[]) => {
    setBusy(true);
    setError(null);
    try {
      const { reply } = await askAssistant({ data: { messages: next.slice(-20) } });
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const send = async (e?: FormEvent, preset?: string) => {
    e?.preventDefault();
    const text = (preset ?? input).trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    await run(next);
  };

  const lastIsUser = messages[messages.length - 1]?.role === "user";

  return (
    <div className="ai-fade flex h-full flex-col">
      <div ref={listRef} className="ai-scroll flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col px-4 py-5 md:px-6 md:py-6">
          {messages.length === 0 ? (
            <div className="my-auto py-6">
              <BlobAvatar size={64} />
              <h2 className="pg-t-h2 mt-4">Ask Ama about your farm</h2>
              <p className="mt-1 max-w-[52ch] text-[14px] leading-5 text-ink-2">
                She reads the latest sensor data from every house and answers in your language,
                including Twi, Ga, Ewe and Hausa.
              </p>
              <div className="mt-5 flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap">
                {suggestions(sensors.data).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="ai-chip"
                    onClick={() => void send(undefined, s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ol className="flex flex-col gap-5" aria-label="Conversation">
              {messages.map((m, i) =>
                m.role === "assistant" ? (
                  <li key={i} className="flex items-start gap-3">
                    <BlobAvatar />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] leading-4 font-medium text-ink-3">Ama</p>
                      <p className="mt-1 text-[14px] leading-[22px] whitespace-pre-wrap text-ink">
                        {withBold(m.content)}
                      </p>
                    </div>
                  </li>
                ) : (
                  <li key={i} className="flex justify-end">
                    <p className="ai-user-msg">{m.content}</p>
                  </li>
                ),
              )}
            </ol>
          )}

          <div aria-live="polite" className="contents">
            {busy && (
              <div className="mt-5 flex items-center gap-3 text-[13px] text-ink-3">
                <BlobAvatar /> Thinking…
              </div>
            )}
          </div>
          {error && (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2 rounded-md border border-crit/20 bg-crit-tint px-3 py-2.5"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-crit" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-[18px] font-medium text-ink">
                  Ama couldn’t answer
                </p>
                <p className="mt-0.5 text-[12px] leading-4 break-words text-ink-2">{error}</p>
              </div>
              {lastIsUser && (
                <Button size="sm" variant="ghost" onClick={() => void run(messages)}>
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={send} className="ai-composer">
        <div className="mx-auto flex w-full max-w-[720px] items-center gap-2">
          <label htmlFor="ai-message" className="sr-only">
            Message Ama
          </label>
          <input
            id="ai-message"
            name="message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message Ama…"
            autoComplete="off"
            enterKeyHint="send"
            className="pg-input ai-input flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            iconOnly
            icon={Send}
            loading={busy}
            aria-label="Send message"
          />
        </div>
        <p className="pg-t-caption mx-auto mt-2 w-full max-w-[720px]">
          Ama can be wrong. Check the readings before acting.
        </p>
      </form>
    </div>
  );
}

// Live speech to speech with the 3D explorer (day mode) -----------------------------
// One tap opens a Realtime session over WebRTC: the mic streams to OpenAI, her
// voice streams back while it's being generated, and the server detects when
// you stop talking. Replies start in about a second, there's no button to
// press per turn, and talking over her interrupts her.

type VoiceState = "off" | "connecting" | "listening" | "hearing" | "thinking" | "speaking";

type LiveCall = {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  mic: MediaStream;
  audio: HTMLAudioElement;
};

type RealtimeEvent = {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
  response?: { status?: string; status_details?: { error?: { message?: string } } };
};

type VoiceSession = Awaited<ReturnType<typeof createVoiceSession>>;

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

function VoiceChat({ active }: { active: boolean }) {
  const avatar = useRef<ExplorerAvatarHandle>(null);
  const call = useRef<LiveCall | null>(null);
  // Bumped on every hang-up, so events and awaits from an old call are ignored.
  const gen = useRef(0);
  const youItem = useRef<string | null>(null);
  const turns = useRef(0);
  const [state, setState] = useState<VoiceState>("off");
  const [error, setError] = useState<string | null>(null);
  const [you, setYou] = useState("");
  const [ama, setAma] = useState("");
  const [amaFinal, setAmaFinal] = useState("");
  // Gestures + translation for the current reply (see annotateVoiceTurn).
  const youText = useRef("");
  const replySeq = useRef(0);
  const speakingSince = useRef<number | null>(null);
  const pendingGestures = useRef<VoiceSegment[] | null>(null);
  const gestureTimers = useRef<number[]>([]);
  const [trans, setTrans] = useState<{ language: string; you: string; ama: string } | null>(null);
  const clearGestures = () => {
    gestureTimers.current.forEach((t) => window.clearTimeout(t));
    gestureTimers.current = [];
  };
  // Spread the parts over her speech by their share of the text. Her pace is
  // estimated (about 14 characters a second); the next part's gesture simply
  // starts a little early or late if she talks faster or slower.
  const scheduleGestures = (segments: VoiceSegment[]) => {
    clearGestures();
    const start = speakingSince.current;
    if (start == null || !segments.length) return;
    const total = segments.reduce((n, x) => n + x.text.length, 0) || 1;
    const estMs = (total / 14) * 1000;
    const elapsed = Date.now() - start;
    let at = 0;
    segments.forEach((seg, i) => {
      const end = at + (seg.text.length / total) * estMs;
      const isLast = i === segments.length - 1;
      if (end > elapsed || isLast) {
        const delay = Math.max(0, at - elapsed);
        gestureTimers.current.push(
          window.setTimeout(() => avatar.current?.play(seg.action, "talking"), delay),
        );
      }
      at = end;
    });
  };

  const hangUp = useCallback(() => {
    gen.current++;
    clearGestures();
    speakingSince.current = null;
    pendingGestures.current = null;
    const c = call.current;
    call.current = null;
    if (c) {
      c.dc.close();
      c.mic.getTracks().forEach((t) => t.stop());
      c.pc.close();
      c.audio.pause();
      c.audio.srcObject = null;
    }
    avatar.current?.play("idle");
    setState("off");
  }, []);

  // Pre-mint the session secret while voice mode is open, so tapping the mic
  // only has to do the WebRTC handshake. Secrets live 120 s; use them within 90.
  const warm = useRef<{ p: Promise<VoiceSession>; at: number } | null>(null);
  const takeSession = () => {
    const w = warm.current;
    warm.current = null;
    return w && Date.now() - w.at < 90_000 ? w.p : createVoiceSession();
  };
  useEffect(() => {
    if (!active) {
      warm.current = null;
      return;
    }
    const prewarm = () => {
      if (call.current) return;
      const p = createVoiceSession();
      p.catch(() => {
        if (warm.current?.p === p) warm.current = null;
      });
      warm.current = { p, at: Date.now() };
    };
    prewarm();
    const t = window.setInterval(prewarm, 85_000);
    return () => window.clearInterval(t);
  }, [active]);

  // Leaving the page or switching back to chat ends the call (mic off, no audio).
  useEffect(() => hangUp, [hangUp]);
  useEffect(() => {
    if (!active) hangUp();
  }, [active, hangUp]);

  const onEvent = (e: RealtimeEvent) => {
    switch (e.type) {
      case "input_audio_buffer.speech_started":
        youItem.current = e.item_id ?? null;
        setYou("");
        setState("hearing");
        avatar.current?.play("idle");
        break;
      case "input_audio_buffer.speech_stopped":
        setState("thinking");
        avatar.current?.play("walking");
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (e.item_id === youItem.current) setYou((s) => s + (e.delta ?? ""));
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (e.item_id === youItem.current) {
          setYou(e.transcript ?? "");
          youText.current = e.transcript ?? "";
        }
        break;
      case "response.created":
        replySeq.current++;
        clearGestures();
        pendingGestures.current = null;
        setAma("");
        setTrans(null);
        break;
      case "response.output_audio_transcript.delta":
        setAma((s) => s + (e.delta ?? ""));
        break;
      case "response.output_audio_transcript.done": {
        const text = e.transcript ?? "";
        setAma(text);
        setAmaFinal(text);
        if (!text.trim()) break;
        const my = gen.current;
        const seq = replySeq.current;
        annotateVoiceTurn({
          data: { you: youText.current.slice(0, 4000), ama: text.slice(0, 4000) },
        })
          .then((a) => {
            if (my !== gen.current || seq !== replySeq.current) return;
            setTrans({ language: a.language, you: a.you_english, ama: a.ama_english });
            if (speakingSince.current != null) scheduleGestures(a.segments);
            else pendingGestures.current = a.segments;
          })
          .catch(() => {
            /* gestures and translation are extras; the conversation goes on */
          });
        break;
      }
      case "output_audio_buffer.started":
        setState("speaking");
        speakingSince.current = Date.now();
        avatar.current?.play(turns.current++ % 2 ? "talking2" : "talking");
        if (pendingGestures.current) {
          scheduleGestures(pendingGestures.current);
          pendingGestures.current = null;
        }
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        clearGestures();
        speakingSince.current = null;
        setState((s) => (s === "speaking" ? "listening" : s));
        avatar.current?.play("idle");
        break;
      case "response.done":
        if (e.response?.status === "failed") {
          setError(e.response.status_details?.error?.message ?? "Ama couldn’t answer that.");
          setState("listening");
          avatar.current?.play("sad");
        }
        break;
      case "error":
        setError(e.error?.message ?? "Something went wrong in the live call.");
        break;
    }
  };

  const start = async () => {
    if (call.current) return;
    const my = ++gen.current;
    setError(null);
    setYou("");
    setAma("");
    setState("connecting");
    avatar.current?.play("idle");
    let mic: MediaStream | undefined;
    let pc: RTCPeerConnection | undefined;
    try {
      // Mic permission and the session secret in parallel.
      const [stream, session] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }),
        takeSession(),
      ]);
      mic = stream;
      if (my !== gen.current) throw new Error("cancelled");

      const conn = new RTCPeerConnection();
      pc = conn;
      const audio = new Audio();
      audio.autoplay = true;
      conn.ontrack = (ev) => {
        audio.srcObject = ev.streams[0];
        void audio.play().catch(() => {});
      };
      stream.getTracks().forEach((t) => conn.addTrack(t, stream));
      const dc = conn.createDataChannel("oai-events");
      dc.onmessage = (m) => {
        if (my !== gen.current) return;
        try {
          onEvent(JSON.parse(m.data as string) as RealtimeEvent);
        } catch {
          /* ignore malformed events */
        }
      };
      dc.onopen = () => {
        if (my === gen.current) setState("listening");
      };
      conn.onconnectionstatechange = () => {
        if (my === gen.current && conn.connectionState === "failed") {
          hangUp();
          setError("The live connection dropped. Tap the mic to reconnect.");
        }
      };
      call.current = { pc: conn, dc, mic: stream, audio };

      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      const res = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${session.clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!res.ok) throw new Error(`Couldn’t start the live call (${res.status}).`);
      const sdp = await res.text();
      if (my !== gen.current) return;
      await conn.setRemoteDescription({ type: "answer", sdp });
    } catch (err) {
      // Release this attempt unless it became the live call (hangUp handles that).
      if (!mic || call.current?.mic !== mic) {
        mic?.getTracks().forEach((t) => t.stop());
        pc?.close();
      }
      if (my !== gen.current) return;
      hangUp();
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in the browser to talk to Ama."
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
  };

  const on = state !== "off";
  const label = {
    off: "Tap to talk",
    connecting: "Connecting…",
    listening: "Listening… just talk",
    hearing: "Hearing you…",
    thinking: "Thinking…",
    speaking: "Speaking… talk to interrupt",
  }[state];
  const dot: Status = (
    {
      off: "brand",
      connecting: "neutral",
      listening: "crit",
      hearing: "crit",
      thinking: "warn",
      speaking: "ok",
    } as const
  )[state];

  return (
    <div className="ai-fade relative h-full">
      <div className="absolute inset-0">
        <ExplorerAvatar ref={avatar} className="h-full w-full" />
      </div>

      {(you || ama) && (
        <div className="ai-turn">
          {you && (
            <div className="ai-float">
              <p className="ai-float-label">
                You{trans?.language && trans.language !== "English" ? ` · ${trans.language}` : ""}
              </p>
              <p className="mt-0.5 text-ink">{you}</p>
              {trans?.you && trans.language !== "English" && trans.you.trim() !== you.trim() && (
                <p className="ai-float-en">English: {trans.you}</p>
              )}
            </div>
          )}
          {ama && (
            <div className="ai-float">
              <p className="ai-float-label">Ama</p>
              <p className="mt-0.5 text-ink">{ama}</p>
              {trans?.ama && trans.language !== "English" && trans.ama.trim() !== ama.trim() && (
                <p className="ai-float-en">English: {trans.ama}</p>
              )}
            </div>
          )}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {amaFinal}
      </p>

      <div className="ai-mic-dock">
        {error && (
          <p role="alert" className="ai-float ai-float--error">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => (on ? hangUp() : void start())}
          className={cn("ai-mic", state === "hearing" && "ai-mic--rec")}
          aria-label={on ? "End voice conversation" : "Start voice conversation"}
          aria-pressed={on}
        >
          {state === "connecting" ? (
            <Loader2 className="size-7 animate-spin" aria-hidden />
          ) : on ? (
            <Square className="size-6" fill="currentColor" aria-hidden />
          ) : (
            <Mic className="size-7" strokeWidth={1.75} aria-hidden />
          )}
        </button>
        <span className="ai-mic-label" aria-live="polite">
          <StatusDot status={dot} pulse={state === "hearing" || state === "listening"} />
          {label}
        </span>
      </div>
    </div>
  );
}

// Styles ----------------------------------------------------------------------------
// The day/night toggle is adapted from Ash Nolan's CSS toggle collection
// (https://codepen.io/ashleynolan), converted from SCSS and scaled down.

const pageCss = `
/* Edge to edge: this page drops the console's centred, padded content column. */
.pg-content:has(> .ai-page) { max-width: none; padding: 0; margin: 0; }
.ai-page { --ai-top: 52px; --ai-head: 64px; display: flex; flex-direction: column; }
@media (max-width: 767px) { .ai-page { --ai-top: calc(56px + env(safe-area-inset-top)); --ai-head: 60px; } }
.ai-head {
  height: var(--ai-head); flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 0 24px; background: var(--pg-surface); border-bottom: 1px solid var(--pg-hairline);
}
@media (max-width: 767px) { .ai-head { padding: 0 12px 0 16px; } }
.ai-head-sub { font-size: 13px; line-height: 18px; color: var(--pg-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 639px) { .ai-head-sub { display: none; } }

.ai-layout { display: flex; flex-direction: column; }
@media (min-width: 1024px) {
  .ai-layout {
    display: grid; grid-template-columns: minmax(0, 1fr) 300px;
    height: calc(100dvh - var(--ai-top) - var(--ai-head));
  }
}

/* Stage: no frame, fills everything left of the rail. */
.ai-stage {
  position: relative;
  min-width: 0;
  height: calc(100dvh - var(--ai-top) - var(--ai-head));
  min-height: 420px;
  overflow: hidden;
  background: var(--pg-surface);
  transition: background-color 300ms var(--pg-ease);
}
@media (min-width: 1024px) { .ai-stage { height: 100%; min-height: 0; } }
/* Sky behind the 3D scene; the bottom matches the scene's fog (#d9f1fb). */
.ai-stage--voice {
  background-color: #d9f1fb;
  background-image: linear-gradient(180deg, #b4dbee 0%, #d9f1fb 58%);
}
.ai-fade { animation: ai-fade-in 240ms var(--pg-ease) both; }
@keyframes ai-fade-in { from { opacity: 0; } to { opacity: 1; } }

/* Chat */
.ai-scroll { overscroll-behavior: contain; scrollbar-gutter: stable; }
.ai-chip {
  display: inline-flex; align-items: center; min-height: 32px; max-width: 100%;
  padding: 6px 12px; border-radius: 6px; text-align: left;
  border: 1px solid var(--pg-line-strong); background: var(--pg-surface);
  font-size: 13px; line-height: 18px; color: var(--pg-ink);
  transition: background-color 140ms var(--pg-ease), border-color 140ms var(--pg-ease);
  cursor: pointer;
}
.ai-chip:hover { background: var(--pg-hover); border-color: #b9b4a5; }
.ai-user-msg {
  max-width: min(85%, 560px);
  padding: 8px 12px; border-radius: 8px 8px 2px 8px;
  background: var(--pg-brand-tint); color: var(--pg-ink);
  font-size: 14px; line-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere;
}
.ai-composer {
  border-top: 1px solid var(--pg-hairline); background: var(--pg-surface);
  padding: 12px 16px max(12px, env(safe-area-inset-bottom));
}
@media (min-width: 768px) { .ai-composer { padding: 16px 24px; } }
.ai-input { font-size: 16px; }
@media (min-width: 768px) { .ai-input { font-size: 14px; } }

/* Voice: floating transcript, mic dock */
.ai-turn {
  position: absolute; top: 12px; left: 12px; right: 12px;
  display: flex; flex-direction: column; gap: 8px;
  max-height: 42%; overflow-y: auto; overscroll-behavior: contain;
  font-size: 13px; line-height: 20px;
}
@media (min-width: 768px) { .ai-turn { top: 16px; left: 16px; right: auto; width: 360px; max-height: 60%; font-size: 14px; } }
.ai-float {
  background: var(--pg-surface); border: 1px solid var(--pg-hairline); border-radius: 8px;
  padding: 8px 12px; box-shadow: var(--pg-shadow-pop);
}
.ai-float-en { margin-top: 4px; font-size: 12px; line-height: 17px; color: var(--pg-ink-3); }
.ai-float-label { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--pg-ink-3); }
.ai-float--error {
  max-width: min(360px, calc(100% - 32px)); text-align: center;
  font-size: 13px; line-height: 18px; color: var(--pg-crit); background: var(--pg-crit-tint); border-color: #efc9c4;
}
.ai-mic-dock {
  position: absolute; left: 0; right: 0; bottom: max(16px, env(safe-area-inset-bottom));
  display: flex; flex-direction: column; align-items: center; gap: 10px; pointer-events: none;
}
.ai-mic-dock > * { pointer-events: auto; }
.ai-mic {
  width: 72px; height: 72px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  background: var(--pg-brand); color: #fff; cursor: pointer;
  box-shadow: 0 0 0 4px rgb(255 255 255 / 0.9), 0 6px 20px rgb(28 33 28 / 0.22);
  transition: background-color 140ms var(--pg-ease), transform 140ms var(--pg-ease);
}
.ai-mic:hover:not(:disabled) { background: var(--pg-brand-hover); transform: scale(1.04); }
.ai-mic:active:not(:disabled) { transform: scale(0.97); }
.ai-mic:focus-visible { outline: 2px solid var(--pg-focus); outline-offset: 6px; }
.ai-mic:disabled { cursor: progress; background: #4f7759; }
.ai-mic--rec, .ai-mic--rec:hover:not(:disabled) { background: var(--pg-crit); animation: ai-pulse 1.4s ease-in-out infinite; }
@keyframes ai-pulse {
  0%, 100% { box-shadow: 0 0 0 4px rgb(255 255 255 / 0.9), 0 0 0 4px rgb(180 35 24 / 0.3), 0 6px 20px rgb(28 33 28 / 0.22); }
  50% { box-shadow: 0 0 0 4px rgb(255 255 255 / 0.9), 0 0 0 14px rgb(180 35 24 / 0.12), 0 6px 20px rgb(28 33 28 / 0.22); }
}
.ai-mic-label {
  display: inline-flex; align-items: center; gap: 8px; height: 28px; padding: 0 10px;
  border-radius: 999px; background: var(--pg-surface); border: 1px solid var(--pg-hairline);
  font-size: 13px; line-height: 18px; font-weight: 500; color: var(--pg-ink);
  box-shadow: 0 1px 2px rgb(28 33 28 / 0.08);
}

/* Sensor rail: flush against the right edge of the window. */
.ai-rail.pg-panel { min-width: 0; display: flex; flex-direction: column; border-radius: 0; border-width: 1px 0 0 0; box-shadow: none; }
@media (min-width: 1024px) {
  .ai-rail.pg-panel { height: 100%; border-width: 0 0 0 1px; overflow-y: auto; overscroll-behavior: contain; }
}
.ai-rail-select { height: 32px; font-size: 13px; }
@media (max-width: 767px) { .ai-rail-select { height: 44px; font-size: 16px; } }
.ai-rail-list { list-style: none; margin: 0; padding: 0; }
.ai-rail-row {
  display: flex; align-items: center; gap: 12px; min-height: 48px;
  padding: 8px 16px; border-bottom: 1px solid var(--pg-hairline);
}
.ai-rail-row:last-child { border-bottom: 0; }
@media (min-width: 640px) and (max-width: 1023px) {
  .ai-rail-list { display: grid; grid-template-columns: 1fr 1fr; }
  .ai-rail-list .ai-rail-row:nth-child(odd) { border-right: 1px solid var(--pg-hairline); }
  .ai-rail-list .ai-rail-row:nth-last-child(2):nth-child(odd) { border-bottom: 0; }
}

/* Mode toggle labels */
.ai-mode-btn {
  min-height: 32px; padding: 0 6px; border-radius: 6px;
  font-size: 13px; line-height: 18px; font-weight: 500; color: var(--pg-ink-3);
  transition: color 140ms var(--pg-ease);
}
.ai-mode-btn:hover { color: var(--pg-ink); }
.ai-mode-btn--on { color: var(--pg-ink); }
@media (max-width: 767px) { .ai-mode-btn { min-height: 44px; } }

/* Day/night toggle (125x70 design, scaled to 0.6) */
.dn-wrap { width: 75px; height: 42px; position: relative; flex-shrink: 0; }
.dn-checkbox {
  position: absolute; inset: 0; width: 100%; height: 100%; margin: 0;
  opacity: 0; cursor: pointer; z-index: 1;
}
.dn-checkbox:focus-visible + .dn-btn { outline: 3px solid var(--pg-focus); outline-offset: 4px; }
.dn-btn {
  position: absolute; top: 0; left: 0;
  display: block; height: 70px; width: 125px; border-radius: 70px;
  transform: scale(.6); transform-origin: top left;
  border: 5px solid #1c1c1c; background-color: #3c4145;
  cursor: pointer;
}
.dn-btn, .dn-btn::before, .dn-btn::after,
.dn-feature, .dn-feature::before, .dn-feature::after {
  transition-property: left, top, transform, opacity, background-color, border-color, box-shadow;
  transition-duration: 250ms;
  transition-timing-function: ease-in;
}
.dn-btn::before, .dn-btn::after, .dn-feature::before, .dn-feature::after {
  content: ''; display: block;
}
/* moon / sun */
.dn-btn::before {
  position: absolute; top: 2px; left: 4px;
  width: 56px; height: 56px; border-radius: 50%;
  background-color: #fff; border: 5px solid #e3e3c7;
}
/* cloud */
.dn-btn::after {
  position: absolute; top: 62%; left: 39px; z-index: 10;
  width: 11.2px; height: 11.2px; opacity: 0;
  background-color: #fff; border-radius: 50%;
  box-shadow: #fff 0 0, #fff 3px 0, #fff 6px 0, #fff 9px 0, #fff 11px 0, #fff 14px 0, #fff 16px 0,
    #fff 21px -1px 0 1px, #fff 16px -7px 0 -2px, #fff 7px -7px 0 1px,
    #d3d3d3 0 0 0 4px, #d3d3d3 6px 0 0 4px, #d3d3d3 11px 0 0 4px, #d3d3d3 16px 0 0 4px,
    #d3d3d3 21px -1px 0 5px, #d3d3d3 16px -7px 0 1px, #d3d3d3 7px -7px 0 5px;
  transition: opacity 100ms ease-in;
}
/* stars + moon craters */
.dn-feature {
  display: block; position: absolute; top: 9px; left: 52.5%; z-index: 20;
  width: 4px; height: 4px; border-radius: 50%; background-color: #fff;
  box-shadow: rgba(255,255,255,.1) 30px -3px 0 0, rgba(255,255,255,.1) 12px 10px 0 -1px,
    #fff 38px 18px 0 1px, rgba(255,255,255,.1) 32px 34px 0 0,
    #fff 20px 24px 0 -1.5px, rgba(255,255,255,.1) 5px 38px 0 1px;
  animation: dn-starry 5s ease-in-out infinite;
}
.dn-feature::before {
  position: absolute; top: -2px; left: -25px;
  width: 18px; height: 18px; border-radius: 50%;
  background-color: #fff; border: 5px solid #e3e3c7;
  box-shadow: #e3e3c7 -28px 0 0 -3px, #e3e3c7 -8px 24px 0 -2px;
  transform-origin: -6px 130%;
}
.dn-checkbox:checked + .dn-btn { background-color: #9ee3fb; border-color: #86c3d7; }
.dn-checkbox:checked + .dn-btn::before {
  left: 55px; background-color: #ffdf6d; border-color: #e1c348;
}
.dn-checkbox:checked + .dn-btn::after {
  opacity: 1;
  animation: dn-bounce-in .6s ease-in-out .1s backwards;
}
.dn-checkbox:checked + .dn-btn > .dn-feature {
  opacity: 0; animation: none;
  box-shadow: rgba(255,255,255,.1) 30px -3px 0 -4px, rgba(255,255,255,.1) 12px 10px 0 -5px,
    #fff 38px 18px 0 -3px, rgba(255,255,255,.1) 32px 34px 0 -4px,
    #fff 20px 24px 0 -5.5px, rgba(255,255,255,.1) 5px 38px 0 -3px;
}
.dn-checkbox:checked + .dn-btn > .dn-feature::before { left: 25px; transform: rotate(70deg); }
@keyframes dn-starry {
  50% {
    background-color: rgba(255,255,255,.1);
    box-shadow: #fff 30px -3px 0 0, #fff 12px 10px 0 -1px, rgba(255,255,255,.1) 38px 18px 0 1px,
      #fff 32px 34px 0 0, rgba(255,255,255,.1) 20px 24px 0 -1.5px, #fff 5px 38px 0 1px;
  }
}
@keyframes dn-bounce-in {
  0% { opacity: 0; transform: scale(.3); }
  50% { opacity: 1; transform: scale(1.1); }
  55% { transform: scale(1.1); }
  75% { transform: scale(.9); }
  100% { opacity: 1; transform: scale(1); }
}
`;
