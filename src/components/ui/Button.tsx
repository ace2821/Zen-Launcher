import { LoaderCircle, type LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import styles from "./ui.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: styles.btnPrimary,
  secondary: styles.btnSecondary,
  ghost: styles.btnGhost,
  danger: styles.btnDanger,
};

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  block?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    styles.btn,
    VARIANT_CLASS[variant],
    size === "sm" ? styles.btnSm : "",
    block ? styles.btnBlock : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={classes}
    >
      {loading ? (
        <LoaderCircle size={14} className={styles.btnSpinner} aria-hidden />
      ) : Icon ? (
        <Icon size={14} aria-hidden />
      ) : null}
      {children === undefined || children === null ? null : (
        <span className={styles.btnLabel}>{children}</span>
      )}
    </button>
  );
}

export interface IconButtonProps extends ComponentProps<"button"> {
  icon: LucideIcon;
  /** Accessible name, also used as the native tooltip. */
  label: string;
  iconSize?: number;
  tone?: "default" | "danger";
  active?: boolean;
}

export function IconButton({
  icon: Icon,
  label,
  iconSize = 15,
  tone = "default",
  active = false,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  const classes = [
    styles.iconBtn,
    tone === "danger" ? styles.iconBtnDanger : "",
    active ? styles.iconBtnActive : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={rest["aria-pressed"] ?? undefined}
      className={classes}
    >
      <Icon size={iconSize} aria-hidden />
    </button>
  );
}
