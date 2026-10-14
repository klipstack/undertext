mod ai;
mod claude_code;

use std::fs;
use std::path::Path;

/// The page can only read and write text documents, never other files on disk.
const DOCUMENT_EXTENSIONS: [&str; 3] = ["md", "markdown", "txt"];

fn document_path(path: &str) -> Result<&Path, String> {
    let target = Path::new(path);
    let ext = target.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if DOCUMENT_EXTENSIONS.contains(&ext.as_str()) {
        Ok(target)
    } else {
        Err(format!("Undertext only opens and saves .md, .markdown, and .txt files: {path}"))
    }
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(document_path(&path)?).map_err(|e| format!("Could not read {path}: {e}"))
}

/// Writes to a temp file next to the target, then renames it, so a crash
/// never leaves a half-written document.
#[tauri::command]
fn write_text(path: String, contents: String) -> Result<(), String> {
    let target = document_path(&path)?;
    let tmp = target.with_extension("undertext-tmp");
    fs::write(&tmp, contents).map_err(|e| format!("Could not write {path}: {e}"))?;
    fs::rename(&tmp, target).map_err(|e| format!("Could not save {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ai::AiClient::default())
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            ai::ai_key_status,
            ai::ai_set_key,
            ai::ai_clear_key,
            ai::ai_request,
            claude_code::claude_code_status,
            claude_code::claude_code_set_enabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_text_documents_are_allowed() {
        assert!(document_path("/tmp/notes.md").is_ok());
        assert!(document_path("/tmp/Notes.MARKDOWN").is_ok());
        assert!(document_path("/tmp/draft.txt").is_ok());
        assert!(document_path("/Users/me/.zshrc").is_err());
        assert!(document_path("/Users/me/.ssh/id_ed25519").is_err());
        assert!(document_path("/tmp/notes.md.sh").is_err());
    }
}
