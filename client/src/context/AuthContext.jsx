import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

const STORAGE_KEY = 'cursor-mobile-auth';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
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

  useEffect(() => {
    if (token && serverUrl) {
      validateToken();
    } else {
      setIsLoading(false);
    }
  }, []);

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
