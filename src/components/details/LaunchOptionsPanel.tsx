import type { TFunction } from "i18next";
import { RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  parseArgs,
  parseEnvLines,
  stringifyArgs,
  stringifyEnv,
  type ParseIssue,
} from "../../lib/args";
import type { Game } from "../../lib/types";
import { useLibraryStore } from "../../store/library";
import { toastSuccess } from "../../store/toasts";
import { Badge, Chip } from "../ui/Badge";
import { Button } from "../ui/Button";
import { TextAreaField, TextField } from "../ui/Field";
import page from "../page/page.module.css";
import styles from "./details.module.css";

type Translate = TFunction<"translation">;

/** Parse failures are machine-readable in `lib/args`; the wording lives here. */
function describeIssue(issue: ParseIssue, t: Translate): string {
  switch (issue.kind) {
    case "unterminatedQuote":
      return t("parse.unterminatedQuote", { token: issue.token });
    case "invalidEnvLine":
      return t("parse.invalidEnvLine", { line: issue.line, text: issue.text });
  }
}

export interface LaunchOptionsPanelProps {
  game: Game;
}

/**
 * The only editable launch surface in M1. Arguments and environment are edited
 * as free text (that is how people actually copy them around) but are always
 * parsed into the array/record the contract expects — never handed to a shell.
 *
 * When the game carries a detected SA-MP client, its `host`/`port`/`nick`
 * are edited here and saved back as `client` — the core composes the actual
 * `-h`/`-p`/`-n` launch arguments from `ClientInfo`, this panel only owns the
 * fields. FiveM and MTA add no arguments, so they get a read-only note instead.
 */
export function LaunchOptionsPanel({ game }: LaunchOptionsPanelProps) {
  const { t } = useTranslation();
  const updateGame = useLibraryStore((state) => state.updateGame);
  const saving = useLibraryStore(
    (state) => state.busy[`game:update:${game.id}`] === true,
  );

  const clientKind = game.client?.kind;
  const isSamp = clientKind === "samp";
  const isInfoClient = clientKind === "fivem" || clientKind === "mta";

  const clientLabel = isSamp || isInfoClient
    ? {
        samp: t("details.clientBadge.samp"),
        fivem: t("details.clientBadge.fivem"),
        mta: t("details.clientBadge.mta"),
      }[clientKind]
    : null;

  // The stored values are the baseline; the fields are free to drift from them.
  const baseline = useMemo(
    () => ({
      executable: game.executable,
      argsText: stringifyArgs(game.args),
      workDir: game.workDir ?? "",
      envText: stringifyEnv(game.env),
      host: game.client?.host ?? "",
      port: game.client?.port?.toString() ?? "",
      nick: game.client?.nick ?? "",
    }),
    [
      game.executable,
      game.args,
      game.workDir,
      game.env,
      game.client?.host,
      game.client?.port,
      game.client?.nick,
    ],
  );

  const [executable, setExecutable] = useState(baseline.executable);
  const [argsText, setArgsText] = useState(baseline.argsText);
  const [workDir, setWorkDir] = useState(baseline.workDir);
  const [envText, setEnvText] = useState(baseline.envText);
  const [host, setHost] = useState(baseline.host);
  const [port, setPort] = useState(baseline.port);
  const [nick, setNick] = useState(baseline.nick);

  // Opening a different entry always starts from its stored options. The
  // baseline is deliberately not a dependency: this resets on identity change
  // only, so an in-flight refresh cannot discard what is being typed.
  useEffect(() => {
    setExecutable(baseline.executable);
    setArgsText(baseline.argsText);
    setWorkDir(baseline.workDir);
    setEnvText(baseline.envText);
    setHost(baseline.host);
    setPort(baseline.port);
    setNick(baseline.nick);
  }, [game.id]);

  const dirty =
    executable !== baseline.executable ||
    argsText !== baseline.argsText ||
    workDir !== baseline.workDir ||
    envText !== baseline.envText ||
    host !== baseline.host ||
    port !== baseline.port ||
    nick !== baseline.nick;

  // An external change (another view, an event) is applied only while the
  // editor is untouched, so nothing overwrites what is being typed.
  useEffect(() => {
    if (dirty) return;
    setExecutable(baseline.executable);
    setArgsText(baseline.argsText);
    setWorkDir(baseline.workDir);
    setEnvText(baseline.envText);
    setHost(baseline.host);
    setPort(baseline.port);
    setNick(baseline.nick);
  }, [baseline, dirty]);

  const args = useMemo(() => parseArgs(argsText), [argsText]);
  const env = useMemo(() => parseEnvLines(envText), [envText]);
  const argsIssue = args.issue ? describeIssue(args.issue, t) : null;
  const envIssue = env.issue ? describeIssue(env.issue, t) : null;
  const executableIssue = executable.trim() === "" ? t("details.executableRequired") : null;

  const portNumber = port.trim() === "" ? null : Number(port);
  const portIssue =
    port.trim() !== "" &&
    (Number.isNaN(portNumber!) || portNumber! < 1 || portNumber! > 65535)
      ? t("details.client.portInvalid")
      : null;

  const invalid =
    argsIssue !== null || envIssue !== null || executableIssue !== null || portIssue !== null;

  const reset = useCallback(() => {
    setExecutable(baseline.executable);
    setArgsText(baseline.argsText);
    setWorkDir(baseline.workDir);
    setEnvText(baseline.envText);
    setHost(baseline.host);
    setPort(baseline.port);
    setNick(baseline.nick);
  }, [baseline]);

  const save = useCallback(async () => {
    if (invalid) return;
    const patch: Parameters<typeof updateGame>[1] = {
      executable: executable.trim(),
      args: args.value,
      workDir: workDir.trim() === "" ? null : workDir.trim(),
      env: env.value,
    };
    if (game.client !== null) {
      patch.client = {
        kind: game.client.kind,
        host: host.trim() === "" ? null : host.trim(),
        port: portNumber,
        nick: nick.trim() === "" ? null : nick.trim(),
      };
    }
    const updated = await updateGame(game.id, patch);
    if (updated !== null) toastSuccess(t("details.optionsSaved"));
  }, [
    args.value,
    env.value,
    executable,
    game.client,
    game.id,
    host,
    invalid,
    nick,
    portNumber,
    t,
    updateGame,
    workDir,
  ]);

  const envEntries = Object.entries(env.value);

  return (
    <section className={page.panel}>
      <div className={page.panelHead}>
        <div className={page.panelText}>
          <h2 className="sectionTitle">{t("details.launchOptions")}</h2>
          <p className="sectionHint">{t("details.launchOptionsDescription")}</p>
        </div>
        <div className={page.panelActions}>
          {dirty ? (
            <span className="sectionHint">{t("details.unsaved")}</span>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            icon={RotateCcw}
            disabled={!dirty || saving}
            onClick={reset}
          >
            {t("details.revertChanges")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={Save}
            loading={saving}
            disabled={!dirty || invalid}
            onClick={() => void save()}
          >
            {t("details.saveOptions")}
          </Button>
        </div>
      </div>

      <div className={page.fields}>
        <TextField
          label={t("details.executable")}
          hint={t("details.executableHint")}
          error={executableIssue}
          mono
          value={executable}
          spellCheck={false}
          onChange={(event) => setExecutable(event.target.value)}
        />

        <TextAreaField
          label={t("details.args")}
          hint={t("details.argsHint")}
          error={argsIssue}
          mono
          rows={2}
          value={argsText}
          spellCheck={false}
          onChange={(event) => setArgsText(event.target.value)}
        />

        <div className={styles.preview}>
          <span className={styles.previewLabel}>{t("details.argsPreview")}</span>
          {args.value.length === 0 ? (
            <span className={styles.previewEmpty}>{t("details.argsPreviewEmpty")}</span>
          ) : (
            <span className={styles.previewChips}>
              {args.value.map((argument, index) => (
                <Chip key={`${argument}-${index}`}>{argument}</Chip>
              ))}
            </span>
          )}
        </div>

        <TextField
          label={t("details.workDir")}
          hint={t("details.workDirHint")}
          placeholder={t("details.workDirPlaceholder")}
          mono
          value={workDir}
          spellCheck={false}
          onChange={(event) => setWorkDir(event.target.value)}
        />

        <TextAreaField
          label={t("details.env")}
          hint={t("details.envHint")}
          error={envIssue}
          mono
          rows={3}
          value={envText}
          spellCheck={false}
          onChange={(event) => setEnvText(event.target.value)}
        />

        <div className={styles.preview}>
          <span className={styles.previewLabel}>{t("details.envPreview")}</span>
          {envEntries.length === 0 ? (
            <span className={styles.previewEmpty}>{t("details.envPreviewEmpty")}</span>
          ) : (
            <span className={styles.envList}>
              {envEntries.map(([key, value]) => (
                <span className={styles.envRow} key={key}>
                  <span className={styles.envKey}>{key}</span>
                  <span className={styles.envValue}>{value === "" ? "—" : value}</span>
                </span>
              ))}
            </span>
          )}
        </div>

        {game.client !== null ? (
          <div className={styles.clientGroup}>
            <h3 className={styles.subTitle}>{clientLabel}</h3>
            {isSamp ? (
              <>
                <TextField
                  label={t("details.client.host")}
                  mono
                  value={host}
                  spellCheck={false}
                  onChange={(event) => setHost(event.target.value)}
                />
                <TextField
                  label={t("details.client.port")}
                  hint={t("details.client.portHint")}
                  error={portIssue}
                  mono
                  type="number"
                  min="1"
                  max="65535"
                  value={port}
                  spellCheck={false}
                  onChange={(event) => setPort(event.target.value)}
                />
                <TextField
                  label={t("details.client.nick")}
                  mono
                  value={nick}
                  spellCheck={false}
                  onChange={(event) => setNick(event.target.value)}
                />
              </>
            ) : (
              <div className={styles.clientInfo}>
                <Badge tone="info">{clientLabel}</Badge>
                <span>{t(clientKind === "fivem" ? "details.client.fivem" : "details.client.mta")}</span>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
