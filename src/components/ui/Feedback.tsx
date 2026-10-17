import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./ui.module.css";

/** Inline confidence meter for scanner candidates. */
export function Meter({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(1, Math.max(0, value));
  const percent = Math.round(clamped * 100);
  return (
    <span
      className={styles.meter}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <span className={styles.meterTrack}>
        <span className={styles.meterFill} style={{ width: `${percent}%` }} />
      </span>
      <span className={styles.meterValue}>{percent}%</span>
    </span>
  );
}

export function Skeleton({
  width,
  height,
  radius,
  className,
}: {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={[styles.skeleton, className ?? ""].filter(Boolean).join(" ")}
      style={{ width, height, borderRadius: radius }}
    />
  );
}

export interface ProgressBarProps {
  /** `null` renders an indeterminate bar — a scan cannot know its total up front. */
  value: number | null;
  label: string;
  meta?: ReactNode;
  className?: string;
}

export function ProgressBar({ value, label, meta, className }: ProgressBarProps) {
  const determinate = value !== null;
  const percent = determinate ? Math.round(Math.min(1, Math.max(0, value)) * 100) : 0;

  return (
    <div className={[styles.progress, className ?? ""].filter(Boolean).join(" ")}>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-label={label}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={determinate ? percent : undefined}
      >
        {determinate ? (
          <div className={styles.progressFill} style={{ width: `${percent}%` }} />
        ) : (
          <div className={styles.progressIndeterminate} />
        )}
      </div>
      {meta ? <div className={styles.progressMeta}>{meta}</div> : null}
    </div>
  );
}

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, body, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon size={20} aria-hidden />
      </span>
      <h2 className={styles.emptyTitle}>{title}</h2>
      <p className={styles.emptyBody}>{body}</p>
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  );
}
