//! Calls to Claude through the Claude Code CLI (`claude -p`), so requests run on the
//! person's Claude subscription instead of an API key. Used only when no API key is set
//! and the person chose to use their subscription; a Claude Code login alone is not enough.
//! Undertext never signs anyone in: people sign in to Claude Code themselves, and the
//! app only uses that login once they opt in. Account details stay on the Rust side.

use crate::ai::AiRequest;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::Manager;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const TIMEOUT: Duration = Duration::from_secs(180);
const NOT_CONNECTED: &str = "no_key: Sign in to Claude Code or add an Anthropic API key first.";
/// Present in the app's config folder once the person chooses to use their subscription.
const CHOICE_FILE: &str = "use-claude-subscription";

fn choice_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(CHOICE_FILE))
}

pub fn enabled(app: &tauri::AppHandle) -> bool {
    choice_file(app).is_some_and(|path| path.is_file())
}

/// Turns the subscription on or off for Undertext. This never signs Claude Code in or out.
#[tauri::command]
pub fn claude_code_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let path = choice_file(&app).ok_or("api: Could not find the app's settings folder.")?;
    let result = if enabled {
        std::fs::create_dir_all(path.parent().expect("config dir"))
            .and_then(|()| std::fs::write(&path, ""))
    } else {
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    };
    result.map_err(|e| format!("api: Could not save the setting ({e})."))
}

/// Apps opened from Finder get a minimal PATH, so look in the usual install places first.
fn claude_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("CLAUDE_PATH") {
        return Some(PathBuf::from(path));
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    let mut candidates = vec![
        home.join(".local/bin/claude"),
        home.join(".claude/local/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ];
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join("claude")));
    }
    candidates.into_iter().find(|path| path.is_file())
}

/// A `claude` command that uses the subscription login, outside any project folder.
fn claude_command(claude: &Path) -> Command {
    let mut command = Command::new(claude);
    // An API key in the environment would take priority over the subscription login.
    command
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("ANTHROPIC_AUTH_TOKEN")
        .current_dir(std::env::temp_dir())
        .kill_on_drop(true);
    command
}

fn start_error(e: std::io::Error) -> String {
    format!("api: Could not start Claude Code ({e}).")
}

#[derive(Serialize, Default)]
pub struct Status {
    installed: bool,
    /// Claude Code is signed in.
    connected: bool,
    /// The person chose to use their subscription in Undertext.
    enabled: bool,
    /// "pro", "max", … when connected with a Claude subscription
    plan: Option<String>,
}

#[tauri::command]
pub async fn claude_code_status(app: tauri::AppHandle) -> Status {
    let enabled = enabled(&app);
    let Some(claude) = claude_path() else {
        return Status {
            enabled,
            ..Status::default()
        };
    };
    let output = claude_command(&claude)
        .args(["auth", "status", "--json"])
        .output()
        .await;
    let status: Value = output
        .ok()
        .and_then(|o| serde_json::from_slice(&o.stdout).ok())
        .unwrap_or_default();
    Status {
        installed: true,
        connected: status["loggedIn"] == true,
        enabled,
        plan: status["subscriptionType"].as_str().map(String::from),
    }
}

fn args(request: &AiRequest, model: &str) -> Vec<String> {
    [
        "-p",
        "--output-format",
        "json",
        "--model",
        model,
        "--effort",
        &request.effort,
        "--system-prompt",
        &request.system,
        "--json-schema",
        &request.schema.to_string(),
        // A plain question and answer: no tools, MCP servers, settings, or saved sessions.
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--safe-mode",
        "--no-session-persistence",
    ]
    .map(String::from)
    .to_vec()
}

/// Runs one request. Errors use the same codes as the API path.
pub async fn request(request: &AiRequest, model: &str) -> Result<Value, String> {
    let claude = claude_path().ok_or(NOT_CONNECTED)?;
    let mut child = claude_command(&claude)
        .args(args(request, model))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(start_error)?;

    // The prompt holds the whole document, so it goes through stdin rather than the arguments.
    let mut stdin = child.stdin.take().expect("piped stdin");
    stdin
        .write_all(request.prompt.as_bytes())
        .await
        .map_err(|e| format!("api: {e}"))?;
    drop(stdin);

    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "network: Claude took too long to answer. Try again.".to_string())?
        .map_err(|e| format!("api: {e}"))?;

    match serde_json::from_slice::<Value>(&output.stdout) {
        Ok(result) => parse_result(&result),
        Err(_) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(classify(
                stderr
                    .trim()
                    .lines()
                    .last()
                    .unwrap_or("Claude Code failed."),
            ))
        }
    }
}

fn classify(message: &str) -> String {
    let lower = message.to_lowercase();
    if lower.contains("not logged in") || lower.contains("/login") {
        NOT_CONNECTED.to_string()
    } else if lower.contains("limit") {
        format!("api: You hit your plan's usage limit. ({message})")
    } else {
        format!("api: {message}")
    }
}

fn parse_result(result: &Value) -> Result<Value, String> {
    if result["is_error"] == true || result["subtype"] != "success" {
        return Err(classify(
            result["result"]
                .as_str()
                .unwrap_or("Claude Code reported an error."),
        ));
    }
    if result["stop_reason"] == "refusal" {
        return Err("refused: Claude declined this request.".into());
    }
    match &result["structured_output"] {
        Value::Null => Err("api: Claude's answer did not match the expected format.".into()),
        answer => Ok(answer.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request() -> AiRequest {
        AiRequest {
            system: "sys".into(),
            prompt: "hi".into(),
            schema: json!({"type": "object"}),
            effort: "low".into(),
            max_tokens: 1000,
        }
    }

    #[test]
    fn passes_model_effort_and_schema() {
        let args = args(&request(), "claude-opus-5-5");
        let after = |flag: &str| &args[args.iter().position(|a| a == flag).unwrap() + 1];
        assert_eq!(after("--model"), "claude-opus-5-5");
        assert_eq!(after("--effort"), "low");
        assert_eq!(after("--json-schema"), r#"{"type":"object"}"#);
        assert_eq!(after("--tools"), "");
    }

    #[test]
    fn reads_structured_output() {
        let result = json!({
            "type": "result", "subtype": "success", "is_error": false, "stop_reason": "end_turn",
            "result": "{\"alternatives\":[\"a\",\"b\"]}",
            "structured_output": {"alternatives": ["a", "b"]}
        });
        assert_eq!(parse_result(&result).unwrap()["alternatives"][1], "b");
    }

    #[test]
    fn reports_errors_and_refusals() {
        let not_logged_in = json!({"subtype": "success", "is_error": true, "result": "Not logged in · Please run /login"});
        assert!(parse_result(&not_logged_in)
            .unwrap_err()
            .starts_with("no_key:"));
        let refusal = json!({"subtype": "success", "is_error": false, "stop_reason": "refusal"});
        assert!(parse_result(&refusal).unwrap_err().starts_with("refused:"));
    }

    /// Calls Claude for real on the logged-in subscription. Run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn answers_through_the_cli() {
        let request = AiRequest {
            schema: json!({
                "type": "object", "additionalProperties": false, "required": ["alternatives"],
                "properties": {"alternatives": {"type": "array", "items": {"type": "string"}}}
            }),
            prompt: "Give 3 alternatives for the word 'struggle'.".into(),
            ..request()
        };
        let answer =
            tauri::async_runtime::block_on(super::request(&request, "claude-opus-5-5")).unwrap();
        assert!(!answer["alternatives"].as_array().unwrap().is_empty());
    }
}
