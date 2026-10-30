import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Droplets,
  Fan,
  Flame,
  History,
  Lightbulb,
  Loader2,
  Mic,
  Plus,
  Send,
  Square,
  Thermometer,
  Trash2,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  askAssistant,
  annotateVoiceTurn,
  createVoiceSession,
  deleteConversation,
  getAssistantSensors,
  getConversation,
  getSpeechEngines,
  listConversations,
  saveVoiceTurn,
  speakReply,
  suggestTwiWords,
  transcribeSpeech,
  twiReply,
  wakeTwiVoiceFn,
} from "@/lib/api/assistant.functions";
import { detectLang } from "@/lib/ai-languages";
import { openAiLimitMessage } from "@/lib/openai-errors";
import {
  MIC_CONSTRAINTS,
  Recorder,
  blobToBase64,
  micErrorMessage,
  micUnavailableReason,
  toWav16k,
} from "@/lib/ai-audio";
import { useTheme } from "@/components/ThemeProvider";
import { useLanguage } from "@/components/LanguageProvider";
import { SpeechPlayer, cachedChunk, type FetchChunk } from "@/lib/speech-client";
import { speechLangFor, type SiteLang } from "@/lib/site-lang";
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
  formatFan,
  formatLight,
  formatNumber,
  formatTemp,
  tempUnit,
  toTemp,
  toTempDelta,
  useDisplayPrefs,
  type Status,
} from "@/components/ui-kit";
import { cn } from "@/lib/utils";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: "text" | "voice";
  english?: string | null;
  language?: string | null;
};
type Mode = "chat" | "voice";

/* The mode lives in the URL (?mode=voice) so voice can be linked to directly. */
export const Route = createFileRoute("/app/ai")({
  validateSearch: (s: Record<string, unknown>): { mode?: Mode } => ({
    mode: s.mode === "voice" ? "voice" : undefined,
  }),
  component: AiAssistant,
});

const BLOB = "/ai/bloub.gif";
const BLOB_STILL = "/ai/bloub-still.png";

const sensorsQuery = {
  queryKey: ["assistant-sensors"],
  queryFn: () => getAssistantSensors(),
  refetchInterval: 10_000,
};

function AiAssistant() {
  // Re-render when the temperature unit or clock preference changes.
  useDisplayPrefs();
  useWakeTwiVoice();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // The live call is OpenAI only. Without it the chat mic is how you talk to Ama.
  const liveVoice = useQuery(enginesQuery).data?.liveVoice !== false;
  const mode: Mode = liveVoice ? (search.mode ?? "chat") : "chat";
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
            {!liveVoice
              ? "Type, or tap the mic and talk: she answers out loud."
              : mode === "chat"
                ? "Ask Ama about your farm in any language."
                : "Talk to Ama out loud. She answers out loud too."}
          </p>
        </div>
        {liveVoice && <ModeToggle voice={mode === "voice"} onChange={toggle} />}
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
    /** Shown instead of the number (e.g. the relay's "On" / "Off"). */
    text?: string;
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
          hint: r.light == null ? "LDR" : `${formatLight(r.light)} · LDR`,
        },
        {
          label: "Fan",
          value: r.fan_on == null ? null : Number(r.fan_on),
          text: formatFan(r.fan_on),
          icon: Fan,
          hint: "Relay",
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
                  {row.text ?? fmt(row.value, row.digits ?? 1)}
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
  const { settings } = useTheme();
  return (
    <img
      src={settings.stillImages ? BLOB_STILL : BLOB}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full border border-hairline bg-white object-cover"
      style={{ width: size, height: size }}
    />
  );
}

// Which speech engines the server can use: the GhanaNLP Twi voice (Pi or this PC),
// a Khaya key, and the DistilABENA word helper. The Pi's voice comes and goes.
const enginesQuery = {
  queryKey: ["ai-speech-engines"],
  queryFn: () => getSpeechEngines(),
  staleTime: 60_000,
  refetchInterval: 60_000,
};
/** True when Twi has its own voice (stable-twi-tts, Ghana Voice or Khaya); otherwise GPT speaks Twi too. */
function useTwiVoice() {
  const engines = useQuery(enginesQuery);
  return Boolean(engines.data?.twiVoice || engines.data?.ghanaVoice || engines.data?.khaya);
}
/** While the AI tab is open, keep the Pi polling fast (it slows down after 5 minutes). */
function useWakeTwiVoice() {
  const engines = useQuery(enginesQuery);
  const on = Boolean(engines.data?.twiVoice);
  useEffect(() => {
    if (!on) return;
    const wake = () => void wakeTwiVoiceFn().catch(() => {});
    wake();
    const t = window.setInterval(wake, 4 * 60_000);
    return () => window.clearInterval(t);
  }, [on]);
}

const conversationsQuery = {
  queryKey: ["ai-conversations"],
  queryFn: () => listConversations(),
};

function HistoryPanel({
  currentId,
  onPick,
  onNew,
  onClose,
}: {
  currentId: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery(conversationsQuery);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const remove = async (id: string) => {
    setDeleting(id);
    try {
      await deleteConversation({ data: { id } });
      await qc.invalidateQueries({ queryKey: conversationsQuery.queryKey });
      if (id === currentId) onNew();
    } finally {
      setDeleting(null);
      setConfirm(null);
    }
  };

  return (
    <div className="ai-history" role="dialog" aria-label="Chat history">
      <div className="ai-history-head">
        <h2 className="pg-t-h3">History</h2>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" icon={Plus} onClick={onNew}>
            New chat
          </Button>
          <Button
            ref={closeRef}
            size="sm"
            variant="ghost"
            iconOnly
            icon={X}
            aria-label="Close history"
            onClick={onClose}
          />
        </div>
      </div>
      <div className="ai-scroll flex-1 overflow-y-auto">
        {q.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : q.isError ? (
          <div className="p-4">
            <ErrorState
              title="Couldn’t load your chats"
              error={q.error}
              onRetry={() => void q.refetch()}
            />
          </div>
        ) : !q.data?.length ? (
          <p className="p-4 text-[13px] leading-5 text-ink-3">
            No saved chats yet. Your conversations with Ama, typed or spoken, are saved here.
          </p>
        ) : (
          <ul className="flex flex-col p-2">
            {q.data.map((c) => (
              <li key={c.id} className={cn("ai-history-item", c.id === currentId && "is-current")}>
                {confirm === c.id ? (
                  <div className="flex w-full items-center gap-2 px-2 py-1.5">
                    <span className="min-w-0 flex-1 text-[13px] text-ink">Delete this chat?</span>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={deleting === c.id}
                      onClick={() => void remove(c.id)}
                    >
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      Keep
                    </Button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ai-history-open"
                      onClick={() => onPick(c.id)}
                      aria-current={c.id === currentId ? "true" : undefined}
                    >
                      <span className="flex w-full min-w-0 items-center gap-1.5">
                        {c.has_voice && (
                          <Mic className="size-3.5 shrink-0 text-ink-3" aria-label="Has voice" />
                        )}
                        <span className="truncate text-[13px] leading-[18px] font-medium text-ink">
                          {c.title.replace(/^Voice: /, "")}
                        </span>
                      </span>
                      <span className="text-[12px] leading-4 text-ink-3">
                        <RelativeTime iso={c.updated_at} /> · {c.message_count} messages
                      </span>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon={Trash2}
                      aria-label={`Delete “${c.title}”`}
                      onClick={() => setConfirm(c.id)}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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

/** Ama's voice for one sentence, cached so Listen twice costs nothing. */
const replyChunks =
  (lang: ReturnType<typeof speechLangFor>, uiLang: SiteLang): FetchChunk =>
  (text, slowTwi) =>
    cachedChunk(`ai\u0000${lang}\u0000${text}`, () =>
      speakReply({ data: { text: text.slice(0, 4000), lang, uiLang, slowTwi } }),
    );

let msgSeq = 0;
const newId = () => `m${Date.now().toString(36)}${(msgSeq++).toString(36)}`;

type RecState = "idle" | "recording" | "transcribing";

function TextChat() {
  useDisplayPrefs();
  const { settings, update } = useTheme();
  const { lang: uiLang } = useLanguage();
  const qc = useQueryClient();
  const sensors = useQuery(sensorsQuery);
  // With a Khaya key, dictation is sent as WAV so Khaya can re-hear it if it's Twi.
  const khaya = Boolean(useQuery(enginesQuery).data?.khaya);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Spoken replies -------------------------------------------------------------
  // Sentence by sentence: the first one plays while the rest are still being made.
  const player = useRef<SpeechPlayer | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null);
  useEffect(() => {
    const p = new SpeechPlayer();
    p.onChange = setPlaying;
    player.current = p;
    return () => {
      p.onChange = null;
      p.dispose();
    };
  }, []);

  const listen = async (m: Msg) => {
    const p = player.current;
    if (!p) return;
    if (playing === m.id) {
      p.stop();
      return;
    }
    p.unlock();
    setLoadingAudio(m.id);
    const lang = speechLangFor(m.content, uiLang);
    const fetchChunk = replyChunks(lang, uiLang);
    try {
      // Spinner only until the first sentence is ready.
      void fetchChunk(m.content.split(/(?<=[.!?])\s/)[0] ?? m.content, false)
        .catch(() => {})
        .finally(() => setLoadingAudio((id) => (id === m.id ? null : id)));
      await p.speak(m.id, m.content, fetchChunk, { twi: lang === "tw" });
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Your browser blocked the sound. Tap the speaker on the message to hear it."
          : `Couldn’t play Ama’s voice: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingAudio((id) => (id === m.id ? null : id));
    }
  };

  // Dictation -----------------------------------------------------------------
  const recorder = useRef<Recorder | null>(null);
  const [rec, setRec] = useState<RecState>("idle");
  const [recSecs, setRecSecs] = useState(0);
  useEffect(() => {
    if (rec !== "recording") return;
    setRecSecs(0);
    const t = window.setInterval(() => setRecSecs((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [rec]);
  useEffect(() => () => recorder.current?.cancel(), []);

  const toggleMic = async () => {
    if (rec === "transcribing") return;
    setError(null);
    if (rec === "idle") {
      player.current?.stop();
      const r = new Recorder();
      recorder.current = r;
      try {
        await r.start();
        setRec("recording");
      } catch (err) {
        recorder.current = null;
        setError(micErrorMessage(err));
      }
      return;
    }
    const r = recorder.current;
    recorder.current = null;
    setRec("transcribing");
    try {
      const heard = r?.heardSomething ?? true;
      const blob = await r?.stop();
      if (!heard) {
        setError("I didn’t hear anything. Check the mic isn’t muted, then speak a little louder.");
        return;
      }
      if (!blob || blob.size < 1200) {
        setError("Didn’t catch that. Hold the phone closer and try again.");
        return;
      }
      // Khaya needs WAV; if this browser can't convert, OpenAI takes the original.
      const audio = (khaya && (await toWav16k(blob))) || blob;
      const { text } = await transcribeSpeech({
        data: { audio: await blobToBase64(audio), mimeType: audio.type, uiLang },
      });
      if (!text.trim()) setError("Didn’t catch that. Try again, a little slower.");
      else {
        setInput((cur) => (cur.trim() ? `${cur.trim()} ${text.trim()}` : text.trim()));
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    } catch (err) {
      setError(
        `Couldn’t turn your speech into text: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setRec("idle");
    }
  };

  // Conversation ----------------------------------------------------------------
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const run = async (next: Msg[]) => {
    setBusy(true);
    setError(null);
    try {
      const {
        reply,
        english,
        youEnglish,
        conversationId: cid,
      } = await askAssistant({
        data: {
          messages: next.slice(-20).map((m) => ({
            role: m.role,
            content: m.content.slice(0, 4000),
            english: m.english?.slice(0, 4000) ?? null,
          })),
          conversationId: conversationId ?? undefined,
          uiLang,
        },
      });
      const msg: Msg = { id: newId(), role: "assistant", content: reply, english };
      const withYou = next.map((m, i) =>
        i === next.length - 1 && m.role === "user" && youEnglish && youEnglish !== m.content
          ? { ...m, english: youEnglish }
          : m,
      );
      setMessages([...withYou, msg]);
      setConversationId(cid);
      void qc.invalidateQueries({ queryKey: conversationsQuery.queryKey });
      if (settings.aiSpeak) void listen(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const send = async (e?: FormEvent, preset?: string) => {
    e?.preventDefault();
    const text = (preset ?? input).trim();
    if (!text || busy || rec !== "idle") return;
    // Unlock audio inside this tap, so the spoken reply can play on phones.
    if (settings.aiSpeak) player.current?.unlock();
    const next = [...messages, { id: newId(), role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    await run(next);
  };

  const newChat = () => {
    player.current?.stop();
    setMessages([]);
    setConversationId(null);
    setError(null);
    setHistoryOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openChat = async (id: string) => {
    setHistoryOpen(false);
    if (id === conversationId) return;
    player.current?.stop();
    setLoadingChat(true);
    setError(null);
    try {
      const { messages: rows } = await getConversation({ data: { id } });
      setMessages(
        rows.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          mode: m.mode,
          english: m.english,
          language: m.language,
        })),
      );
      setConversationId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingChat(false);
    }
  };

  const lastIsUser = messages[messages.length - 1]?.role === "user";
  const recording = rec === "recording";

  // Twi word helper (DistilABENA on the server's TWI_NLP_URL) -------------------
  // While typing Twi: finish the current word, suggest the next one, or fill a ___ blank.
  const engines = useQuery(enginesQuery);
  // Shown only once what's typed looks like Twi.
  const twiWords = Boolean(engines.data?.twiWords) && detectLang(input) === "tw";
  const [hints, setHints] = useState<{ words: string[]; label: string } | null>(null);
  useEffect(() => {
    const text = input;
    if (!twiWords || rec !== "idle" || !text.trim()) {
      setHints(null);
      return;
    }
    const blank = /_{2,}/.test(text);
    // Mid-word: predict the word at this spot and keep the ones that start with what's typed.
    const partial = !blank && !/\s$/.test(text) ? (text.match(/[^\s]+$/)?.[0] ?? "") : "";
    const context = partial ? text.slice(0, -partial.length) : text;
    if (partial && !context.trim()) {
      setHints(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      suggestTwiWords({ data: { text: context.slice(-2000) } })
        .then((r) => {
          if (cancelled) return;
          const p = partial.toLowerCase();
          const words = r.words
            .map((w) => w.word)
            .filter((w) => !p || (w.startsWith(p) && w !== p))
            .slice(0, 5);
          setHints(
            words.length
              ? { words, label: blank ? "Fill the blank" : partial ? "Finish word" : "Next word" }
              : null,
          );
        })
        .catch(() => !cancelled && setHints(null));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [input, twiWords, rec]);
  const pickHint = (word: string) => {
    setInput((cur) => {
      if (/_{2,}/.test(cur)) return cur.replace(/_{2,}/, word);
      if (!/\s$/.test(cur)) return cur.replace(/[^\s]+$/, `${word} `);
      return `${cur}${word} `;
    });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="ai-fade relative flex h-full flex-col">
      <div className="ai-toolbar">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={History}
            onClick={() => setHistoryOpen(true)}
            aria-expanded={historyOpen}
          >
            History
          </Button>
          {messages.length > 0 && (
            <Button size="sm" variant="ghost" icon={Plus} onClick={newChat}>
              <span className="max-sm:sr-only">New chat</span>
            </Button>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className={cn("ai-speak-toggle", settings.aiSpeak && "is-on")}
            aria-pressed={settings.aiSpeak}
            onClick={() => {
              if (settings.aiSpeak) player.current?.stop();
              else player.current?.unlock();
              update({ aiSpeak: !settings.aiSpeak });
            }}
          >
            {settings.aiSpeak ? (
              <Volume2 className="size-4" aria-hidden />
            ) : (
              <VolumeX className="size-4" aria-hidden />
            )}
            <span className="max-sm:sr-only">Voice replies</span>
            <span className="sm:hidden sr-only">{settings.aiSpeak ? "on" : "off"}</span>
          </button>
        </div>
      </div>

      {historyOpen && (
        <HistoryPanel
          currentId={conversationId}
          onPick={(id) => void openChat(id)}
          onNew={newChat}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      <div ref={listRef} className="ai-scroll flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col px-4 py-5 md:px-6 md:py-6">
          {loadingChat ? (
            <div className="flex flex-col gap-4" aria-busy="true">
              <Skeleton className="ml-auto h-10 w-1/2" />
              <Skeleton className="h-20 w-3/4" />
              <Skeleton className="ml-auto h-10 w-2/5" />
            </div>
          ) : messages.length === 0 ? (
            <div className="my-auto py-6">
              <BlobAvatar size={64} />
              <h2 className="pg-t-h2 mt-4">Ask Ama about your farm</h2>
              <p className="mt-1 max-w-[52ch] text-[14px] leading-5 text-ink-2">
                She reads the latest sensor data from every house and answers in your language,
                including Twi, Ga, Ewe and Hausa. Type, or tap the mic and speak.
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
              {messages.map((m) =>
                m.role === "assistant" ? (
                  <li key={m.id} className="flex items-start gap-3">
                    <BlobAvatar />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[12px] leading-4 font-medium text-ink-3">
                        Ama
                        {m.mode === "voice" && <Mic className="size-3" aria-label="spoken" />}
                      </p>
                      <p
                        className="mt-1 text-[14px] leading-[22px] whitespace-pre-wrap text-ink"
                        translate="no"
                      >
                        {withBold(m.content)}
                      </p>
                      {m.english && (
                        <p className="ai-float-en">
                          English: <span translate="no">{m.english}</span>
                        </p>
                      )}
                      <button
                        type="button"
                        className={cn("ai-listen", playing === m.id && "is-on")}
                        onClick={() => void listen(m)}
                        aria-label={
                          playing === m.id ? "Stop reading aloud" : "Read this reply aloud"
                        }
                      >
                        {loadingAudio === m.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : playing === m.id ? (
                          <Square className="size-3" fill="currentColor" aria-hidden />
                        ) : (
                          <Volume2 className="size-3.5" aria-hidden />
                        )}
                        {playing === m.id ? "Stop" : "Listen"}
                      </button>
                    </div>
                  </li>
                ) : (
                  <li key={m.id} className="flex flex-col items-end gap-1">
                    <p className="ai-user-msg" translate="no">
                      {m.mode === "voice" && (
                        <Mic
                          className="mr-1 inline size-3 align-[-1px] text-ink-3"
                          aria-label="spoken"
                        />
                      )}
                      {m.content}
                    </p>
                    {m.english && (
                      <p className="ai-float-en max-w-[85%] text-right">
                        English: <span translate="no">{m.english}</span>
                      </p>
                    )}
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
                  Something went wrong
                </p>
                <p className="mt-0.5 text-[12px] leading-4 break-words text-ink-2">{error}</p>
              </div>
              {lastIsUser && !busy && (
                <Button size="sm" variant="ghost" onClick={() => void run(messages)}>
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={send} className="ai-composer">
        {hints && (
          <div
            className="ai-twi-hints mx-auto w-full max-w-[720px]"
            aria-label="Twi word suggestions"
          >
            <span className="ai-twi-hints-label">{hints.label} · DistilABENA</span>
            {hints.words.map((w) => (
              <button
                key={w}
                type="button"
                className="ai-chip ai-chip--sm"
                onClick={() => pickHint(w)}
              >
                {w}
              </button>
            ))}
          </div>
        )}
        <div className="mx-auto flex w-full max-w-[720px] items-end gap-2">
          <label htmlFor="ai-message" className="sr-only">
            Message Ama
          </label>
          <textarea
            ref={inputRef}
            data-no-dictate
            id="ai-message"
            name="message"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              recording
                ? `Listening… ${recSecs}s. Tap ■ when you’re done.`
                : rec === "transcribing"
                  ? "Writing down what you said…"
                  : "Message Ama…"
            }
            readOnly={rec !== "idle"}
            autoComplete="off"
            enterKeyHint="send"
            className="pg-input ai-input flex-1"
          />
          <button
            type="button"
            onClick={() => void toggleMic()}
            className={cn("ai-dictate", recording && "is-rec")}
            aria-label={recording ? "Stop recording" : "Speak your message"}
            aria-pressed={recording}
            disabled={rec === "transcribing" || busy}
          >
            {rec === "transcribing" ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : recording ? (
              <Square className="size-4" fill="currentColor" aria-hidden />
            ) : (
              <Mic className="size-5" aria-hidden />
            )}
          </button>
          <Button
            type="submit"
            variant="primary"
            iconOnly
            icon={Send}
            loading={busy}
            disabled={rec !== "idle"}
            aria-label="Send message"
            className="ai-send"
          />
        </div>
        <p className="pg-t-caption mx-auto mt-2 w-full max-w-[720px]">
          Chats are saved to your account. Ama can be wrong, so check the readings before acting.
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

// A tiny silent WAV, played inside the tap that starts a call. iPhones only let
// an <audio> element play sound later if it was first played from a tap.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

// Live speech to speech over OpenAI Realtime ---------------------------------------
// Language decides who answers. With a Twi voice available (stable-twi-tts on the
// Pi or this PC, or Khaya), the realtime model doesn't reply on its own: once the
// farmer's words are transcribed, Twi goes to the Twi stack (twiReply, played in
// the GhanaNLP voice) and anything else is handed back to the realtime model.
// Without a Twi voice it is a plain live GPT call, as before.

type TurnHistory = { role: "user" | "assistant"; content: string; english: string | null };

function VoiceChat({ active }: { active: boolean }) {
  const twiRouting = useTwiVoice();
  const { lang: uiLang } = useLanguage();
  const qc = useQueryClient();
  const avatar = useRef<ExplorerAvatarHandle>(null);
  // Her voice plays through this element; it lives in the page so phones keep it.
  const audioRef = useRef<HTMLAudioElement>(null);
  // Twi replies (GhanaNLP voice) play through their own element.
  const twiAudioRef = useRef<HTMLAudioElement>(null);
  const twiPlayer = useRef<SpeechPlayer | null>(null);
  const twiSeq = useRef(0);
  const twiPending = useRef(""); // Twi words not yet answered (cut off by more speech)
  const manual = useRef(false); // this call's session waits for response.create
  const answered = useRef<string | null>(null); // last transcript item we routed
  const history = useRef<TurnHistory[]>([]);
  // Every call is saved as one conversation in the chat history.
  const voiceConv = useRef<string | null>(null);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
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
    twiSeq.current++;
    twiPlayer.current?.stop();
    void saveChain.current.then(() => qc.invalidateQueries({ queryKey: ["ai-conversations"] }));
    avatar.current?.play("idle");
    setState("off");
  }, [qc]);
  useEffect(() => () => twiPlayer.current?.dispose(), []);

  // Pre-mint the session secret while voice mode is open, so tapping the mic
  // only has to do the WebRTC handshake. Secrets live 120 s; use them within 90.
  const warm = useRef<{
    p: Promise<VoiceSession>;
    at: number;
    twi: boolean;
    lang: SiteLang;
  } | null>(null);
  const takeSession = () => {
    const w = warm.current;
    warm.current = null;
    return w && w.twi === twiRouting && w.lang === uiLang && Date.now() - w.at < 90_000
      ? w.p
      : createVoiceSession({ data: { twiRouting, uiLang } });
  };
  useEffect(() => {
    if (!active) {
      warm.current = null;
      return;
    }
    if (micUnavailableReason()) return;
    const prewarm = () => {
      if (call.current) return;
      const p = createVoiceSession({ data: { twiRouting, uiLang } });
      p.catch(() => {
        if (warm.current?.p === p) warm.current = null;
      });
      warm.current = { p, at: Date.now(), twi: twiRouting, lang: uiLang };
    };
    prewarm();
    const t = window.setInterval(prewarm, 85_000);
    return () => window.clearInterval(t);
  }, [active, twiRouting, uiLang]);

  const send = (event: Record<string, unknown>) => {
    const dc = call.current?.dc;
    if (dc?.readyState === "open") dc.send(JSON.stringify(event));
  };

  /** A Twi turn: answered by the Twi stack and spoken in the GhanaNLP voice. */
  const twiTurn = async (said: string, my: number) => {
    // If the farmer paused mid-thought and carried on, the cut-off part is
    // answered together with the rest instead of being lost.
    const text = `${twiPending.current} ${said}`.trim();
    twiPending.current = text;
    const seq = ++twiSeq.current;
    setState("thinking");
    avatar.current?.play("walking");
    setAma("");
    setTrans(null);
    try {
      const r = await twiReply({
        data: { text: text.slice(0, 4000), history: history.current.slice(-12) },
      });
      if (my !== gen.current || seq !== twiSeq.current) return;
      twiPending.current = "";
      setYou(text);
      setAma(r.ama);
      setAmaFinal(r.ama);
      setTrans({ language: "Twi", you: r.youEnglish ?? "", ama: r.amaEnglish ?? "" });
      history.current.push(
        {
          role: "user",
          content: text.slice(0, 4000),
          english: r.youEnglish?.slice(0, 4000) ?? null,
        },
        {
          role: "assistant",
          content: r.ama.slice(0, 4000),
          english: r.amaEnglish?.slice(0, 4000) ?? null,
        },
      );
      saveTurn(text, r.ama, {
        language: "Twi",
        you_english: r.youEnglish ?? "",
        ama_english: r.amaEnglish ?? "",
      });
      // Tell the live model what she said, so the rest of the call follows on.
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: r.ama }],
        },
      });
      const a = twiAudioRef.current;
      if (!a) return setState("listening");
      const player = (twiPlayer.current ??= new SpeechPlayer(a));
      setState("speaking");
      avatar.current?.play(turns.current++ % 2 ? "talking2" : "talking");
      // Sentence by sentence in the GhanaNLP voice: the first plays while the rest are made.
      await player.speak(`twi${seq}`, r.ama, replyChunks("tw", uiLang), { twi: true }).catch(() => {
        setError("Your browser blocked Ama’s voice. Her reply is written above.");
      });
      if (my !== gen.current || seq !== twiSeq.current) return;
      setState("listening");
      avatar.current?.play("idle");
    } catch {
      if (my !== gen.current || seq !== twiSeq.current) return;
      // The Twi stack is unreachable: let the live model answer instead.
      send({ type: "response.create" });
    }
  };

  /** Save one finished turn (in order), with translations when we have them. */
  const saveTurn = (
    you: string,
    ama: string,
    t?: { language: string; you_english: string; ama_english: string },
  ) => {
    saveChain.current = saveChain.current
      .catch(() => {})
      .then(() =>
        saveVoiceTurn({
          data: {
            conversationId: voiceConv.current ?? undefined,
            you: you.slice(0, 4000),
            ama: ama.slice(0, 4000),
            language: t?.language.slice(0, 40),
            youEnglish: t?.you_english.slice(0, 4000),
            amaEnglish: t?.ama_english.slice(0, 4000),
          },
        }),
      )
      .then((r) => {
        voiceConv.current = r.conversationId;
      })
      .catch(() => {
        /* history is a nice-to-have; never interrupt the call over it */
      });
  };

  // Leaving the page or switching back to chat ends the call (mic off, no audio).
  useEffect(() => hangUp, [hangUp]);
  useEffect(() => {
    if (!active) hangUp();
  }, [active, hangUp]);

  const onEvent = (e: RealtimeEvent) => {
    switch (e.type) {
      case "input_audio_buffer.speech_started": {
        // Talking over a Twi reply stops it, like the live voice.
        if (twiPlayer.current?.busy) {
          twiSeq.current++;
          twiPlayer.current.stop();
        }
        youItem.current = e.item_id ?? null;
        setYou("");
        setState("hearing");
        avatar.current?.play("idle");
        break;
      }
      case "input_audio_buffer.speech_stopped":
        setState("thinking");
        avatar.current?.play("walking");
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (e.item_id === youItem.current) setYou((s) => s + (e.delta ?? ""));
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (e.item_id === youItem.current) {
          const said = e.transcript ?? "";
          setYou(said);
          youText.current = said;
          // Route this turn: Twi to the Twi stack, anything else to the live model.
          if (manual.current && answered.current !== e.item_id) {
            answered.current = e.item_id ?? null;
            if (said.trim() && detectLang(said) === "tw") void twiTurn(said, gen.current);
            else {
              twiPending.current = "";
              send({ type: "response.create" });
            }
          }
        }
        break;
      case "conversation.item.input_audio_transcription.failed":
        if (manual.current && e.item_id === youItem.current && answered.current !== e.item_id) {
          answered.current = e.item_id ?? null;
          send({ type: "response.create" });
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
        // The farmer's own transcript can land just after her reply; wait up to 2 s for it.
        let youSaid = "";
        const waitForYou = async () => {
          for (let i = 0; i < 20 && !youText.current; i++)
            await new Promise((r) => setTimeout(r, 100));
          youSaid = youText.current;
          youText.current = "";
          return youSaid;
        };
        waitForYou()
          .then((y) =>
            annotateVoiceTurn({ data: { you: y.slice(0, 4000), ama: text.slice(0, 4000) } }),
          )
          .then((a) => {
            saveTurn(youSaid, text, a);
            history.current.push(
              {
                role: "user",
                content: youSaid.slice(0, 4000),
                english: a.you_english.slice(0, 4000),
              },
              {
                role: "assistant",
                content: text.slice(0, 4000),
                english: a.ama_english.slice(0, 4000),
              },
            );
            if (my !== gen.current || seq !== replySeq.current) return;
            setTrans({ language: a.language, you: a.you_english, ama: a.ama_english });
            if (speakingSince.current != null) scheduleGestures(a.segments);
            else pendingGestures.current = a.segments;
          })
          .catch(() => {
            // gestures and translation are extras; the conversation goes on
            saveTurn(youSaid, text);
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
    const why = micUnavailableReason();
    if (why) {
      setError(why);
      return;
    }
    // Unlock playback inside this tap (iPhone), before any await.
    const audio = audioRef.current ?? new Audio();
    audio.srcObject = null;
    audio.src = SILENT_WAV;
    void audio.play().catch(() => {});
    const twiAudio = twiAudioRef.current;
    if (twiAudio) {
      twiAudio.src = SILENT_WAV;
      void twiAudio.play().catch(() => {});
    }
    const my = ++gen.current;
    voiceConv.current = null;
    history.current = [];
    twiPending.current = "";
    answered.current = null;
    manual.current = twiRouting;
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
        navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS),
        takeSession(),
      ]);
      mic = stream;
      if (my !== gen.current) throw new Error("cancelled");

      const conn = new RTCPeerConnection();
      pc = conn;
      conn.ontrack = (ev) => {
        audio.removeAttribute("src");
        audio.srcObject = ev.streams[0];
        void audio.play().catch(() => {
          setError("Your browser blocked Ama’s voice. Tap the mic again to retry.");
        });
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
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          openAiLimitMessage(res.status, body) ?? `Couldn’t start the live call (${res.status}).`,
        );
      }
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
      setError(micErrorMessage(err));
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
              <p className="mt-0.5 text-ink" translate="no">
                {you}
              </p>
              {trans?.you && trans.language !== "English" && trans.you.trim() !== you.trim() && (
                <p className="ai-float-en">
                  English: <span translate="no">{trans.you}</span>
                </p>
              )}
            </div>
          )}
          {ama && (
            <div className="ai-float">
              <p className="ai-float-label">Ama</p>
              <p className="mt-0.5 text-ink" translate="no">
                {ama}
              </p>
              {trans?.ama && trans.language !== "English" && trans.ama.trim() !== ama.trim() && (
                <p className="ai-float-en">
                  English: <span translate="no">{trans.ama}</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {amaFinal}
      </p>

      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      <audio ref={twiAudioRef} playsInline className="hidden" />
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
.ai-chip--sm { min-height: 28px; padding: 3px 10px; font-size: 13px; }
.ai-twi-hints {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px;
}
.ai-twi-hints-label { font-size: 12px; line-height: 16px; color: var(--pg-ink-3); margin-right: 2px; }
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
textarea.ai-input {
  min-height: 44px; max-height: 160px; height: auto; resize: none;
  padding: 11px 12px; line-height: 20px; field-sizing: content;
}
@media (min-width: 768px) { textarea.ai-input { min-height: 40px; padding: 9px 12px; } }
.ai-send { height: 44px !important; width: 44px !important; flex-shrink: 0; }
@media (min-width: 768px) { .ai-send { height: 40px !important; width: 40px !important; } }

/* Mic for dictation, next to send */
.ai-dictate {
  width: 44px; height: 44px; flex-shrink: 0; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--pg-line-strong); background: var(--pg-surface); color: var(--pg-ink);
  cursor: pointer; transition: background-color 140ms var(--pg-ease), color 140ms var(--pg-ease);
}
@media (min-width: 768px) { .ai-dictate { width: 40px; height: 40px; } }
@media (hover: hover) { .ai-dictate:hover:not(:disabled):not(.is-rec) { background: var(--pg-hover); } }
.ai-dictate:disabled { opacity: 0.6; cursor: progress; }
.ai-dictate.is-rec, .ai-dictate.is-rec:hover { background: var(--pg-crit); border-color: var(--pg-crit); color: var(--pg-on-crit, #fff); animation: ai-rec 1.4s ease-in-out infinite; }
@keyframes ai-rec {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--pg-crit) 35%, transparent); }
  50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--pg-crit) 0%, transparent); }
}

/* Toolbar above the conversation: history, language, voice replies */
.ai-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 48px; padding: 6px 12px; border-bottom: 1px solid var(--pg-hairline);
  background: var(--pg-surface);
}
@media (min-width: 768px) { .ai-toolbar { padding: 6px 20px; } }
.ai-speak-toggle {
  display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px;
  border-radius: 999px; border: 1px solid var(--pg-line-strong); background: var(--pg-surface);
  font-size: 13px; line-height: 18px; font-weight: 500; color: var(--pg-ink-2); cursor: pointer;
  transition: background-color 140ms var(--pg-ease), color 140ms var(--pg-ease), border-color 140ms var(--pg-ease);
}
@media (max-width: 767px) { .ai-speak-toggle { min-height: 40px; min-width: 40px; justify-content: center; padding: 0 10px; } }
.ai-speak-toggle:hover { background: var(--pg-hover); }
.ai-speak-toggle.is-on { background: var(--pg-brand-tint); border-color: color-mix(in srgb, var(--pg-brand) 40%, transparent); color: var(--pg-ink); }
.ai-speak-toggle.is-on svg { color: var(--pg-brand); }

/* "Listen" under each reply */
.ai-listen {
  margin-top: 6px; display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 0 8px 0 6px;
  border-radius: 6px; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--pg-ink-3);
  cursor: pointer; transition: background-color 140ms var(--pg-ease), color 140ms var(--pg-ease);
}
.ai-listen:hover, .ai-listen.is-on { background: var(--pg-hover); color: var(--pg-ink); }
@media (max-width: 767px) { .ai-listen { min-height: 36px; padding: 0 10px 0 8px; } }

/* Chat history drawer */
.ai-history {
  position: absolute; inset: 0; z-index: 20; display: flex; flex-direction: column;
  background: var(--pg-surface); animation: ai-fade-in 160ms var(--pg-ease) both;
}
@media (min-width: 768px) {
  .ai-history { right: auto; width: 340px; border-right: 1px solid var(--pg-hairline); box-shadow: var(--pg-shadow-pop); }
}
.ai-history-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 48px; padding: 6px 8px 6px 16px; border-bottom: 1px solid var(--pg-hairline);
}
.ai-history-item { display: flex; align-items: center; gap: 4px; border-radius: 8px; padding-right: 4px; }
.ai-history-item:hover, .ai-history-item.is-current { background: var(--pg-hover); }
.ai-history-open {
  flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 8px 10px; text-align: left; cursor: pointer; border-radius: 8px; min-height: 48px;
}

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
