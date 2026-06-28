import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export interface WindowInfo {
  title: string;
  url: string;
  app_name: string;
  idle_seconds: number;
}

export interface BlacklistItem {
  keywords: string[];
  excludeKeywords?: string[];
}

export const BROWSER_APPS = [
  "Google Chrome",
  "Safari",
  "Arc",
  "Brave Browser",
  "Microsoft Edge",
  "Vivaldi",
];

export const IDLE_THRESHOLD_SECONDS = 30; // 操作なしと判定する秒数のしきい値
export const COOLDOWN_MS = 5000; // 最前面移動コマンド連打防止のクールダウン時間

/**
 * 秒数を受け取り、 "M:SS" 形式の文字列にフォーマットする
 */
export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/**
 * アクティブなウィンドウ情報から、指定されたDAWキーワードに合致するか判定する
 */
export const isDawActive = (title: string, appName: string, dawKeywords: string[]): boolean => {
  const lowerTitle = title.toLowerCase();
  const lowerAppName = appName.toLowerCase();

  return dawKeywords.some(
    (keyword) =>
      lowerTitle.includes(keyword.toLowerCase()) || lowerAppName.includes(keyword.toLowerCase()),
  );
};

/**
 * アクティブなウィンドウ情報から、ブラックリストに合致するか判定する
 */
export const isBlacklisted = (
  title: string,
  url: string,
  appName: string,
  blacklist: BlacklistItem[],
): boolean => {
  if (!BROWSER_APPS.includes(appName)) return false;

  const lowerTitle = title.toLowerCase();
  const lowerUrl = url.toLowerCase();

  return blacklist.some((item) => {
    // WindowsなどURLが取得できない（空文字）環境向けのフォールバック処理
    if (!url || url.trim() === "") {
      const isYoutubeRelated = item.keywords.some((k) => {
        const lowKey = k.toLowerCase();
        return lowKey.includes("youtube") || lowKey.includes("shorts");
      });

      if (isYoutubeRelated) {
        // YouTube関連の場合、タイトル部分一致（除外ルール無視）で一括ブロック対象とする
        return item.keywords.some((k) => lowerTitle.includes(k.toLowerCase()));
      }
    }

    // 通常の判定（URLが取得できている環境、またはYouTube関連以外のサービス）
    const hasKeyword = item.keywords.some((k) => {
      const lowKey = k.toLowerCase();
      return lowerTitle.includes(lowKey) || lowerUrl.includes(lowKey);
    });

    const hasExclude =
      item.excludeKeywords?.some((ex) => {
        const lowEx = ex.toLowerCase();
        return lowerTitle.includes(lowEx) || lowerUrl.includes(lowEx);
      }) ?? false;

    return hasKeyword && !hasExclude;
  });
};

export const useTimeBank = (
  blacklist: BlacklistItem[],
  dawKeywords: string[],
  dawNameForFocus: string,
) => {
  const [timeBank, setTimeBank] = useState<number>(0);
  const [currentTitle, setCurrentTitle] = useState<string>("監視未始動");
  const [currentUrl, setCurrentUrl] = useState<string>("");
  const [currentAppName, setCurrentAppName] = useState<string>("");
  const [currentIdleSeconds, setCurrentIdleSeconds] = useState<number>(0);
  const [status, setStatus] = useState<"BUILD" | "DRAIN" | "IDLE">("IDLE");
  const [hasAccessibilityError, setHasAccessibilityError] = useState<boolean>(false);

  const blacklistRef = useRef<BlacklistItem[]>(blacklist);
  const dawKeywordsRef = useRef(dawKeywords);
  const dawNameForFocusRef = useRef(dawNameForFocus);
  const lastFocusTimeRef = useRef<number>(0);

  useEffect(() => {
    blacklistRef.current = blacklist;
    dawKeywordsRef.current = dawKeywords;
    dawNameForFocusRef.current = dawNameForFocus;
  }, [blacklist, dawKeywords, dawNameForFocus]);

  useEffect(() => {
    let active = true;
    let unlistenFunc: (() => void) | undefined;

    const setupListener = async () => {
      const unlistenFocus = await listen<WindowInfo>("window-focus-changed", (event) => {
        setHasAccessibilityError(false);
        const { title, url, app_name, idle_seconds } = event.payload;

        if (!title || title.trim() === "") return;

        setCurrentTitle(title);
        setCurrentUrl(url);
        setCurrentAppName(app_name);
        setCurrentIdleSeconds(idle_seconds);

        const currentDawKeywords = dawKeywordsRef.current;
        const currentBlacklist = blacklistRef.current;

        // 1. 加算判定 (DAWソフトがアクティブ & 無操作状態でないとき)
        if (isDawActive(title, app_name, currentDawKeywords)) {
          if (idle_seconds >= IDLE_THRESHOLD_SECONDS) {
            setStatus("IDLE");
          } else {
            setTimeBank((prev) => prev + 1);
            setStatus("BUILD");
          }
        }
        // 2. 減算判定 (ブラウザがアクティブ & ブラックリストURL/タイトルのとき)
        else if (isBlacklisted(title, url, app_name, currentBlacklist)) {
          setStatus("DRAIN");
          setTimeBank((prev) => {
            if (prev <= 1) {
              const now = Date.now();
              // 連打防止のクールダウン検証
              if (now - lastFocusTimeRef.current > COOLDOWN_MS) {
                lastFocusTimeRef.current = now;
                invoke("focus_daw", { dawName: dawNameForFocusRef.current }).catch(console.error);
              }
              return 0;
            }
            return prev - 1;
          });
        }
        // 3. 維持
        else {
          setStatus("IDLE");
        }
      });

      const unlistenError = await listen<boolean>("accessibility-error", (event) => {
        if (event.payload) {
          setHasAccessibilityError(true);
        }
      });

      if (!active) {
        unlistenFocus();
        unlistenError();
      } else {
        unlistenFunc = () => {
          unlistenFocus();
          unlistenError();
        };
      }
    };

    setupListener();

    return () => {
      active = false;
      if (unlistenFunc) {
        unlistenFunc();
      }
    };
  }, []);

  const adjustTimeBank = useCallback((amountSeconds: number) => {
    setTimeBank((prev) => {
      const nextTime = prev + amountSeconds;
      return nextTime < 0 ? 0 : nextTime;
    });
  }, []);

  return {
    timeBank,
    formattedTime: formatTime(timeBank),
    currentTitle,
    currentUrl,
    currentAppName,
    currentIdleSeconds,
    status,
    hasAccessibilityError,
    adjustTimeBank,
  };
};
