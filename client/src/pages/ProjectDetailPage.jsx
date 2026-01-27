import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import styles from './ProjectDetailPage.module.css';

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [tree, setTree] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [activeTab, setActiveTab] = useState('files'); // 'files' or 'chats'
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  
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
      
      // Load project and tree first (critical)
      const [projectRes, treeRes] = await Promise.all([
        apiRequest(`/api/projects/${projectId}`),
        apiRequest(`/api/projects/${projectId}/tree?depth=4`)
      ]);
      
      const projectData = await projectRes.json();
      const treeData = await treeRes.json();
      
      setProject(projectData.project);
      setTree(treeData.tree || []);
      
      // Load conversations separately so it doesn't break the page if it fails
      try {
        const conversationsRes = await apiRequest(`/api/projects/${projectId}/conversations`);
        const conversationsData = await conversationsRes.json();
        setConversations(conversationsData.conversations || []);
      } catch (convErr) {
        console.error('Failed to load conversations:', convErr);
        setConversations([]);
      }
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

  async function createNewChat() {
    if (isCreatingChat) return;
    
    try {
      setIsCreatingChat(true);
      const response = await apiRequest('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: projectId })
      });
      
      const data = await response.json();
      
      if (data.chatId) {
        // Navigate to the new chat
        navigate(`/chat/${data.chatId}?type=chat&workspaceId=${projectId}`);
      } else {
        console.error('No chatId returned from create conversation');
      }
    } catch (err) {
      console.error('Failed to create chat:', err);
      setError('Failed to create new chat: ' + err.message);
    } finally {
      setIsCreatingChat(false);
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
      
      {/* Tab Navigation */}
      <div className={styles.tabs}>
        <button 
          className={`${styles.tab} ${activeTab === 'files' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('files')}
        >
          📁 Files
        </button>
        <button 
          className={`${styles.tab} ${activeTab === 'chats' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('chats')}
        >
          💬 Chats ({conversations.length})
        </button>
      </div>
      
      {/* Files Tab */}
      {activeTab === 'files' && (
        <div className={styles.fileTree}>
          <FileTreeNode 
            items={tree} 
            expandedDirs={expandedDirs}
            onToggleDir={toggleDir}
            onOpenFile={openFile}
            depth={0}
          />
        </div>
      )}
      
      {/* Chats Tab */}
      {activeTab === 'chats' && (
        <div className={styles.chatList}>
          <button 
            className={styles.newChatButton} 
            onClick={createNewChat}
            disabled={isCreatingChat}
          >
            {isCreatingChat ? '⏳ Creating...' : '➕ New Chat'}
          </button>
          
          {conversations.length === 0 ? (
            <div className={styles.emptyChats}>
              <span className={styles.emptyIcon}>💬</span>
              <p>No conversations for this project yet</p>
              <p className={styles.emptyHint}>Start a new chat to begin</p>
            </div>
          ) : (
            conversations.map((conversation) => (
              <div 
                key={conversation.id}
                className={styles.chatCard}
                onClick={() => navigate(`/chat/${conversation.id}?type=${conversation.type}&workspaceId=${conversation.workspaceId || 'global'}`)}
              >
                <span className={styles.chatIcon}>
                  {conversation.type === 'composer' ? '🎹' : '💬'}
                </span>
                <div className={styles.chatInfo}>
                  <h4 className={styles.chatTitle}>
                    {truncateTitle(conversation.title)}
                  </h4>
                  <div className={styles.chatMeta}>
                    <span className={`${styles.typeTag} ${styles[conversation.type + 'Tag']}`}>
                      {conversation.type === 'composer' ? 'Composer' : 'Chat'}
                    </span>
                    <span className={styles.messageCount}>
                      {conversation.messageCount || 0} messages
                    </span>
                    <span className={styles.chatDate}>
                      {formatDate(conversation.timestamp)}
                    </span>
                  </div>
                </div>
                <span className={styles.arrow}>›</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function truncateTitle(title, maxLength = 80) {
  if (!title) return 'Untitled';
  if (title.length <= maxLength) return title;
  return title.slice(0, maxLength) + '...';
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  
  const date = new Date(typeof timestamp === 'number' ? timestamp : Date.parse(timestamp));
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  
  return date.toLocaleDateString();
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
