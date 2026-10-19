import React from "react";

/**
 * Ytrium's app icon - the original rounded-tile music mark (transparent PNG).
 * Used everywhere the brand appears: header corner, sidebar, sign-in card and
 * boot splash. Shown raw; the tile and its rounding live inside the image.
 */
export const Logo: React.FC<{ size?: number; title?: string }> = ({ size = 22, title = "Ytrium" }) => (
  <img
    src="/icon.png"
    alt={title}
    width={size}
    height={size}
    draggable={false}
    /* width/height are attributes (not inline styles) so CSS breakpoints can
       resize the mark; object-fit keeps the near-square icon undistorted. */
    style={{ objectFit: "contain", display: "block" }}
  />
);

export default Logo;
