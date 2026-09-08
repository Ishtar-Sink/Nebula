//! Persisted settings, shared with the frontend through Tauri commands.
//!
//! The server address lives in a plain JSON file, so pointing the app at another machine
//! never needs a rebuild, an environment variable or a launcher script.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const DEFAULT_SERVER: &str = "http://localhost:4000";

#[derive(Debug, Clone, Serialize, Deserialize)]
// camelCase so the field reads naturally from the frontend as `serverUrl`.
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub server_url: String,
}

impl Default for Config {
    fn default() -> Self {
        Self { server_url: DEFAULT_SERVER.to_string() }
    }
}

/// `%APPDATA%\nebula` on Windows, `$XDG_CONFIG_HOME/nebula` or `~/.config/nebula` elsewhere.
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .or_else(|| std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join("AppData/Roaming")))
        .unwrap_or_else(std::env::temp_dir);

    let dir = base.join("nebula");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

impl Config {
    pub fn load() -> Self {
        // A corrupt or hand-edited file should not stop the app from starting.
        match std::fs::read_to_string(config_path()) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|err| {
                eprintln!("[config] {} ilegível ({err}); usando o padrão", config_path().display());
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(config_path(), text).map_err(|e| e.to_string())
    }

    /// Trims a pasted address into something usable: adds the scheme, drops a trailing slash,
    /// and supplies the default port when only a host was given.
    pub fn normalize_url(input: &str) -> String {
        let mut url = input.trim().trim_end_matches('/').to_string();
        if url.is_empty() {
            return DEFAULT_SERVER.to_string();
        }
        if !url.starts_with("http://") && !url.starts_with("https://") {
            url = format!("http://{url}");
        }
        let authority = url
            .trim_start_matches("http://")
            .trim_start_matches("https://");
        if !authority.contains(':') {
            url = format!("{url}:4000");
        }
        url
    }
}
