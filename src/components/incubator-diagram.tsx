import { RELAY_INFO, type RelayName, type RelayState } from "@/lib/relays";
import { cn } from "@/lib/utils";

// A 2D incubator for the Automation page. The controller panel, fan, lamp and the
// LED strip around the door are each a button (mouse, touch or keyboard) that
// switches its relay. Styles: .pg-inc-* in styles.css.

/* -------------------------------------------------------------------------- */
/* The 2D incubator                                                           */
/* -------------------------------------------------------------------------- */

export function IncubatorDiagram({
  state,
  pending,
  offline,
  disabled,
  onToggle,
}: {
  state: RelayState;
  pending: (k: RelayName) => boolean;
  offline: boolean;
  disabled: boolean;
  onToggle: (k: RelayName) => void;
}) {
  const { incubator, fan, light, strip } = state;

  // One clickable part of the drawing. "shape" is both its click area and the ring
  // drawn on hover, keyboard focus and while the board hasn't confirmed a change.
  type Shape =
    | { circle: { cx: number; cy: number; r: number } }
    | { rect: { x: number; y: number; width: number; height: number; rx: number }; band?: number };
  const part = (k: RelayName, shape: Shape, body: React.ReactNode) => {
    const on = state[k];
    const label = `${RELAY_INFO[k].label}: ${on ? "on" : "off"}`;
    return (
      <g
        className={cn("pg-inc-part", pending(k) && "pg-inc-part--pending")}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-pressed={on}
        aria-disabled={disabled || undefined}
        aria-label={disabled ? label : `${label}. Press to turn ${on ? "off" : "on"}.`}
        onClick={() => !disabled && onToggle(k)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onToggle(k);
          }
        }}
      >
        <title>{label}</title>
        {body}
        {"circle" in shape ? (
          <>
            <circle className="pg-inc-ring" {...shape.circle} />
            <circle {...shape.circle} fill="transparent" />
          </>
        ) : (
          <>
            <rect className="pg-inc-ring" {...shape.rect} />
            {shape.band ? (
              <rect
                {...shape.rect}
                fill="none"
                stroke="transparent"
                strokeWidth={shape.band}
                pointerEvents="stroke"
              />
            ) : (
              <rect {...shape.rect} fill="transparent" />
            )}
          </>
        )}
      </g>
    );
  };

  // A small "name · on/off" tag next to each part.
  const tag = (x: number, y: number, k: RelayName, name: string) => (
    <g pointerEvents="none" transform={`translate(${x} ${y})`}>
      <rect x={-46} y={-11} width={92} height={22} rx={11} fill="rgb(0 0 0 / 0.6)" />
      <circle cx={-33} cy={0} r={4} fill={state[k] ? "#5ee38b" : "#8b918a"} />
      <text x={6} y={4} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="#f4f4ef">
        {name} · {state[k] ? "ON" : "OFF"}
      </text>
    </g>
  );

  const eggs = [];
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 7; i++)
      eggs.push(
        <ellipse
          key={`${row}-${i}`}
          cx={88 + i * 38 + (row ? 19 : 0)}
          cy={row ? 262 : 250}
          rx={12}
          ry={15}
          fill="url(#inc-egg)"
          stroke="rgb(0 0 0 / 0.25)"
          strokeWidth={1}
        />,
      );

  // LED strip dots around the inside of the door frame.
  const dots = [];
  for (let x = 68; x <= 346; x += 18) dots.push([x, 74], [x, 340]);
  for (let y = 92; y <= 322; y += 18) dots.push([58, y], [356, y]);

  return (
    <figure className={cn("pg-inc m-0", offline && "pg-inc--offline")}>
      <svg
        viewBox="0 0 500 420"
        className="h-auto w-full max-w-[560px] select-none"
        role="group"
        aria-label="Incubator. Each part is a button that switches its relay."
      >
        <defs>
          <linearGradient id="inc-glass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#26302a" />
            <stop offset="1" stopColor="#151b17" />
          </linearGradient>
          <radialGradient id="inc-lamp-glow" cx="0.5" cy="0.12" r="0.85">
            <stop offset="0" stopColor="#ffd88a" stopOpacity="0.75" />
            <stop offset="0.45" stopColor="#ffb547" stopOpacity="0.28" />
            <stop offset="1" stopColor="#ffb547" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="inc-egg" cx="0.4" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#fff6e6" />
            <stop offset="1" stopColor="#d9c3a0" />
          </radialGradient>
          <linearGradient id="inc-heat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff7a2f" stopOpacity="0" />
            <stop offset="1" stopColor="#ff7a2f" stopOpacity="0.45" />
          </linearGradient>
          <filter id="inc-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <clipPath id="inc-window">
            <rect x={50} y={64} width={316} height={286} rx={14} />
          </clipPath>
        </defs>

        {/* Cabinet */}
        <rect
          x={34}
          y={30}
          width={444}
          height={346}
          rx={20}
          fill="var(--pg-surface)"
          stroke="var(--pg-line-strong)"
          strokeWidth={2}
        />
        <rect x={34} y={30} width={444} height={22} rx={11} fill="var(--pg-sunken)" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect
            key={i}
            x={160 + i * 22}
            y={37}
            width={14}
            height={8}
            rx={3}
            fill="var(--pg-line-strong)"
          />
        ))}
        <rect x={70} y={376} width={40} height={12} rx={4} fill="var(--pg-line-strong)" />
        <rect x={402} y={376} width={40} height={12} rx={4} fill="var(--pg-line-strong)" />

        {/* Chamber behind the glass door */}
        <g clipPath="url(#inc-window)">
          <rect x={50} y={64} width={316} height={286} fill="url(#inc-glass)" />
          {light && <rect x={50} y={64} width={316} height={286} fill="url(#inc-lamp-glow)" />}
          {incubator && <rect x={50} y={250} width={316} height={100} fill="url(#inc-heat)" />}
          {/* Egg tray */}
          <rect x={66} y={270} width={284} height={10} rx={3} fill="#6b5a45" />
          {eggs}
          {/* Heater coil (shows the controller's heat) */}
          <path
            d="M76 318 q10 -14 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0"
            fill="none"
            stroke={incubator ? "#ff7a2f" : "#59605a"}
            strokeWidth={4}
            strokeLinecap="round"
          />
          {incubator && (
            <path
              d="M76 318 q10 -14 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0"
              fill="none"
              stroke="#ffb547"
              strokeWidth={6}
              opacity={0.6}
              filter="url(#inc-blur)"
            />
          )}
          {/* Glass reflection */}
          <path d="M70 64 L130 64 L60 200 L50 200 L50 90 Z" fill="#fff" opacity={0.05} />
        </g>

        {/* LED strip around the door frame */}
        {part(
          "strip",
          { rect: { x: 50, y: 64, width: 316, height: 286, rx: 14 }, band: 20 },
          <g>
            <rect
              x={50}
              y={64}
              width={316}
              height={286}
              rx={14}
              fill="none"
              stroke="var(--pg-line-strong)"
              strokeWidth={10}
            />
            {dots.map(([x, y], i) => (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={strip ? 3.2 : 2.4}
                fill={strip ? "#9fe8ff" : "#7d837c"}
                className={strip ? "pg-inc-led" : undefined}
              />
            ))}
            {tag(208, 340, "strip", "STRIP")}
          </g>,
        )}

        {/* Fan on the back wall */}
        {part(
          "fan",
          { circle: { cx: 112, cy: 136, r: 44 } },
          <g>
            <circle cx={112} cy={136} r={36} fill="#1f2622" stroke="#4d554f" strokeWidth={3} />
            <g
              className={fan ? "pg-inc-spin" : undefined}
              style={{ transformOrigin: "112px 136px" }}
            >
              {[0, 90, 180, 270].map((a) => (
                <path
                  key={a}
                  d="M112 136 C 104 118, 108 106, 122 104 C 126 116, 122 128, 112 136 Z"
                  fill={fan ? "#cfe3d6" : "#7d837c"}
                  transform={`rotate(${a} 112 136)`}
                />
              ))}
            </g>
            <circle cx={112} cy={136} r={6} fill="#4d554f" />
            {[-24, -8, 8, 24].map((d) => (
              <line
                key={d}
                x1={112 + d}
                y1={102}
                x2={112 + d}
                y2={170}
                stroke="#4d554f"
                strokeWidth={1}
                opacity={0.6}
              />
            ))}
            {tag(112, 190, "fan", "FAN")}
          </g>,
        )}

        {/* Lamp at the top of the chamber */}
        {part(
          "light",
          { circle: { cx: 262, cy: 108, r: 40 } },
          <g>
            <rect x={254} y={66} width={16} height={18} rx={2} fill="#8b8f86" />
            {light && (
              <circle
                cx={262}
                cy={102}
                r={30}
                fill="#ffd88a"
                opacity={0.45}
                filter="url(#inc-blur)"
              />
            )}
            <circle
              cx={262}
              cy={102}
              r={17}
              fill={light ? "#ffe7a8" : "#bfc3ba"}
              stroke={light ? "#ffb547" : "#8b8f86"}
              strokeWidth={2}
            />
            <path
              d="M255 102 q3.5 -7 7 0 t7 0"
              fill="none"
              stroke={light ? "#c47d10" : "#8b8f86"}
              strokeWidth={1.6}
            />
            {tag(262, 146, "light", "LAMP")}
          </g>,
        )}

        {/* Controller panel on the right: heater and turner */}
        {part(
          "incubator",
          { rect: { x: 378, y: 60, width: 92, height: 294, rx: 14 } },
          <g>
            <rect
              x={382}
              y={64}
              width={84}
              height={286}
              rx={12}
              fill="var(--pg-sunken)"
              stroke="var(--pg-line-strong)"
              strokeWidth={1.5}
            />
            {/* Display */}
            <rect
              x={392}
              y={80}
              width={64}
              height={40}
              rx={6}
              fill={incubator ? "#173d26" : "#2a2e2b"}
            />
            <text
              x={424}
              y={106}
              textAnchor="middle"
              fontSize={15}
              fontWeight={700}
              fontFamily="var(--pg-font-mono)"
              fill={incubator ? "#5ee38b" : "#6d736c"}
            >
              {incubator ? "HEAT" : "OFF"}
            </text>
            {/* Power button */}
            <circle
              cx={424}
              cy={176}
              r={26}
              fill="var(--pg-surface)"
              stroke={incubator ? "#2fa35f" : "var(--pg-line-strong)"}
              strokeWidth={4}
            />
            <path
              d="M424 162 v13"
              stroke={incubator ? "#2fa35f" : "var(--pg-ink-3)"}
              strokeWidth={3.5}
              strokeLinecap="round"
            />
            <path
              d="M414 168 a14 14 0 1 0 20 0"
              fill="none"
              stroke={incubator ? "#2fa35f" : "var(--pg-ink-3)"}
              strokeWidth={3.5}
              strokeLinecap="round"
            />
            {/* Status lights and dial */}
            <circle cx={406} cy={228} r={5} fill={incubator ? "#ff7a2f" : "#8b918a"} />
            <circle cx={424} cy={228} r={5} fill={incubator ? "#5ee38b" : "#8b918a"} />
            <circle cx={442} cy={228} r={5} fill="#8b918a" />
            <circle
              cx={424}
              cy={278}
              r={18}
              fill="var(--pg-surface)"
              stroke="var(--pg-line-strong)"
              strokeWidth={2}
            />
            <line
              x1={424}
              y1={278}
              x2={432}
              y2={266}
              stroke="var(--pg-ink-2)"
              strokeWidth={3}
              strokeLinecap="round"
            />
            <text
              x={424}
              y={330}
              textAnchor="middle"
              fontSize={9.5}
              fontWeight={600}
              letterSpacing="0.08em"
              fill="var(--pg-ink-3)"
            >
              CONTROLLER
            </text>
          </g>,
        )}

        {/* Door handle (decoration) */}
        <rect
          x={352}
          y={180}
          width={8}
          height={56}
          rx={4}
          fill="var(--pg-line-strong)"
          pointerEvents="none"
        />
      </svg>
      <figcaption className="pg-t-caption mt-2">
        Tap the controller, fan, lamp or the LED strip around the door. A dashed ring means the
        board hasn’t confirmed the change yet.
      </figcaption>
    </figure>
  );
}
