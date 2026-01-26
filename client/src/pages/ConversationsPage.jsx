import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './ConversationsPage.module.css';

export default function ConversationsPage() {
  const [conversations, setConversations] = useState([]);
  const [filteredConversations, setFilteredConversations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all', 'chat', 'composer'
  const [searchQuery, setSearchQuery] = useState('');
  
  const { apiRequest } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    filterConversations();
  }, [conversations, filter, searchQuery]);

  async function loadConversations() {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await apiRequest('/api/conversations');
      const data = await response.json();
      setConversations(data.conversations || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  function filterConversations() {
    let filtered = [...conversations];
    
    // Apply type filter
    if (filter !== 'all') {
      filtered = filtered.filter(c => c.type === filter);
    }
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c => 
        c.title?.toLowerCase().includes(query) ||
        c.projectName?.toLowerCase().includes(query) ||
        c.matchText?.toLowerCase().includes(query)
      );
    }
    
    setFilteredConversations(filtered);
  }

  function selectConversation(conversation) {
    navigate(`/chat/${conversation.id}?type=${conversation.type}&workspaceId=${conversation.workspaceId || 'global'}`);
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

  function getTypeIcon(type) {
    return type === 'composer' ? '🎹' : '💬';
  }

  function getTypeLabel(type) {
    return type === 'composer' ? 'Composer' : 'Chat';
  }

  function truncateTitle(title, maxLength = 80) {
    if (!title) return 'Untitled';
    if (title.length <= maxLength) return title;
    return title.slice(0, maxLength) + '...';
  }

  return (
    <div className={styles.container}>
      {/* Search and Filter Bar */}
      <div className={styles.searchBar}>
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={styles.searchInput}
        />
        <button 
          className={styles.refreshButton}
          onClick={loadConversations}
          title="Refresh"
        >
          ↻
        </button>
      </div>
      
      {/* Filter Tabs */}
      <div className={styles.filterTabs}>
        <button 
          className={`${styles.filterTab} ${filter === 'all' ? styles.activeTab : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({conversations.length})
        </button>
        <button 
          className={`${styles.filterTab} ${filter === 'chat' ? styles.activeTab : ''}`}
          onClick={() => setFilter('chat')}
        >
          💬 Chats ({conversations.filter(c => c.type === 'chat').length})
        </button>
        <button 
          className={`${styles.filterTab} ${filter === 'composer' ? styles.activeTab : ''}`}
          onClick={() => setFilter('composer')}
        >
          🎹 Composer ({conversations.filter(c => c.type === 'composer').length})
        </button>
      </div>

      {isLoading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Loading conversations...</p>
        </div>
      ) : error ? (
        <div className={styles.error}>
          <p>{error}</p>
          <button onClick={loadConversations}>Retry</button>
        </div>
      ) : filteredConversations.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>💬</span>
          <h3>No conversations found</h3>
          <p>
            {searchQuery 
              ? 'Try adjusting your search query' 
              : 'Your Cursor chat history will appear here'}
          </p>
        </div>
      ) : (
        <div className={styles.conversationList}>
          {filteredConversations.map((conversation) => (
            <div 
              key={conversation.id}
              className={styles.conversationCard}
              onClick={() => selectConversation(conversation)}
            >
              <span className={styles.conversationIcon}>
                {getTypeIcon(conversation.type)}
              </span>
              <div className={styles.conversationInfo}>
                <h3 className={styles.conversationName}>
                  {truncateTitle(conversation.title)}
                </h3>
                <div className={styles.conversationMeta}>
                  <span className={`${styles.typeTag} ${styles[conversation.type + 'Tag']}`}>
                    {getTypeLabel(conversation.type)}
                  </span>
                  {conversation.projectName && (
                    <span className={styles.projectName}>
                      {conversation.projectName}
                    </span>
                  )}
                </div>
                <div className={styles.conversationFooter}>
                  <span className={styles.messageCount}>
                    {conversation.messageCount || 0} messages
                  </span>
                  <span className={styles.conversationDate}>
                    {formatDate(conversation.timestamp)}
                  </span>
                </div>
              </div>
              <span className={styles.arrow}>›</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
