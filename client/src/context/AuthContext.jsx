import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

const STORAGE_KEY = 'napp-trapp-auth';

// Check for token in URL query params (from QR code scan)
function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  console.log('[Auth Debug] URL search:', window.location.search);
  console.log('[Auth Debug] Token from URL:', token ? `${token.substring(0, 8)}...` : 'none');
  return token;
}

// Clean the URL after extracting token (remove ?token=xxx)
function cleanUrlToken() {
  const url = new URL(window.location.href);
  url.searchParams.delete('token');
  window.history.replaceState({}, '', url.pathname + url.search);
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    // First check URL for token (QR code flow)
    const urlToken = getTokenFromUrl();
    if (urlToken) {
      return urlToken;
    }
    // Then check localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored).token : null;
  });
  const [serverUrl, setServerUrl] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored).serverUrl;
    }
    // Default to current host if accessing via server
    if (window.location.port === '3847' || window.location.hostname !== 'localhost') {
      return `${window.location.protocol}//${window.location.host}`;
    }
    return 'http://localhost:3847';
  });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [autoConnectAttempted, setAutoConnectAttempted] = useState(false);
  const [debugLog, setDebugLog] = useState([]);

  // Debug logging helper that stores logs for display
  function addDebugLog(message) {
    console.log('[Auth Debug]', message);
    setDebugLog(prev => [...prev, `${new Date().toISOString().substring(11, 19)} ${message}`]);
  }

  useEffect(() => {
    // Check if we have a token from URL (QR code scan)
    const urlToken = getTokenFromUrl();
    
    addDebugLog(`URL: ${window.location.href}`);
    addDebugLog(`urlToken: ${urlToken ? 'present' : 'absent'}`);
    addDebugLog(`autoConnectAttempted: ${autoConnectAttempted}`);
    addDebugLog(`token state: ${token ? 'present' : 'absent'}`);
    addDebugLog(`serverUrl: ${serverUrl}`);
    
    if (urlToken && !autoConnectAttempted) {
      // Auto-connect with URL token
      addDebugLog('Starting auto-connect from URL token');
      setAutoConnectAttempted(true);
      autoConnectFromUrl(urlToken);
    } else if (token && serverUrl) {
      addDebugLog('Validating existing token');
      validateToken();
    } else {
      addDebugLog('No token to validate, showing login');
      setIsLoading(false);
    }
  }, []);

  async function autoConnectFromUrl(urlToken) {
    try {
      // Use current host as server URL
      const currentUrl = `${window.location.protocol}//${window.location.host}`;
      
      addDebugLog(`Auto-connect to: ${currentUrl}`);
      addDebugLog(`Fetching: ${currentUrl}/api/system/info`);
      
      const response = await fetch(`${currentUrl}/api/system/info`, {
        headers: {
          'Authorization': `Bearer ${urlToken}`
        }
      });
      
      addDebugLog(`Response status: ${response.status}`);
      
      if (response.ok) {
        // Success! Save credentials and authenticate
        addDebugLog('SUCCESS! Authenticating...');
        setServerUrl(currentUrl);
        setToken(urlToken);
        setIsAuthenticated(true);
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          token: urlToken,
          serverUrl: currentUrl
        }));
        
        // Clean the token from URL
        cleanUrlToken();
      } else {
        // Token invalid, clear it
        const errorText = await response.text();
        addDebugLog(`FAILED: ${response.status}`);
        addDebugLog(`Error: ${errorText}`);
        cleanUrlToken();
      }
    } catch (error) {
      addDebugLog(`EXCEPTION: ${error.message}`);
      cleanUrlToken();
    } finally {
      addDebugLog('Auto-connect finished');
      setIsLoading(false);
    }
  }

  async function validateToken() {
    try {
      const response = await fetch(`${serverUrl}/api/system/info`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        setIsAuthenticated(true);
      } else {
        logout();
      }
    } catch (error) {
      console.error('Token validation failed:', error);
      // Don't logout on network error - might be temporary
    } finally {
      setIsLoading(false);
    }
  }

  async function login(url, authToken) {
    try {
      const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
      
      const response = await fetch(`${normalizedUrl}/api/system/info`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (response.ok) {
        setServerUrl(normalizedUrl);
        setToken(authToken);
        setIsAuthenticated(true);
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          token: authToken,
          serverUrl: normalizedUrl
        }));
        
        return { success: true };
      } else {
        return { success: false, error: 'Invalid token' };
      }
    } catch (error) {
      return { success: false, error: error.message || 'Connection failed' };
    }
  }

  function logout() {
    setToken(null);
    setIsAuthenticated(false);
    localStorage.removeItem(STORAGE_KEY);
  }

  async function apiRequest(endpoint, options = {}) {
    const url = `${serverUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    };
    
    const response = await fetch(url, {
      ...options,
      headers
    });
    
    if (response.status === 401) {
      logout();
      throw new Error('Session expired');
    }
    
    return response;
  }

  const value = {
    token,
    serverUrl,
    isAuthenticated,
    isLoading,
    login,
    logout,
    apiRequest,
    debugLog
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
