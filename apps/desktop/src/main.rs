#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Nebula desktop — a Tauri shell hosting the Nebula web player.
//!
//! The Rust side deliberately owns very little: the window, and the settings file that says
//! which server to talk to. Playback, playlists and the remote-control protocol are the same
//! code that runs in the browser, so the three clients cannot drift apart.

mod config;

use config::Config;

/// Reads the persisted settings. Called by the frontend before it opens its websocket.
#[tauri::command]
fn get_config() -> Config {
    Config::load()
}

/// Persists the server address and returns the normalised value actually written.
#[tauri::command]
fn set_server_url(url: String) -> Result<Config, String> {
    let config = Config { server_url: Config::normalize_url(&url) };
    config.save()?;
    Ok(config)
}

/// Where the settings live, shown in the UI so the file is findable.
#[tauri::command]
fn config_path() -> String {
    config::config_path().to_string_lossy().to_string()
}

/// Machine name, used to label this device in the "playing on" picker.
#[tauri::command]
fn device_name() -> String {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|h| !h.trim().is_empty())
        .or_else(|| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|h| !h.is_empty())
        });

    match host {
        Some(name) => format!("{} · Desktop", name.trim_end_matches(".local")),
        None => "Desktop".to_string(),
    }
}

fn main() {
    // Without this the webview applies Chrome's autoplay policy, and handing playback to
    // this device from a phone would sit silent until someone clicked the window.
    #[cfg(windows)]
    if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            // The msWebOOUI/msPdfOOUI/SmartScreen flags are Tauri's own defaults, repeated
            // here because setting this variable replaces them wholesale.
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection              --autoplay-policy=no-user-gesture-required",
        );
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_server_url,
            config_path,
            device_name
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar a janela do Nebula");
}
