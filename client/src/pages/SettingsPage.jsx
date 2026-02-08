import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { useTheme, THEMES } from '../context/ThemeContext';
import styles from './SettingsPage.module.css';

export default function SettingsPage() {
  const { serverUrl, logout, apiRequest } = useAuth();
  const { isConnected, fileChanges } = useWebSocket();
  const { theme, setTheme } = useTheme();
  
  const [systemInfo, setSystemInfo] = useState(null);
  const [networkInfo, setNetworkInfo] = useState([]);
  const [toolsStatus, setToolsStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSystemInfo();
  }, []);

  async function loadSystemInfo() {
    try {
      setIsLoading(true);
      
      const [sysRes, netRes] = await Promise.all([
        apiRequest('/api/system/info'),
        apiRequest('/api/system/network')
      ]);
      
      setSystemInfo(await sysRes.json());
      setNetworkInfo((await netRes.json()).addresses || []);
      
      // Load tools status separately (non-critical)
      try {
        const toolsRes = await apiRequest('/api/system/tools-status');
        setToolsStatus(await toolsRes.json());
      } catch (err) {
        console.error('Failed to load tools status:', err);
      }
    } catch (err) {
      console.error('Failed to load system info:', err);
    } finally {
      setIsLoading(false);
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  return (
    <div className={styles.container}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Appearance</h2>
        <div className={styles.themeGrid}>
          {Object.values(THEMES).map((t) => (
            <button
              key={t.id}
              className={`${styles.themeOption} ${theme === t.id ? styles.themeSelected : ''}`}
              onClick={() => setTheme(t.id)}
              aria-label={`Select ${t.name} theme`}
            >
              <div 
                className={styles.themePreview}
                data-theme-preview={t.id}
              >
                <div className={styles.themePreviewIcon}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                    <path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7z"/>
                  </svg>
                </div>
              </div>
              <span className={styles.themeName}>{t.name}</span>
              {theme === t.id && (
                <span className={styles.themeCheck}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Connection</h2>
        <div className={styles.card}>
          <div className={styles.statusRow}>
            <span className={styles.label}>Status</span>
            <span className={`${styles.status} ${isConnected ? styles.connected : styles.disconnected}`}>
              <span className={styles.statusDot} />
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Server</span>
            <span className={styles.value}>{serverUrl}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Real-time Events</span>
            <span className={styles.value}>{fileChanges.length} received</span>
          </div>
        </div>
      </section>

      {toolsStatus && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>AI CLI Tools</h2>
          <div className={styles.card}>
            {Object.entries(toolsStatus.tools || {}).map(([toolId, info]) => (
              <div key={toolId} className={styles.statusRow}>
                <span className={styles.label}>{info.displayName || toolId}</span>
                <span className={`${styles.status} ${info.available ? styles.connected : styles.disconnected}`}>
                  <span className={styles.statusDot} />
                  {info.available ? 'Installed' : 'Not Found'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>System</h2>
        {isLoading ? (
          <div className={styles.loadingCard}>
            <div className={styles.spinner} />
          </div>
        ) : systemInfo ? (
          <div className={styles.card}>
            <div className={styles.infoRow}>
              <span className={styles.label}>Hostname</span>
              <span className={styles.value}>{systemInfo.hostname}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Platform</span>
              <span className={styles.value}>{systemInfo.platform} ({systemInfo.arch})</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>User</span>
              <span className={styles.value}>{systemInfo.username}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>CPUs</span>
              <span className={styles.value}>{systemInfo.cpus} cores</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Memory</span>
              <span className={styles.value}>
                {formatBytes(systemInfo.memory.used)} / {formatBytes(systemInfo.memory.total)}
              </span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Uptime</span>
              <span className={styles.value}>{formatUptime(systemInfo.uptime)}</span>
            </div>
          </div>
        ) : null}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Network</h2>
        <div className={styles.card}>
          {networkInfo.length === 0 ? (
            <p className={styles.noData}>No network interfaces found</p>
          ) : (
            networkInfo.map((iface, index) => (
              <div key={index} className={styles.networkItem}>
                <span className={styles.interfaceName}>{iface.name}</span>
                <span className={styles.interfaceAddress}>{iface.address}</span>
              </div>
            ))
          )}
        </div>
        <p className={styles.hint}>
          Use one of these IP addresses to connect from your phone
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Account</h2>
        <button className={styles.logoutButton} onClick={logout}>
          Log Out
        </button>
      </section>

      <footer className={styles.footer}>
        <p>Napp Trapp v1.0.0</p>
        <p>Your standalone mobile IDE</p>
      </footer>
    </div>
  );
}
