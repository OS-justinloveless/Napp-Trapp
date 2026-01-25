import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import styles from './ProjectDetailPage.module.css';

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [tree, setTree] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  
  const { apiRequest } = useAuth();
  const { watchPath, fileChanges } = useWebSocket();
  const navigate = useNavigate();

  useEffect(() => {
    loadProject();
  }, [projectId]);

  useEffect(() => {
    if (project?.path) {
      watchPath(project.path);
    }
  }, [project?.path]);

  async function loadProject() {
    try {
      setIsLoading(true);
      setError(null);
      
      const [projectRes, treeRes] = await Promise.all([
        apiRequest(`/api/projects/${projectId}`),
        apiRequest(`/api/projects/${projectId}/tree?depth=4`)
      ]);
      
      const projectData = await projectRes.json();
      const treeData = await treeRes.json();
      
      setProject(projectData.project);
      setTree(treeData.tree || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function openInCursor() {
    try {
      await apiRequest(`/api/projects/${projectId}/open`, {
        method: 'POST'
      });
    } catch (err) {
      console.error('Failed to open project:', err);
    }
  }

  function toggleDir(path) {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function openFile(filePath) {
    navigate(`/file?path=${encodeURIComponent(filePath)}`);
  }

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading project...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        <p>{error}</p>
        <button onClick={() => navigate('/projects')}>Back to Projects</button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <button className={styles.backButton} onClick={() => navigate('/projects')}>
        ← Back
      </button>
      
      <div className={styles.header}>
        <span className={styles.icon}>📁</span>
        <div className={styles.info}>
          <h2 className={styles.name}>{project?.name}</h2>
          <p className={styles.path}>{project?.path}</p>
        </div>
      </div>
      
      <div className={styles.actions}>
        <button className={styles.actionButton} onClick={openInCursor}>
          🚀 Open in Cursor
        </button>
        <button className={styles.actionButton} onClick={loadProject}>
          🔄 Refresh
        </button>
      </div>
      
      {fileChanges.length > 0 && (
        <div className={styles.changes}>
          <h3>Recent Changes</h3>
          {fileChanges.slice(0, 5).map((change, i) => (
            <div key={i} className={styles.change}>
              <span className={styles.changeEvent}>{change.event}</span>
              <span className={styles.changePath}>{change.relativePath}</span>
            </div>
          ))}
        </div>
      )}
      
      <div className={styles.fileTree}>
        <h3>Files</h3>
        <FileTreeNode 
          items={tree} 
          expandedDirs={expandedDirs}
          onToggleDir={toggleDir}
          onOpenFile={openFile}
          depth={0}
        />
      </div>
    </div>
  );
}

function FileTreeNode({ items, expandedDirs, onToggleDir, onOpenFile, depth }) {
  if (!Array.isArray(items)) return null;
  
  return (
    <div className={styles.treeLevel} style={{ paddingLeft: depth * 16 }}>
      {items.map((item) => (
        <div key={item.path} className={styles.treeItem}>
          {item.type === 'directory' ? (
            <>
              <div 
                className={styles.dirRow}
                onClick={() => onToggleDir(item.path)}
              >
                <span className={styles.arrow}>
                  {expandedDirs.has(item.path) ? '▼' : '▶'}
                </span>
                <span className={styles.folderIcon}>📁</span>
                <span className={styles.itemName}>{item.name}</span>
              </div>
              {expandedDirs.has(item.path) && item.children && (
                <FileTreeNode 
                  items={item.children}
                  expandedDirs={expandedDirs}
                  onToggleDir={onToggleDir}
                  onOpenFile={onOpenFile}
                  depth={depth + 1}
                />
              )}
            </>
          ) : (
            <div 
              className={styles.fileRow}
              onClick={() => onOpenFile(item.path)}
            >
              <span className={styles.fileIcon}>
                {getFileIcon(item.extension)}
              </span>
              <span className={styles.itemName}>{item.name}</span>
              <span className={styles.fileSize}>
                {formatSize(item.size)}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function getFileIcon(ext) {
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
    rs: '🦀'
  };
  return icons[ext] || '📄';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
