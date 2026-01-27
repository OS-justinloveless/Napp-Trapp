import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAuth } from '../context/AuthContext';
import styles from './ChatDetailPage.module.css';

// Tool call display names and icons
const TOOL_DISPLAY_INFO = {
  Read: { icon: '📄', name: 'Read File', getDescription: (input) => input?.path ? `Reading ${input.path.split('/').pop()}` : 'Reading file' },
  Write: { icon: '✏️', name: 'Write File', getDescription: (input) => input?.path ? `Writing to ${input.path.split('/').pop()}` : 'Writing file' },
  Edit: { icon: '🔧', name: 'Edit File', getDescription: (input) => input?.path ? `Editing ${input.path.split('/').pop()}` : 'Editing file' },
  StrReplace: { icon: '🔄', name: 'Replace Text', getDescription: (input) => input?.path ? `Replacing in ${input.path.split('/').pop()}` : 'Replacing text' },
  Shell: { icon: '💻', name: 'Run Command', getDescription: (input) => input?.command ? `$ ${input.command.slice(0, 50)}${input.command.length > 50 ? '...' : ''}` : 'Running command' },
  Bash: { icon: '💻', name: 'Run Command', getDescription: (input) => input?.command ? `$ ${input.command.slice(0, 50)}${input.command.length > 50 ? '...' : ''}` : 'Running command' },
  Grep: { icon: '🔍', name: 'Search', getDescription: (input) => input?.pattern ? `Searching for "${input.pattern.slice(0, 30)}"` : 'Searching' },
  Glob: { icon: '📂', name: 'Find Files', getDescription: (input) => input?.pattern ? `Finding ${input.pattern}` : 'Finding files' },
  LS: { icon: '📁', name: 'List Directory', getDescription: (input) => input?.path ? `Listing ${input.path.split('/').pop() || input.path}` : 'Listing directory' },
  SemanticSearch: { icon: '🧠', name: 'Semantic Search', getDescription: (input) => input?.query ? `Searching: "${input.query.slice(0, 40)}"` : 'Semantic search' },
  WebSearch: { icon: '🌐', name: 'Web Search', getDescription: (input) => input?.query ? `Searching web: "${input.query.slice(0, 40)}"` : 'Web search' },
  WebFetch: { icon: '🌍', name: 'Fetch URL', getDescription: (input) => input?.url ? `Fetching ${new URL(input.url).hostname}` : 'Fetching URL' },
  Task: { icon: '🤖', name: 'Run Task', getDescription: (input) => input?.description || 'Running subtask' },
  TodoWrite: { icon: '✅', name: 'Update Todos', getDescription: () => 'Updating task list' },
  Delete: { icon: '🗑️', name: 'Delete File', getDescription: (input) => input?.path ? `Deleting ${input.path.split('/').pop()}` : 'Deleting file' },
  default: { icon: '🔧', name: 'Tool', getDescription: () => 'Running tool' }
};

function getToolDisplayInfo(toolName, input) {
  const info = TOOL_DISPLAY_INFO[toolName] || TOOL_DISPLAY_INFO.default;
  return {
    icon: info.icon,
    name: info.name || toolName,
    description: info.getDescription(input)
  };
}

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
  const [expandedToolCalls, setExpandedToolCalls] = useState(new Set());
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
    setStreamingMessage({ type: 'assistant', text: '', toolCalls: [], timestamp: Date.now() });
    
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
      let toolCalls = [];
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
                // {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."},{"type":"tool_use",...}]}}
                if (data.message?.content) {
                  for (const contentItem of data.message.content) {
                    if (contentItem.type === 'text' && contentItem.text) {
                      assistantText += contentItem.text;
                    } else if (contentItem.type === 'tool_use') {
                      // Add tool call to the list
                      const existingIndex = toolCalls.findIndex(tc => tc.id === contentItem.id);
                      if (existingIndex === -1) {
                        toolCalls.push({
                          id: contentItem.id,
                          name: contentItem.name,
                          input: contentItem.input,
                          status: 'running'
                        });
                      }
                    } else if (contentItem.type === 'tool_result') {
                      // Mark tool call as complete
                      const toolIndex = toolCalls.findIndex(tc => tc.id === contentItem.tool_use_id);
                      if (toolIndex !== -1) {
                        toolCalls[toolIndex] = {
                          ...toolCalls[toolIndex],
                          status: contentItem.is_error ? 'error' : 'complete',
                          result: contentItem.content
                        };
                      }
                    }
                  }
                  setStreamingMessage({
                    type: 'assistant',
                    text: assistantText,
                    toolCalls: [...toolCalls],
                    timestamp: Date.now()
                  });
                }
              } else if (data.type === 'text') {
                // Fallback for simple text messages
                assistantText += data.content;
                setStreamingMessage({
                  type: 'assistant',
                  text: assistantText,
                  toolCalls: [...toolCalls],
                  timestamp: Date.now()
                });
              } else if (data.type === 'stderr') {
                console.warn('cursor-agent stderr:', data.content);
              } else if (data.type === 'complete') {
                console.log('Complete event:', data);
                // Finalize the message
                if (data.success) {
                  console.log('✓ Message sent successfully');
                  // Mark any running tools as complete
                  const finalToolCalls = toolCalls.map(tc => 
                    tc.status === 'running' ? { ...tc, status: 'complete' } : tc
                  );
                  const finalMessage = {
                    type: 'assistant',
                    text: assistantText,
                    toolCalls: finalToolCalls,
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

  function toggleToolCall(toolId) {
    const newExpanded = new Set(expandedToolCalls);
    if (newExpanded.has(toolId)) {
      newExpanded.delete(toolId);
    } else {
      newExpanded.add(toolId);
    }
    setExpandedToolCalls(newExpanded);
  }

  function renderToolCalls(toolCalls) {
    if (!toolCalls || toolCalls.length === 0) return null;

    return (
      <div className={styles.toolCallsContainer}>
        {toolCalls.map((tool) => {
          const isExpanded = expandedToolCalls.has(tool.id);
          const displayInfo = getToolDisplayInfo(tool.name, tool.input);
          
          return (
            <div 
              key={tool.id} 
              className={`${styles.toolCall} ${styles[`toolCall${tool.status}`]}`}
            >
              <button
                className={styles.toolCallHeader}
                onClick={() => toggleToolCall(tool.id)}
                aria-expanded={isExpanded}
              >
                <span className={styles.toolCallIcon}>{displayInfo.icon}</span>
                <span className={styles.toolCallInfo}>
                  <span className={styles.toolCallName}>{displayInfo.name}</span>
                  <span className={styles.toolCallDescription}>{displayInfo.description}</span>
                </span>
                <span className={styles.toolCallStatus}>
                  {tool.status === 'running' && <span className={styles.toolCallSpinner} />}
                  {tool.status === 'complete' && <span className={styles.toolCallCheck}>✓</span>}
                  {tool.status === 'error' && <span className={styles.toolCallError}>✗</span>}
                </span>
                <span className={`${styles.toolCallChevron} ${isExpanded ? styles.expanded : ''}`}>
                  ▶
                </span>
              </button>
              
              {isExpanded && (
                <div className={styles.toolCallDetails}>
                  {tool.input && (
                    <div className={styles.toolCallSection}>
                      <div className={styles.toolCallSectionLabel}>Input</div>
                      <pre className={styles.toolCallJson}>
                        {JSON.stringify(tool.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  {tool.result && (
                    <div className={styles.toolCallSection}>
                      <div className={styles.toolCallSectionLabel}>Result</div>
                      <pre className={styles.toolCallJson}>
                        {typeof tool.result === 'string' 
                          ? tool.result.slice(0, 2000) + (tool.result.length > 2000 ? '\n...(truncated)' : '')
                          : JSON.stringify(tool.result, null, 2).slice(0, 2000)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Custom components for ReactMarkdown
  const markdownComponents = {
    // Code blocks with syntax highlighting
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      const codeString = String(children).replace(/\n$/, '');
      
      if (!inline && (match || codeString.includes('\n'))) {
        const lines = codeString.split('\n');
        const shouldCollapse = lines.length > 15;
        const blockId = `code-${Math.random().toString(36).substr(2, 9)}`;
        const isExpanded = expandedCodeBlocks.has(blockId);
        
        return (
          <div className={styles.codeBlock}>
            <div className={styles.codeHeader}>
              <span className={styles.codeLanguage}>{language || 'code'}</span>
              {shouldCollapse && (
                <button 
                  className={styles.expandButton}
                  onClick={() => toggleCodeBlock(blockId)}
                >
                  {isExpanded ? 'Collapse' : `Expand (${lines.length} lines)`}
                </button>
              )}
              <button 
                className={styles.copyButton}
                onClick={() => navigator.clipboard.writeText(codeString)}
              >
                Copy
              </button>
            </div>
            <div className={`${styles.codeContent} ${shouldCollapse && !isExpanded ? styles.collapsed : ''}`}>
              <SyntaxHighlighter
                style={vscDarkPlus}
                language={language || 'text'}
                PreTag="div"
                customStyle={{
                  margin: 0,
                  padding: '12px',
                  background: 'transparent',
                  fontSize: '13px',
                }}
                {...props}
              >
                {codeString}
              </SyntaxHighlighter>
            </div>
          </div>
        );
      }
      
      // Inline code
      return (
        <code className={styles.inlineCode} {...props}>
          {children}
        </code>
      );
    },
    // Paragraphs
    p({ children }) {
      return <p className={styles.markdownParagraph}>{children}</p>;
    },
    // Headers
    h1({ children }) {
      return <h1 className={styles.markdownH1}>{children}</h1>;
    },
    h2({ children }) {
      return <h2 className={styles.markdownH2}>{children}</h2>;
    },
    h3({ children }) {
      return <h3 className={styles.markdownH3}>{children}</h3>;
    },
    h4({ children }) {
      return <h4 className={styles.markdownH4}>{children}</h4>;
    },
    // Lists
    ul({ children }) {
      return <ul className={styles.markdownList}>{children}</ul>;
    },
    ol({ children }) {
      return <ol className={styles.markdownOrderedList}>{children}</ol>;
    },
    li({ children }) {
      return <li className={styles.markdownListItem}>{children}</li>;
    },
    // Links
    a({ href, children }) {
      return (
        <a href={href} className={styles.markdownLink} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
    // Blockquotes
    blockquote({ children }) {
      return <blockquote className={styles.markdownBlockquote}>{children}</blockquote>;
    },
    // Tables
    table({ children }) {
      return <table className={styles.markdownTable}>{children}</table>;
    },
    th({ children }) {
      return <th className={styles.markdownTh}>{children}</th>;
    },
    td({ children }) {
      return <td className={styles.markdownTd}>{children}</td>;
    },
    // Horizontal rule
    hr() {
      return <hr className={styles.markdownHr} />;
    },
    // Strong/Bold
    strong({ children }) {
      return <strong className={styles.markdownStrong}>{children}</strong>;
    },
    // Emphasis/Italic
    em({ children }) {
      return <em className={styles.markdownEm}>{children}</em>;
    },
  };

  function renderMessageContent(text) {
    if (!text) return null;
    
    return (
      <div className={styles.markdownContent}>
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {text}
        </ReactMarkdown>
      </div>
    );
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
                  {renderToolCalls(message.toolCalls)}
                  {renderMessageContent(message.text)}
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
                  {renderToolCalls(streamingMessage.toolCalls)}
                  {renderMessageContent(streamingMessage.text)}
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
