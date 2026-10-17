import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./ui.module.css";

export type BadgeTone = "neutral" | "accent" | "warn" | "danger" | "info" | "quiet";

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "",
  accent: styles.badgeAccent,
  warn: styles.badgeWarn,
  danger: styles.badgeDanger,
  info: styles.badgeInfo,
  quiet: styles.badgeQuiet,
};

export interface BadgeProps {
  tone?: BadgeTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Badge({
  tone = "neutral",
  icon: Icon,
  children,
  className,
  title,
}: BadgeProps) {
  return (
    <span
      className={[styles.badge, TONE_CLASS[tone], className ?? ""]
        .filter(Boolean)
        .join(" ")}
      title={title}
    >
      {Icon ? <Icon size={11} aria-hidden /> : null}
      {children}
    </span>
  );
}

export function Chip({
  children,
  overflow = false,
}: {
  children: ReactNode;
  overflow?: boolean;
}) {
  return (
    <span
      className={[styles.chip, overflow ? styles.chipOverflow : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}

export function CountBadge({ children }: { children: ReactNode }) {
  return <span className={styles.countBadge}>{children}</span>;
}
