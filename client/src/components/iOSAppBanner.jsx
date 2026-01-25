import React, { useState, useEffect } from 'react';
import styles from './iOSAppBanner.module.css';

const IOS_APP_SCHEME = 'cursor-mobile';
const IOS_APP_STORE_URL = 'https://apps.apple.com/app/cursor-mobile'; // Placeholder

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

export default function IOSAppBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if user is on iOS and hasn't dismissed the banner
    const wasDismissed = localStorage.getItem('ios-app-banner-dismissed');
    
    if (isIOS() && !isStandalone() && !wasDismissed) {
      setShowBanner(true);
    }
  }, []);

  function dismiss() {
    setDismissed(true);
    setShowBanner(false);
    localStorage.setItem('ios-app-banner-dismissed', 'true');
  }

  function openNativeApp() {
    // Get current URL and auth token
    const token = localStorage.getItem('cursor-mobile-auth');
    const authData = token ? JSON.parse(token) : null;
    
    // Build deep link URL
    const currentHost = window.location.hostname;
    const currentPort = window.location.port || '3847';
    const authToken = authData?.token || '';
    
    const deepLink = `${IOS_APP_SCHEME}://connect?server=${currentHost}:${currentPort}&token=${authToken}`;
    
    // Try to open the app
    window.location.href = deepLink;
    
    // If the app doesn't open within 1 second, the app isn't installed
    // In production, you'd redirect to App Store
    setTimeout(() => {
      // App wasn't installed - could show a message or redirect to App Store
      // For now, just dismiss the banner
    }, 1500);
  }

  if (!showBanner || dismissed) {
    return null;
  }

  return (
    <div className={styles.banner}>
      <div className={styles.content}>
        <div className={styles.icon}>📱</div>
        <div className={styles.text}>
          <strong>Cursor Mobile App</strong>
          <span>Get a better experience with our native iOS app</span>
        </div>
      </div>
      <div className={styles.actions}>
        <button className={styles.openButton} onClick={openNativeApp}>
          Open App
        </button>
        <button className={styles.dismissButton} onClick={dismiss}>
          ✕
        </button>
      </div>
    </div>
  );
}

// Hook to check if we should show native app prompt
export function useIOSAppDetection() {
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [hasNativeApp, setHasNativeApp] = useState(false);

  useEffect(() => {
    setIsIOSDevice(isIOS());
    
    // Check if app is installed by trying to detect if deep link works
    // This is a simplified check - in production you'd use Universal Links
    if (isIOS()) {
      // For now, assume app might be installed
      setHasNativeApp(true);
    }
  }, []);

  function openInNativeApp(serverUrl, token) {
    if (!isIOSDevice) return false;
    
    const url = new URL(serverUrl);
    const deepLink = `${IOS_APP_SCHEME}://connect?server=${url.host}&token=${token}`;
    
    window.location.href = deepLink;
    return true;
  }

  return {
    isIOSDevice,
    hasNativeApp,
    openInNativeApp
  };
}
