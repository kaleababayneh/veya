/**
 * The ↗ mark, drawn as an SVG. The Unicode arrow (U+2197) also has an emoji form, and iOS paints it as a
 * blue emoji tile whenever the text font has no glyph for it (Arial and Switzer do not); desktop browsers
 * fall back to a plain symbol font, so it only shows on phones. Sized in em and coloured by the text.
 */
export function ArrowMark({ className = "" }: { className?: string }) {
  return (
    <svg className={`arrow-mark ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6.5 17.5 17.5 6.5M8.5 6.5h9v9" />
    </svg>
  );
}
