import { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

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

const BROWSER_APPS = [
  'Google Chrome', 'Safari', 'Arc', 'Brave Browser', 'Microsoft Edge', 'Vivaldi'
];

/**
 * 秒数を受け取り、 "M:SS" 形式の文字列にフォーマットする
 */
export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const useTimeBank = (blacklist: BlacklistItem[], dawKeywords: string[], dawNameForFocus: string) => {
  const [timeBank, setTimeBank] = useState<number>(0);
  const [currentTitle, setCurrentTitle] = useState<string>('監視未始動');
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [currentAppName, setCurrentAppName] = useState<string>('');
  const [currentIdleSeconds, setCurrentIdleSeconds] = useState<number>(0);
  const [status, setStatus] = useState<'BUILD' | 'DRAIN' | 'IDLE'>('IDLE');

  const blacklistRef = useRef<BlacklistItem[]>(blacklist);
  const dawKeywordsRef = useRef(dawKeywords);
  const dawNameForFocusRef = useRef(dawNameForFocus);

  useEffect(() => {
    blacklistRef.current = blacklist;
    dawKeywordsRef.current = dawKeywords;
    dawNameForFocusRef.current = dawNameForFocus;
  }, [blacklist, dawKeywords, dawNameForFocus]);

  useEffect(() => {
    // コンポーネントのクリーンアップ時およびアンマウント時に非同期リスナーを追跡するフラグ
    let active = true; 
    let unlistenFunc: (() => void) | undefined;

    const setupListener = async () => {
      const unlisten = await listen<WindowInfo>('window-focus-changed', (event) => {
        const { title, url, app_name, idle_seconds } = event.payload;
        
        if (!title || title.trim() === '') return;

        setCurrentTitle(title);
        setCurrentUrl(url);
        setCurrentAppName(app_name);
        setCurrentIdleSeconds(idle_seconds);
        
        const lowerTitle = title.toLowerCase();
        const lowerUrl = url.toLowerCase();
        const lowerAppName = app_name.toLowerCase();

        const currentDawKeywords = dawKeywordsRef.current;
        const currentBlacklist = blacklistRef.current;

        // 1. 加算判定 (DAWソフトがアクティブ & 30秒未満操作があるとき)
        if (
          currentDawKeywords.some(keyword => 
            lowerTitle.includes(keyword.toLowerCase()) || 
            lowerAppName.includes(keyword.toLowerCase())
          )
        ) {
          if (idle_seconds >= 30) {
            setStatus('IDLE');
          } else {
            setTimeBank((prev) => prev + 1);
            setStatus('BUILD');
          }
        } 
        // 2. 減算判定 (ブラウザがアクティブ & ブラックリストURL/タイトルのとき)
        else if (
          BROWSER_APPS.includes(app_name) &&
          currentBlacklist.some(item => {
            const hasKeyword = item.keywords.some(k => {
              const lowKey = k.toLowerCase();
              return lowerTitle.includes(lowKey) || lowerUrl.includes(lowKey);
            });
            const hasExclude = item.excludeKeywords?.some(ex => {
              const lowEx = ex.toLowerCase();
              return lowerTitle.includes(lowEx) || lowerUrl.includes(lowEx);
            }) ?? false;
            return hasKeyword && !hasExclude;
          })
        ) {
          setStatus('DRAIN');
          setTimeBank((prev) => {
            if (prev <= 1) {
              invoke('focus_daw', { dawName: dawNameForFocusRef.current }).catch(console.error);
              return 0;
            }
            return prev - 1;
          });
        } 
        // 3. 維持
        else {
          setStatus('IDLE');
        }
      });

      // 非同期解決の間にアンマウントされた場合は即座にリスナー解除する
      if (!active) {
        unlisten();
      } else {
        unlistenFunc = unlisten;
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
    adjustTimeBank 
  };
};