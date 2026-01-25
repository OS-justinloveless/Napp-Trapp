import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useWebSocket } from '../context/WebSocketContext';
import styles from './Layout.module.css';

const navItems = [
  { path: '/projects', icon: '📁', label: 'Projects' },
  { path: '/files', icon: '📄', label: 'Files' },
  { path: '/conversations', icon: '💬', label: 'Chat' },
  { path: '/settings', icon: '⚙️', label: 'Settings' }
];

export default function Layout({ children }) {
  const location = useLocation();
  const { isConnected } = useWebSocket();
  
  // Get current page title
  const currentNav = navItems.find(item => location.pathname.startsWith(item.path));
  const title = currentNav?.label || 'Cursor Mobile';

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.status}>
            <span className={`${styles.statusDot} ${isConnected ? styles.connected : styles.disconnected}`} />
            <span className={styles.statusText}>
              {isConnected ? 'Connected' : 'Offline'}
            </span>
          </div>
        </div>
      </header>
      
      <main className={styles.main}>
        {children}
      </main>
      
      <nav className={styles.nav}>
        {navItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => 
              `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
            }
          >
            <span className={styles.navIcon}>{item.icon}</span>
            <span className={styles.navLabel}>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
