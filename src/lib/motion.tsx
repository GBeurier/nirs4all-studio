/**
 * Motion wrapper that disables animations in Firefox
 * Firefox has performance issues with framer-motion
 */
import { motion as framerMotion, AnimatePresence as FramerAnimatePresence, LayoutGroup as FramerLayoutGroup } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";

// Detect Firefox
export const isFirefox = typeof navigator !== "undefined" &&
  navigator.userAgent.toLowerCase().includes("firefox");

// Create a simple div wrapper that ignores motion props
const StaticDiv = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  ({ initial, animate, exit, variants, transition, whileHover, whileTap, whileFocus, whileInView, layout, layoutId, style, children, ...props }, ref) => {
    // Cast props to strip motion-specific types
    return <div ref={ref} style={style as React.CSSProperties} {...(props as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>;
  }
);
StaticDiv.displayName = "StaticDiv";

// Export motion that's either real or static based on browser
export const motion = isFirefox
  ? { div: StaticDiv, span: StaticDiv, section: StaticDiv, article: StaticDiv, main: StaticDiv, header: StaticDiv, footer: StaticDiv, nav: StaticDiv, aside: StaticDiv, ul: StaticDiv, li: StaticDiv, a: StaticDiv, button: StaticDiv, p: StaticDiv, h1: StaticDiv, h2: StaticDiv, h3: StaticDiv, h4: StaticDiv, h5: StaticDiv, h6: StaticDiv }
  : framerMotion;

// AnimatePresence that does nothing in Firefox
export const AnimatePresence = isFirefox
  ? ({ children }: { children: ReactNode; mode?: string; initial?: boolean }) => <>{children}</>
  : FramerAnimatePresence;

// LayoutGroup that does nothing in Firefox
export const LayoutGroup = isFirefox
  ? ({ children }: { children: ReactNode; id?: string }) => <>{children}</>
  : FramerLayoutGroup;
