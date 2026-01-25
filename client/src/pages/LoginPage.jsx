import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const [serverUrl, setServerUrl] = useState(() => {
    // Default to current host if not localhost
    if (window.location.hostname !== 'localhost' || window.location.port === '3847') {
      return `${window.location.protocol}//${window.location.host}`;
    }
    return '';
  });
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const { login, isLoading: isAutoConnecting } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    
    try {
      const url = serverUrl || `${window.location.protocol}//${window.location.host}`;
      const result = await login(url, token);
      
      if (result.success) {
        navigate('/');
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  // Show loading while auto-connecting from QR code
  if (isAutoConnecting) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.connecting}>
            <div className={styles.spinner}></div>
            <h2>Connecting...</h2>
            <p>Setting up your connection</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>⌨️</span>
          <h1 className={styles.title}>Cursor Mobile</h1>
          <p className={styles.subtitle}>Control Cursor from your phone</p>
        </div>
        
        <div className={styles.qrInfo}>
          <span className={styles.qrIcon}>📱</span>
          <div>
            <h3>Scan QR Code to Connect</h3>
            <p>Use your phone's camera to scan the QR code shown in the server terminal</p>
          </div>
        </div>
        
        <div className={styles.divider}>
          <span>or connect manually</span>
        </div>
        
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>Server URL</label>
            <input
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://192.168.1.100:3847"
              className={styles.input}
              autoComplete="url"
            />
          </div>
          
          <div className={styles.field}>
            <label className={styles.label}>Auth Token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your authentication token"
              className={styles.input}
              required
              autoComplete="current-password"
            />
          </div>
          
          {error && (
            <div className={styles.error}>
              {error}
            </div>
          )}
          
          <button 
            type="submit" 
            className={styles.button}
            disabled={isLoading || !token}
          >
            {isLoading ? 'Connecting...' : 'Connect'}
          </button>
        </form>
        
        <div className={styles.help}>
          <h3>How to Connect</h3>
          <ol>
            <li>Run <code>npm start</code> in the server folder on your laptop</li>
            <li>Point your phone camera at the QR code in the terminal</li>
            <li>Tap the notification to open and connect automatically</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
