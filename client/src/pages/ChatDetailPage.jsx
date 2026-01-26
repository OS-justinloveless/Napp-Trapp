import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './ChatDetailPage.module.css';

export default function ChatDetailPage() {
  const { chatId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { apiRequest } = useAuth();
  
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedCodeBlocks, setExpandedCodeBlocks] = useState(new Set());
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState(null);
  
  const messagesEndRef = useRef(null);
  const eventSourceRef = useRef(null);
  
  const type = searchParams.get('type') || 'chat';
  const workspaceId = searchParams.get('workspaceId') || 'global';

  useEffect(() => {
    loadChatData();
    
    // Cleanup event source on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [chatId, type, workspaceId]);
  
  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingMessage]);

  async function loadChatData() {
    try {
      setIsLoading(true);
      setError(null);
      
      // Load chat details
      const chatResponse = await apiRequest(`/api/conversations/${chatId}`);
      const chatData = await chatResponse.json();
      setChat(chatData.conversation);
      
      // Load messages
      const messagesResponse = await apiRequest(
        `/api/conversations/${chatId}/messages?type=${type}&workspaceId=${workspaceId}`
      );
      const messagesData = await messagesResponse.json();
      setMessages(messagesData.messages || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function sendMessage() {
    if (!messageInput.trim() || isSending) return;
    
    const userMessage = messageInput.trim();
    console.log('=== SENDING MESSAGE ===');
    console.log('Message:', userMessage);
    console.log('Chat ID:', chatId);
    console.log('Workspace ID:', workspaceId);
    
    setMessageInput('');
    setIsSending(true);
    setError(null); // Clear previous errors
    setStreamingMessage({ type: 'assistant', text: '', timestamp: Date.now() });
    
    // Add user message to UI immediately
    const newUserMessage = {
      type: 'user',
      text: userMessage,
      timestamp: Date.now(),
      id: `temp-${Date.now()}`
    };
    setMessages(prev => [...prev, newUserMessage]);
    
    try {
      const url = `/api/conversations/${chatId}/messages`;
      console.log('Fetching:', url);
      
      // Use apiRequest which handles auth properly
      const response = await apiRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: userMessage,
          workspaceId
        })
      });
      
      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        // Try to get error details from response
        let errorDetails;
        try {
          errorDetails = await response.json();
          console.error('Error response:', errorDetails);
        } catch (e) {
          errorDetails = { error: `HTTP ${response.status}: ${response.statusText}` };
        }
        throw new Error(errorDetails.details || errorDetails.error || 'Failed to send message');
      }
      
      console.log('Starting SSE stream...');
      
      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      let eventCount = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('Stream completed. Total events:', eventCount);
          break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            eventCount++;
            const dataStr = line.slice(6);
            console.log(`Event #${eventCount}:`, dataStr.substring(0, 200));
            
            try {
              const data = JSON.parse(dataStr);
              
              if (data.type === 'connected') {
                console.log('✓ Connected to cursor-agent');
              } else if (data.type === 'system') {
                console.log('System event:', data.subtype);
              } else if (data.type === 'assistant') {
                // cursor-agent sends assistant messages with this structure:
                // {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."}]}}
                if (data.message?.content) {
                  for (const contentItem of data.message.content) {
                    if (contentItem.type === 'text' && contentItem.text) {
                      assistantText += contentItem.text;
                      setStreamingMessage({
                        type: 'assistant',
                        text: assistantText,
                        timestamp: Date.now()
                      });
                    }
                  }
                }
              } else if (data.type === 'text') {
                // Fallback for simple text messages
                assistantText += data.content;
                setStreamingMessage({
                  type: 'assistant',
                  text: assistantText,
                  timestamp: Date.now()
                });
              } else if (data.type === 'stderr') {
                console.warn('cursor-agent stderr:', data.content);
              } else if (data.type === 'complete') {
                console.log('Complete event:', data);
                // Finalize the message
                if (data.success) {
                  console.log('✓ Message sent successfully');
                  const finalMessage = {
                    type: 'assistant',
                    text: assistantText,
                    timestamp: Date.now(),
                    id: `response-${Date.now()}`
                  };
                  setMessages(prev => [...prev, finalMessage]);
                  setStreamingMessage(null);
                } else {
                  console.error('✗ Message failed with code:', data.code);
                  if (data.stderr) {
                    console.error('stderr:', data.stderr);
                  }
                  throw new Error(`cursor-agent failed (exit code ${data.code})\n${data.stderr || ''}`);
                }
              } else if (data.type === 'error') {
                console.error('Error event:', data);
                throw new Error(data.content || 'Unknown error from cursor-agent');
              }
            } catch (e) {
              if (e.message && (e.message.includes('cursor-agent') || e.message.includes('failed'))) {
                throw e; // Re-throw our errors
              }
              console.error('Failed to parse SSE data:', e, dataStr);
            }
          }
        }
      }
      
      console.log('=== MESSAGE COMPLETE ===');
      
    } catch (err) {
      console.error('=== MESSAGE FAILED ===');
      console.error('Error:', err);
      console.error('Stack:', err.stack);
      
      const errorMessage = err.message || 'Unknown error occurred';
      setError(`Failed to send message: ${errorMessage}`);
      setStreamingMessage(null);
      
      // Show detailed error in console
      console.error('Detailed error info:', {
        message: errorMessage,
        chatId,
        workspaceId,
        userMessage: userMessage.substring(0, 50)
      });
    } finally {
      setIsSending(false);
    }
  }
  
  function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = new Date(typeof timestamp === 'number' ? timestamp : Date.parse(timestamp));
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(typeof timestamp === 'number' ? timestamp : Date.parse(timestamp));
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function toggleCodeBlock(blockId) {
    const newExpanded = new Set(expandedCodeBlocks);
    if (newExpanded.has(blockId)) {
      newExpanded.delete(blockId);
    } else {
      newExpanded.add(blockId);
    }
    setExpandedCodeBlocks(newExpanded);
  }

  function renderMessageContent(text, codeBlocks, messageIndex) {
    if (!text) return null;
    
    // Split content by code blocks
    const codeBlockPattern = /```(\w*)\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    let blockIndex = 0;
    
    while ((match = codeBlockPattern.exec(text)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: text.slice(lastIndex, match.index)
        });
      }
      
      // Add code block
      parts.push({
        type: 'code',
        language: match[1] || 'text',
        content: match[2],
        id: `${messageIndex}-${blockIndex++}`
      });
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({
        type: 'text',
        content: text.slice(lastIndex)
      });
    }
    
    // If no code blocks found, return as plain text
    if (parts.length === 0) {
      return <p className={styles.textContent}>{text}</p>;
    }
    
    return parts.map((part, idx) => {
      if (part.type === 'text') {
        return <p key={idx} className={styles.textContent}>{part.content}</p>;
      }
      
      const isExpanded = expandedCodeBlocks.has(part.id);
      const lines = part.content.split('\n');
      const shouldCollapse = lines.length > 10;
      
      return (
        <div key={idx} className={styles.codeBlock}>
          <div className={styles.codeHeader}>
            <span className={styles.codeLanguage}>{part.language}</span>
            {shouldCollapse && (
              <button 
                className={styles.expandButton}
                onClick={() => toggleCodeBlock(part.id)}
              >
                {isExpanded ? 'Collapse' : `Expand (${lines.length} lines)`}
              </button>
            )}
            <button 
              className={styles.copyButton}
              onClick={() => navigator.clipboard.writeText(part.content)}
            >
              Copy
            </button>
          </div>
          <pre className={`${styles.codeContent} ${shouldCollapse && !isExpanded ? styles.collapsed : ''}`}>
            <code>{part.content}</code>
          </pre>
        </div>
      );
    });
  }

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Loading conversation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <p>{error}</p>
          <button onClick={loadChatData}>Retry</button>
        </div>
      </div>
    );
  }

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
          <h2 className={styles.title}>
            {chat?.title || 'Conversation'}
          </h2>
          <div className={styles.headerMeta}>
            <span className={`${styles.typeTag} ${styles[type + 'Tag']}`}>
              {type === 'composer' ? '🎹 Composer' : '💬 Chat'}
            </span>
            {chat?.projectName && (
              <span className={styles.projectName}>{chat.projectName}</span>
            )}
            <span className={styles.messageCount}>{messages.length} messages</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className={styles.messagesContainer}>
        {messages.length === 0 ? (
          <div className={styles.emptyMessages}>
            <span className={styles.emptyIcon}>💬</span>
            <h3>No messages found</h3>
            <p>This conversation appears to be empty</p>
          </div>
        ) : (
          <div className={styles.messagesList}>
            {messages.map((message, index) => (
              <div 
                key={message.id || index} 
                className={`${styles.message} ${styles[message.type + 'Message']}`}
              >
                <div className={styles.messageHeader}>
                  <span className={styles.messageRole}>
                    {message.type === 'user' ? '👤 You' : '🤖 Assistant'}
                  </span>
                  {message.modelType && (
                    <span className={styles.modelType}>{message.modelType}</span>
                  )}
                  <span className={styles.messageTime}>
                    {formatTimestamp(message.timestamp)}
                  </span>
                </div>
                <div className={styles.messageContent}>
                  {renderMessageContent(message.text, message.codeBlocks, index)}
                </div>
                {message.relevantFiles && message.relevantFiles.length > 0 && (
                  <div className={styles.relevantFiles}>
                    <span className={styles.filesLabel}>Referenced files:</span>
                    {message.relevantFiles.map((file, idx) => (
                      <span key={idx} className={styles.fileTag}>{file}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            
            {/* Streaming message */}
            {streamingMessage && (
              <div className={`${styles.message} ${styles.assistantMessage} ${styles.streaming}`}>
                <div className={styles.messageHeader}>
                  <span className={styles.messageRole}>🤖 Assistant</span>
                  <span className={styles.typingIndicator}>
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                </div>
                <div className={styles.messageContent}>
                  {renderMessageContent(streamingMessage.text, [], 'streaming')}
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
      
      {/* Message Input */}
      <div className={styles.inputContainer}>
        {error && (
          <div className={styles.errorBanner}>
            <span className={styles.errorIcon}>⚠️</span>
            <div className={styles.errorContent}>
              <strong>Error:</strong>
              <pre className={styles.errorText}>{error}</pre>
            </div>
            <button 
              className={styles.dismissError}
              onClick={() => setError(null)}
            >
              ✕
            </button>
          </div>
        )}
        <div className={styles.inputRow}>
          <textarea
            className={styles.messageInput}
            placeholder="Type your message... (Press Enter to send, Shift+Enter for new line)"
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isSending}
            rows={1}
          />
          <button 
            className={styles.sendButton}
            onClick={sendMessage}
            disabled={!messageInput.trim() || isSending}
          >
            {isSending ? '⏳' : '📤'}
          </button>
        </div>
      </div>
    </div>
  );
}
