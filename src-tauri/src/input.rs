//! Gamepad bridge: a `gilrs` polling thread turns evdev-style controller
//! events into console-menu navigation events for the webview.
//!
//! Design (see `docs/INTERFACES.md` → "Gamepad & Big Picture"):
//! - every button press/release is forwarded as `gamepad-event` with the
//!   gilrs `Button` debug name (`South`, `DPadUp`, ...);
//! - left-stick movement is reduced to synthetic 4-way axis events with a
//!   120 ms held-repeat cadence so the UI gets dpad-like navigation instead
//!   of a stream of raw samples.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use gilrs::{Axis, EventType, GamepadId, Gilrs};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Event bus name for gamepad navigation.
pub const EVENT: &str = "gamepad-event";
/// Stick deflection needed to count as a direction press.
pub const STICK_THRESHOLD: f32 = 0.55;
/// Stick deflection below which a held direction is released.
const STICK_RELEASE: f32 = 0.40;
/// Re-fire cadence while a stick direction is held.
const STICK_REPEAT: Duration = Duration::from_millis(120);
/// Sleep between poll sweeps when no events are pending.
const POLL_IDLE: Duration = Duration::from_millis(8);

/// One navigation event on the bus. `kind` distinguishes real button edges
/// from synthetic stick directions; `code` uses gilrs debug names.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamepadEvent {
    pub kind: &'static str,
    pub pad: u64,
    pub name: Option<String>,
    pub code: String,
}

/// Connected-pad snapshot for `list_gamepads` (layout auto-detection).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamepadInfo {
    pub id: u64,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Default)]
struct StickState {
    held: Option<&'static str>,
    last_emitted: Option<Instant>,
}

/// Launch the polling thread. Best-effort: without a working gilrs back
/// end the launcher simply runs without gamepad support.
pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("gamepad-bridge".into())
        .spawn(move || run(app))
        .ok();
}

fn run(app: AppHandle) {
    let mut gilrs = match Gilrs::new() {
        Ok(gilrs) => gilrs,
        Err(err) => {
            tracing::warn!("gamepad bridge disabled: {err:?}");
            return;
        }
    };
    tracing::info!("gamepad bridge started");

    let mut sticks: HashMap<GamepadId, StickState> = HashMap::new();
    loop {
        while let Some(event) = gilrs.next_event() {
            let pad = event.id;
            match event.event {
                EventType::ButtonPressed(button, _) => {
                    emit(
                        &app,
                        EventKind::Press,
                        pad,
                        pad_name(&gilrs, pad),
                        &format!("{button:?}"),
                    );
                }
                EventType::ButtonReleased(button, _) => {
                    emit(
                        &app,
                        EventKind::Release,
                        pad,
                        pad_name(&gilrs, pad),
                        &format!("{button:?}"),
                    );
                }
                EventType::AxisChanged(axis, value, _) => {
                    handle_axis(&app, &gilrs, &mut sticks, pad, axis, value);
                }
                _ => {}
            }
        }
        std::thread::sleep(POLL_IDLE);
    }
}

fn pad_name(gilrs: &Gilrs, pad: GamepadId) -> Option<String> {
    Some(gilrs.gamepad(pad).name().to_string())
}

enum EventKind {
    Press,
    Release,
}

fn emit(app: &AppHandle, kind: EventKind, pad: GamepadId, name: Option<String>, code: &str) {
    let kind = match kind {
        EventKind::Press => "button-press",
        EventKind::Release => "button-release",
    };
    let payload = GamepadEvent {
        kind,
        pad: usize::from(pad) as u64,
        name,
        code: code.to_string(),
    };
    if let Err(err) = app.emit(EVENT, &payload) {
        tracing::warn!("could not emit gamepad event: {err}");
    }
}

/// Collapse analog stick movement into dpad-like repeats.
fn handle_axis(
    app: &AppHandle,
    gilrs: &Gilrs,
    sticks: &mut HashMap<GamepadId, StickState>,
    pad: GamepadId,
    axis: Axis,
    value: f32,
) {
    if !matches!(axis, Axis::LeftStickX | Axis::LeftStickY) {
        return;
    }
    let dir = axis_direction(axis, value);

    let state = sticks.entry(pad).or_default();
    match dir {
        None => {
            // Release the held direction once the stick is back near center
            // so the next flick starts a fresh press.
            if value.abs() < STICK_RELEASE {
                state.held = None;
                state.last_emitted = None;
            }
        }
        Some(code) => {
            let now = Instant::now();
            let fresh = state.held != Some(code);
            if fresh
                || state
                    .last_emitted
                    .is_none_or(|last| now.duration_since(last) >= STICK_REPEAT)
            {
                emit(app, EventKind::Press, pad, pad_name(gilrs, pad), code);
                if fresh {
                    state.held = Some(code);
                }
                state.last_emitted = Some(now);
            }
        }
    }
}

fn axis_direction(axis: Axis, value: f32) -> Option<&'static str> {
    if value.abs() < STICK_THRESHOLD {
        return None;
    }
    let positive = value > 0.0;
    Some(match (axis, positive) {
        (Axis::LeftStickX, false) => "AxisLeft",
        (Axis::LeftStickX, true) => "AxisRight",
        (Axis::LeftStickY, true) => "AxisUp",
        (Axis::LeftStickY, false) => "AxisDown",
        _ => return None,
    })
}

/// Snapshot connected pads for the UI (Big Picture layout auto-detection).
pub fn list_gamepads() -> Vec<GamepadInfo> {
    let mut out = Vec::new();
    if let Ok(gilrs) = Gilrs::new() {
        for (id, pad) in gilrs.gamepads() {
            let name = pad.name().to_string();
            out.push(GamepadInfo {
                id: usize::from(id) as u64,
                kind: pad_kind(&name).to_string(),
                name,
            });
        }
    }
    out.sort_by_key(|pad| pad.id);
    out
}

/// Infer the glyph family from the device name (`settings.bigPictureLayout`
/// = "auto" lets the UI pick this).
pub fn pad_kind(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase().replace("x-box", "xbox");
    if lower.contains("dualshock")
        || lower.contains("dualsense")
        || lower.contains("playstation")
        || lower.contains("sony")
    {
        "playstation"
    } else if lower.contains("xbox")
        || lower.contains("xinput")
        || lower.contains("x360")
        || lower.contains("xpad")
    {
        "xbox"
    } else {
        "unknown"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pad_kind_matches_console_families() {
        assert_eq!(pad_kind("X-Box 360 Controller"), "xbox");
        assert_eq!(pad_kind("Xbox Series X Controller"), "xbox");
        assert_eq!(
            pad_kind("Sony Interactive Entertainment DualSense Wireless Controller"),
            "playstation"
        );
        assert_eq!(pad_kind("8BitDo Pro 2"), "unknown");
    }
}
