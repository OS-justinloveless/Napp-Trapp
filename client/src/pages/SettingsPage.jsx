import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import styles from './SettingsPage.module.css';

export default function SettingsPage() {
  const { serverUrl, logout, apiRequest } = useAuth();
  const { isConnected, fileChanges } = useWebSocket();
  
  const [systemInfo, setSystemInfo] = useState(null);
  const [networkInfo, setNetworkInfo] = useState([]);
  const [cursorStatus, setCursorStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSystemInfo();
  }, []);

  async function loadSystemInfo() {
    try {
      setIsLoading(true);
      
      const [sysRes, netRes, cursorRes] = await Promise.all([
        apiRequest('/api/system/info'),
        apiRequest('/api/system/network'),
        apiRequest('/api/system/cursor-status')
      ]);
      
      setSystemInfo(await sysRes.json());
      setNetworkInfo((await netRes.json()).addresses || []);
      setCursorStatus(await cursorRes.json());
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

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Cursor IDE</h2>
        <div className={styles.card}>
          <div className={styles.statusRow}>
            <span className={styles.label}>Status</span>
            <span className={`${styles.status} ${cursorStatus?.isRunning ? styles.connected : styles.disconnected}`}>
              <span className={styles.statusDot} />
              {cursorStatus?.isRunning ? 'Running' : 'Not Running'}
            </span>
          </div>
          {cursorStatus?.version && (
            <div className={styles.infoRow}>
              <span className={styles.label}>Version</span>
              <span className={styles.value}>{cursorStatus.version}</span>
            </div>
          )}
        </div>
      </section>

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
        <p>Cursor Mobile Access v1.0.0</p>
        <p>Control your Cursor IDE remotely</p>
      </footer>
    </div>
  );
}
