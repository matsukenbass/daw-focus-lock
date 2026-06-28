import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTimeBank, formatTime, BlacklistItem } from "./useTimeBank";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

// イベントリスナーをモックし、手動でトリガーできるようにオブジェクトに保存
const mockEventListeners: Record<string, Function> = {};

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn().mockImplementation((eventName: string, callback: Function) => {
      mockEventListeners[eventName] = callback;
      return Promise.resolve(() => {
        delete mockEventListeners[eventName];
      });
    }),
  };
});

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: vi.fn().mockImplementation(() => Promise.resolve()),
  };
});

describe("formatTime (時間フォーマットユーティリティ)", () => {
  it("秒数を M:SS 形式の文字列にフォーマットすること", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(59)).toBe("0:59");
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3599)).toBe("59:59");
    expect(formatTime(3600)).toBe("60:00");
  });
});

describe("useTimeBank (タイムバンク監視フック)", () => {
  const mockBlacklist: BlacklistItem[] = [
    { keywords: ["youtube", "shorts"], excludeKeywords: ["music", "tutorial"] },
    { keywords: ["twitter", "x.com"] },
  ];
  const mockDawKeywords = ["Ableton", "Logic", "Cubase"];
  const mockDawNameForFocus = "Ableton Live";

  beforeEach(() => {
    vi.clearAllMocks();
    // リスナー辞書をクリア
    for (const key in mockEventListeners) {
      delete mockEventListeners[key];
    }
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const getActiveListeners = async () => {
    // フック内の複数の非同期効果 (setupListener 内の複数の listen 呼び出し) が完了するのを待つ
    for (let i = 0; i < 10; i++) {
      if (mockEventListeners["window-focus-changed"] && mockEventListeners["accessibility-error"]) {
        break;
      }
      await act(async () => {
        await Promise.resolve();
      });
    }
  };

  it("デフォルトの初期状態で初期化されること", async () => {
    const { result } = renderHook(() =>
      useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus),
    );

    expect(result.current.timeBank).toBe(0);
    expect(result.current.formattedTime).toBe("0:00");
    expect(result.current.currentTitle).toBe("監視未始動");
    expect(result.current.currentUrl).toBe("");
    expect(result.current.currentAppName).toBe("");
    expect(result.current.currentIdleSeconds).toBe(0);
    expect(result.current.status).toBe("IDLE");
    expect(result.current.hasAccessibilityError).toBe(false);
  });

  it("マウント時にイベントリスナーが登録されること", async () => {
    renderHook(() => useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus));
    await getActiveListeners();

    expect(listen).toHaveBeenCalledWith("window-focus-changed", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("accessibility-error", expect.any(Function));
  });

  describe("window-focus-changed イベント発生時のシナリオ", () => {
    it("DAWがアクティブかつ無操作時間が30秒未満のとき、タイムバンクが増加すること", async () => {
      const { result } = renderHook(() =>
        useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus),
      );
      await getActiveListeners();

      const focusChangedCallback = mockEventListeners["window-focus-changed"];
      expect(focusChangedCallback).toBeDefined();

      act(() => {
        focusChangedCallback({
          payload: {
            title: "My Project - Ableton Live 11",
            url: "",
            app_name: "Ableton Live 11",
            idle_seconds: 15,
          },
        });
      });

      expect(result.current.timeBank).toBe(1);
      expect(result.current.status).toBe("BUILD");
      expect(result.current.currentTitle).toBe("My Project - Ableton Live 11");
      expect(result.current.currentAppName).toBe("Ableton Live 11");
      expect(result.current.currentIdleSeconds).toBe(15);
      expect(result.current.hasAccessibilityError).toBe(false); // フォーカスイベント受信時にアクセシビリティエラーをリセット
    });

    it("DAWがアクティブだが無操作時間が30秒以上のとき、ステータスがIDLEになりタイムバンクが増加しないこと", async () => {
      const { result } = renderHook(() =>
        useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus),
      );
      await getActiveListeners();

      const focusChangedCallback = mockEventListeners["window-focus-changed"];

      act(() => {
        focusChangedCallback({
          payload: {
            title: "My Project - Ableton Live 11",
            url: "",
            app_name: "Ableton Live 11",
            idle_seconds: 30,
          },
        });
      });

      expect(result.current.timeBank).toBe(0);
      expect(result.current.status).toBe("IDLE");
      expect(result.current.currentIdleSeconds).toBe(30);
    });

    it("ブラウザがアクティブでブラックリストのタイトル/URLにマッチするとき、タイムバンクが減少すること", async () => {
      const { result } = renderHook(() =>
        useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus),
      );
      await getActiveListeners();

      // 最初にタイムバンクに時間を追加
      act(() => {
        result.current.adjustTimeBank(5);
      });
      expect(result.current.timeBank).toBe(5);

      const focusChangedCallback = mockEventListeners["window-focus-changed"];

      act(() => {
        focusChangedCallback({
          payload: {
            title: "Funny cat videos on YouTube",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            app_name: "Google Chrome",
            idle_seconds: 0,
          },
        });
      });

      expect(result.current.timeBank).toBe(4);
      expect(result.current.status).toBe("DRAIN");
      expect(result.current.currentTitle).toBe("Funny cat videos on YouTube");
      expect(result.current.currentUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    });

    it("ブラウザがアクティブでブラックリストにマッチしても、除外キーワードが含まれる場合はタイムバンクが減少しないこと", async () => {
      const { result } = renderHook(() =>
        useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus),
      );
      await getActiveListeners();

      // 最初にタイムバンクに時間を追加
      act(() => {
        result.current.adjustTimeBank(5);
      });

      const focusChangedCallback = mockEventListeners["window-focus-changed"];

      act(() => {
        focusChangedCallback({
          payload: {
            title: "Cool Music Tutorial on YouTube", // 'music' と 'tutorial' の除外キーワードにマッチ、DAWキーワードは含まない
            url: "https://www.youtube.com/watch?v=tutorial",
            app_name: "Google Chrome",
            idle_seconds: 0,
          },
        });
      });

      expect(result.current.timeBank).toBe(5);
      expect(result.current.status).toBe("IDLE");
    });

    it("タイムバンクが0に減少したとき（イベント前の値が1以下の場合）、focus_dawが呼び出されること", async () => {
      const { result } = renderHook(() =>
        useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus),
      );
      await getActiveListeners();

      // タイムバンクを1にする
      act(() => {
        result.current.adjustTimeBank(1);
      });

      const focusChangedCallback = mockEventListeners["window-focus-changed"];

      act(() => {
        focusChangedCallback({
          payload: {
            title: "Twitter Feed",
            url: "https://twitter.com/home",
            app_name: "Safari",
            idle_seconds: 0,
          },
        });
      });

      expect(result.current.timeBank).toBe(0);
      expect(result.current.status).toBe("DRAIN");
      expect(invoke).toHaveBeenCalledWith("focus_daw", { dawName: "Ableton Live" });
    });

    it("focus_dawの呼び出しに対して5秒間のクールダウン制限が機能すること", async () => {
      renderHook(() => useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus));
      await getActiveListeners();

      const focusChangedCallback = mockEventListeners["window-focus-changed"];

      // 1. タイムバンク0の時に減少イベントを発生させてinvokeを呼び出す (timeBank <= 1 のため)
      act(() => {
        focusChangedCallback({
          payload: {
            title: "Twitter Feed",
            url: "https://twitter.com/home",
            app_name: "Safari",
            idle_seconds: 0,
          },
        });
      });

      expect(invoke).toHaveBeenCalledTimes(1);

      // 2. 5秒以内のクールダウン期間中に2回目の減少イベントを発生させる
      act(() => {
        focusChangedCallback({
          payload: {
            title: "Twitter Feed 2",
            url: "https://twitter.com/home",
            app_name: "Safari",
            idle_seconds: 0,
          },
        });
      });

      // invokeは追加で呼ばれないことを確認
      expect(invoke).toHaveBeenCalledTimes(1);

      // 3. クールダウンを回避するため時間を5001ms進める
      act(() => {
        vi.advanceTimersByTime(5001);
      });

      // 4. 再度減少イベントを発生させる
      act(() => {
        focusChangedCallback({
          payload: {
            title: "Twitter Feed 3",
            url: "https://twitter.com/home",
            app_name: "Safari",
            idle_seconds: 0,
          },
        });
      });

      // invokeが2回目として呼び出されることを確認
      expect(invoke).toHaveBeenCalledTimes(2);
    });

    it("URLが空の時、YouTubeのタイトル部分一致によるフォールバック判定（Windows向け）が機能すること", async () => {
      const { result } = renderHook(() =>
        useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus),
      );
      await getActiveListeners();

      act(() => {
        result.current.adjustTimeBank(5);
      });

      const focusChangedCallback = mockEventListeners["window-focus-changed"];

      act(() => {
        // 空のURLだがタイトルにYouTubeが含まれる
        focusChangedCallback({
          payload: {
            title: "Amazing Cats - YouTube",
            url: "",
            app_name: "Google Chrome",
            idle_seconds: 0,
          },
        });
      });

      expect(result.current.timeBank).toBe(4);
      expect(result.current.status).toBe("DRAIN");
    });

    it("DAWもブラックリスト対象ブラウザもフォーカスされていない場合、ステータスがIDLEになること", async () => {
      const { result } = renderHook(() =>
        useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus),
      );
      await getActiveListeners();

      act(() => {
        result.current.adjustTimeBank(5);
      });

      const focusChangedCallback = mockEventListeners["window-focus-changed"];

      act(() => {
        focusChangedCallback({
          payload: {
            title: "System Preferences",
            url: "",
            app_name: "System Settings",
            idle_seconds: 0,
          },
        });
      });

      expect(result.current.timeBank).toBe(5); // 維持
      expect(result.current.status).toBe("IDLE");
    });
  });

  describe("accessibility-error イベント発生時のシナリオ", () => {
    it("accessibility-errorイベントがtrueで発火したとき、hasAccessibilityErrorがtrueになること", async () => {
      const { result } = renderHook(() =>
        useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus),
      );
      await getActiveListeners();

      const errorCallback = mockEventListeners["accessibility-error"];
      expect(errorCallback).toBeDefined();

      act(() => {
        errorCallback({ payload: true });
      });

      expect(result.current.hasAccessibilityError).toBe(true);
    });
  });

  describe("adjustTimeBank (タイムバンク調整機能)", () => {
    it("タイムバンクの値を増加させられること", () => {
      const { result } = renderHook(() =>
        useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus),
      );

      act(() => {
        result.current.adjustTimeBank(10);
      });
      expect(result.current.timeBank).toBe(10);
      expect(result.current.formattedTime).toBe("0:10");
    });

    it("タイムバンクの値を減少させられるが、0未満にはならないこと", () => {
      const { result } = renderHook(() =>
        useTimeBank(mockBlacklist, mockDawKeywords, mockDawNameForFocus),
      );

      act(() => {
        result.current.adjustTimeBank(10);
      });
      expect(result.current.timeBank).toBe(10);

      act(() => {
        result.current.adjustTimeBank(-4);
      });
      expect(result.current.timeBank).toBe(6);

      act(() => {
        result.current.adjustTimeBank(-10); // 0未満にしようとする
      });
      expect(result.current.timeBank).toBe(0);
    });
  });
});
