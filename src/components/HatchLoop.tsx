// The little animation along the bottom of the sign-in and sign-up pages. It replaced
// a hopping bunny and keeps the bunny's look: soft flat white shapes with no outlines,
// a dark dot eye, a brown ground shadow, a hop, and white dust puffs kicked up behind.
// Like the bunny it runs from off-screen left to off-screen right, then loops:
//   egg rolls in -> cracks -> chick hops out and on -> grows into a hen -> hops off.
// Pure SVG + CSS (nothing to download) and decorative only (aria-hidden).

export function HatchLoop() {
  return (
    <div className="hl-run" aria-hidden="true">
      <svg className="hl-svg" viewBox="0 0 120 120" width="88" height="88">
        {/* Ground shadow, like the bunny's */}
        <ellipse className="hl-shadow" cx="60" cy="112" rx="24" ry="4" fill="#b78e81" />
        {/* Dust puffs behind (the bunny's clouds) */}
        <g className="hl-puffs" fill="#fff">
          <circle cx="16" cy="104" r="6" />
          <circle cx="8" cy="108" r="4" />
          <circle cx="24" cy="108" r="4.5" />
        </g>
        <g className="hl-egg">
          <ellipse cx="60" cy="80" rx="22" ry="29" fill="#fff" />
          <ellipse cx="66" cy="86" rx="12" ry="17" fill="#f3ebe6" />
        </g>
        <g className="hl-shell">
          <path
            d="M38 84 L45 77 L52 84 L60 76 L68 84 L75 77 L82 84 A22 25 0 0 1 38 84 Z"
            fill="#fff"
          />
          <path
            className="hl-cap"
            d="M39 72 A22 26 0 0 1 81 72 L74 78 L67 71 L60 78 L53 71 L46 78 Z"
            fill="#fff"
          />
        </g>
        <g className="hl-hop hl-chick-hop">
          <g className="hl-chick">
            <ellipse cx="58" cy="94" rx="16" ry="14" fill="#ffc533" />
            <circle cx="68" cy="76" r="10" fill="#ffc533" />
            <path d="M77 75 l7 2.5 l-7 2.5 z" fill="#f4a259" />
            <circle cx="71" cy="74" r="2" fill="#3f3334" />
            <ellipse cx="52" cy="92" rx="7" ry="5" fill="#f2ab1c" />
          </g>
        </g>
        <g className="hl-hop hl-hen-hop">
          <g className="hl-hen">
            <path d="M28 76 q-10 -14 -2 -26 q9 9 18 18 z" fill="#f3ebe6" />
            <path
              d="M30 80 q2 -24 30 -22 q20 2 23 -10 l7 2 q4 26 -10 40 q-14 13 -32 6 q-18 -6 -18 -16 z"
              fill="#fff"
            />
            <path d="M79 37 q2 -8 7 -4 q3 -7 7 -1 q5 -3 5 4 z" fill="#e5533d" />
            <circle cx="87" cy="46" r="10" fill="#fff" />
            <path d="M96 45 l9 3 l-9 3 z" fill="#f4a259" />
            <path d="M93 53 q2 7 -2 8 q-4 -3 -1 -8 z" fill="#e5533d" />
            <circle cx="90" cy="43" r="2.2" fill="#3f3334" />
            <path d="M44 80 q14 -10 26 2 q-10 11 -26 -2 z" fill="#f3ebe6" />
          </g>
        </g>
      </svg>
      <style>{HATCH_CSS}</style>
    </div>
  );
}

// One 12 s crossing (the bunny took 6 s; this one has a story to tell).
//   0-32%  egg rolls in       32-38% wobbles and cracks
//   38-64% chick hops on      62-100% hen hops off the right edge, then it loops
const HATCH_CSS = `
.hl-run {
  position: fixed; left: -20vw; bottom: 14px; width: 20vw; display: grid; place-items: center;
  z-index: 10; pointer-events: none;
  animation: hl-travel 12s linear infinite;
}
.hl-svg { display: block; overflow: visible; }
.hl-svg g, .hl-svg ellipse { transform-box: fill-box; }
.hl-egg { transform-origin: center; animation: hl-egg 12s linear infinite; }
.hl-shell { opacity: 0; animation: hl-shell 12s linear infinite; }
.hl-cap { transform-origin: center; animation: hl-cap 12s ease-out infinite; }
.hl-chick { opacity: 0; transform-origin: center bottom; animation: hl-chick 12s linear infinite; }
.hl-hen { opacity: 0; transform-origin: center bottom; animation: hl-hen 12s linear infinite; }
/* The bunny's hop: lean back, up, lean forward, land. */
.hl-hop { transform-origin: center bottom; animation: hl-hop 1s linear infinite; }
.hl-shadow { transform-origin: center; animation: hl-shadow 1s linear infinite; }
.hl-puffs { opacity: 0; animation: hl-puffs 1s linear infinite; }

@keyframes hl-travel { from { transform: translateX(0); } to { transform: translateX(140vw); } }
@keyframes hl-hop {
  0%, 100% { transform: rotate(0) translate(0, 0); }
  20% { transform: rotate(-10deg) translate(2px, -9px); }
  40% { transform: rotate(10deg) translate(5px, -16px); }
  60%, 75% { transform: rotate(0) translate(7px, 0); }
}
@keyframes hl-shadow { 0%, 60%, 100% { transform: scaleX(1); } 40% { transform: scaleX(0.6); } }
@keyframes hl-puffs {
  0% { opacity: 0; transform: translate(0, 0); }
  40% { opacity: 0.85; transform: translate(-8px, -2px); }
  60%, 100% { opacity: 0; transform: translate(-14px, -4px); }
}
@keyframes hl-egg {
  0% { opacity: 1; transform: rotate(0deg); }
  30% { opacity: 1; transform: rotate(720deg); }
  32% { transform: rotate(706deg); }
  34% { transform: rotate(734deg); }
  36% { opacity: 1; transform: rotate(720deg); }
  37%, 100% { opacity: 0; transform: rotate(720deg); }
}
@keyframes hl-shell { 0%, 35.9% { opacity: 0; } 36%, 42% { opacity: 1; } 46%, 100% { opacity: 0; } }
@keyframes hl-cap {
  0%, 37% { transform: translate(0, 0) rotate(0deg); }
  42%, 100% { transform: translate(-10px, -16px) rotate(-35deg); }
}
@keyframes hl-chick {
  0%, 36.9% { opacity: 0; transform: scale(0.7); }
  39% { opacity: 1; transform: scale(0.75); }
  60% { opacity: 1; transform: scale(0.95); }
  64%, 100% { opacity: 0; transform: scale(0.95); }
}
@keyframes hl-hen {
  0%, 61.9% { opacity: 0; transform: scale(0.75); }
  65% { opacity: 1; transform: scale(0.9); }
  70%, 99% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; }
}
/* Always moves, like the bunny did, even when the device asks for reduced motion
   (Windows turns that on when "Animation effects" is off). It is small, slow and
   at the very bottom of the page, away from the form. */
`;
