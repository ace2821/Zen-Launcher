import { useEffect, useMemo, useState, type ReactNode } from "react";
import { coverPalette, titleInitials } from "../../lib/cover";
import styles from "./library.module.css";

export interface GameCoverProps {
  title: string;
  coverPath: string | null;
  /** `initials` scales the fallback down for compact covers (table rows). */
  variant?: "poster" | "compact";
  className?: string;
  children?: ReactNode;
}

/**
 * Cover art, or the deterministic fallback tile. Providers start filling
 * `coverPath` in M3; until then every entry gets a stable duotone + its
 * initials, so the grid never shows a gap or a broken image.
 */
export function GameCover({
  title,
  coverPath,
  variant = "poster",
  className,
  children,
}: GameCoverProps) {
  const palette = useMemo(() => coverPalette(title), [title]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [coverPath]);

  const showImage = coverPath !== null && coverPath !== "" && !failed;

  return (
    <span
      className={[styles.cover, className ?? ""].filter(Boolean).join(" ")}
      style={{
        backgroundImage: showImage
          ? undefined
          : `linear-gradient(${palette.angle}deg, ${palette.from} 0%, ${palette.to} 100%)`,
      }}
    >
      {showImage ? (
        <img
          className={styles.coverImage}
          src={coverPath}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <span
            className={[
              styles.coverInitials,
              variant === "compact" ? styles.tableCoverInitials : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ color: palette.tint }}
          >
            {titleInitials(title)}
          </span>
          <span className={styles.coverGlow} />
        </>
      )}
      {children}
    </span>
  );
}
