import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTimeBank } from './hooks/useTimeBank';

interface Service { id: string; name: string; keywords: string[]; enabled: boolean; }
interface DawPreset { id: string; name: string; keywords: string[]; focusName: string; }

const DAW_PRESETS: DawPreset[] = [
  { id: 'fender-studio', name: 'Fender Studio Pro 8', keywords: ['Studio Pro', 'Fender Studio', 'Studio One'], focusName: 'Studio Pro 8' },
  { id: 'cubase', name: 'Cubase', keywords: ['Cubase'], focusName: 'Cubase' },
  { id: 'logic', name: 'Logic Pro', keywords: ['Logic Pro'], focusName: 'Logic Pro' },
  { id: 'live', name: 'Ableton Live', keywords: ['Live', 'Ableton'], focusName: 'Live' },
  { id: 'fl', name: 'FL Studio', keywords: ['FL Studio'], focusName: 'FL Studio' },
  { id: 'protools', name: 'Pro Tools', keywords: ['Pro Tools'], focusName: 'Pro Tools' },
];

const AVAILABLE_SERVICES: Service[] = [
  { id: 'x', name: 'X / Twitter', keywords: ['twitter', ' / x', 'x.com'], enabled: true },
  { id: 'youtube', name: 'YouTube (Shorts含む)', keywords: ['youtube', 'youtube.com', 'shorts'], enabled: true },
  { id: 'instagram', name: 'Instagram', keywords: ['instagram', 'instagram.com'], enabled: true },
  { id: 'mixi2', name: 'mixi2', keywords: ['mixi2', 'mixi.social', 'mixi'], enabled: true },
];

export default function App() {
  const [selectedDawId, setSelectedDawId] = useState<string>('fender-studio');
  const currentDaw = DAW_PRESETS.find(d => d.id === selectedDawId) || DAW_PRESETS[0];

  const [services, setServices] = useState<Service[]>(AVAILABLE_SERVICES);
  const activeBlacklist = services.filter(s => s.enabled).flatMap(s => s.keywords);
  
  const { timeBank, currentTitle, currentUrl, currentAppName, currentIdleSeconds, status, adjustTimeBank } = useTimeBank(
    activeBlacklist, 
    currentDaw.keywords, 
    currentDaw.focusName
  );
  
  // 🎯 権限管理をアクセシビリティの1つだけに絞る
  const [hasAccessibility, setHasAccessibility] = useState<boolean>(true);

  const verifyPermissions = async () => {
    try {
      const axAuth = await invoke<boolean>('check_accessibility');
      setHasAccessibility(axAuth);
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
  const debugButtonStyle = { padding: '6px 12px', fontSize: '11px', fontWeight: 'bold' as const, backgroundColor: '#4b5563', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' };

  // 🎯 権限エラー画面も最小限にスマート化
  if (!hasAccessibility) {
    return (
      <div style={{ padding: '40px 24px', fontFamily: 'sans-serif', backgroundColor: '#fef2f2', height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <h1 style={{ color: '#dc2626', fontSize: '22px', marginBottom: '12px' }}>🚨 動作には権限の設定が必要です</h1>
        <div style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #fca5a5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 'bold', fontSize: '14px' }}>アクセシビリティ権限</div>
              <div style={{ fontSize: '12px', color: '#dc2626' }}>❌ 未許可（ウインドウ監視に必要です）</div>
            </div>
            <button onClick={() => invoke('open_accessibility_settings')} style={buttonStyle}>設定を開く</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', fontFamily: 'sans-serif', textAlign: 'center', maxWidth: '480px', margin: '0 auto' }}>
      <h1>⏳ daw-focus-lock</h1>
      
      <div style={{ margin: '24px 0' }}>
        <p style={{ fontSize: '14px', color: '#666', margin: '0' }}>現在のSNS利用可能時間</p>
        <div style={{ fontSize: '64px', fontWeight: 'bold', color: statusColors[status], transition: 'color 0.2s' }}>
          {timeBank}
        </div>
        <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
          {status === 'BUILD' ? `🎵 ${currentDaw.name}で作業中（貯金UP）` : status === 'DRAIN' ? '🚨 SNS閲覧中（貯金減少）' : '☕ 待機中'}
        </div>
      </div>

      {/* DAW切り替えセレクトボックス */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', backgroundColor: '#fff', textAlign: 'left', marginBottom: '16px' }}>
        <label htmlFor="daw-select" style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
          🎹 使用するDAWソフト
        </label>
        <select 
          id="daw-select"
          value={selectedDawId}
          onChange={(e) => setSelectedDawId(e.target.value)}
          style={{
            width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1',
            fontSize: '14px', backgroundColor: '#f8fafc', cursor: 'pointer', outline: 'none'
          }}
        >
          {DAW_PRESETS.map(daw => (
            <option key={daw.id} value={daw.id}>{daw.name}</option>
          ))}
        </select>
      </div>

      {/* デバッグパネル */}
      {import.meta.env.DEV && (
        <div style={{ border: '1px dashed #e5e7eb', borderRadius: '12px', padding: '12px', backgroundColor: '#fdf2f8', textAlign: 'left', marginBottom: '16px' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#be185d' }}>🔧 開発者用デバッグパネル</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => adjustTimeBank(60)} style={debugButtonStyle}>＋1分</button>
            <button onClick={() => adjustTimeBank(10)} style={debugButtonStyle}>＋10秒</button>
            <button onClick={() => adjustTimeBank(-10)} style={{...debugButtonStyle, backgroundColor: '#9ca3af'}}>－10秒</button>
            <button onClick={() => adjustTimeBank(-60)} style={{...debugButtonStyle, backgroundColor: '#9ca3af'}}>－1分</button>
            <button onClick={() => { adjustTimeBank(-99999); adjustTimeBank(1); }} style={{...debugButtonStyle, backgroundColor: '#dc2626'}}>💥 残り1秒</button>
          </div>
        </div>
      )}

      {/* 制限スイッチ */}
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

      {/* デバッグ・ステータス情報 */}
      <div style={{ border: '1px solid #ddd', padding: '12px', borderRadius: '8px', backgroundColor: '#f9f9f9', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #eee', paddingBottom: '4px' }}>
          <span style={{ fontSize: '11px', color: '#888' }}> 検出中のアプリ名</span>
          <strong style={{ fontSize: '12px', color: '#333' }}>{currentAppName || '検出中...'}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #eee', paddingBottom: '4px' }}>
          <span style={{ fontSize: '11px', color: '#888' }}>PC全体の無操作時間</span>
          <strong style={{ fontSize: '12px', color: currentIdleSeconds >= 30 ? '#dc2626' : '#16a34a' }}>
            {currentIdleSeconds} 秒 {currentIdleSeconds >= 30 ? '⚠️ 放置中' : '🐾 操作中'}
          </strong>
        </div>
        <div style={{ textAlign: 'left' }}>
          <p style={{ fontSize: '11px', margin: '0 0 2px 0', color: '#888' }}>検出中のウィンドウタイトル</p>
          <code style={{ fontSize: '13px', wordBreak: 'break-all', color: '#333' }}>{currentTitle}</code>
        </div>
        <div style={{ textAlign: 'left', borderTop: '1px solid #eee', paddingTop: '6px' }}>
          <p style={{ fontSize: '11px', margin: '0 0 2px 0', color: '#888' }}>検出中のURL</p>
          <code style={{ fontSize: '13px', wordBreak: 'break-all', color: currentUrl ? '#0284c7' : '#9ca3af' }}>
            {currentUrl || '（空：自動化の許可がないか、未対応アプリです）'}
          </code>
        </div>
      </div>
    </div>
  );
}