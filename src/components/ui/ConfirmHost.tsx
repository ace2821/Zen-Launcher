import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConfirmStore } from "../../store/confirm";
import { Button } from "./Button";
import { Modal } from "./Modal";
import styles from "./ui.module.css";

/**
 * Single host for every confirmation in the app. Views call
 * `confirmDialog(...)` and await a boolean; the store keeps one modal at a time.
 */
export function ConfirmHost() {
  const current = useConfirmStore((state) => state.current);
  const settle = useConfirmStore((state) => state.settle);
  const { t } = useTranslation();

  return (
    <Modal
      open={current !== null}
      title={current?.title ?? ""}
      onClose={() => settle(false)}
      closeLabel={t("common.close")}
      footer={
        current ? (
          <>
            <Button variant="ghost" onClick={() => settle(false)}>
              {current.cancelLabel}
            </Button>
            <Button
              variant={current.tone === "danger" ? "danger" : "primary"}
              onClick={() => settle(true)}
            >
              {current.confirmLabel}
            </Button>
          </>
        ) : null
      }
    >
      {current ? (
        <>
          <p>{current.body}</p>
          {current.note ? (
            <p className={styles.confirmNote}>
              <Info size={16} aria-hidden className={styles.confirmNoteIcon} />
              <span className="mono">{current.note}</span>
            </p>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
