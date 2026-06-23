import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTimeBank } from './hooks/useTimeBank';

interface Service {
  id: string;
  name: string;
  keywords: string[];
  enabled: boolean;
}

const AVAILABLE_SERVICES: Service[] = [
  { 
    id: 'x', 
    name: 'X / Twitter', 
    keywords: ['twitter', ' / x', 'x.com'], // 👈 URLドメインも追加
    enabled: true 
  },
  { 
    id: 'youtube', 
    name: 'YouTube (Shorts含む)', 
    keywords: ['youtube', 'youtube.com', 'shorts'], // 👈 URLの「shorts」や「youtube.com」を確実に対象に
    enabled: true 
  },
  { id: 'instagram', name: 'Instagram', keywords: ['instagram', 'instagram.com'], enabled: true },
  { id: 'mixi2', name: 'mixi2', keywords: ['mixi2', 'mixi.social', 'mixi'], enabled: false },
];

export default function App() {
  const [services, setServices] = useState<Service[]>(AVAILABLE_SERVICES);
  const activeBlacklist = services.filter(s => s.enabled).flatMap(s => s.keywords);
  
  // currentUrl をフックから受け取る
  const { timeBank, currentTitle, currentUrl, status } = useTimeBank(activeBlacklist);
  
  const [hasAccessibility, setHasAccessibility] = useState<boolean>(true);
  const [hasScreenRecording, setHasScreenRecording] = useState<boolean>(true);

  const verifyPermissions = async () => {
    try {
      const axAuth = await invoke<boolean>('check_accessibility');
      const srAuth = await invoke<boolean>('check_screen_recording');
      setHasAccessibility(axAuth);
      setHasScreenRecording(srAuth);
    } catch (error) {
      console.error('権限チェックに失敗しました:', error);
    }
  };

  useEffect(() => {
    verifyPermissions();
    window.addEventListener('focus', verifyPermissions);
    return () => window.removeEventListener('focus', verifyPermissions);
  }, []);

  const toggleService = (id: string) => {
    setServices(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  };

  const statusColors = { BUILD: '#22c55e', DRAIN: '#ef4444', IDLE: '#6b7280' };
  const buttonStyle = { padding: '8px 16px', fontSize: '12px', fontWeight: 'bold' as const, backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' };

  if (!hasAccessibility || !hasScreenRecording) {
    return (
      <div style={{ padding: '40px 24px', fontFamily: 'sans-serif', backgroundColor: '#fef2f2', height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <h1 style={{ color: '#dc2626', fontSize: '22px', marginBottom: '12px' }}>🚨 動作には権限の設定が必要です</h1>
        <div style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', border: `1px solid ${hasAccessibility ? '#bbf7d0' : '#fca5a5'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ textAlign: 'left' }}><div style={{ fontWeight: 'bold', fontSize: '14px' }}>1. アクセシビリティ権限</div><div style={{ fontSize: '12px', color: hasAccessibility ? '#16a34a' : '#dc2626' }}>{hasAccessibility ? '✅ 許可済み' : '❌ 未許可'}</div></div>
            {!hasAccessibility && <button onClick={() => invoke('open_accessibility_settings')} style={buttonStyle}>設定を開く</button>}
          </div>
          <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', border: `1px solid ${hasScreenRecording ? '#bbf7d0' : '#fca5a5'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ textAlign: 'left' }}><div style={{ fontWeight: 'bold', fontSize: '14px' }}>2. 画面収録権限</div><div style={{ fontSize: '12px', color: hasScreenRecording ? '#16a34a' : '#dc2626' }}>{hasScreenRecording ? '✅ 許可済み' : '❌ 未許可'}</div></div>
            {!hasScreenRecording && <button onClick={() => invoke('open_screen_recording_settings')} style={buttonStyle}>設定を開く</button>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', fontFamily: 'sans-serif', textAlign: 'center', maxWidth: '480px', margin: '0 auto' }}>
      <h1>⏳ daw-focus-lock</h1>
      
      <div style={{ margin: '30px 0' }}>
        <p style={{ fontSize: '14px', color: '#666', margin: '0' }}>現在のSNS利用可能時間</p>
        <div style={{ fontSize: '64px', fontWeight: 'bold', color: statusColors[status], transition: 'color 0.2s' }}>
          {timeBank}
        </div>
        <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
          {status === 'BUILD' ? '🎵 作曲中（貯金UP）' : status === 'DRAIN' ? '🚨 SNS閲覧中（貯金減少）' : '☕ 待機中'}
        </div>
      </div>

      {/* スイッチ */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', backgroundColor: '#fff', textAlign: 'left', marginBottom: '24px' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#374151' }}>🛡️ 制限するサービス</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {services.map(service => (
            <div key={service.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: '500', color: service.enabled ? '#111827' : '#9ca3af' }}>{service.name}</span>
              <div onClick={() => toggleService(service.id)} style={{ width: '44px', height: '24px', backgroundColor: service.enabled ? '#22c55e' : '#cbd5e1', borderRadius: '12px', position: 'relative', cursor: 'pointer', transition: 'background-color 0.2s' }}>
                <div style={{ width: '20px', height: '20px', backgroundColor: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: service.enabled ? '22px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ウィンドウ情報 ＆ 【新機能】URL情報 */}
      <div style={{ border: '1px solid #ddd', padding: '12px', borderRadius: '8px', backgroundColor: '#f9f9f9', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ textAlign: 'left' }}>
          <p style={{ fontSize: '11px', margin: '0 0 2px 0', color: '#888' }}>検出中のウィンドウタイトル</p>
          <code style={{ fontSize: '13px', wordBreak: 'break-all', color: '#333' }}>{currentTitle}</code>
        </div>
        {currentUrl && (
          <div style={{ textAlign: 'left', borderTop: '1px solid #eee', paddingTop: '6px' }}>
            <p style={{ fontSize: '11px', margin: '0 0 2px 0', color: '#888' }}>検出中のURL</p>
            <code style={{ fontSize: '13px', wordBreak: 'break-all', color: '#0284c7' }}>{currentUrl}</code>
          </div>
        )}
      </div>
    </div>
  );
}