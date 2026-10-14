//! Calls to the Claude API. The API key lives in the macOS Keychain (or the
//! ANTHROPIC_API_KEY environment variable during development) and never
//! reaches the web view: the page sends a prompt and a JSON schema, and gets
//! back the parsed JSON answer. Without a key, requests can go through Claude Code
//! on the person's Claude subscription instead, once they choose to (see `claude_code`).

use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const MODEL: &str = "claude-opus-5-5";
const KEYCHAIN_SERVICE: &str = "dev.ernesto.undertext";
const KEYCHAIN_USER: &str = "anthropic-api-key";
/// Re-run a declined request on Anthropic's recommended model for that category.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

pub struct AiClient(reqwest::Client);

impl Default for AiClient {
    fn default() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .build()
            .expect("HTTP client");
        Self(client)
    }
}

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| e.to_string())
}

fn api_key() -> Option<String> {
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.trim().is_empty() {
            return Some(key);
        }
    }
    keychain().ok()?.get_password().ok().filter(|k| !k.trim().is_empty())
}

#[tauri::command]
pub fn ai_key_status() -> bool {
    api_key().is_some()
}

#[tauri::command]
pub fn ai_set_key(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("The key is empty.".into());
    }
    keychain()?.set_password(key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_clear_key() -> Result<(), String> {
    match keychain()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Deserialize)]
pub struct AiRequest {
    pub(crate) system: String,
    pub(crate) prompt: String,
    pub(crate) schema: Value,
    /// "low", "medium", or "high"
    pub(crate) effort: String,
    /// Only the API path uses this; Claude Code has no output limit option.
    pub(crate) max_tokens: u32,
}

/// Errors start with a short code the page can branch on: `no_key:`, `refused:`, `api:`, `network:`.
#[tauri::command]
pub async fn ai_request(
    app: tauri::AppHandle,
    client: tauri::State<'_, AiClient>,
    request: AiRequest,
) -> Result<Value, String> {
    let Some(key) = api_key() else {
        if crate::claude_code::enabled(&app) {
            return crate::claude_code::request(&request, MODEL).await;
        }
        return Err(
            "no_key: Add an Anthropic API key or use your Claude subscription first.".into(),
        );
    };
    let body = request_body(&request, true);
    let mut response = send(&client.0, &key, &body, true).await?;

    // If this account can't use server-side fallbacks, try once without them.
    if matches!(&response, Err(message) if message.contains("fallback")) {
        response = send(&client.0, &key, &request_body(&request, false), false).await?;
    }
    parse_response(&response?)
}

fn request_body(request: &AiRequest, with_fallback: bool) -> Value {
    let mut body = json!({
        "model": MODEL,
        "max_tokens": request.max_tokens,
        "system": request.system,
        "messages": [{ "role": "user", "content": request.prompt }],
        "output_config": {
            "effort": request.effort,
            "format": { "type": "json_schema", "schema": request.schema },
        },
    });
    if with_fallback {
        body["fallbacks"] = json!("default");
    }
    body
}

/// Outer error: network failure. Inner error: the API answered with an error status.
async fn send(
    client: &reqwest::Client,
    key: &str,
    body: &Value,
    with_fallback: bool,
) -> Result<Result<Value, String>, String> {
    let mut req = client
        .post(API_URL)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(body);
    if with_fallback {
        req = req.header("anthropic-beta", FALLBACK_BETA);
    }
    let res = req.send().await.map_err(|e| format!("network: {e}"))?;
    let status = res.status();
    let value: Value = res.json().await.map_err(|e| format!("network: {e}"))?;
    if status.is_success() {
        return Ok(Ok(value));
    }
    let message = value["error"]["message"].as_str().unwrap_or("unknown error");
    Ok(Err(match status.as_u16() {
        401 => "no_key: The API key was rejected. Check it and try again.".to_string(),
        429 => format!("api: Rate limited. Try again in a moment. ({message})"),
        529 => "api: Claude is overloaded right now. Try again in a moment.".to_string(),
        code => format!("api: {code} {message}"),
    }))
}

fn parse_response(response: &Value) -> Result<Value, String> {
    match response["stop_reason"].as_str() {
        Some("refusal") => {
            let why = response["stop_details"]["explanation"].as_str().unwrap_or("no reason given");
            return Err(format!("refused: Claude declined this request ({why})."));
        }
        Some("max_tokens") => return Err("api: The answer was cut off. Try a shorter selection.".into()),
        _ => {}
    }
    let text = response["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect::<String>();
    serde_json::from_str(&text).map_err(|e| format!("api: Could not read Claude's answer ({e})."))
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn builds_a_structured_output_request() {
        let body = request_body(&request(), true);
        assert_eq!(body["model"], MODEL);
        assert_eq!(body["fallbacks"], "default");
        assert_eq!(body["output_config"]["format"]["type"], "json_schema");
        assert_eq!(body["output_config"]["effort"], "low");
        assert!(request_body(&request(), false).get("fallbacks").is_none());
    }

    #[test]
    fn reads_json_from_text_blocks() {
        let response = json!({
            "stop_reason": "end_turn",
            "content": [
                {"type": "thinking", "thinking": ""},
                {"type": "text", "text": "{\"alternatives\": [\"a\", \"b\"]}"}
            ]
        });
        assert_eq!(parse_response(&response).unwrap()["alternatives"][1], "b");
    }

    #[test]
    fn reports_refusals() {
        let response = json!({"stop_reason": "refusal", "stop_details": {"explanation": "x"}, "content": []});
        assert!(parse_response(&response).unwrap_err().starts_with("refused:"));
    }
}
