import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './ChatDetailPage.module.css';

// Tool display information
const TOOL_INFO = {
  'cursor-agent': { icon: '🤖', name: 'Cursor Agent', color: '#007acc' },
  'claude': { icon: '🧠', name: 'Claude Code', color: '#a855f7' },
  'gemini': { icon: '✨', name: 'Gemini', color: '#f97316' },
  'default': { icon: '💻', name: 'Terminal', color: '#6b7280' }
};

export default function ChatDetailPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { apiRequest } = useAuth();

  const [chat, setChat] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [promptInput, setPromptInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendStatus, setSendStatus] = useState(null);
  const [isEditingTopic, setIsEditingTopic] = useState(false);
  const [editedTopic, setEditedTopic] = useState('');

  const inputRef = useRef(null);
  const topicInputRef = useRef(null);

  useEffect(() => {
    loadChatDetails();
  }, [chatId]);

  useEffect(() => {
    // Focus the topic input when editing starts
    if (isEditingTopic && topicInputRef.current) {
      topicInputRef.current.focus();
      topicInputRef.current.select();
    }
  }, [isEditingTopic]);

  async function loadChatDetails() {
    try {
      setIsLoading(true);
      setError(null);
      
      // Load chat window details
      const response = await apiRequest(`/api/conversations/${chatId}`);
      const data = await response.json();
      
      setChat(data.chat || data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function sendPrompt() {
    if (!promptInput.trim() || isSending) return;
    
    const prompt = promptInput.trim();
    setPromptInput('');
    setIsSending(true);
    setSendStatus(null);
    
    try {
      const response = await apiRequest(`/api/conversations/${chatId}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setSendStatus({ type: 'success', message: 'Prompt sent to terminal!' });
        // Focus input for next prompt
        inputRef.current?.focus();
      } else {
        setSendStatus({ type: 'error', message: data.error || 'Failed to send prompt' });
      }
    } catch (err) {
      setSendStatus({ type: 'error', message: err.message });
    } finally {
      setIsSending(false);
    }
  }

  async function closeChat() {
    if (!confirm('Close this chat window? The AI CLI session will be terminated.')) {
      return;
    }

    try {
      await apiRequest(`/api/conversations/${chatId}`, {
        method: 'DELETE'
      });
      navigate('/conversations');
    } catch (err) {
      setError('Failed to close chat: ' + err.message);
    }
  }

  function startEditingTopic() {
    setEditedTopic(chat?.topic || '');
    setIsEditingTopic(true);
  }

  function cancelEditingTopic() {
    setIsEditingTopic(false);
    setEditedTopic('');
  }

  async function saveTopic() {
    if (!editedTopic.trim()) {
      alert('Topic cannot be empty');
      return;
    }

    console.log('[ChatDetailPage] Updating topic for chat:', chatId);
    console.log('[ChatDetailPage] New topic:', editedTopic.trim());

    try {
      const response = await apiRequest(`/api/conversations/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: editedTopic.trim() })
      });

      console.log('[ChatDetailPage] Response status:', response.status);
      const data = await response.json();
      console.log('[ChatDetailPage] Response data:', data);

      if (data.success) {
        setChat({ ...chat, topic: data.topic });
        setIsEditingTopic(false);
        setSendStatus({ type: 'success', message: 'Topic updated!' });
        setTimeout(() => setSendStatus(null), 3000);
      } else {
        alert(data.error || 'Failed to update topic');
      }
    } catch (err) {
      alert('Failed to update topic: ' + err.message);
    }
  }

  function handleTopicKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveTopic();
    } else if (e.key === 'Escape') {
      cancelEditingTopic();
    }
  }

  function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  }

  function getToolInfo(toolName) {
    return TOOL_INFO[toolName] || TOOL_INFO['default'];
  }

  function getDisplayTitle() {
    if (!chat) return 'Chat Window';
    if (chat.topic) return chat.topic;
    if (chat.title) return chat.title;
    return chat.windowName || 'Chat Window';
  }

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Loading chat window...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <p>{error}</p>
          <button onClick={loadChatDetails}>Retry</button>
          <button onClick={() => navigate('/conversations')}>Back to Chats</button>
        </div>
      </div>
    );
  }

  const toolInfo = chat ? getToolInfo(chat.tool) : TOOL_INFO['default'];

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <button
          className={styles.backButton}
          onClick={() => navigate('/conversations')}
        >
          ← Back
        </button>
        <div className={styles.headerInfo}>
          {isEditingTopic ? (
            <div className={styles.topicEditContainer}>
              <input
                ref={topicInputRef}
                type="text"
                className={styles.topicInput}
                value={editedTopic}
                onChange={(e) => setEditedTopic(e.target.value)}
                onKeyDown={handleTopicKeyPress}
                onBlur={cancelEditingTopic}
                placeholder="Enter topic name..."
              />
              <button
                className={styles.topicSaveButton}
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent blur
                  saveTopic();
                }}
              >
                ✓
              </button>
              <button
                className={styles.topicCancelButton}
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent blur
                  cancelEditingTopic();
                }}
              >
                ✕
              </button>
            </div>
          ) : (
            <h2 className={styles.title}>
              <span style={{ marginRight: '8px' }}>{toolInfo.icon}</span>
              {getDisplayTitle()}
              <button
                className={styles.editTopicButton}
                onClick={startEditingTopic}
                title="Edit topic"
              >
                ✎
              </button>
            </h2>
          )}
          <div className={styles.headerMeta}>
            <span
              className={styles.typeTag}
              style={{ backgroundColor: `${toolInfo.color}20`, color: toolInfo.color }}
            >
              {toolInfo.name}
            </span>
            {chat?.windowName && (
              <span className={styles.projectName}>{chat.windowName}</span>
            )}
            <span className={styles.messageCount}>
              {chat?.active ? '🟢 Active' : '⚫ Inactive'}
            </span>
          </div>
        </div>
        <button
          className={styles.closeButton}
          onClick={closeChat}
          title="Close chat window"
        >
          ✕
        </button>
      </div>

      {/* Chat info panel */}
      <div className={styles.messagesContainer}>
        <div className={styles.terminalInfo}>
          <div className={styles.infoCard}>
            <h3>🖥️ Tmux Chat Window</h3>
            <p>
              This chat is running as a tmux terminal window with the <strong>{toolInfo.name}</strong> AI CLI.
            </p>
            <p>
              For full terminal access with keyboard input and real-time output, use the iOS app or 
              connect directly via SSH/tmux.
            </p>
            
            <div className={styles.infoDetails}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Window:</span>
                <span className={styles.infoValue}>{chat?.windowName || chatId}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Session:</span>
                <span className={styles.infoValue}>{chat?.sessionName || 'Unknown'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Tool:</span>
                <span className={styles.infoValue}>{chat?.tool || 'Unknown'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Project:</span>
                <span className={styles.infoValue}>{chat?.projectPath || 'Unknown'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Status:</span>
                <span className={styles.infoValue}>
                  {chat?.active ? '🟢 Running' : '⚫ Not running'}
                </span>
              </div>
            </div>
          </div>

          {/* Status message */}
          {sendStatus && (
            <div className={`${styles.statusMessage} ${styles[sendStatus.type]}`}>
              {sendStatus.type === 'success' ? '✓' : '✗'} {sendStatus.message}
            </div>
          )}
        </div>
      </div>
      
      {/* Prompt Input */}
      <div className={styles.inputContainer}>
        <div className={styles.inputRow}>
          <textarea
            ref={inputRef}
            className={styles.messageInput}
            placeholder="Send a prompt to the AI CLI... (Press Enter to send)"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isSending || !chat?.active}
            rows={1}
          />
          <button 
            className={styles.sendButton}
            onClick={sendPrompt}
            disabled={!promptInput.trim() || isSending || !chat?.active}
          >
            {isSending ? '⏳' : '📤'}
          </button>
        </div>
        {!chat?.active && (
          <p className={styles.inputHint}>
            Chat window is not active. Start a new chat from a project.
          </p>
        )}
      </div>
    </div>
  );
}
