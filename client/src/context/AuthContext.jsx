import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

const STORAGE_KEY = 'cursor-mobile-auth';

// Check for token in URL query params (from QR code scan)
function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('token');
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

  useEffect(() => {
    // Check if we have a token from URL (QR code scan)
    const urlToken = getTokenFromUrl();
    
    if (urlToken && !autoConnectAttempted) {
      // Auto-connect with URL token
      setAutoConnectAttempted(true);
      autoConnectFromUrl(urlToken);
    } else if (token && serverUrl) {
      validateToken();
    } else {
      setIsLoading(false);
    }
  }, []);

  async function autoConnectFromUrl(urlToken) {
    try {
      // Use current host as server URL
      const currentUrl = `${window.location.protocol}//${window.location.host}`;
      
      const response = await fetch(`${currentUrl}/api/system/info`, {
        headers: {
          'Authorization': `Bearer ${urlToken}`
        }
      });
      
      if (response.ok) {
        // Success! Save credentials and authenticate
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
        cleanUrlToken();
      }
    } catch (error) {
      console.error('Auto-connect failed:', error);
      cleanUrlToken();
    } finally {
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
    apiRequest
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
