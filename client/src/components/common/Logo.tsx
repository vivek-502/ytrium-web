import React from "react";

/**
 * Ytrium's app mark, rebuilt as inline SVG so it is theme- and accent aware
 * with no baked-in tile or background:
 *   - the open ring (a C-arc, broken on the right) inherits `currentColor`,
 *     so it is dark on a light theme and light on a dark theme
 *   - the solid play triangle is filled with `var(--accent)`, following the
 *     accent the user picked in Settings; an inline `fill` acts as a fallback
 *     for the rare context where the CSS variable is not in scope
 *   - no background fill at all - the mark floats as pure line-work on the
 *     header, sidebar, sign-in card and boot splash.
 *
 * The viewBox is padded past the drawing so the arc's stroke is never clipped,
 * and `overflow: visible` keeps the round line-caps from being cut.
 */
export const Logo: React.FC<{ size?: number; title?: string }> = ({
  size = 22,
  title = "Ytrium",
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    role="img"
    aria-label={title}
    fill="none"
    style={{ display: "block", overflow: "visible" }}
  >
    {/* Open ring: a true circle (same sweep in x and y), broken with a gap
        on the right so the play triangle reads through the opening. */}
    <path
      d="M45.2 18.4A22.6 22.6 0 1 0 45.2 45.6"
      stroke="currentColor"
      strokeWidth={3.4}
      strokeLinecap="round"
    />
    {/* Solid play triangle, pointing right, nested in the ring's opening. */}
    <path
      d="M26.5 21.5 45 32 26.5 42.5Z"
      fill="var(--accent, #757de8)"
    />
  </svg>
);

export default Logo;
