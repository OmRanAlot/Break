/**
 * theme.js — Break onboarding design tokens.
 * ─────────────────────────────────────────────────────────────────────────────
 * Lifted verbatim from the "Break Onboarding" handoff design (claude.ai/design)
 * so the onboarding flow matches the mockup exactly. The warm off-white palette
 * is intentionally distinct from the rest of the app's `globalStyles` — these
 * tokens are scoped to the first-run flow only.
 *
 * Colour reference (design source → token):
 *   #f4f3f1  screen background          → bg
 *   #1a1815  primary ink                → ink
 *   #161412  near-black (pills/icons)   → inkDeep
 *   #a4a09a  body copy                  → body
 *   #9c988f  small uppercase labels     → label
 *   #bdb9b1  back / step counter        → faint
 *   #6c685f  disabled row text          → dim
 *   #fbfbfa  card surface               → card
 *   #eae8e4  card / divider border      → border
 *   #ececea  segmented track / off icon → track
 *   #ededeb  permission icon tile/chip  → tile
 *   #f0efed  reassurance card           → reassure
 *   #d2cfca  unchecked control border   → controlBorder
 */

export const T = {
  bg: '#f4f3f1',
  ink: '#1a1815',
  inkDeep: '#161412',
  onInk: '#f6f4f1',
  iconOnInk: '#f4f3f1',
  body: '#a4a09a',
  label: '#9c988f',
  faint: '#bdb9b1',
  dim: '#6c685f',
  card: '#fbfbfa',
  border: '#eae8e4',
  track: '#ececea',
  tile: '#ededeb',
  reassure: '#f0efed',
  controlBorder: '#d2cfca',
  dotInactive: '#d6d3ce',
  accent: '#1a1815',
};

