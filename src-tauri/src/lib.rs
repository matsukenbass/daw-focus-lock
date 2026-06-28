#![allow(uncommon_codepoints)]
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

/// システム全体の無操作時間（秒）を取得
#[cfg(target_os = "macos")]
fn get_idle_seconds() -> u64 {
    let cmd = "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'";
    std::process::Command::new("sh")
        .args(["-c", cmd])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0)
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

#[cfg(target_os = "windows")]
mod win32_focus {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    type BOOL = i32;
    type HWND = isize;
    type LPARAM = isize;
    type WNDENUMPROC = unsafe extern "system" fn(HWND, LPARAM) -> BOOL;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(lpEnumFunc: WNDENUMPROC, lParam: LPARAM) -> BOOL;
        fn GetWindowTextW(hWnd: HWND, lpString: *mut u16, nMaxCount: i32) -> i32;
        fn SetForegroundWindow(hWnd: HWND) -> BOOL;
        fn ShowWindow(hWnd: HWND, nCmdShow: i32) -> BOOL;
        fn IsIconic(hWnd: HWND) -> BOOL;
        fn keybd_event(bVk: u8, bScan: u8, dwFlags: u32, dwExtraInfo: usize);
    }

    const VK_MENU: u8 = 0x12; // ALT キー
    const KEYEVENTF_KEYUP: u32 = 0x0002;
    const SW_RESTORE: i32 = 9;

    struct EnumContext {
        target_keywords: Vec<String>,
        found_hwnd: Option<HWND>,
    }

    unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam as *mut EnumContext);
        
        let mut buffer = [0u16; 512];
        let len = GetWindowTextW(hwnd, buffer.as_mut_ptr(), 512);
        if len > 0 {
            let title = OsString::from_wide(&buffer[..len as usize])
                .to_string_lossy()
                .to_lowercase();
            
            if ctx.target_keywords.iter().any(|k| title.contains(&k.to_lowercase())) {
                ctx.found_hwnd = Some(hwnd);
                return 0; // スキャンを終了
            }
        }
        1 // スキャンを継続
    }

    pub fn focus_window(daw_name: &str) -> bool {
        unsafe {
            let keywords = vec![
                daw_name.to_string(),
                "Studio One".to_string(),
                "Studio Pro".to_string(),
            ];
            
            let mut ctx = EnumContext {
                target_keywords: keywords,
                found_hwnd: None,
            };

            let ctx_ptr = &mut ctx as *mut EnumContext as LPARAM;
            EnumWindows(enum_windows_callback, ctx_ptr);

            if let Some(hwnd) = ctx.found_hwnd {
                // 最小化されている場合は元のサイズに復元する
                if IsIconic(hwnd) != 0 {
                    ShowWindow(hwnd, SW_RESTORE);
                }
                
                // ALTキーをダミー送信してフォーカス強奪制限（Focus Stealing Prevention）をバイパス
                keybd_event(VK_MENU, 0, 0, 0);
                keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
                
                SetForegroundWindow(hwnd);
                true
            } else {
                false
            }
        }
    }
}

#[cfg(target_os = "macos")]
#[cfg(not(test))]
fn execute_open(app: &str) -> std::io::Result<std::process::ExitStatus> {
    std::process::Command::new("open")
        .args(["-a", app])
        .spawn()
        .and_then(|mut child| child.wait())
}

#[cfg(target_os = "macos")]
#[cfg(test)]
fn execute_open(app: &str) -> std::io::Result<std::process::ExitStatus> {
    if app == "MockApp" {
        // Return a real successful ExitStatus by spawning a simple command
        if cfg!(unix) {
            std::process::Command::new("true").status()
        } else {
            std::process::Command::new("cmd").args(["/c", "exit 0"]).status()
        }
    } else {
        Err(std::io::Error::new(std::io::ErrorKind::NotFound, "mock error"))
    }
}

#[cfg(target_os = "macos")]
#[cfg(not(test))]
fn find_fallback_path() -> std::io::Result<String> {
    let output = std::process::Command::new("mdfind")
        .arg("kMDItemContentType == 'com.apple.application-bundle' && kMDItemFSName == '*Studio Pro*'")
        .output()?;
    let paths = String::from_utf8_lossy(&output.stdout);
    if let Some(valid_path) = paths.lines().next() {
        Ok(valid_path.to_string())
    } else {
        Err(std::io::Error::new(std::io::ErrorKind::NotFound, "No fallback application found"))
    }
}

#[cfg(target_os = "macos")]
#[cfg(test)]
fn find_fallback_path() -> std::io::Result<String> {
    Ok("FallbackMockApp".to_string())
}

#[cfg(target_os = "macos")]
#[cfg(not(test))]
fn execute_open_path(path: &str) -> std::io::Result<()> {
    std::process::Command::new("open").arg(path).spawn().map(|_| ())
}

#[cfg(target_os = "macos")]
#[cfg(test)]
fn execute_open_path(path: &str) -> std::io::Result<()> {
    assert_eq!(path, "FallbackMockApp");
    Ok(())
}

/// 指定されたDAWにフォーカスを強制移動
#[tauri::command]
fn focus_daw(daw_name: String) {
    #[cfg(target_os = "macos")]
    {
        // 1手目: フロントから渡された名前でアプリを最前面化
        let status = execute_open(&daw_name);

        // 2手目: 失敗した場合は「Studio Pro」が含まれるアプリの実体を自動スキャンしてフォールバック
        if status.is_err() || !status.unwrap().success() {
            if let Ok(valid_path) = find_fallback_path() {
                let _ = execute_open_path(&valid_path);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let _ = win32_focus::focus_window(&daw_name);
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
        #[cfg(not(test))]
        {
            let _ = std::process::Command::new("open")
                .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
                .spawn();
        }
        #[cfg(test)]
        {
            // Test no-op
        }
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
                    
                    // 🎯 アクティブウィンドウの取得結果に応じてイベントを分岐（権限エラー検知のため）
                    match get_active_window() {
                        Ok(active_window) => {
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
                        Err(_) => {
                            // 権限がないなどのエラー時にフロントへ警告イベントを送る
                            let _ = app_handle.emit("accessibility-error", true);
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;

    #[test]
    fn ウィンドウ情報のシリアライズ() {
        let info = WindowInfo {
            title: "Test Title".to_string(),
            url: "https://test.com".to_string(),
            app_name: "Test App".to_string(),
            idle_seconds: 42,
        };
        
        let serialized = serde_json::to_string(&info).unwrap();
        assert!(serialized.contains("\"title\":\"Test Title\""));
        assert!(serialized.contains("\"url\":\"https://test.com\""));
        assert!(serialized.contains("\"app_name\":\"Test App\""));
        assert!(serialized.contains("\"idle_seconds\":42"));
    }

    #[test]
    fn アイドル時間の取得機能() {
        let idle = get_idle_seconds();
        // Verify it runs and returns a u64 type without panicking
        let _: u64 = idle;
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn 未知のアプリ名に対するブラウザURL取得() {
        // Unknown applications should return an empty string immediately
        let url = get_browser_url("Unknown App Name");
        assert_eq!(url, "");
    }

    #[test]
    fn アクセシビリティ権限チェック() {
        // Verify that check_accessibility executes without panicking
        let _ = check_accessibility();
    }

    #[test]
    fn 存在しないアプリ名に対するフォーカス強制移動のフォールバック() {
        // Verify that focus_daw handles non-existent apps gracefully without panicking
        focus_daw("NonExistentApplicationNameForTestingOnly".to_string());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn アプリ名に対するフォーカス強制移動の成功() {
        // Verify that focus_daw succeeds when the app exists (MockApp)
        focus_daw("MockApp".to_string());
    }

    #[test]
    fn アクセシビリティ設定画面の表示() {
        // Verify that open_accessibility_settings runs without panicking
        open_accessibility_settings();
    }
}