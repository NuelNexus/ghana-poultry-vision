import { useId } from "react";
import { RELAY_INFO, RELAYS, type RelayName, type RelayState } from "@/lib/relays";
import { cn } from "@/lib/utils";

// The incubator unit on the Automation page, drawn like the real one: a white
// upright box. Across the top, built into the box, is the panel with the incubator
// controller's screen and one button per relay. Below it the incubator (eggs, fan,
// lamp), and at the bottom the brooding area (chicks under the LED strip lights).
// Every part is a button (mouse, touch or keyboard) that switches its relay.
// Styles: .pg-inc-* and .pg-coop-* in styles.css.

const PANEL: Record<RelayName, string> = {
  incubator: "HEAT",
  fan: "FAN",
  light: "LAMP",
  strip: "STRIP",
};

export function IncubatorDiagram({
  state,
  pending,
  offline,
  disabled,
  onToggle,
  display,
  caption = true,
  fit = false,
}: {
  state: RelayState;
  pending: (k: RelayName) => boolean;
  offline: boolean;
  disabled: boolean;
  onToggle: (k: RelayName) => void;
  /** What the controller's screen shows, e.g. the demo's temperature. */
  display?: string;
  caption?: boolean;
  /** On wide screens, grow to the height of the cell (the Coop section's left column). */
  fit?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (s: string) => `inc-${uid}-${s}`;
  const { incubator, fan, light, strip } = state;

  const label = (k: RelayName) => {
    const on = state[k];
    const base = `${RELAY_INFO[k].label}: ${on ? "on" : "off"}`;
    return disabled ? base : `${base}. Press to turn ${on ? "off" : "on"}.`;
  };
  const part = (
    k: RelayName,
    hit: React.ComponentProps<typeof Part>["hit"],
    body: React.ReactNode,
  ) => (
    <Part
      on={state[k]}
      pending={pending(k)}
      disabled={disabled}
      label={label(k)}
      onPress={() => onToggle(k)}
      hit={hit}
    >
      {body}
    </Part>
  );

  // Eggs: two staggered rows on the tray.
  const eggs = [];
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 6; i++)
      eggs.push(
        <ellipse
          key={`${row}-${i}`}
          cx={118 + i * 30 + (row ? 15 : 0)}
          cy={row ? 300 : 290}
          rx={10.5}
          ry={13}
          fill={`url(#${id("egg")})`}
          stroke="rgb(0 0 0 / 0.18)"
        />,
      );

  // Chicks run about under the strip lights and huddle together in the dark.
  const chicks = strip ? [100, 136, 170, 204, 240, 276] : [146, 162, 178, 194, 210, 226];

  // LED strip along the brooder ceiling.
  const leds: number[] = [];
  for (let x = 60; x <= 300; x += 15) leds.push(x);

  return (
    <figure
      className={cn(
        "pg-inc m-0",
        offline && "pg-inc--offline",
        fit && "lg:relative lg:h-full lg:min-h-[520px]",
      )}
    >
      <svg
        viewBox="0 0 360 576"
        preserveAspectRatio="xMidYMin meet"
        className={cn(
          "mx-auto h-auto w-full max-w-[420px] select-none",
          fit && "lg:absolute lg:inset-0 lg:h-full lg:max-w-none",
        )}
        role="group"
        aria-label="Incubator unit. Each part is a button that switches its relay."
      >
        <defs>
          <radialGradient id={id("egg")} cx="0.4" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#fffaf0" />
            <stop offset="1" stopColor="#e2cfae" />
          </radialGradient>
          <linearGradient id={id("heat")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff9b4a" stopOpacity="0.05" />
            <stop offset="1" stopColor="#ff7a2f" stopOpacity="0.3" />
          </linearGradient>
          <radialGradient id={id("lamp")} cx="0.55" cy="0.15" r="0.8">
            <stop offset="0" stopColor="#ffd88a" stopOpacity="0.85" />
            <stop offset="0.5" stopColor="#ffc163" stopOpacity="0.28" />
            <stop offset="1" stopColor="#ffc163" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id("strip")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c8f1ff" stopOpacity="0.75" />
            <stop offset="1" stopColor="#c8f1ff" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id={id("body")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#f1f2ee" />
          </linearGradient>
          <filter id={id("blur")} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <clipPath id={id("top")}>
            <rect x={46} y={168} width={268} height={210} rx={10} />
          </clipPath>
          <clipPath id={id("bottom")}>
            <rect x={46} y={350} width={268} height={202} rx={10} />
          </clipPath>
        </defs>

        {/* The white box */}
        <rect
          x={28}
          y={10}
          width={304}
          height={548}
          rx={16}
          fill={`url(#${id("body")})`}
          stroke="#c9ccc4"
          strokeWidth={2}
        />

        {/* Top panel, built into the box: the controller screen and the relay buttons in one row */}
        <rect
          x={44}
          y={24}
          width={272}
          height={76}
          rx={12}
          fill="#eceee9"
          stroke="#d3d6cf"
          strokeWidth={1.5}
        />
        {part(
          "incubator",
          { x: 48, y: 28, width: 92, height: 68, rx: 10 },
          <g>
            <rect x={54} y={34} width={80} height={40} rx={5} fill="#151816" />
            <text
              x={92}
              y={60}
              textAnchor="middle"
              fontSize={18}
              fontWeight={700}
              fontFamily="var(--pg-font-mono)"
              fill={incubator ? "#ff4a3d" : "#4a2a28"}
            >
              {incubator ? (display ?? "HEAT") : "OFF"}
            </text>
            <circle cx={127} cy={40} r={2.5} fill={incubator ? "#ff7a2f" : "#3a3d3a"} />
            <circle cx={127} cy={48} r={2.5} fill={incubator ? "#5ee38b" : "#3a3d3a"} />
            <text
              x={94}
              y={89}
              textAnchor="middle"
              fontSize={8.5}
              fontWeight={700}
              letterSpacing="0.1em"
              fill="#8a8f86"
            >
              CONTROLLER
            </text>
          </g>,
        )}
        <line x1={145} y1={34} x2={145} y2={90} stroke="#d3d6cf" strokeWidth={1.5} />
        {RELAYS.map((k, i) => {
          const x = 166 + i * 42;
          const cy = 58;
          const on = state[k];
          return (
            <Part
              key={k}
              on={on}
              pending={pending(k)}
              disabled={disabled}
              label={label(k)}
              onPress={() => onToggle(k)}
              hit={{ x: x - 21, y: 28, width: 42, height: 70, rx: 10 }}
            >
              <circle cx={x} cy={37} r={3} fill={on ? "#3fcf76" : "#b9bcb4"} />
              <circle
                cx={x}
                cy={cy}
                r={13}
                fill={on ? "#ffffff" : "#e2e4de"}
                stroke={on ? "#2f8f57" : "#a3a89f"}
                strokeWidth={3}
              />
              <path
                d={`M${x} ${cy - 7} v7`}
                stroke={on ? "#2f8f57" : "#8a8f86"}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <path
                d={`M${x - 5.5} ${cy - 4} a8 8 0 1 0 11 0`}
                fill="none"
                stroke={on ? "#2f8f57" : "#8a8f86"}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <text
                x={x}
                y={88}
                textAnchor="middle"
                fontSize={10}
                fontWeight={700}
                letterSpacing="0.04em"
                fill="#4b524a"
              >
                {PANEL[k]}
              </text>
            </Part>
          );
        })}

        {/* Everything below the panel, moved up under it */}
        <g transform="translate(0 -58)">
          {/* Floor shadow */}
          <ellipse cx={180} cy={624} rx={150} ry={7} fill="#000" opacity={0.12} />

          {/* Upper section: incubator */}
          <g clipPath={`url(#${id("top")})`}>
            <rect x={46} y={168} width={268} height={210} fill="#f1ebe0" />
            {incubator && (
              <rect x={46} y={168} width={268} height={210} fill={`url(#${id("heat")})`} />
            )}
            {light && <rect x={46} y={168} width={268} height={210} fill={`url(#${id("lamp")})`} />}
            <g transform="translate(0 50)">
              <rect x={100} y={308} width={204} height={8} rx={3} fill="#b49a77" />
              {eggs}
              {/* Heater element along the floor */}
              <path
                d="M112 322 q8 -8 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0"
                fill="none"
                stroke={incubator ? "#ff7a2f" : "#b9b4aa"}
                strokeWidth={3}
                strokeLinecap="round"
              />
            </g>
            <path d="M60 168 L110 168 L56 274 L46 274 L46 194 Z" fill="#fff" opacity={0.35} />
          </g>
          <rect
            x={46}
            y={168}
            width={268}
            height={210}
            rx={10}
            fill="none"
            stroke="#c9ccc4"
            strokeWidth={2}
            pointerEvents="none"
          />
          <text
            x={302}
            y={186}
            textAnchor="end"
            fontSize={10}
            fontWeight={700}
            letterSpacing="0.12em"
            fill="#8a8f86"
          >
            INCUBATOR
          </text>

          {/* Fan on the incubator's back wall */}
          {part(
            "fan",
            { x: 50, y: 174, width: 70, height: 94, rx: 12 },
            <g>
              <circle cx={84} cy={212} r={27} fill="#e4e5e0" stroke="#9ea39a" strokeWidth={2} />
              <g
                className={fan ? "pg-inc-spin" : undefined}
                style={{ transformOrigin: "84px 212px" }}
              >
                {[0, 90, 180, 270].map((a) => (
                  <path
                    key={a}
                    d="M84 212 C 77 197, 80 188, 92 187 C 95 198, 92 206, 84 212 Z"
                    fill={fan ? "#5d8f74" : "#a3a89f"}
                    transform={`rotate(${a} 84 212)`}
                  />
                ))}
              </g>
              <circle cx={84} cy={212} r={5} fill="#6d736c" />
              <text
                x={84}
                y={256}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill={fan ? "#2f7a50" : "#8a8f86"}
              >
                FAN {fan ? "ON" : "OFF"}
              </text>
            </g>,
          )}

          {/* Lamp hanging in the incubator */}
          {part(
            "light",
            { x: 160, y: 170, width: 64, height: 76, rx: 12 },
            <g>
              <line x1={192} y1={168} x2={192} y2={190} stroke="#8b8f86" strokeWidth={2} />
              {light && (
                <circle
                  cx={192}
                  cy={208}
                  r={22}
                  fill="#ffd88a"
                  opacity={0.6}
                  filter={`url(#${id("blur")})`}
                />
              )}
              <path
                d="M176 204 L208 204 L200 188 L184 188 Z"
                fill="#c4c8bf"
                stroke="#8b8f86"
                strokeWidth={1.5}
              />
              <circle
                cx={192}
                cy={208}
                r={8}
                fill={light ? "#ffe7a8" : "#5c605a"}
                stroke={light ? "#ffb547" : "#4d514b"}
                strokeWidth={1.5}
              />
              <text
                x={192}
                y={238}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill={light ? "#a5660c" : "#8a8f86"}
              >
                LAMP {light ? "ON" : "OFF"}
              </text>
            </g>,
          )}

          <g transform="translate(0 50)">
            {/* Shelf between the sections */}
            <rect x={40} y={336} width={280} height={6} rx={3} fill="#e3e5df" />

            {/* Lower section: brooding area */}
            <g clipPath={`url(#${id("bottom")})`}>
              <rect x={46} y={350} width={268} height={202} fill={strip ? "#f6f3ec" : "#d9d6cf"} />
              {strip && (
                <rect x={46} y={350} width={268} height={150} fill={`url(#${id("strip")})`} />
              )}
              {/* Wood shavings */}
              <rect x={46} y={528} width={268} height={24} fill="#dcc08a" />
              {Array.from({ length: 22 }, (_, i) => (
                <path
                  key={i}
                  d={`M${54 + i * 12} ${534 + (i % 3) * 5} q4 -3 8 0`}
                  fill="none"
                  stroke="#c4a266"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              ))}
              {/* Feeder */}
              <path d="M56 534 h40 l-5 -9 h-30 Z" fill="#c9ccc4" />
              {chicks.map((x, i) => (
                <g
                  key={i}
                  className="pg-coop-bird"
                  style={{
                    transform: `translate(${x}px, ${532 + (i % 2) * 4}px) scale(${
                      (strip ? i % 3 === 1 : x > 186) ? -1 : 1
                    }, 1)`,
                  }}
                >
                  <g className="pg-coop-peck" style={{ animationDelay: `${i * 0.8}s` }}>
                    <Chick />
                  </g>
                </g>
              ))}
            </g>
            <rect
              x={46}
              y={350}
              width={268}
              height={202}
              rx={10}
              fill="none"
              stroke="#c9ccc4"
              strokeWidth={2}
              pointerEvents="none"
            />
            <text
              x={302}
              y={386}
              textAnchor="end"
              fontSize={10}
              fontWeight={700}
              letterSpacing="0.12em"
              fill="#8a7a5c"
            >
              BROODER
            </text>

            {/* LED strip lights on the brooder ceiling */}
            {part(
              "strip",
              { x: 50, y: 352, width: 260, height: 24, rx: 8 },
              <g>
                <rect x={54} y={356} width={252} height={8} rx={4} fill="#d0d3cc" />
                {leds.map((x) => (
                  <circle
                    key={x}
                    cx={x}
                    cy={360}
                    r={strip ? 3 : 2.3}
                    fill={strip ? "#7fdcff" : "#a3a89f"}
                    className={strip ? "pg-inc-led" : undefined}
                  />
                ))}
              </g>,
            )}
          </g>
        </g>
      </svg>
      {caption && (
        <figcaption className="pg-t-caption mt-2">
          Tap the controller screen, a button on the top panel, the fan, the lamp or the strip
          lights. A dashed ring means the board hasn’t confirmed the change yet.
        </figcaption>
      )}
    </figure>
  );
}

function Chick() {
  return (
    <g>
      <line
        x1={-2}
        y1={-3}
        x2={-3}
        y2={0}
        stroke="#e08a1e"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <line x1={2} y1={-3} x2={3} y2={0} stroke="#e08a1e" strokeWidth={1.6} strokeLinecap="round" />
      <ellipse cx={0} cy={-9} rx={9} ry={7} fill="#ffd84d" />
      <path d="M-5 -10 q4 -4 8 0" fill="none" stroke="#f0bf2a" strokeWidth={1.5} />
      <circle cx={6} cy={-16} r={5} fill="#ffd84d" />
      <path d="M10.5 -16.5 l4 1.5 l-4 1.5 Z" fill="#f08a1e" />
      <circle cx={7.5} cy={-17} r={1.1} fill="#1b1b1b" />
    </g>
  );
}

/** One pressable part of the drawing, with the ring shown on hover, focus and while pending. */
function Part({
  on,
  pending,
  disabled,
  label,
  onPress,
  hit,
  children,
}: {
  /** Omit for parts that aren't on/off toggles. */
  on?: boolean;
  pending: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
  hit:
    | { cx: number; cy: number; r: number }
    | { x: number; y: number; width: number; height: number; rx: number };
  children: React.ReactNode;
}) {
  return (
    <g
      className={cn("pg-inc-part", pending && "pg-inc-part--pending")}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={on}
      aria-busy={pending || undefined}
      aria-disabled={disabled || undefined}
      aria-label={label}
      onClick={() => !disabled && onPress()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onPress();
        }
      }}
    >
      <title>{label}</title>
      {children}
      {"r" in hit ? (
        <>
          <circle className="pg-inc-ring" {...hit} />
          <circle {...hit} fill="transparent" />
        </>
      ) : (
        <>
          <rect className="pg-inc-ring" {...hit} />
          <rect {...hit} fill="transparent" />
        </>
      )}
    </g>
  );
}
