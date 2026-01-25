import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import styles from './ConversationsPage.module.css';

export default function ConversationsPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [error, setError] = useState(null);
  
  const { apiRequest } = useAuth();

  useEffect(() => {
    loadConversations();
  }, []);

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

  async function loadMessages(conversationId) {
    try {
      setIsLoadingMessages(true);
      
      const response = await apiRequest(`/api/conversations/${conversationId}/messages`);
      const data = await response.json();
      setMessages(data.messages || []);
    } catch (err) {
      console.error('Failed to load messages:', err);
      setMessages([]);
    } finally {
      setIsLoadingMessages(false);
    }
  }

  function selectConversation(conversation) {
    setSelectedConversation(conversation);
    loadMessages(conversation.id);
  }

  function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    
    return date.toLocaleDateString();
  }

  function getProjectName(conversation) {
    if (conversation.projectName) {
      // Extract readable name from path
      const parts = conversation.projectName.replace('file://', '').split('/');
      return parts[parts.length - 1] || conversation.projectName;
    }
    return conversation.id.substring(0, 8);
  }

  if (selectedConversation) {
    return (
      <div className={styles.container}>
        <div className={styles.messagesHeader}>
          <button 
            className={styles.backButton}
            onClick={() => setSelectedConversation(null)}
          >
            ← Back
          </button>
          <div className={styles.headerInfo}>
            <h2>{getProjectName(selectedConversation)}</h2>
            <p>{formatDate(selectedConversation.lastModified)}</p>
          </div>
        </div>
        
        <div className={styles.messagesContainer}>
          {isLoadingMessages ? (
            <div className={styles.loading}>
              <div className={styles.spinner} />
              <p>Loading messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className={styles.emptyMessages}>
              <span className={styles.emptyIcon}>💬</span>
              <h3>No messages available</h3>
              <p>
                Cursor conversations are stored in an internal database format.
                Future versions will provide better integration.
              </p>
            </div>
          ) : (
            <div className={styles.messagesList}>
              {messages.map((message, index) => (
                <div 
                  key={index} 
                  className={`${styles.message} ${message.role === 'user' ? styles.userMessage : styles.assistantMessage}`}
                >
                  <div className={styles.messageRole}>
                    {message.role === 'user' ? '👤 You' : '🤖 Assistant'}
                  </div>
                  <div className={styles.messageContent}>
                    {message.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.actions}>
        <button 
          className={styles.refreshButton}
          onClick={loadConversations}
        >
          🔄 Refresh
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
      ) : conversations.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>💬</span>
          <h3>No conversations found</h3>
          <p>Your Cursor chat history will appear here</p>
        </div>
      ) : (
        <div className={styles.conversationList}>
          {conversations.map((conversation) => (
            <div 
              key={conversation.id}
              className={styles.conversationCard}
              onClick={() => selectConversation(conversation)}
            >
              <span className={styles.conversationIcon}>💬</span>
              <div className={styles.conversationInfo}>
                <h3 className={styles.conversationName}>
                  {getProjectName(conversation)}
                </h3>
                <p className={styles.conversationPath}>
                  {conversation.path}
                </p>
                <span className={styles.conversationDate}>
                  {formatDate(conversation.lastModified)}
                </span>
              </div>
              <span className={styles.arrow}>›</span>
            </div>
          ))}
        </div>
      )}
      
      <div className={styles.notice}>
        <h4>📌 Note</h4>
        <p>
          Cursor stores conversations in a proprietary format. 
          This page shows available workspace sessions. 
          Full conversation history integration is being developed.
        </p>
      </div>
    </div>
  );
}
