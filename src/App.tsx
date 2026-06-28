import { useEffect, useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTimeBank } from "./hooks/useTimeBank";
import "./App.css";

interface Service {
  id: string;
  name: string;
  keywords: string[];
  excludeKeywords?: string[];
  enabled: boolean;
}

interface DawPreset {
  id: string;
  name: string;
  keywords: string[];
  focusName: string;
}

const DAW_PRESETS: DawPreset[] = [
  {
    id: "fender-studio",
    name: "Fender Studio Pro (8+ / 旧One)",
    keywords: ["Studio Pro", "Fender Studio", "Studio One"],
    focusName: "Studio Pro 8",
  },
  { id: "cubase", name: "Cubase", keywords: ["Cubase"], focusName: "Cubase" },
  { id: "logic", name: "Logic Pro", keywords: ["Logic Pro"], focusName: "Logic Pro" },
  { id: "live", name: "Ableton Live", keywords: ["Live", "Ableton"], focusName: "Live" },
  { id: "fl", name: "FL Studio", keywords: ["FL Studio"], focusName: "FL Studio" },
  { id: "protools", name: "Pro Tools", keywords: ["Pro Tools"], focusName: "Pro Tools" },
];

const AVAILABLE_SERVICES: Service[] = [
  { id: "x", name: "X / Twitter", keywords: ["twitter", " / x", "x.com"], enabled: true },
  {
    id: "youtube",
    name: "YouTube (通常動画)",
    keywords: ["youtube.com", "youtube"],
    excludeKeywords: ["shorts"],
    enabled: true,
  },
  {
    id: "youtube-shorts",
    name: "YouTube Shorts",
    keywords: ["shorts", "youtube.com/shorts"],
    enabled: true,
  },
  { id: "instagram", name: "Instagram", keywords: ["instagram", "instagram.com"], enabled: true },
  { id: "mixi2", name: "mixi2", keywords: ["mixi2", "mixi.social", "mixi"], enabled: true },
];

export default function App() {
  const [selectedDawId, setSelectedDawId] = useState<string>("fender-studio");
  const [services, setServices] = useState<Service[]>(AVAILABLE_SERVICES);
  const [hasAccessibility, setHasAccessibility] = useState<boolean>(true);

  const currentDaw = useMemo(() => {
    return DAW_PRESETS.find((d) => d.id === selectedDawId) || DAW_PRESETS[0];
  }, [selectedDawId]);

  // WindowsなどURLが取得できない（空文字）環境向けのブラックリスト一括化処理
  const isWindows = useMemo(() => {
    return typeof window !== "undefined" && /win/i.test(navigator.userAgent || "");
  }, []);

  const activeBlacklist = useMemo(() => {
    return services
      .filter((s) => {
        if (isWindows) {
          // Windows環境では、通常YouTubeまたはShortsのいずれか一方が有効なら両方を制限対象にする
          if (s.id === "youtube" || s.id === "youtube-shorts") {
            return services.some(
              (item) => (item.id === "youtube" || item.id === "youtube-shorts") && item.enabled,
            );
          }
        }
        return s.enabled;
      })
      .map((s) => {
        if (isWindows && (s.id === "youtube" || s.id === "youtube-shorts")) {
          // Windowsでは通常動画とShortsをURLで除外判定できないため、除外ルールを解除して一括制限する
          return {
            keywords: s.keywords,
            excludeKeywords: [],
          };
        }
        return {
          keywords: s.keywords,
          excludeKeywords: s.excludeKeywords,
        };
      });
  }, [services, isWindows]);

  const {
    formattedTime,
    currentTitle,
    currentUrl,
    currentAppName,
    currentIdleSeconds,
    status,
    hasAccessibilityError,
    adjustTimeBank,
  } = useTimeBank(activeBlacklist, currentDaw.keywords, currentDaw.focusName);

  // 権限チェックのロジック
  useEffect(() => {
    const verifyPermissions = async () => {
      try {
        const axAuth = await invoke<boolean>("check_accessibility");
        setHasAccessibility(axAuth);
      } catch (error) {
        console.error("権限チェックに失敗しました:", error);
      }
    };

    verifyPermissions();
    window.addEventListener("focus", verifyPermissions);
    return () => window.removeEventListener("focus", verifyPermissions);
  }, []);

  const toggleService = useCallback((id: string) => {
    setServices((prev) => {
      if (id === "youtube-merged") {
        // Windows環境用：どちらか一方がONなら両方をOFFに、両方OFFなら両方をONにトグルする
        const isCurrentlyEnabled = prev.some(
          (s) => (s.id === "youtube" || s.id === "youtube-shorts") && s.enabled,
        );
        return prev.map((s) =>
          s.id === "youtube" || s.id === "youtube-shorts"
            ? { ...s, enabled: !isCurrentlyEnabled }
            : s,
        );
      }
      return prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
    });
  }, []);

  const getStatusText = useCallback(() => {
    switch (status) {
      case "BUILD":
        return `🎵 ${currentDaw.name}で作業中（貯金UP）`;
      case "DRAIN":
        return "🚨 制限サービス閲覧中（貯金減少）";
      default:
        return "☕ 待機中";
    }
  }, [status, currentDaw]);

  // UIに表示する制限サービス一覧（WindowsではYouTube関連をマージ）
  const visibleServices = useMemo(() => {
    return services.reduce<Service[]>((acc, service) => {
      if (isWindows) {
        if (service.id === "youtube") {
          const isShortsEnabled = services.find((s) => s.id === "youtube-shorts")?.enabled;
          acc.push({
            id: "youtube-merged",
            name: "YouTube (Shorts含む)",
            keywords: ["youtube.com", "youtube", "shorts"],
            enabled: service.enabled || !!isShortsEnabled,
          });
        } else if (service.id === "youtube-shorts") {
          // Shortsはマージされるため、個別のトグルとしては表示しない
        } else {
          acc.push(service);
        }
      } else {
        acc.push(service);
      }
      return acc;
    }, []);
  }, [services, isWindows]);

  // 🚨 権限エラー画面
  if (!hasAccessibility || hasAccessibilityError) {
    return (
      <div className="error-container">
        <h1 className="error-title">🚨 動作には権限の設定が必要です</h1>
        <div className="error-card">
          <div className="error-card-row">
            <div>
              <div className="error-card-label">アクセシビリティ権限</div>
              <div className="error-subtext">
                {hasAccessibilityError
                  ? "⚠️ 許可済に見えますが、OSが拒否しています"
                  : "❌ 未許可（ウインドウ監視に必要です）"}
              </div>
            </div>
            <button
              onClick={() => invoke("open_accessibility_settings")}
              className="primary-button"
            >
              設定を開く
            </button>
          </div>

          {hasAccessibilityError && (
            <div
              style={{
                marginTop: "16px",
                fontSize: "13px",
                color: "var(--text-secondary)",
                textAlign: "left",
                borderTop: "1px solid rgba(244, 63, 94, 0.2)",
                paddingTop: "16px",
                lineHeight: "1.5",
              }}
            >
              <strong
                style={{ color: "var(--color-drain)", display: "block", marginBottom: "8px" }}
              >
                💡 解決手順 (macOSのバグ対策)：
              </strong>
              1. システム設定の「アクセシビリティ」から <strong>daw-focus-lock</strong> をマイナス（
              <code>-</code>）ボタンで一度完全に削除します。
              <br />
              2. 本アプリを再起動し、再度リストに追加してチェックをONにしてください。
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <h1 className="app-title">⏳ daw-focus-lock</h1>

      {/* タイマー表示セクション */}
      <div className="timer-section">
        <p className="timer-label">制限サービスの残り利用可能時間</p>
        <div className={`timer-display status-${status.toLowerCase()}`}>{formattedTime}</div>
        <div className={`status-badge status-${status.toLowerCase()}`}>{getStatusText()}</div>
      </div>

      {/* DAW切り替えセレクトボックス */}
      <div className="card">
        <label htmlFor="daw-select" className="input-label">
          🎹 使用するDAWソフト
        </label>
        <select
          id="daw-select"
          value={selectedDawId}
          onChange={(e) => setSelectedDawId(e.target.value)}
          className="select-input"
        >
          {DAW_PRESETS.map((daw) => (
            <option key={daw.id} value={daw.id}>
              {daw.name}
            </option>
          ))}
        </select>
      </div>

      {/* デバッグパネル */}
      {import.meta.env.DEV && (
        <div className="debug-panel">
          <h4 className="debug-title">🔧 開発者用デバッグパネル</h4>
          <div className="flex-gap-wrap">
            <button onClick={() => adjustTimeBank(60)} className="debug-btn">
              ＋1分
            </button>
            <button onClick={() => adjustTimeBank(10)} className="debug-btn">
              ＋10秒
            </button>
            <button onClick={() => adjustTimeBank(-10)} className="debug-btn">
              －10秒
            </button>
            <button onClick={() => adjustTimeBank(-60)} className="debug-btn">
              －1分
            </button>
            <button
              onClick={() => {
                adjustTimeBank(-99999);
                adjustTimeBank(1);
              }}
              className="debug-btn danger"
            >
              💥 残り1秒
            </button>
          </div>
        </div>
      )}

      {/* 制限スイッチ */}
      <div className="card">
        <h3 className="card-title">🛡️ 制限するサービス</h3>
        <div className="flex-column-gap">
          {visibleServices.map((service) => (
            <div key={service.id} className="toggle-row">
              <span
                className="service-name"
                style={{ color: service.enabled ? "var(--text-primary)" : "var(--text-muted)" }}
              >
                {service.name}
              </span>
              <button
                onClick={() => toggleService(service.id)}
                className={`switch-track ${service.enabled ? "enabled" : ""}`}
                role="switch"
                aria-checked={service.enabled}
                aria-label={`${service.name}の制限スイッチ`}
              >
                <div className="switch-thumb" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* デバッグ・ステータス情報 */}
      <div className="status-console">
        <div className="console-row">
          <span>検出中のアプリ名</span>
          <strong>{currentAppName || "検出中..."}</strong>
        </div>
        <div className="console-row">
          <span>PC全体の無操作時間</span>
          <strong
            style={{
              color: currentIdleSeconds >= 30 ? "var(--color-drain)" : "var(--color-build)",
            }}
          >
            {currentIdleSeconds} 秒 {currentIdleSeconds >= 30 ? "⚠️ 放置中" : "🐾 操作中"}
          </strong>
        </div>
        <div className="console-row-block">
          <p className="console-label">検出中のウィンドウタイトル</p>
          <code className="code-block">{currentTitle}</code>
        </div>
        <div className="console-row-block">
          <p className="console-label">検出中のURL</p>
          <code
            className="code-block"
            style={{ color: currentUrl ? "#60a5fa" : "var(--text-muted)" }}
          >
            {currentUrl || "（空：自動化の許可がないか、未対応アプリです）"}
          </code>
        </div>
      </div>
    </div>
  );
}
