import { useId, useState } from "react";
import type { CoopZone, ZoneControls } from "@/lib/controls";
import { Part } from "@/components/incubator-diagram";
import { formatTemp } from "@/components/ui-kit";
import { cn } from "@/lib/utils";

// The coop unit on the Automation page, drawn like the real one: a long wooden box on
// four table legs with two levels, layers on top and broilers below. Each level has a
// fan at both ends (the two switch together, on that zone's fan relay) and a heat lamp.
// The door in the middle of the front slides up and down. Fans and lamps are buttons;
// the AUTO / MANUAL tag of each level switches its mode. Styles: .pg-inc-* and
// .pg-coop-* in styles.css.

export interface CoopZoneView {
  temp?: number | null;
  humidity?: number | null;
  sensor_ok?: boolean;
  safety_tripped?: boolean;
  fan: boolean;
  lamp: boolean;
  mode: "auto" | "manual";
}

type Device = "fan" | "lamp";

const NAME: Record<CoopZone, string> = { layers: "Layers", broilers: "Broilers" };

// viewBox 0 0 480 400. Each level: a window left of the door and one right of it.
const LEVEL_TOP: Record<CoopZone, number> = { layers: 52, broilers: 192 };
/** The band above each level: the lid for layers, the shelf for broilers. */
const BAND_Y: Record<CoopZone, number> = { layers: 35, broilers: 178 };
const LEVEL_H = 108;
const WINDOWS = [
  { x: 40, w: 172 },
  { x: 268, w: 172 },
];
const FANS = [72, 408];
const LAMP_X = 172;
const SPREAD = [66, 108, 150, 306, 352];
const HUDDLE = [112, 132, 152, 172, 194];

export function CoopDrawing({
  zones,
  settings,
  pending,
  offline,
  disabled,
  onToggle,
  onMode,
}: {
  zones: Record<CoopZone, CoopZoneView>;
  settings: Record<CoopZone, ZoneControls>;
  pending?: (zone: CoopZone, what: Device) => boolean;
  offline?: boolean;
  disabled?: boolean;
  onToggle: (zone: CoopZone, what: Device) => void;
  onMode: (zone: CoopZone) => void;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (s: string) => `coop-${uid}-${s}`;
  // The door isn't motorised: it opens and closes on the drawing only.
  const [doorOpen, setDoorOpen] = useState(false);

  return (
    <figure className={cn("pg-inc m-0", offline && "pg-inc--offline")}>
      <svg
        viewBox="0 0 480 400"
        className="mx-auto h-auto w-full max-w-[760px] select-none"
        role="group"
        aria-label="Coop with layers on top and broilers below. Each fan and lamp is a button; each level's AUTO / MANUAL tag switches its mode."
      >
        <defs>
          <pattern id={id("mesh")} width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M0 0 L10 10 M10 0 L0 10" stroke="#d9d4c6" strokeWidth="0.7" opacity="0.4" />
          </pattern>
          <linearGradient id={id("wood")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c18c55" />
            <stop offset="1" stopColor="#a87442" />
          </linearGradient>
          <radialGradient id={id("glow")} cx="0.75" cy="0.15" r="0.9">
            <stop offset="0" stopColor="#ffd88a" stopOpacity="0.75" />
            <stop offset="0.55" stopColor="#ffb547" stopOpacity="0.22" />
            <stop offset="1" stopColor="#ffb547" stopOpacity="0" />
          </radialGradient>
          <filter id={id("blur")} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <clipPath id={id("door")}>
            <rect x={218} y={46} width={44} height={258} />
          </clipPath>
          {(["layers", "broilers"] as const).map((z) =>
            WINDOWS.map((w, i) => (
              <clipPath key={`${z}${i}`} id={id(`win-${z}-${i}`)}>
                <rect x={w.x} y={LEVEL_TOP[z]} width={w.w} height={LEVEL_H} rx={4} />
              </clipPath>
            )),
          )}
        </defs>

        {/* Ground shadow */}
        <ellipse cx={240} cy={388} rx={220} ry={7} fill="#000" opacity={0.12} />

        {/* Legs: the back two, then the front two */}
        <rect x={50} y={300} width={12} height={74} rx={2} fill="#6e4523" />
        <rect x={418} y={300} width={12} height={74} rx={2} fill="#6e4523" />
        <rect x={28} y={300} width={16} height={84} rx={3} fill="#8a5a30" />
        <rect x={436} y={300} width={16} height={84} rx={3} fill="#8a5a30" />

        {/* The wooden box */}
        <rect
          x={22}
          y={44}
          width={436}
          height={262}
          rx={6}
          fill={`url(#${id("wood")})`}
          stroke="#6e4523"
          strokeWidth={3}
        />
        {/* Lid and the shelf between the levels */}
        <rect
          x={16}
          y={22}
          width={448}
          height={26}
          rx={6}
          fill="#8a5a30"
          stroke="#6e4523"
          strokeWidth={2}
        />
        <rect x={22} y={164} width={436} height={26} fill="#8a5a30" />

        {(["layers", "broilers"] as const).map((z) => (
          <Level
            key={z}
            zone={z}
            state={zones[z]}
            setpoints={settings[z]}
            clip={(i) => id(`win-${z}-${i}`)}
            mesh={id("mesh")}
            glow={id("glow")}
            blur={id("blur")}
            pending={(w) => pending?.(z, w) ?? false}
            disabled={!!disabled}
            onToggle={(w) => onToggle(z, w)}
            onMode={() => onMode(z)}
          />
        ))}

        {/* The door in the middle slides up */}
        <rect x={214} y={46} width={4} height={258} fill="#6e4523" />
        <rect x={262} y={46} width={4} height={258} fill="#6e4523" />
        <rect x={218} y={52} width={44} height={248} fill="#2a1d12" />
        <g
          className="pg-inc-part"
          role="button"
          tabIndex={0}
          aria-pressed={doorOpen}
          aria-label={`Door: ${doorOpen ? "open" : "closed"}. Press to ${doorOpen ? "close" : "open"} it on the drawing (the door isn't motorised).`}
          onClick={() => setDoorOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setDoorOpen((o) => !o);
            }
          }}
        >
          <title>Door: {doorOpen ? "open" : "closed"}</title>
          <g clipPath={`url(#${id("door")})`}>
            <g
              className="pg-coop-door"
              style={{ transform: `translateY(${doorOpen ? -196 : 0}px)` }}
            >
              <rect
                x={219}
                y={52}
                width={42}
                height={248}
                fill="#9a683a"
                stroke="#6e4523"
                strokeWidth={1.5}
              />
              {[80, 108, 136, 164, 192, 220, 248, 276].map((y) => (
                <line
                  key={y}
                  x1={220}
                  y1={y}
                  x2={260}
                  y2={y}
                  stroke="#6e4523"
                  strokeOpacity={0.45}
                />
              ))}
              <rect x={232} y={284} width={16} height={6} rx={3} fill="#4a2f17" />
            </g>
          </g>
          <rect className="pg-inc-ring" x={212} y={46} width={56} height={260} rx={6} />
          <rect x={212} y={46} width={56} height={260} fill="transparent" />
        </g>
        <Tag
          x={240}
          y={326}
          text={doorOpen ? "DOOR · OPEN" : "DOOR · SHUT"}
          on={doorOpen}
          width={96}
        />
      </svg>
      <figcaption className="pg-t-caption mt-2">
        Layers on top, broilers below. Tap a fan or a lamp to switch it; that level goes to Manual.
        Tap AUTO / MANUAL to switch the mode. A dashed ring means the coop hasn’t confirmed the
        change yet. The door opens on the drawing only.
      </figcaption>
    </figure>
  );
}

function Level({
  zone,
  state,
  setpoints,
  clip,
  mesh,
  glow,
  blur,
  pending,
  disabled,
  onToggle,
  onMode,
}: {
  zone: CoopZone;
  state: CoopZoneView;
  setpoints: ZoneControls;
  clip: (i: number) => string;
  mesh: string;
  glow: string;
  blur: string;
  pending: (w: Device) => boolean;
  disabled: boolean;
  onToggle: (w: Device) => void;
  onMode: () => void;
}) {
  const top = LEVEL_TOP[zone];
  const band = BAND_Y[zone];
  const { fan, lamp, mode } = state;
  const temp = state.sensor_ok !== false && state.temp != null ? state.temp : null;
  const cold = temp != null && temp <= setpoints.low_temp + 0.5;
  const hot = temp != null && temp >= setpoints.high_temp - 0.5;
  const huddle = lamp || cold;
  const spots = huddle ? HUDDLE : SPREAD;
  const floor = top + LEVEL_H;
  const label = (w: Device) => {
    const on = state[w];
    const base = `${NAME[zone]} ${w === "fan" ? "fans" : "heat lamp"}: ${on ? "on" : "off"}`;
    return disabled ? base : `${base}. Press to turn ${on ? "off" : "on"}.`;
  };

  return (
    <g>
      {/* Name, reading and mode on the band above the level */}
      <text
        x={126}
        y={band + 4.5}
        textAnchor="middle"
        fontSize={12.5}
        fontWeight={700}
        letterSpacing="0.05em"
        fill="#fff3e3"
      >
        {NAME[zone].toUpperCase()} · {temp == null ? "--" : formatTemp(temp)}
        {state.humidity != null ? ` · ${state.humidity}%` : ""}
      </text>
      <Part
        pending={false}
        disabled={disabled}
        label={
          disabled
            ? `${NAME[zone]} mode: ${mode}`
            : `${NAME[zone]} mode: ${mode}. Press to switch to ${mode === "auto" ? "manual" : "auto"}.`
        }
        onPress={onMode}
        hit={{ x: 308, y: band - 12, width: 92, height: 24, rx: 12 }}
      >
        <Tag
          x={354}
          y={band}
          on={mode === "auto"}
          info={mode === "manual"}
          text={mode === "auto" ? "AUTO" : "MANUAL"}
          width={mode === "auto" ? 66 : 82}
        />
      </Part>

      {/* Inside, seen through the wire mesh */}
      {WINDOWS.map((w, i) => (
        <g key={i}>
          <g clipPath={`url(#${clip(i)})`}>
            <rect x={w.x} y={top} width={w.w} height={LEVEL_H} fill="#3b2a1b" />
            {lamp && <rect x={w.x} y={top} width={w.w} height={LEVEL_H} fill={`url(#${glow})`} />}
            <rect
              x={w.x}
              y={top}
              width={w.w}
              height={LEVEL_H}
              fill={hot ? "#ff4d2e" : "#3d8bff"}
              opacity={hot || (cold && !lamp) ? 0.16 : 0}
            />
            <rect x={w.x} y={floor - 18} width={w.w} height={18} fill="#c49a45" />
            {Array.from({ length: 15 }, (_, k) => (
              <line
                key={k}
                x1={w.x + 6 + k * 11}
                y1={floor - 14 + (k % 3) * 4}
                x2={w.x + 13 + k * 11}
                y2={floor - 17 + (k % 4) * 4}
                stroke="#e2bf6a"
                strokeWidth={1.3}
                strokeLinecap="round"
              />
            ))}
            {spots.map((x, k) => (
              <g
                key={k}
                className="pg-coop-bird"
                style={{
                  transform: `translate(${x}px, ${floor - 6 + (k % 2) * 2}px) scale(${
                    (huddle ? x > LAMP_X : k % 2 === 1) ? -0.72 : 0.72
                  }, 0.72)`,
                }}
              >
                <g className="pg-coop-peck" style={{ animationDelay: `${k * 0.9}s` }}>
                  <Hen kind={zone} fluffed={cold} />
                </g>
              </g>
            ))}
            <rect
              x={w.x}
              y={top}
              width={w.w}
              height={LEVEL_H}
              fill={`url(#${mesh})`}
              pointerEvents="none"
            />
          </g>
          <rect
            x={w.x}
            y={top}
            width={w.w}
            height={LEVEL_H}
            rx={4}
            fill="none"
            stroke="#6e4523"
            strokeWidth={3}
            pointerEvents="none"
          />
        </g>
      ))}

      {/* A fan at each end; both run on this level's fan relay */}
      {FANS.map((fx, i) => (
        <Part
          key={fx}
          on={fan}
          pending={pending("fan")}
          disabled={disabled}
          label={label("fan")}
          onPress={() => onToggle("fan")}
          hit={{ cx: fx, cy: top + 36, r: 30 }}
        >
          <circle cx={fx} cy={top + 36} r={24} fill="#3a3f3b" stroke="#252926" strokeWidth={2} />
          <g
            className={fan ? "pg-inc-spin" : undefined}
            style={{ transformOrigin: `${fx}px ${top + 36}px` }}
          >
            {[0, 120, 240].map((a) => (
              <path
                key={a}
                d={`M${fx} ${top + 36} C ${fx - 6} ${top + 23}, ${fx - 3} ${top + 16}, ${fx + 8} ${top + 16} C ${fx + 11} ${top + 26}, ${fx + 7} ${top + 31}, ${fx} ${top + 36} Z`}
                fill={fan ? "#cfe3d6" : "#7d837c"}
                transform={`rotate(${a} ${fx} ${top + 36})`}
              />
            ))}
          </g>
          <circle cx={fx} cy={top + 36} r={4} fill="#4d554f" />
          {i === 0 && (
            <Tag
              x={fx + 8}
              y={top + 74}
              on={fan}
              text={`FANS · ${fan ? "ON" : "OFF"}`}
              width={86}
            />
          )}
        </Part>
      ))}

      {/* Heat lamp */}
      <Part
        on={lamp}
        pending={pending("lamp")}
        disabled={disabled}
        label={label("lamp")}
        onPress={() => onToggle("lamp")}
        hit={{ cx: LAMP_X, cy: top + 30, r: 28 }}
      >
        <line x1={LAMP_X} y1={top} x2={LAMP_X} y2={top + 14} stroke="#8b8f86" strokeWidth={2} />
        {lamp && (
          <circle
            cx={LAMP_X}
            cy={top + 30}
            r={17}
            fill="#ffd88a"
            opacity={0.6}
            filter={`url(#${blur})`}
          />
        )}
        <path
          d={`M${LAMP_X - 13} ${top + 26} L${LAMP_X + 13} ${top + 26} L${LAMP_X + 7} ${top + 13} L${LAMP_X - 7} ${top + 13} Z`}
          fill="#c4c8bf"
          stroke="#8b8f86"
          strokeWidth={1.5}
        />
        <circle
          cx={LAMP_X}
          cy={top + 30}
          r={6}
          fill={lamp ? "#ffe7a8" : "#5c605a"}
          stroke={lamp ? "#ffb547" : "#4d514b"}
          strokeWidth={1.5}
        />
        <Tag
          x={LAMP_X - 12}
          y={top + 54}
          on={lamp}
          warn={!!state.safety_tripped}
          text={state.safety_tripped ? "LAMP · CUT OUT" : `LAMP · ${lamp ? "ON" : "OFF"}`}
          width={state.safety_tripped ? 104 : 82}
        />
      </Part>
    </g>
  );
}

function Tag({
  x,
  y,
  text,
  on,
  warn,
  info,
  width = 88,
}: {
  x: number;
  y: number;
  text: string;
  on: boolean;
  warn?: boolean;
  info?: boolean;
  width?: number;
}) {
  const dot = warn ? "#ff6b57" : info ? "#7cb8ff" : on ? "#5ee38b" : "#8b918a";
  return (
    <g pointerEvents="none" transform={`translate(${x} ${y})`}>
      <rect x={-width / 2} y={-10} width={width} height={20} rx={10} fill="rgb(0 0 0 / 0.62)" />
      <circle cx={-width / 2 + 11} cy={0} r={3.5} fill={dot} />
      <text x={6} y={3.8} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="#f4f4ef">
        {text}
      </text>
    </g>
  );
}

function Hen({ kind, fluffed }: { kind: CoopZone; fluffed: boolean }) {
  const c =
    kind === "layers"
      ? { body: "#a0572b", wing: "#7c3f1d", tail: "#5a2c14" }
      : { body: "#f4f1ea", wing: "#dcd6c8", tail: "#c9c2b2" };
  const s = fluffed ? 1.12 : 1;
  return (
    <g>
      <line x1={-4} y1={-5} x2={-5} y2={0} stroke="#e0a030" strokeWidth={2} strokeLinecap="round" />
      <line x1={4} y1={-5} x2={5} y2={0} stroke="#e0a030" strokeWidth={2} strokeLinecap="round" />
      <path d="M-12 -16 L-21 -27 L-17 -11 Z" fill={c.tail} />
      <ellipse cx={0} cy={-14} rx={15 * s} ry={10.5 * s} fill={c.body} />
      <path d="M-8 -16 q8 -7 15 1 q-7 6 -15 -1 Z" fill={c.wing} />
      <circle cx={12} cy={-25} r={6.5} fill={c.body} />
      <path d="M8 -30 q2 -5 4 -1 q2 -5 4 0 l-1 2 h-7 Z" fill="#d8352a" />
      <path d="M18 -26.5 l6 2 l-6 2 Z" fill="#f2a516" />
      <circle cx={14} cy={-26.5} r={1.3} fill="#1b1b1b" />
    </g>
  );
}
