/**
 * SVG art for the physical entropy game: an isometric die and a coin.
 * Colours come from theme tokens through `currentColor` and CSS variables, so
 * every theme draws them correctly.
 */

/** Pip centres on a 60×60 face, indexed by face value. */
const PIPS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[30, 30]],
  2: [[16, 16], [44, 44]],
  3: [[16, 16], [30, 30], [44, 44]],
  4: [[16, 16], [44, 16], [16, 44], [44, 44]],
  5: [[16, 16], [44, 16], [30, 30], [16, 44], [44, 44]],
  6: [[16, 16], [44, 16], [16, 30], [44, 30], [16, 44], [44, 44]],
};

/**
 * Two faces adjacent to `front` and to each other, as on a real die: opposite
 * faces sum to seven, so neither may be `front`, `7 - front`, or each other's
 * opposite.
 */
export function adjacentFaces(front: number): [number, number] {
  const sides = [1, 2, 3, 4, 5, 6].filter((n) => n !== front && n !== 7 - front);
  const top = sides[0];
  const right = sides.find((n) => n !== top && n !== 7 - top)!;
  return [top, right];
}

/** One 60×60 face; `shaded` tints a side face so the cube reads as solid. */
function Face({ value, shaded = false, transform }: { value: number; shaded?: boolean; transform: string }) {
  return (
    <g transform={transform}>
      <rect x="1" y="1" width="58" height="58" rx="11" fill="var(--bg-elevated)" />
      <rect x="1" y="1" width="58" height="58" rx="11" fill={shaded ? 'var(--card-active)' : 'none'} stroke="var(--brand)" strokeWidth="2" />
      {(PIPS[value] ?? []).map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="5.5" fill="var(--brand)" />)}
    </g>
  );
}

/** A die in three-quarter view with `value` facing the viewer. */
export function Die({ value, size = 96 }: { value: number | null; size?: number }) {
  // A blank front face (no pips) carries the "?" before the first roll.
  const front = value ?? 0;
  const [top, right] = adjacentFaces(front);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <ellipse cx="52" cy="94" rx="34" ry="4" fill="var(--text-muted)" opacity="0.25" />
      {/* Top and right faces are the 60×60 front face sheared back by a third. */}
      <Face value={top} shaded transform="matrix(1 0 0.3333 -0.3333 10 30)" />
      <Face value={right} shaded transform="matrix(0.3333 -0.3333 0 1 70 30)" />
      <Face value={front} transform="translate(10 30)" />
      {value === null && <text x="40" y="69" textAnchor="middle" fontSize="30" fontWeight="700" fill="var(--brand)">?</text>}
    </svg>
  );
}

/** A small flat die face, used on the result buttons and in the log. */
export function DieFace({ value, size = 22 }: { value: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true">
      <Face value={value} transform="" />
    </svg>
  );
}

/** A coin showing 1 (heads) or 0 (tails); `null` is a blank coin. */
export function Coin({ value, size = 96 }: { value: number | null; size?: number }) {
  const heads = value === 1;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="52" r="42" fill="var(--brand-hover)" />
      <circle cx="50" cy="48" r="42" fill={heads ? 'var(--brand)' : 'var(--bg-elevated)'} stroke="var(--brand)" strokeWidth="3" />
      <circle cx="50" cy="48" r="33" fill="none" stroke={heads ? 'var(--text-on-brand)' : 'var(--brand)'} strokeWidth="1.5" strokeDasharray="3 4" opacity="0.7" />
      <text x="50" y="62" textAnchor="middle" fontSize="40" fontWeight="700" fontFamily="var(--font-mono)" fill={heads ? 'var(--text-on-brand)' : 'var(--brand)'}>
        {value === null ? '?' : value}
      </text>
    </svg>
  );
}
