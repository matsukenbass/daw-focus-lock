use std::time::Duration;
use tauri::Emitter;
use active_win_pos_rs::get_active_window;

#[derive(Clone, serde::Serialize)]
struct WindowInfo {
    title: String,
    url: String,
    app_name: String,
    idle_seconds: u64,
}

#[cfg(target_os = "macos")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

#[cfg(target_os = "macos")]
fn get_idle_seconds() -> u64 {
    if let Ok(output) = std::process::Command::new("sh")
        .arg("-c")
        .arg("ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'")
        .output() 
    {
        let out_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        out_str.parse::<u64>().unwrap_or(0)
    } else {
        0
    }
}

#[cfg(not(target_os = "macos"))]
fn get_idle_seconds() -> u64 {
    0
}

#[tauri::command]
fn focus_daw(daw_name: String) {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("-a")
            .arg(&daw_name)
            .spawn()
            .and_then(|mut child| child.wait());

        if status.is_err() || !status.unwrap().success() {
            if let Ok(output) = std::process::Command::new("mdfind")
                .arg("kMDItemContentType == 'com.apple.application-bundle' && kMDItemFSName == '*Studio Pro*'")
                .output()
            {
                let paths_str = String::from_utf8_lossy(&output.stdout);
                if let Some(valid_path) = paths_str.lines().next() {
                    let _ = std::process::Command::new("open")
                        .arg(valid_path)
                        .spawn();
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let command = format!(
            r#"
            $wshell = New-Object -ComObject Wscript.Shell;
            $wshell.AppActivate("{}");
            $wshell.AppActivate("Studio Pro");
            $wshell.AppActivate("Studio One");
            "#,
            daw_name
        );
        let _ = std::process::Command::new("powershell")
            .arg("-Command")
            .arg(command).spawn();
    }
}

// 🎯 アクセシビリティチェック（ウインドウ情報の取得に必要）のみ残す
#[tauri::command]
fn check_accessibility() -> bool {
    #[cfg(target_os = "macos")] { unsafe { AXIsProcessTrusted() } }
    #[cfg(not(target_os = "macos"))] { true }
}

#[tauri::command]
fn open_accessibility_settings() {
    #[cfg(target_os = "macos")] {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            focus_daw,
            check_accessibility,
            open_accessibility_settings
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    
                    if let Ok(active_window) = get_active_window() {
                        let mut url = String::new();
                        let app_name = active_window.app_name.clone();
                        
                        #[cfg(target_os = "macos")]
                        {
                            if app_name == "Google Chrome" || 
                               app_name == "Brave Browser" || 
                               app_name == "Microsoft Edge" || 
                               app_name == "Vivaldi" {
                                
                                let script = format!(
                                    "tell application \"{}\" to return URL of active tab of front window", 
                                    app_name
                                );
                                if let Ok(output) = std::process::Command::new("osascript").arg("-e").arg(&script).output() {
                                    url = String::from_utf8_lossy(&output.stdout).trim().to_string();
                                }
                            } else if app_name == "Arc" {
                                let script = "tell application \"Arc\" to tell window 1 to return URL of active tab";
                                if let Ok(output) = std::process::Command::new("osascript").arg("-e").arg(script).output() {
                                    url = String::from_utf8_lossy(&output.stdout).trim().to_string();
                                }
                            } else if app_name == "Safari" {
                                let script = "tell application \"Safari\" to return URL of current tab of front window";
                                if let Ok(output) = std::process::Command::new("osascript").arg("-e").arg(script).output() {
                                    url = String::from_utf8_lossy(&output.stdout).trim().to_string();
                                }
                            }
                        }

                        let info = WindowInfo {
                            title: active_window.title,
                            url: url,
                            app_name: app_name,
                            idle_seconds: get_idle_seconds(),
                        };

                        let _ = app_handle.emit("window-focus-changed", info);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}