import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';

const WebSocketContext = createContext(null);

export function WebSocketProvider({ children }) {
  const { token, serverUrl, isAuthenticated } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const [fileChanges, setFileChanges] = useState([]);
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const messageHandlersRef = useRef(new Map());

  const connect = useCallback(() => {
    if (!isAuthenticated || !serverUrl || !token) return;
    
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    const wsUrl = serverUrl.replace('http', 'ws');
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      // Authenticate
      ws.send(JSON.stringify({ type: 'auth', token }));
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        setLastMessage(message);
        
        // Handle auth response
        if (message.type === 'auth') {
          if (message.success) {
            setIsConnected(true);
          } else {
            console.error('WebSocket auth failed:', message.message);
          }
          return;
        }
        
        // Handle file changes
        if (message.type === 'fileChange') {
          setFileChanges(prev => [message, ...prev].slice(0, 50));
        }
        
        // Call registered handlers
        const handlers = messageHandlersRef.current.get(message.type);
        if (handlers) {
          handlers.forEach(handler => handler(message));
        }
      } catch (error) {
        console.error('WebSocket message parse error:', error);
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
      
      // Attempt reconnect after 3 seconds
      if (isAuthenticated) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    wsRef.current = ws;
  }, [isAuthenticated, serverUrl, token]);

  useEffect(() => {
    if (isAuthenticated) {
      connect();
    }
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [isAuthenticated, connect]);

  function send(message) {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }

  function watchPath(path) {
    send({ type: 'watch', path });
  }

  function unwatchPath(path) {
    send({ type: 'unwatch', path });
  }

  function addMessageHandler(type, handler) {
    if (!messageHandlersRef.current.has(type)) {
      messageHandlersRef.current.set(type, new Set());
    }
    messageHandlersRef.current.get(type).add(handler);
    
    return () => {
      messageHandlersRef.current.get(type).delete(handler);
    };
  }

  const value = {
    isConnected,
    lastMessage,
    fileChanges,
    send,
    watchPath,
    unwatchPath,
    addMessageHandler
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}
