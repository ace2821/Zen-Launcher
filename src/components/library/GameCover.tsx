import { useEffect, useMemo, useState, type ReactNode } from "react";
import { coverPalette, titleInitials } from "../../lib/cover";
import { useAssetUrl } from "../../lib/hooks";
import styles from "./library.module.css";

export interface GameCoverProps {
  title: string;
  coverPath: string | null;
  /** `compact` scales the fallback down for small covers (table rows). */
  variant?: "poster" | "compact";
  className?: string;
  children?: ReactNode;
}

/**
 * Cover art, or the deterministic fallback tile.
 *
 * The core stores artwork outside the bundle, so `coverPath` is a path on disk
 * until the asset protocol turns it into a URL. Until that resolves — and if the
 * image turns out to be unreadable — the tile falls back to the palette and the
 * title's initials, so the grid never shows a gap or a broken image.
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
  const src = useAssetUrl(coverPath);

  useEffect(() => {
    setFailed(false);
  }, [coverPath]);

  const showImage = src !== null && !failed;

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
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
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
