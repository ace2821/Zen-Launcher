import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { useToastStore, type ToastTone } from "../../store/toasts";
import { IconButton } from "./Button";
import styles from "./ui.module.css";

const TONE_ICON: Record<ToastTone, LucideIcon> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
};

const TONE_CLASS: Record<ToastTone, string> = {
  success: styles.toastSuccess,
  error: styles.toastError,
  info: styles.toastInfo,
};

const ICON_CLASS: Record<ToastTone, string> = {
  success: styles.toastIconSuccess,
  error: styles.toastIconError,
  info: "",
};

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  const { t } = useTranslation();

  return createPortal(
    <div className={styles.toaster} aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = TONE_ICON[toast.tone];
          return (
            <motion.div
              key={toast.id}
              layout
              role="status"
              className={[styles.toast, TONE_CLASS[toast.tone]].join(" ")}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <span
                className={[styles.toastIcon, ICON_CLASS[toast.tone]]
                  .filter(Boolean)
                  .join(" ")}
              >
                <Icon size={15} aria-hidden />
              </span>
              <div className={styles.toastContent}>
                <div className={styles.toastTitle}>
                  {toast.title}
                  {toast.code ? (
                    <span className={styles.toastCode}>{toast.code}</span>
                  ) : null}
                </div>
                {toast.description ? (
                  <div className={styles.toastDescription}>{toast.description}</div>
                ) : null}
              </div>
              <IconButton
                icon={X}
                label={t("common.dismiss")}
                onClick={() => dismiss(toast.id)}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
