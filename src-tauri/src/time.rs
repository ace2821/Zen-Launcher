//! Timestamp helpers. Contract: ISO-8601 UTC strings (`"2026-10-17T13:00:00Z"`).

use chrono::{DateTime, SecondsFormat, Utc};

/// Current time as an ISO-8601 UTC string with second precision.
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Parse an ISO-8601 timestamp produced by [`now_iso`].
pub fn parse_iso(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
}

/// Whole seconds between `started_at` and now (never negative).
pub fn elapsed_seconds_since(started_at: &str) -> i64 {
    match parse_iso(started_at) {
        Some(start) => (Utc::now() - start).num_seconds().max(0),
        None => 0,
    }
}
