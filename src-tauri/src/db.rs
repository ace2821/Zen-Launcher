//! SQLite persistence. WAL mode, foreign keys on, versioned migrations in
//! `schema_migrations`. Schema mirrors `docs/INTERFACES.md` (migration v1).
//!
//! Every function takes a `&Connection`; callers own the locking. Commands must
//! never hold the connection mutex across long operations (scan, spawn, wait).

use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::error::{AppError, AppResult};
use crate::models::{
    Candidate, CandidateStatus, ClientInfo, EngineKind, Game, GamePatch, GameStatus, GameType, Session,
    Source,
};
use crate::time::now_iso;

pub const MIGRATION_V1: &str = r#"
CREATE TABLE sources(
    id INTEGER PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    auto_scan INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_scan_at TEXT
);
CREATE TABLE candidates(
    id INTEGER PRIMARY KEY,
    source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
    path TEXT NOT NULL,
    executable TEXT,
    engine TEXT NOT NULL DEFAULT 'unknown',
    suggested_title TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    evidence_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
);
CREATE TABLE games(
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    sort_title TEXT,
    type TEXT NOT NULL DEFAULT 'native',
    install_path TEXT NOT NULL,
    executable TEXT NOT NULL,
    args_json TEXT NOT NULL DEFAULT '[]',
    env_json TEXT NOT NULL DEFAULT '{}',
    work_dir TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    favorite INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    cover_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_played_at TEXT,
    total_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sessions(
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_seconds INTEGER,
    exit_code INTEGER
);
-- Supporting indexes (do not change the documented table shapes).
CREATE UNIQUE INDEX idx_candidates_source_path ON candidates(source_id, path);
CREATE INDEX idx_sessions_game_id ON sessions(game_id);
"#;

pub const SCHEMA_VERSION: i64 = 2;

/// v2: client adapter metadata on library entries (`ClientInfo` as JSON).
pub const MIGRATION_V2: &str = r#"
ALTER TABLE games ADD COLUMN client TEXT NULL;
"#;

// ---------------------------------------------------------------------------
// Connection & migrations
// ---------------------------------------------------------------------------

/// Open a connection at `path`, applying pragmas and migrations.
pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

/// WAL + foreign keys + busy timeout. Safe for in-memory databases too (WAL is
/// silently unavailable there).
pub fn configure(conn: &Connection) -> AppResult<()> {
    // `PRAGMA journal_mode` returns a row, so it cannot go through execute().
    let _mode: String = conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;
    conn.busy_timeout(Duration::from_millis(5_000))?;
    Ok(())
}

/// Apply pending migrations, recording each in `schema_migrations`.
pub fn migrate(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations(
             version INTEGER PRIMARY KEY,
             applied_at TEXT NOT NULL
         );",
    )?;

    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;

    if current < 1 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(MIGRATION_V1)?;
        tx.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?1)",
            params![now_iso()],
        )?;
        tx.commit()?;
        tracing::info!("applied database migration v1");
    }

    if current < 2 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(MIGRATION_V2)?;
        tx.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?1)",
            params![now_iso()],
        )?;
        tx.commit()?;
        tracing::info!("applied database migration v2");
    }

    Ok(())
}

/// Highest applied migration version (0 when none).
pub fn schema_version(conn: &Connection) -> AppResult<i64> {
    let version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    Ok(version)
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

fn encode_json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

fn decode_json<T: serde::de::DeserializeOwned + Default>(raw: &str) -> T {
    serde_json::from_str(raw).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

fn map_source(row: &Row<'_>) -> rusqlite::Result<Source> {
    Ok(Source {
        id: row.get("id")?,
        path: row.get("path")?,
        auto_scan: row.get::<_, i64>("auto_scan")? != 0,
        created_at: row.get("created_at")?,
        last_scan_at: row.get("last_scan_at")?,
    })
}

fn map_candidate(row: &Row<'_>) -> rusqlite::Result<Candidate> {
    let engine_raw: String = row.get("engine")?;
    let status_raw: String = row.get("status")?;
    let evidence_raw: String = row.get("evidence_json")?;
    Ok(Candidate {
        id: row.get("id")?,
        source_id: row.get("source_id")?,
        path: row.get("path")?,
        executable: row.get("executable")?,
        engine: EngineKind::parse(&engine_raw).unwrap_or(EngineKind::Unknown),
        suggested_title: row.get("suggested_title")?,
        confidence: row.get("confidence")?,
        evidence: decode_json(&evidence_raw),
        status: CandidateStatus::parse(&status_raw).unwrap_or(CandidateStatus::Pending),
        created_at: row.get("created_at")?,
    })
}

fn map_game(row: &Row<'_>) -> rusqlite::Result<Game> {
    let type_raw: String = row.get("type")?;
    let args_raw: String = row.get("args_json")?;
    let env_raw: String = row.get("env_json")?;
    let tags_raw: String = row.get("tags_json")?;
    let executable: String = row.get("executable")?;
    let install_path: String = row.get("install_path")?;
    let client_raw: Option<String> = row.get("client")?;

    let status = if resolve_executable(&install_path, &executable).exists() {
        GameStatus::Ready
    } else {
        GameStatus::Missing
    };

    Ok(Game {
        id: row.get("id")?,
        title: row.get("title")?,
        sort_title: row.get("sort_title")?,
        game_type: GameType::parse(&type_raw).unwrap_or(GameType::Native),
        install_path,
        executable,
        args: decode_json(&args_raw),
        env: decode_json::<BTreeMap<String, String>>(&env_raw),
        work_dir: row.get("work_dir")?,
        tags: decode_json(&tags_raw),
        favorite: row.get::<_, i64>("favorite")? != 0,
        hidden: row.get::<_, i64>("hidden")? != 0,
        notes: row.get("notes")?,
        cover_path: row.get("cover_path")?,
        client: client_raw.and_then(|raw| serde_json::from_str(&raw).ok()),
        status,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_played_at: row.get("last_played_at")?,
        total_seconds: row.get("total_seconds")?,
    })
}

fn map_session(row: &Row<'_>) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get("id")?,
        game_id: row.get("game_id")?,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
        duration_seconds: row.get("duration_seconds")?,
        exit_code: row.get("exit_code")?,
    })
}

/// Resolve a stored executable into an absolute path (relative entries are
/// resolved against the install path).
pub fn resolve_executable(install_path: &str, executable: &str) -> std::path::PathBuf {
    let exe = std::path::Path::new(executable);
    if exe.is_absolute() {
        exe.to_path_buf()
    } else {
        std::path::Path::new(install_path).join(exe)
    }
}

const SOURCE_COLUMNS: &str = "id, path, auto_scan, created_at, last_scan_at";
const CANDIDATE_COLUMNS: &str = "id, source_id, path, executable, engine, suggested_title, confidence, evidence_json, status, created_at";
const GAME_COLUMNS: &str = "id, title, sort_title, type, install_path, executable, args_json, env_json, \
     work_dir, tags_json, favorite, hidden, notes, cover_path, client, created_at, updated_at, last_played_at, total_seconds";
const SESSION_COLUMNS: &str = "id, game_id, started_at, ended_at, duration_seconds, exit_code";

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

pub fn insert_source(conn: &Connection, path: &str, auto_scan: bool) -> AppResult<Source> {
    conn.execute(
        "INSERT INTO sources(path, auto_scan, created_at, last_scan_at) VALUES (?1, ?2, ?3, NULL)",
        params![path, i64::from(auto_scan), now_iso()],
    )?;
    get_source(conn, conn.last_insert_rowid())
}

pub fn find_source_by_path(conn: &Connection, path: &str) -> AppResult<Option<Source>> {
    let sql = format!("SELECT {SOURCE_COLUMNS} FROM sources WHERE path = ?1");
    Ok(conn.query_row(&sql, params![path], map_source).optional()?)
}

pub fn list_sources(conn: &Connection) -> AppResult<Vec<Source>> {
    let sql = format!("SELECT {SOURCE_COLUMNS} FROM sources ORDER BY path COLLATE NOCASE ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_source)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_source(conn: &Connection, id: i64) -> AppResult<Source> {
    let sql = format!("SELECT {SOURCE_COLUMNS} FROM sources WHERE id = ?1");
    conn.query_row(&sql, params![id], map_source)
        .optional()?
        .ok_or_else(|| AppError::not_found(format!("source {id} does not exist")))
}

pub fn delete_source(conn: &Connection, id: i64) -> AppResult<()> {
    // Candidates stay: the FK detaches them (ON DELETE SET NULL), so removing a
    // root never destroys pending discoveries. Games are independent library
    // entries and are never touched.
    let affected = conn.execute("DELETE FROM sources WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(AppError::not_found(format!("source {id} does not exist")));
    }
    Ok(())
}

pub fn touch_source_last_scan(conn: &Connection, id: i64, timestamp: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE sources SET last_scan_at = ?2 WHERE id = ?1",
        params![id, timestamp],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/// A freshly detected candidate produced by the scanner.
#[derive(Debug, Clone, PartialEq)]
pub struct NewCandidate {
    pub path: String,
    pub executable: Option<String>,
    pub engine: EngineKind,
    pub suggested_title: String,
    pub confidence: f64,
    pub evidence: Vec<String>,
}

/// Insert a pending candidate, or refresh an existing *pending* row for the same
/// `(source_id, path)`. Approved/rejected rows are preserved. Returns `true`
/// when a new row was inserted.
pub fn upsert_pending_candidate(
    conn: &Connection,
    source_id: i64,
    candidate: &NewCandidate,
) -> AppResult<bool> {
    let existing: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, status FROM candidates WHERE source_id = ?1 AND path = ?2",
            params![source_id, candidate.path],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let evidence = encode_json(&candidate.evidence);

    match existing {
        Some((_, status)) if status != CandidateStatus::Pending.as_str() => Ok(false),
        Some((id, _)) => {
            conn.execute(
                "UPDATE candidates SET executable = ?2, engine = ?3, suggested_title = ?4, \
                 confidence = ?5, evidence_json = ?6 WHERE id = ?1",
                params![
                    id,
                    candidate.executable,
                    candidate.engine.as_str(),
                    candidate.suggested_title,
                    candidate.confidence,
                    evidence,
                ],
            )?;
            Ok(false)
        }
        None => {
            conn.execute(
                "INSERT INTO candidates(source_id, path, executable, engine, suggested_title, \
                 confidence, evidence_json, status, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8)",
                params![
                    source_id,
                    candidate.path,
                    candidate.executable,
                    candidate.engine.as_str(),
                    candidate.suggested_title,
                    candidate.confidence,
                    evidence,
                    now_iso(),
                ],
            )?;
            Ok(true)
        }
    }
}

pub fn list_candidates(
    conn: &Connection,
    status: Option<CandidateStatus>,
) -> AppResult<Vec<Candidate>> {
    let mut candidates = Vec::new();
    match status {
        Some(status) => {
            let sql = format!(
                "SELECT {CANDIDATE_COLUMNS} FROM candidates WHERE status = ?1 \
                 ORDER BY confidence DESC, suggested_title COLLATE NOCASE ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![status.as_str()], map_candidate)?;
            for row in rows {
                candidates.push(row?);
            }
        }
        None => {
            let sql = format!(
                "SELECT {CANDIDATE_COLUMNS} FROM candidates \
                 ORDER BY confidence DESC, suggested_title COLLATE NOCASE ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], map_candidate)?;
            for row in rows {
                candidates.push(row?);
            }
        }
    }
    Ok(candidates)
}

pub fn get_candidate(conn: &Connection, id: i64) -> AppResult<Candidate> {
    let sql = format!("SELECT {CANDIDATE_COLUMNS} FROM candidates WHERE id = ?1");
    conn.query_row(&sql, params![id], map_candidate)
        .optional()?
        .ok_or_else(|| AppError::not_found(format!("candidate {id} does not exist")))
}

pub fn set_candidate_status(conn: &Connection, id: i64, status: CandidateStatus) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE candidates SET status = ?2 WHERE id = ?1",
        params![id, status.as_str()],
    )?;
    if affected == 0 {
        return Err(AppError::not_found(format!(
            "candidate {id} does not exist"
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

/// Input for `insert_game`; all optional bits already defaulted by the caller.
#[derive(Debug, Clone)]
pub struct NewGame {
    pub title: String,
    pub sort_title: Option<String>,
    pub game_type: GameType,
    pub install_path: String,
    pub executable: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub work_dir: Option<String>,
    pub tags: Vec<String>,
    pub client: Option<ClientInfo>,
}

pub fn insert_game(conn: &Connection, game: &NewGame) -> AppResult<Game> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO games(title, sort_title, type, install_path, executable, args_json, env_json, \
         work_dir, tags_json, favorite, hidden, notes, cover_path, client, created_at, updated_at, \
         last_played_at, total_seconds) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 0, NULL, NULL, ?10, ?11, ?11, NULL, 0)",
        params![
            game.title,
            game.sort_title,
            game.game_type.as_str(),
            game.install_path,
            game.executable,
            encode_json(&game.args),
            encode_json(&game.env),
            game.work_dir,
            encode_json(&game.tags),
            game.client.as_ref().map(encode_json),
            now,
        ],
    )?;
    get_game(conn, conn.last_insert_rowid())
}

pub fn list_games(conn: &Connection) -> AppResult<Vec<Game>> {
    let sql = format!(
        "SELECT {GAME_COLUMNS} FROM games ORDER BY COALESCE(sort_title, title) COLLATE NOCASE ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_game)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_game(conn: &Connection, id: i64) -> AppResult<Game> {
    let sql = format!("SELECT {GAME_COLUMNS} FROM games WHERE id = ?1");
    conn.query_row(&sql, params![id], map_game)
        .optional()?
        .ok_or_else(|| AppError::not_found(format!("game {id} does not exist")))
}

pub fn find_game_by_install_path(conn: &Connection, install_path: &str) -> AppResult<Option<Game>> {
    let sql = format!("SELECT {GAME_COLUMNS} FROM games WHERE install_path = ?1");
    Ok(conn
        .query_row(&sql, params![install_path], map_game)
        .optional()?)
}

/// Approve-time lookup: games whose install path is exactly `path` or a parent
/// of `path`, used to skip already-approved subtrees while scanning.
pub fn approved_install_paths(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT install_path FROM games")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Apply a partial patch on top of the stored row. Absent fields keep their
/// value; `null` clears the nullable ones. Empty `title`/`executable` are
/// rejected; both are stored trimmed.
pub fn update_game(conn: &Connection, id: i64, patch: &GamePatch) -> AppResult<Game> {
    let mut game = get_game(conn, id)?;

    if let Some(title) = &patch.title {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::validation("a library entry needs a title"));
        }
        game.title = title.to_string();
    }
    if let Some(sort_title) = &patch.sort_title {
        game.sort_title = sort_title.clone();
    }
    if let Some(game_type) = patch.game_type {
        game.game_type = game_type;
    }
    if let Some(executable) = &patch.executable {
        let executable = executable.trim();
        if executable.is_empty() {
            return Err(AppError::validation("the executable path cannot be empty"));
        }
        game.executable = executable.to_string();
    }
    if let Some(args) = &patch.args {
        game.args = args.clone();
    }
    if let Some(env) = &patch.env {
        game.env = env.clone();
    }
    if let Some(work_dir) = &patch.work_dir {
        game.work_dir = work_dir.clone();
    }
    if let Some(tags) = &patch.tags {
        game.tags = tags.clone();
    }
    if let Some(favorite) = patch.favorite {
        game.favorite = favorite;
    }
    if let Some(hidden) = patch.hidden {
        game.hidden = hidden;
    }
    if let Some(notes) = &patch.notes {
        game.notes = notes.clone();
    }
    if let Some(cover_path) = &patch.cover_path {
        game.cover_path = cover_path.clone();
    }
    if let Some(client) = &patch.client {
        game.client = client.clone();
    }

    conn.execute(
        "UPDATE games SET title = ?2, sort_title = ?3, type = ?4, executable = ?5, args_json = ?6, \
         env_json = ?7, work_dir = ?8, tags_json = ?9, favorite = ?10, hidden = ?11, notes = ?12, \
         cover_path = ?13, client = ?14, updated_at = ?15 WHERE id = ?1",
        params![
            id,
            game.title,
            game.sort_title,
            game.game_type.as_str(),
            game.executable,
            encode_json(&game.args),
            encode_json(&game.env),
            game.work_dir,
            encode_json(&game.tags),
            i64::from(game.favorite),
            i64::from(game.hidden),
            game.notes,
            game.cover_path,
            game.client.as_ref().map(encode_json),
            now_iso(),
        ],
    )?;

    get_game(conn, id)
}

/// Library removal only — never touches files on disk. The entry's play
/// history goes with it (FK cascade), matching the UI's confirmation copy.
pub fn delete_game(conn: &Connection, id: i64) -> AppResult<()> {
    let affected = conn.execute("DELETE FROM games WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(AppError::not_found(format!("game {id} does not exist")));
    }
    Ok(())
}

pub fn record_game_played(
    conn: &Connection,
    id: i64,
    played_at: &str,
    added: i64,
) -> AppResult<()> {
    conn.execute(
        "UPDATE games SET last_played_at = ?2, total_seconds = total_seconds + ?3, updated_at = ?2 \
         WHERE id = ?1",
        params![id, played_at, added.max(0)],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

pub fn insert_session(conn: &Connection, game_id: i64, started_at: &str) -> AppResult<Session> {
    conn.execute(
        "INSERT INTO sessions(game_id, started_at, ended_at, duration_seconds, exit_code) \
         VALUES (?1, ?2, NULL, NULL, NULL)",
        params![game_id, started_at],
    )?;
    get_session(conn, conn.last_insert_rowid())
}

pub fn get_session(conn: &Connection, id: i64) -> AppResult<Session> {
    let sql = format!("SELECT {SESSION_COLUMNS} FROM sessions WHERE id = ?1");
    conn.query_row(&sql, params![id], map_session)
        .optional()?
        .ok_or_else(|| AppError::not_found(format!("session {id} does not exist")))
}

pub fn finish_session(
    conn: &Connection,
    id: i64,
    ended_at: &str,
    duration_seconds: i64,
    exit_code: Option<i64>,
) -> AppResult<()> {
    conn.execute(
        "UPDATE sessions SET ended_at = ?2, duration_seconds = ?3, exit_code = ?4 WHERE id = ?1",
        params![id, ended_at, duration_seconds.max(0), exit_code],
    )?;
    Ok(())
}

/// Remove a session row (used when the process fails to start).
pub fn delete_session(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
    Ok(())
}

/// Newest first. `limit` of `None` returns everything.
pub fn list_sessions(
    conn: &Connection,
    game_id: i64,
    limit: Option<i64>,
) -> AppResult<Vec<Session>> {
    let sessions = match limit {
        Some(limit) => {
            let sql = format!(
                "SELECT {SESSION_COLUMNS} FROM sessions WHERE game_id = ?1 \
                 ORDER BY started_at DESC, id DESC LIMIT ?2"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![game_id, limit.max(0)], map_session)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        }
        None => {
            let sql = format!(
                "SELECT {SESSION_COLUMNS} FROM sessions WHERE game_id = ?1 \
                 ORDER BY started_at DESC, id DESC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![game_id], map_session)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        }
    };
    Ok(sessions)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn open_temp() -> (tempfile::TempDir, Connection) {
        let dir = tempdir().unwrap();
        let conn = open(&dir.path().join("library.db")).unwrap();
        (dir, conn)
    }

    #[test]
    fn migrate_is_idempotent_and_versioned() {
        let (_dir, conn) = open_temp();
        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);
        // Running again must not fail or re-apply.
        migrate(&conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);

        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN \
                 ('sources','candidates','games','sessions','schema_migrations')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 5);
    }

    #[test]
    fn pragmas_are_applied() {
        let (_dir, conn) = open_temp();
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fk, 1);
        let journal: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal.to_lowercase(), "wal");
    }

    #[test]
    fn source_crud_roundtrip() {
        let (_dir, conn) = open_temp();
        let source = insert_source(&conn, "/games/root", false).unwrap();
        assert_eq!(source.path, "/games/root");
        assert!(!source.auto_scan);
        assert!(source.last_scan_at.is_none());

        assert_eq!(list_sources(&conn).unwrap(), vec![source.clone()]);
        assert_eq!(
            find_source_by_path(&conn, "/games/root").unwrap(),
            Some(source.clone())
        );

        touch_source_last_scan(&conn, source.id, "2026-10-17T13:00:00Z").unwrap();
        assert_eq!(
            get_source(&conn, source.id)
                .unwrap()
                .last_scan_at
                .as_deref(),
            Some("2026-10-17T13:00:00Z")
        );

        delete_source(&conn, source.id).unwrap();
        assert!(get_source(&conn, source.id).is_err());
        assert!(list_sources(&conn).unwrap().is_empty());
    }

    #[test]
    fn candidate_upsert_keeps_decisions() {
        let (_dir, conn) = open_temp();
        let source = insert_source(&conn, "/games", false).unwrap();
        let candidate = NewCandidate {
            path: "/games/Alpha".into(),
            executable: Some("/games/Alpha/alpha.x86_64".into()),
            engine: EngineKind::Unity,
            suggested_title: "Alpha".into(),
            confidence: 0.9,
            evidence: vec!["UnityPlayer.so".into()],
        };

        assert!(upsert_pending_candidate(&conn, source.id, &candidate).unwrap());
        // Second pass updates instead of duplicating.
        assert!(!upsert_pending_candidate(&conn, source.id, &candidate).unwrap());
        assert_eq!(list_candidates(&conn, None).unwrap().len(), 1);

        let stored = list_candidates(&conn, Some(CandidateStatus::Pending))
            .unwrap()
            .remove(0);
        set_candidate_status(&conn, stored.id, CandidateStatus::Approved).unwrap();
        assert!(!upsert_pending_candidate(&conn, source.id, &candidate).unwrap());
        assert_eq!(
            get_candidate(&conn, stored.id).unwrap().status,
            CandidateStatus::Approved
        );
        // The approved row survives re-scan.
        assert_eq!(list_candidates(&conn, None).unwrap().len(), 1);
    }

    #[test]
    fn migration_v2_adds_client_and_client_roundtrips() {
        use crate::models::{ClientInfo, ClientKind};

        // A v1 database (no `client` column) migrates to v2.
        let conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
        )
        .unwrap();
        conn.execute_batch(MIGRATION_V1).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (1, '2026-10-17T00:00:00Z')",
            [],
        )
        .unwrap();
        assert_eq!(schema_version(&conn).unwrap(), 1);
        migrate(&conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), 2);
        let has_client: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('games') WHERE name = 'client'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(has_client, 1);

        let dir = tempdir().unwrap();
        let executable = dir.path().join("gta_sa.exe");
        std::fs::write(&executable, b"MZ").unwrap();
        let game = insert_game(
            &conn,
            &NewGame {
                title: "GTA San Andreas".into(),
                sort_title: None,
                game_type: GameType::Windows,
                install_path: dir.path().to_string_lossy().into_owned(),
                executable: executable.to_string_lossy().into_owned(),
                args: vec![],
                env: BTreeMap::new(),
                work_dir: None,
                tags: vec![],
                client: Some(ClientInfo {
                    kind: ClientKind::Samp,
                    host: Some("play.example.com".into()),
                    port: Some(7777),
                    nick: Some("Zen".into()),
                }),
            },
        )
        .unwrap();
        let stored = get_game(&conn, game.id).unwrap();
        assert_eq!(stored.client.as_ref().unwrap().kind, ClientKind::Samp);
        assert_eq!(stored.client.as_ref().unwrap().port, Some(7777));

        // Omitted patch keeps the client; explicit null clears it.
        let kept = update_game(
            &conn,
            game.id,
            &GamePatch {
                title: Some("GTA:SA".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(kept.client, stored.client);

        let cleared = update_game(
            &conn,
            game.id,
            &GamePatch {
                client: Some(None),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(cleared.client, None);
    }

    #[test]
    fn game_crud_roundtrip() {
        let (_dir, conn) = open_temp();
        let dir = tempdir().unwrap();
        let executable = dir.path().join("game.x86_64");
        std::fs::write(&executable, b"x").unwrap();

        let new_game = NewGame {
            title: "Alpha".into(),
            sort_title: None,
            game_type: GameType::Native,
            install_path: dir.path().to_string_lossy().into_owned(),
            executable: executable.to_string_lossy().into_owned(),
            args: vec!["--fullscreen".into()],
            env: BTreeMap::from([("MANGOHUD".to_string(), "1".to_string())]),
            work_dir: None,
            tags: vec!["indie".into()],
            client: None,
        };
        let game = insert_game(&conn, &new_game).unwrap();
        assert_eq!(game.status, GameStatus::Ready);
        assert_eq!(game.args, vec!["--fullscreen".to_string()]);
        assert_eq!(game.env.get("MANGOHUD").unwrap(), "1");

        let patch = GamePatch {
            title: Some("Alpha Remastered".into()),
            favorite: Some(true),
            tags: Some(vec!["indie".into(), "puzzle".into()]),
            work_dir: Some(Some("/tmp/games".into())),
            notes: Some(Some("remember this".into())),
            ..Default::default()
        };
        let updated = update_game(&conn, game.id, &patch).unwrap();
        assert_eq!(updated.title, "Alpha Remastered");
        assert!(updated.favorite);
        assert_eq!(updated.tags.len(), 2);
        assert_eq!(updated.work_dir.as_deref(), Some("/tmp/games"));
        assert_eq!(updated.notes.as_deref(), Some("remember this"));

        assert_eq!(list_games(&conn).unwrap(), vec![updated.clone()]);

        // An explicit clear (`Some(None)`) empties a nullable field; fields that
        // are absent from the patch stay untouched.
        let cleared = update_game(
            &conn,
            game.id,
            &GamePatch {
                work_dir: Some(None),
                notes: Some(None),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(cleared.work_dir, None);
        assert_eq!(cleared.notes, None);
        assert!(cleared.favorite);
        assert_eq!(
            find_game_by_install_path(&conn, &new_game.install_path)
                .unwrap()
                .unwrap()
                .id,
            game.id
        );

        // Missing executable flips the computed status.
        std::fs::remove_file(&executable).unwrap();
        assert_eq!(
            get_game(&conn, game.id).unwrap().status,
            GameStatus::Missing
        );

        delete_game(&conn, game.id).unwrap();
        assert!(list_games(&conn).unwrap().is_empty());
    }

    #[test]
    fn session_roundtrip_newest_first() {
        let (_dir, conn) = open_temp();
        let dir = tempdir().unwrap();
        let executable = dir.path().join("game.x86_64");
        std::fs::write(&executable, b"x").unwrap();
        let game = insert_game(
            &conn,
            &NewGame {
                title: "Alpha".into(),
                sort_title: None,
                game_type: GameType::Native,
                install_path: dir.path().to_string_lossy().into_owned(),
                executable: executable.to_string_lossy().into_owned(),
                args: vec![],
                env: BTreeMap::new(),
                work_dir: None,
                tags: vec![],
                client: None,
            },
        )
        .unwrap();

        let first = insert_session(&conn, game.id, "2026-10-17T10:00:00Z").unwrap();
        let second = insert_session(&conn, game.id, "2026-10-17T12:00:00Z").unwrap();
        finish_session(&conn, first.id, "2026-10-17T10:30:00Z", 1800, Some(0)).unwrap();

        let sessions = list_sessions(&conn, game.id, None).unwrap();
        assert_eq!(sessions[0].id, second.id);
        assert_eq!(
            sessions[1].ended_at.as_deref(),
            Some("2026-10-17T10:30:00Z")
        );
        assert_eq!(sessions[1].duration_seconds, Some(1800));

        assert_eq!(list_sessions(&conn, game.id, Some(1)).unwrap().len(), 1);

        record_game_played(&conn, game.id, "2026-10-17T10:30:00Z", 1800).unwrap();
        let refreshed = get_game(&conn, game.id).unwrap();
        assert_eq!(refreshed.total_seconds, 1800);
        assert_eq!(
            refreshed.last_played_at.as_deref(),
            Some("2026-10-17T10:30:00Z")
        );
    }

    #[test]
    fn update_game_rejects_empty_title_and_executable() {
        let (_dir, conn) = open_temp();
        let dir = tempdir().unwrap();
        let executable = dir.path().join("game.x86_64");
        std::fs::write(&executable, b"x").unwrap();
        let game = insert_game(
            &conn,
            &NewGame {
                title: "Alpha".into(),
                sort_title: None,
                game_type: GameType::Native,
                install_path: dir.path().to_string_lossy().into_owned(),
                executable: executable.to_string_lossy().into_owned(),
                args: vec![],
                env: BTreeMap::new(),
                work_dir: None,
                tags: vec![],
                client: None,
            },
        )
        .unwrap();

        let err = update_game(
            &conn,
            game.id,
            &GamePatch {
                title: Some("   ".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(err.code, crate::error::VALIDATION);

        let err = update_game(
            &conn,
            game.id,
            &GamePatch {
                executable: Some("  ".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(err.code, crate::error::VALIDATION);

        // Refused patches leave the stored row untouched; accepted ones trim.
        assert_eq!(get_game(&conn, game.id).unwrap().title, "Alpha");
        let trimmed = update_game(
            &conn,
            game.id,
            &GamePatch {
                title: Some("  Trimmed  ".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(trimmed.title, "Trimmed");
    }

    #[test]
    fn remove_source_detaches_candidates_and_keeps_games() {
        let (_dir, conn) = open_temp();
        let source = insert_source(&conn, "/games/root", false).unwrap();
        let candidate = NewCandidate {
            path: "/games/root/Alpha".into(),
            executable: None,
            engine: EngineKind::Unknown,
            suggested_title: "Alpha".into(),
            confidence: 0.5,
            evidence: vec![],
        };
        assert!(upsert_pending_candidate(&conn, source.id, &candidate).unwrap());

        let dir = tempdir().unwrap();
        let executable = dir.path().join("game.x86_64");
        std::fs::write(&executable, b"x").unwrap();
        let game = insert_game(
            &conn,
            &NewGame {
                title: "Alpha".into(),
                sort_title: None,
                game_type: GameType::Native,
                install_path: dir.path().to_string_lossy().into_owned(),
                executable: executable.to_string_lossy().into_owned(),
                args: vec![],
                env: BTreeMap::new(),
                work_dir: None,
                tags: vec![],
                client: None,
            },
        )
        .unwrap();

        // Removing a root must succeed even with candidates attached: they stay,
        // detached; games are independent and untouched.
        delete_source(&conn, source.id).unwrap();

        let candidates = list_candidates(&conn, None).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].source_id, None);
        assert_eq!(get_game(&conn, game.id).unwrap().id, game.id);
        assert!(delete_source(&conn, source.id).is_err());
    }

    #[test]
    fn remove_game_drops_its_sessions() {
        let (_dir, conn) = open_temp();
        let dir = tempdir().unwrap();
        let executable = dir.path().join("game.x86_64");
        std::fs::write(&executable, b"x").unwrap();
        let game = insert_game(
            &conn,
            &NewGame {
                title: "Alpha".into(),
                sort_title: None,
                game_type: GameType::Native,
                install_path: dir.path().to_string_lossy().into_owned(),
                executable: executable.to_string_lossy().into_owned(),
                args: vec![],
                env: BTreeMap::new(),
                work_dir: None,
                tags: vec![],
                client: None,
            },
        )
        .unwrap();

        let session = insert_session(&conn, game.id, "2026-10-17T10:00:00Z").unwrap();
        finish_session(&conn, session.id, "2026-10-17T10:10:00Z", 600, Some(0)).unwrap();
        assert_eq!(list_sessions(&conn, game.id, None).unwrap().len(), 1);

        delete_game(&conn, game.id).unwrap();

        assert!(list_games(&conn).unwrap().is_empty());
        let orphans: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(orphans, 0);
    }
}
