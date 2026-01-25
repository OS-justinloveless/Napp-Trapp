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
  
  const { login } = useAuth();
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

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>⌨️</span>
          <h1 className={styles.title}>Cursor Mobile</h1>
          <p className={styles.subtitle}>Control Cursor from your phone</p>
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
            <p className={styles.hint}>
              Leave empty if accessing via the server directly
            </p>
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
            <p className={styles.hint}>
              Token is displayed when starting the server
            </p>
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
          <h3>Quick Start</h3>
          <ol>
            <li>Run <code>npm start</code> in the server folder on your laptop</li>
            <li>Note the server URL and auth token displayed</li>
            <li>Enter them above to connect</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
