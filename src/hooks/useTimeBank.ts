import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface WindowInfo {
  title: string;
  url: string;
  app_name: string;
  idle_seconds: number;
}

const BROWSER_APPS = [
  'Google Chrome', 'Safari', 'Arc', 'Brave Browser', 'Microsoft Edge', 'Vivaldi'
];

export const useTimeBank = (blacklist: string[], dawKeywords: string[], dawNameForFocus: string) => {
  const [timeBank, setTimeBank] = useState<number>(0);
  const [currentTitle, setCurrentTitle] = useState<string>('監視未始動');
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [currentAppName, setCurrentAppName] = useState<string>('');
  const [currentIdleSeconds, setCurrentIdleSeconds] = useState<number>(0);
  const [status, setStatus] = useState<'BUILD' | 'DRAIN' | 'IDLE'>('IDLE');

  const blacklistRef = useRef(blacklist);
  const dawKeywordsRef = useRef(dawKeywords);
  const dawNameForFocusRef = useRef(dawNameForFocus);

  useEffect(() => {
    blacklistRef.current = blacklist;
    dawKeywordsRef.current = dawKeywords;
    dawNameForFocusRef.current = dawNameForFocus;
  }, [blacklist, dawKeywords, dawNameForFocus]);

  useEffect(() => {
    // 🎯 【新ロジック】この useEffect が現在も有効かどうかを追跡するフラグ
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

        // 1. 加算判定
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
        // 2. 減算判定
        else if (
          BROWSER_APPS.includes(app_name) &&
          currentBlacklist.some(keyword => {
            const lowKey = keyword.toLowerCase();
            return lowerTitle.includes(lowKey) || lowerUrl.includes(lowKey);
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

      // 🎯 【重要】非同期処理を待っている間に、すでにコンポーネントがアンマウントされていた場合
      if (!active) {
        unlisten(); // 作られたゾンビリスナーをその場で即座に処刑（解除）する
      } else {
        unlistenFunc = unlisten; // まだ生きていれば変数に保持
      }
    };

    setupListener();

    return () => {
      active = false; // 1回目の高速アンマウント時にここが true になる
      if (unlistenFunc) {
        unlistenFunc();
      }
    };
  }, []);

  const adjustTimeBank = (amountSeconds: number) => {
    setTimeBank((prev) => {
      const nextTime = prev + amountSeconds;
      return nextTime < 0 ? 0 : nextTime;
    });
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return { timeBank: formatTime(timeBank), currentTitle, currentUrl, currentAppName, currentIdleSeconds, status, adjustTimeBank };
};