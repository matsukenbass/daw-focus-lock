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
    fn dlopen(filename: *const std::os::raw::c_char, flag: std::os::raw::c_int) -> *mut std::os::raw::c_void;
    fn dlsym(handle: *mut std::os::raw::c_void, symbol: *const std::os::raw::c_char) -> *mut std::os::raw::c_void;
    fn dlclose(handle: *mut std::os::raw::c_void) -> std::os::raw::c_int;
}

#[cfg(target_os = "macos")]
const RTLD_LAZY: std::os::raw::c_int = 1;

#[cfg(target_os = "macos")]
fn get_idle_seconds_fallback() -> u64 {
    let cmd = "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'";
    std::process::Command::new("sh")
        .args(["-c", cmd])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0)
}

/// システム全体の無操作時間（秒）を取得
#[cfg(target_os = "macos")]
fn get_idle_seconds() -> u64 {
    unsafe {
        let lib_path = std::ffi::CString::new("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics").unwrap();
        let handle = dlopen(lib_path.as_ptr(), RTLD_LAZY);
        if !handle.is_null() {
            let symbol_name = std::ffi::CString::new("CGEventSourceSecondsSinceLastInputType").unwrap();
            let symbol = dlsym(handle, symbol_name.as_ptr());
            if !symbol.is_null() {
                let func: extern "C" fn(i32) -> f64 = std::mem::transmute(symbol);
                let idle = func(-1) as u64;
                dlclose(handle);
                return idle;
            }
            dlclose(handle);
        }
    }
    get_idle_seconds_fallback()
}

/// macOSで指定されたブラウザのアクティブなタブのURLを取得する
#[cfg(target_os = "macos")]
fn get_browser_url(app_name: &str) -> String {
    let script = match app_name {
        "Google Chrome" | "Brave Browser" | "Microsoft Edge" | "Vivaldi" => {
            format!("tell application \"{}\" to return URL of active tab of front window", app_name)
        }
        "Arc" => {
            "tell application \"Arc\" to tell window 1 to return URL of active tab".to_string()
        }
        "Safari" => {
            "tell application \"Safari\" to return URL of current tab of front window".to_string()
        }
        _ => return String::new(),
    };

    std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .unwrap_or_default()
}


#[cfg(not(target_os = "macos"))]
fn get_idle_seconds() -> u64 {
    0
}

/// 指定されたDAWにフォーカスを強制移動
#[tauri::command]
fn focus_daw(daw_name: String) {
    #[cfg(target_os = "macos")]
    {
        // 1手目: フロントから渡された名前でアプリを最前面化
        let status = std::process::Command::new("open")
            .args(["-a", &daw_name])
            .spawn()
            .and_then(|mut child| child.wait());

        // 2手目: 失敗した場合は「Studio Pro」が含まれるアプリの実体を自動スキャンしてフォールバック
        if status.is_err() || !status.unwrap().success() {
            if let Ok(output) = std::process::Command::new("mdfind")
                .arg("kMDItemContentType == 'com.apple.application-bundle' && kMDItemFSName == '*Studio Pro*'")
                .output()
            {
                let paths = String::from_utf8_lossy(&output.stdout);
                if let Some(valid_path) = paths.lines().next() {
                    let _ = std::process::Command::new("open").arg(valid_path).spawn();
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // 過去・現在・未来のStudio Proファミリー、および主要DAWのウィンドウタイトルに対応
        let command = format!(
            r#"
            $wshell = New-Object -ComObject Wscript.Shell;
            $wshell.AppActivate("{}");
            $wshell.AppActivate("Studio One");
            $wshell.AppActivate("Studio Pro");
            "#,
            daw_name
        );
        let _ = std::process::Command::new("powershell")
            .args(["-Command", &command])
            .spawn();
    }
}

/// OS側のアクセシビリティ権限をチェック
#[tauri::command]
fn check_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// OSのアクセシビリティ設定画面を開く
#[tauri::command]
fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    {
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
                    
                    // 🎯 ネストを解消（エラー時は早期リターンして次のループへ）
                    let Ok(active_window) = get_active_window() else {
                        continue;
                    };
                    
                    let app_name = active_window.app_name;
                    
                    #[cfg(target_os = "macos")]
                    let url = get_browser_url(&app_name);
                    #[cfg(not(target_os = "macos"))]
                    let url = String::new();

                    let info = WindowInfo {
                        title: active_window.title,
                        url,
                        app_name,
                        idle_seconds: get_idle_seconds(),
                    };

                    let _ = app_handle.emit("window-focus-changed", info);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}