import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './FileBrowserPage.module.css';

export default function FileBrowserPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPath = searchParams.get('path') || '';
  
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [customPath, setCustomPath] = useState('');
  
  const { apiRequest } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (currentPath) {
      loadDirectory(currentPath);
    } else {
      loadHomeDirectory();
    }
  }, [currentPath]);

  async function loadHomeDirectory() {
    try {
      const response = await apiRequest('/api/system/info');
      const data = await response.json();
      const homePath = data.homeDir;
      setSearchParams({ path: homePath });
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  }

  async function loadDirectory(dirPath) {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await apiRequest(`/api/files/list?dirPath=${encodeURIComponent(dirPath)}`);
      
      if (!response.ok) {
        throw new Error('Failed to load directory');
      }
      
      const data = await response.json();
      setItems(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  function navigateTo(path) {
    if (path.endsWith('/')) {
      setSearchParams({ path });
    } else {
      // It's a file
      navigate(`/file?path=${encodeURIComponent(path)}`);
    }
  }

  function goUp() {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      const parentPath = '/' + parts.join('/');
      setSearchParams({ path: parentPath });
    }
  }

  function handleCustomPath(e) {
    e.preventDefault();
    if (customPath.trim()) {
      setSearchParams({ path: customPath.trim() });
      setCustomPath('');
    }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString();
  }

  return (
    <div className={styles.container}>
      <div className={styles.pathBar}>
        <button className={styles.upButton} onClick={goUp} disabled={!currentPath}>
          ⬆️
        </button>
        <div className={styles.currentPath}>
          {currentPath || 'Select a directory'}
        </div>
      </div>
      
      <form onSubmit={handleCustomPath} className={styles.customPathForm}>
        <input
          type="text"
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          placeholder="Enter path to navigate..."
          className={styles.customPathInput}
        />
        <button type="submit" className={styles.goButton}>Go</button>
      </form>

      {isLoading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Loading...</p>
        </div>
      ) : error ? (
        <div className={styles.error}>
          <p>{error}</p>
          <button onClick={() => loadDirectory(currentPath)}>Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>📂</span>
          <p>Directory is empty</p>
        </div>
      ) : (
        <div className={styles.fileList}>
          {items.map((item) => (
            <div 
              key={item.path}
              className={styles.fileItem}
              onClick={() => navigateTo(item.path)}
            >
              <span className={styles.itemIcon}>
                {item.isDirectory ? '📁' : getFileIcon(item.name)}
              </span>
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{item.name}</span>
                <span className={styles.itemMeta}>
                  {item.isDirectory ? 'Folder' : formatSize(item.size)}
                  {' • '}
                  {formatDate(item.modified)}
                </span>
              </div>
              <span className={styles.itemArrow}>›</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const icons = {
    js: '📜',
    jsx: '⚛️',
    ts: '📘',
    tsx: '⚛️',
    py: '🐍',
    json: '📋',
    md: '📝',
    css: '🎨',
    html: '🌐',
    yml: '⚙️',
    yaml: '⚙️',
    sh: '💻',
    sql: '🗃️',
    go: '🐹',
    rs: '🦀',
    txt: '📄',
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    gif: '🖼️',
    svg: '🖼️',
    pdf: '📕'
  };
  return icons[ext] || '📄';
}
