import { MotionConfig } from "motion/react";
import { AppShell } from "./components/layout/AppShell";

/**
 * `reducedMotion="user"` makes every `motion` transition honour the OS setting,
 * and the CSS layer mirrors it for keyframe animations (see `global.css`).
 */
export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AppShell />
    </MotionConfig>
  );
}
