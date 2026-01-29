import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'napp-trapp-theme';

export const THEMES = {
  night: {
    id: 'night',
    name: 'Night',
    description: 'Dark theme with cyan accents',
  },
  light: {
    id: 'light', 
    name: 'Light',
    description: 'Light theme for bright environments',
  },
  forest: {
    id: 'forest',
    name: 'Forest',
    description: 'Deep green theme with mint accents',
  },
  desert: {
    id: 'desert',
    name: 'Desert',
    description: 'Warm golden theme with magenta accents',
  },
};

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored || 'night';
  });

  useEffect(() => {
    // Apply theme class to document root
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  function setTheme(newTheme) {
    if (THEMES[newTheme]) {
      setThemeState(newTheme);
    }
  }

  const value = {
    theme,
    setTheme,
    themes: THEMES,
    currentTheme: THEMES[theme],
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
