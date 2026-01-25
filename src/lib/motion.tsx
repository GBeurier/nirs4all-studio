/**
 * Motion wrapper that disables animations when:
 * - Firefox browser (performance issues)
 * - User has enabled "Reduce animations" in settings
 * - System prefers reduced motion
 */
import { motion as framerMotion, AnimatePresence as FramerAnimatePresence, LayoutGroup as FramerLayoutGroup } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";

// Detect Firefox
export const isFirefox = typeof navigator !== "undefined" &&
  navigator.userAgent.toLowerCase().includes("firefox");

// Check if motion should be reduced (called at render time for reactivity)
export function shouldReduceMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    isFirefox ||
    document.documentElement.classList.contains("reduce-motion") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Create a simple div wrapper that ignores motion props
const StaticDiv = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  ({ initial, animate, exit, variants, transition, whileHover, whileTap, whileFocus, whileInView, layout, layoutId, style, children, ...props }, ref) => {
    return <div ref={ref} style={style as React.CSSProperties} {...(props as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>;
  }
);
StaticDiv.displayName = "StaticDiv";

// Create wrapper that checks condition at render time
function createMotionWrapper<T extends keyof typeof framerMotion>(element: T) {
  const FramerComponent = framerMotion[element] as React.ComponentType<HTMLMotionProps<"div">>;
  const Wrapper = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>((props, ref) => {
    if (shouldReduceMotion()) {
      const { initial, animate, exit, variants, transition, whileHover, whileTap, whileFocus, whileInView, layout, layoutId, style, children, ...rest } = props;
      return <div ref={ref} style={style as React.CSSProperties} {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>;
    }
    return <FramerComponent ref={ref} {...props} />;
  });
  Wrapper.displayName = `Motion${element.charAt(0).toUpperCase() + element.slice(1)}`;
  return Wrapper;
}

// Export motion with reactive checking
export const motion = {
  div: createMotionWrapper("div"),
  span: createMotionWrapper("span"),
  section: createMotionWrapper("section"),
  article: createMotionWrapper("article"),
  main: createMotionWrapper("main"),
  header: createMotionWrapper("header"),
  footer: createMotionWrapper("footer"),
  nav: createMotionWrapper("nav"),
  aside: createMotionWrapper("aside"),
  ul: createMotionWrapper("ul"),
  li: createMotionWrapper("li"),
  a: createMotionWrapper("a"),
  button: createMotionWrapper("button"),
  p: createMotionWrapper("p"),
  h1: createMotionWrapper("h1"),
  h2: createMotionWrapper("h2"),
  h3: createMotionWrapper("h3"),
  h4: createMotionWrapper("h4"),
  h5: createMotionWrapper("h5"),
  h6: createMotionWrapper("h6"),
};

// AnimatePresence that checks at render time
export const AnimatePresence = ({ children, ...props }: { children: ReactNode; mode?: "sync" | "wait" | "popLayout"; initial?: boolean }) => {
  if (shouldReduceMotion()) {
    return <>{children}</>;
  }
  return <FramerAnimatePresence {...props}>{children}</FramerAnimatePresence>;
};

// LayoutGroup that checks at render time
export const LayoutGroup = ({ children, ...props }: { children: ReactNode; id?: string }) => {
  if (shouldReduceMotion()) {
    return <>{children}</>;
  }
  return <FramerLayoutGroup {...props}>{children}</FramerLayoutGroup>;
};
