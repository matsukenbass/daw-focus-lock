import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// Rustから送られてくるデータの型定義
interface WindowInfo {
  title: string;
  url: string;
}

export const useTimeBank = (blacklist: string[]) => {
  const [timeBank, setTimeBank] = useState<number>(0);
  const [currentTitle, setCurrentTitle] = useState<string>('監視未始動');
  const [currentUrl, setCurrentUrl] = useState<string>(''); // 【新機能】URL状態
  const [status, setStatus] = useState<'BUILD' | 'DRAIN' | 'IDLE'>('IDLE');

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      // 受信型を WindowInfo に
      unlisten = await listen<WindowInfo>('window-focus-changed', (event) => {
        const { title, url } = event.payload;
        
        if (!title || title.trim() === '') return;

        setCurrentTitle(title);
        setCurrentUrl(url);
        
        const lowerTitle = title.toLowerCase();
        const lowerUrl = url.toLowerCase();

        // 1. 加算判定 (Studio One)
        if (lowerTitle.includes('studio one')) {
          setTimeBank((prev) => prev + 1);
          setStatus('BUILD');
        } 
        // 2. 減算判定 (【強化】タイトル、またはURLのいずれかに部分一致したら発動)
        else if (
          blacklist.some(keyword => {
            const lowKey = keyword.toLowerCase();
            return lowerTitle.includes(lowKey) || lowerUrl.includes(lowKey);
          })
        ) {
          setStatus('DRAIN');
          setTimeBank((prev) => {
            if (prev <= 1) {
              triggerPenalty();
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
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [blacklist]);

  const triggerPenalty = async () => {
    try {
      await invoke('focus_daw');
    } catch (error) {
      console.error('フォーカス移動に失敗しました:', error);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return { timeBank: formatTime(timeBank), currentTitle, currentUrl, status }; // currentUrlを追加
};