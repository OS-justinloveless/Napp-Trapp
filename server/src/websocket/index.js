import chokidar from 'chokidar';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { ptyManager, tmuxManager } from '../routes/terminals.js';
import { LogManager } from '../utils/LogManager.js';
import { chatProcessManager } from '../utils/ChatProcessManager.js';

const logger = LogManager.getInstance();
const tmuxSubscribers = new Map(); // "sessionName:windowIndex" -> Set of clientIds

const clients = new Map();
const watchers = new Map();
const ptySubscribers = new Map(); // terminalId -> Set of clientIds

export function setupWebSocket(wss, authManager) {
  wss.on('connection', (ws, req) => {
    const clientId = crypto.randomUUID();
    let authenticated = false;
    let watchedPaths = new Set();
    let subscribedTerminals = new Set();
    
    logger.info('WebSocket', 'Client connected', { clientId });
    
    ws.send(JSON.stringify({
      type: 'connection',
      clientId,
      message: 'Connected. Please authenticate.'
    }));
    
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'auth') {
          if (authManager.validateToken(message.token)) {
            authenticated = true;
            clients.set(clientId, { ws, watchedPaths, subscribedTerminals });
            ws.send(JSON.stringify({
              type: 'auth',
              success: true,
              message: 'Authenticated successfully'
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'auth',
              success: false,
              message: 'Invalid token'
            }));
          }
          return;
        }
        
        if (!authenticated) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Not authenticated'
          }));
          return;
        }
        
        switch (message.type) {
          case 'watch':
            handleWatch(clientId, ws, message);
            break;
            
          case 'unwatch':
            handleUnwatch(clientId, message);
            break;
            
          case 'terminalCreate':
            handleTerminalCreate(clientId, ws, message);
            break;
            
          case 'terminalAttach':
            handleTerminalAttach(clientId, ws, message);
            break;
            
          case 'terminalDetach':
            handleTerminalDetach(clientId, message);
            break;
            
          case 'terminalInput':
            handleTerminalInput(clientId, ws, message);
            break;
            
          case 'terminalResize':
            handleTerminalResize(clientId, ws, message);
            break;
            
          case 'terminalKill':
            handleTerminalKill(clientId, ws, message);
            break;
            
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;

          // Chat session handlers (chat windows are tmux windows running AI CLIs)
          case 'chatAttach':
            handleChatAttach(clientId, ws, message);
            break;

          case 'chatDetach':
            handleChatDetach(clientId, message);
            break;

          case 'chatMessage':
            handleChatMessage(clientId, ws, message);
            break;

          case 'chatCancel':
            handleChatCancel(clientId, ws, message);
            break;

          case 'chatApproval':
            handleChatApproval(clientId, ws, message);
            break;

          default:
            ws.send(JSON.stringify({
              type: 'error',
              message: `Unknown message type: ${message.type}`
            }));
        }
      } catch (error) {
        logger.error('WebSocket', 'Message processing error', { clientId, error: error.message });
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message
        }));
      }
    });
    
    ws.on('close', () => {
      logger.info('WebSocket', 'Client disconnected', { clientId });
      
      // Clean up file watchers
      for (const watchPath of watchedPaths) {
        const watcherInfo = watchers.get(watchPath);
        if (watcherInfo) {
          watcherInfo.clients.delete(clientId);
          if (watcherInfo.clients.size === 0) {
            watcherInfo.watcher.close();
            watchers.delete(watchPath);
          }
        }
      }
      
      const client = clients.get(clientId);
      
      // Clean up terminal subscriptions
      for (const terminalId of subscribedTerminals) {
        // PTY terminals
        if (ptyManager.isPTYTerminal(terminalId)) {
          const subscribers = ptySubscribers.get(terminalId);
          if (subscribers) {
            subscribers.delete(clientId);
          }
          // Remove output handler
          if (client && client.outputHandlers) {
            const handler = client.outputHandlers.get(terminalId);
            if (handler) {
              ptyManager.removeOutputHandler(terminalId, handler);
            }
          }
        }
        
        // Tmux terminals
        if (tmuxManager.isTmuxTerminal(terminalId)) {
          const { sessionName, windowIndex } = tmuxManager.parseTerminalId(terminalId);
          
          // Get the client session name for this client
          const clientSessionName = tmuxManager.generateClientSessionName(sessionName, clientId);
          const windowKey = tmuxManager.getWindowKey(clientSessionName, windowIndex);
          
          const subscribers = tmuxSubscribers.get(windowKey);
          if (subscribers) {
            subscribers.delete(clientId);
            // If no more subscribers for this client session, detach
            if (subscribers.size === 0) {
              tmuxManager.detachFromWindow(clientSessionName, windowIndex);
              tmuxSubscribers.delete(windowKey);
              console.log(`Detached from tmux client session ${windowKey} (client disconnected)`);
              
              // Optionally destroy the client session to clean up
              // The base session and windows remain intact
              try {
                if (tmuxManager.sessionExists(clientSessionName)) {
                  tmuxManager.destroySession(clientSessionName);
                  console.log(`Cleaned up client session ${clientSessionName}`);
                }
              } catch (e) {
                console.warn(`Could not cleanup client session ${clientSessionName}: ${e.message}`);
              }
            }
          }
          // Remove output handler
          if (client && client.outputHandlers) {
            const handler = client.outputHandlers.get(terminalId);
            if (handler) {
              tmuxManager.removeOutputHandler(clientSessionName, windowIndex, handler);
            }
          }
        }
      }
      
      clients.delete(clientId);
    });
    
    ws.on('error', (error) => {
      logger.error('WebSocket', 'Client error', { clientId, error: error.message });
    });
  });
}

function handleWatch(clientId, ws, message) {
  const { path: watchPath, recursive = true } = message;
  
  if (!watchPath) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Path is required for watch'
    }));
    return;
  }
  
  if (watchers.has(watchPath)) {
    const watcherInfo = watchers.get(watchPath);
    watcherInfo.clients.add(clientId);
    
    ws.send(JSON.stringify({
      type: 'watching',
      path: watchPath,
      message: 'Now watching for changes'
    }));
    return;
  }
  
  const watcher = chokidar.watch(watchPath, {
    ignored: /(^|[\/\\])\..|(node_modules|\.git)/,
    persistent: true,
    ignoreInitial: true,
    depth: recursive ? undefined : 0
  });
  
  const clientsWatching = new Set([clientId]);
  
  watcher.on('all', (event, filePath) => {
    const notification = {
      type: 'fileChange',
      event,
      path: filePath,
      relativePath: path.relative(watchPath, filePath),
      timestamp: Date.now()
    };
    
    for (const cid of clientsWatching) {
      const client = clients.get(cid);
      if (client && client.ws.readyState === 1) {
        client.ws.send(JSON.stringify(notification));
      }
    }
  });
  
  watcher.on('error', (error) => {
    console.error(`Watcher error for ${watchPath}:`, error);
  });
  
  watchers.set(watchPath, { watcher, clients: clientsWatching });
  
  const client = clients.get(clientId);
  if (client) {
    client.watchedPaths.add(watchPath);
  }
  
  ws.send(JSON.stringify({
    type: 'watching',
    path: watchPath,
    message: 'Now watching for changes'
  }));
}

function handleUnwatch(clientId, message) {
  const { path: watchPath } = message;
  
  if (!watchPath) return;
  
  const watcherInfo = watchers.get(watchPath);
  if (watcherInfo) {
    watcherInfo.clients.delete(clientId);
    if (watcherInfo.clients.size === 0) {
      watcherInfo.watcher.close();
      watchers.delete(watchPath);
    }
  }
  
  const client = clients.get(clientId);
  if (client) {
    client.watchedPaths.delete(watchPath);
  }
}

// Broadcast to all authenticated clients
export function broadcast(message) {
  const data = JSON.stringify(message);
  for (const [, client] of clients) {
    if (client.ws.readyState === 1) {
      client.ws.send(data);
    }
  }
}

// Cleanup on shutdown
export async function cleanup() {
  for (const [, watcherInfo] of watchers) {
    watcherInfo.watcher.close();
  }
  watchers.clear();

  // Clean up PTY terminals
  ptyManager.cleanup();
  ptySubscribers.clear();

  // Clean up tmux attached windows (but don't kill tmux sessions - they persist)
  tmuxManager.cleanup();
  tmuxSubscribers.clear();

  // Clean up chat processes
  await chatProcessManager.cleanup();
  chatSubscribers.clear();
}

// ============ Terminal Handlers ============

/**
 * Create a new terminal (PTY or tmux)
 */
function handleTerminalCreate(clientId, ws, message) {
  const { cwd, shell, cols, rows, terminalType = 'pty', projectPath } = message;
  
  console.log(`[WS] Creating ${terminalType} terminal for client ${clientId}:`, { cwd, shell, cols, rows, projectPath });
  
  try {
    if (terminalType === 'tmux') {
      // Create a tmux terminal (session + window if needed)
      if (!projectPath) {
        ws.send(JSON.stringify({
          type: 'terminalError',
          message: 'projectPath is required for tmux terminals'
        }));
        return;
      }
      
      if (!tmuxManager.isTmuxAvailable()) {
        ws.send(JSON.stringify({
          type: 'terminalError',
          message: 'tmux is not installed on this system. Install with: brew install tmux'
        }));
        return;
      }
      
      const terminal = tmuxManager.createTerminal({
        projectPath,
        cwd: cwd || projectPath,
        windowName: message.windowName || ''
      });
      
      console.log(`[WS] Tmux terminal created:`, terminal);
      
      ws.send(JSON.stringify({
        type: 'terminalCreated',
        terminal
      }));
      
      return;
    }
    
    // Default: create a PTY terminal
    const terminal = ptyManager.spawnTerminal({
      cwd,
      shell,
      cols: cols || 80,
      rows: rows || 24
    });
    
    console.log(`[WS] Terminal created:`, terminal);
    
    ws.send(JSON.stringify({
      type: 'terminalCreated',
      terminal
    }));
    
  } catch (error) {
    console.error(`[WS] Failed to create terminal:`, error);
    ws.send(JSON.stringify({
      type: 'terminalError',
      message: `Failed to create terminal: ${error.message}`
    }));
  }
}

/**
 * Attach to a terminal (PTY or tmux)
 */
function handleTerminalAttach(clientId, ws, message) {
  const { terminalId, projectPath } = message;
  
  if (!terminalId) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'terminalId is required'
    }));
    return;
  }
  
  // Handle PTY terminals
  if (ptyManager.isPTYTerminal(terminalId)) {
    handlePTYTerminalAttach(clientId, ws, terminalId);
    return;
  }
  
  // Handle tmux terminals
  if (tmuxManager.isTmuxTerminal(terminalId)) {
    handleTmuxTerminalAttach(clientId, ws, terminalId, projectPath);
    return;
  }
  
  ws.send(JSON.stringify({
    type: 'terminalError',
    terminalId,
    message: 'Invalid terminal ID format. Use pty-N for PTY or tmux-{sessionName}:{windowIndex} for tmux terminals.'
  }));
}

/**
 * Attach to a PTY terminal
 */
function handlePTYTerminalAttach(clientId, ws, terminalId) {
  const terminal = ptyManager.getTerminal(terminalId);
  
  if (!terminal) {
    ws.send(JSON.stringify({
      type: 'terminalError',
      terminalId,
      message: 'Terminal not found'
    }));
    return;
  }
  
  const client = clients.get(clientId);
  if (!client) {
    return;
  }
  
  // Initialize outputHandlers map if needed
  if (!client.outputHandlers) {
    client.outputHandlers = new Map();
  }
  
  // Check if already attached - remove old handler first to prevent duplicates
  if (client.outputHandlers.has(terminalId)) {
    console.log(`[WS] Client ${clientId} already attached to ${terminalId}, removing old handler`);
    const oldHandler = client.outputHandlers.get(terminalId);
    ptyManager.removeOutputHandler(terminalId, oldHandler);
    client.outputHandlers.delete(terminalId);
  }
  
  // Set up subscribers tracking
  if (!ptySubscribers.has(terminalId)) {
    ptySubscribers.set(terminalId, new Set());
  }
  ptySubscribers.get(terminalId).add(clientId);
  
  // Track for client cleanup
  client.subscribedTerminals.add(terminalId);
  
  // Set up output handler for this client
  const outputHandler = (data) => {
    const c = clients.get(clientId);
    if (c && c.ws.readyState === 1) {
      c.ws.send(JSON.stringify({
        type: 'terminalData',
        terminalId,
        data
      }));
    }
  };
  
  // Store handler reference for cleanup
  client.outputHandlers.set(terminalId, outputHandler);
  
  ptyManager.addOutputHandler(terminalId, outputHandler);
  
  // Send attachment confirmation
  ws.send(JSON.stringify({
    type: 'terminalAttached',
    terminalId,
    terminal,
    message: 'Attached to PTY terminal',
    readOnly: false
  }));
  
  // Send buffered output (terminal history) so user sees previous content
  const bufferedOutput = ptyManager.getBuffer(terminalId);
  if (bufferedOutput) {
    const clearAndBuffer = '\x1b[2J\x1b[H' + bufferedOutput;
    ws.send(JSON.stringify({
      type: 'terminalData',
      terminalId,
      data: clearAndBuffer
    }));
    console.log(`[WS] Sent ${bufferedOutput.length} bytes of buffered output to client ${clientId}`);
  }
  
  console.log(`Client ${clientId} attached to PTY terminal ${terminalId}`);
}

/**
 * Attach to a tmux terminal (window-based)
 */
function handleTmuxTerminalAttach(clientId, ws, terminalId, projectPath) {
  if (!projectPath) {
    ws.send(JSON.stringify({
      type: 'terminalError',
      terminalId,
      message: 'projectPath is required for tmux terminals'
    }));
    return;
  }
  
  // Parse the terminal ID to get session name and window index
  let sessionName, windowIndex;
  try {
    ({ sessionName, windowIndex } = tmuxManager.parseTerminalId(terminalId));
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'terminalError',
      terminalId,
      message: `Invalid terminal ID: ${error.message}`
    }));
    return;
  }
  
  // Check if base session exists
  if (!tmuxManager.sessionExists(sessionName)) {
    ws.send(JSON.stringify({
      type: 'terminalError',
      terminalId,
      message: 'Tmux session not found'
    }));
    return;
  }
  
  // Check if window exists
  const windows = tmuxManager.listWindows(sessionName);
  const window = windows.find(w => w.index === windowIndex);
  if (!window) {
    ws.send(JSON.stringify({
      type: 'terminalError',
      terminalId,
      message: `Window ${windowIndex} not found in session ${sessionName}`
    }));
    return;
  }
  
  const client = clients.get(clientId);
  if (!client) {
    return;
  }
  
  // Initialize outputHandlers map if needed
  if (!client.outputHandlers) {
    client.outputHandlers = new Map();
  }
  
  // Check if already attached - remove old handler first
  if (client.outputHandlers.has(terminalId)) {
    console.log(`[WS] Client ${clientId} already attached to tmux terminal, removing old handler`);
    const oldHandler = client.outputHandlers.get(terminalId);
    tmuxManager.removeOutputHandler(sessionName, windowIndex, oldHandler);
    client.outputHandlers.delete(terminalId);
  }
  
  // Attach to the tmux window with client-specific grouped session
  let attachResult;
  try {
    attachResult = tmuxManager.attachToWindow(sessionName, windowIndex, { 
      cols: 80, 
      rows: 24,
      clientId
    });
    console.log(`[WS] Client ${clientId} attached to tmux window with independent view`);
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'terminalError',
      terminalId,
      message: `Failed to attach to tmux window: ${error.message}`
    }));
    return;
  }
  
  // Use client session for tracking
  const clientSessionName = attachResult.clientSessionName || sessionName;
  const windowKey = tmuxManager.getWindowKey(clientSessionName, windowIndex);
  
  // Set up subscribers tracking for this client's session
  if (!tmuxSubscribers.has(windowKey)) {
    tmuxSubscribers.set(windowKey, new Set());
  }
  tmuxSubscribers.get(windowKey).add(clientId);
  
  // Track for client cleanup
  client.subscribedTerminals.add(terminalId);
  
  // Set up output handler for this client
  const outputHandler = (data) => {
    const c = clients.get(clientId);
    if (c && c.ws.readyState === 1) {
      c.ws.send(JSON.stringify({
        type: 'terminalData',
        terminalId,
        data
      }));
    }
  };
  
  // Store handler reference for cleanup
  client.outputHandlers.set(terminalId, outputHandler);
  client.clientSessionName = clientSessionName;
  
  tmuxManager.addOutputHandler(clientSessionName, windowIndex, outputHandler);
  
  // Get terminal info for response
  const terminalInfo = tmuxManager.getTerminalInfo(terminalId, projectPath);
  
  // Send attachment confirmation
  ws.send(JSON.stringify({
    type: 'terminalAttached',
    terminalId,
    terminal: terminalInfo,
    message: 'Attached to tmux window',
    readOnly: false,
    isTmux: true,
    sessionName,
    windowIndex
  }));
  
  // Send buffered output if available
  const bufferedOutput = tmuxManager.getBuffer(sessionName, windowIndex);
  if (bufferedOutput) {
    const clearAndBuffer = '\x1b[2J\x1b[H' + bufferedOutput;
    ws.send(JSON.stringify({
      type: 'terminalData',
      terminalId,
      data: clearAndBuffer
    }));
    console.log(`[WS] Sent ${bufferedOutput.length} bytes of tmux buffer to client ${clientId}`);
  }
  
  console.log(`Client ${clientId} attached to tmux window ${windowKey}`);
}

/**
 * Detach from a terminal
 */
function handleTerminalDetach(clientId, message) {
  const { terminalId } = message;
  
  if (!terminalId) return;
  
  const client = clients.get(clientId);
  
  // Handle PTY terminal
  if (ptyManager.isPTYTerminal(terminalId)) {
    const subscribers = ptySubscribers.get(terminalId);
    if (subscribers) {
      subscribers.delete(clientId);
    }
    
    // Remove output handler
    if (client && client.outputHandlers) {
      const handler = client.outputHandlers.get(terminalId);
      if (handler) {
        ptyManager.removeOutputHandler(terminalId, handler);
        client.outputHandlers.delete(terminalId);
      }
    }
  }
  
  // Handle tmux terminal
  if (tmuxManager.isTmuxTerminal(terminalId)) {
    const { sessionName, windowIndex } = tmuxManager.parseTerminalId(terminalId);
    
    const clientSessionName = client?.clientSessionName || tmuxManager.generateClientSessionName(sessionName, clientId);
    const windowKey = tmuxManager.getWindowKey(clientSessionName, windowIndex);
    
    const subscribers = tmuxSubscribers.get(windowKey);
    if (subscribers) {
      subscribers.delete(clientId);
      
      if (subscribers.size === 0) {
        tmuxManager.detachFromWindow(clientSessionName, windowIndex);
        tmuxSubscribers.delete(windowKey);
        console.log(`Detached from tmux client session ${windowKey} (no subscribers)`);
        
        try {
          if (tmuxManager.sessionExists(clientSessionName)) {
            tmuxManager.destroySession(clientSessionName);
            console.log(`Cleaned up client session ${clientSessionName}`);
          }
        } catch (e) {
          console.warn(`Could not cleanup client session ${clientSessionName}: ${e.message}`);
        }
      }
    }
    
    // Remove output handler
    if (client && client.outputHandlers) {
      const handler = client.outputHandlers.get(terminalId);
      if (handler) {
        tmuxManager.removeOutputHandler(clientSessionName, windowIndex, handler);
        client.outputHandlers.delete(terminalId);
      }
    }
  }
  
  if (client) {
    client.subscribedTerminals.delete(terminalId);
  }
}

/**
 * Send input to a terminal
 */
function handleTerminalInput(clientId, ws, message) {
  const { terminalId, data } = message;
  
  if (!terminalId || data === undefined) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'terminalId and data are required'
    }));
    return;
  }
  
  // Handle PTY terminals
  if (ptyManager.isPTYTerminal(terminalId)) {
    try {
      ptyManager.writeToTerminal(terminalId, data);
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'terminalError',
        terminalId,
        message: error.message
      }));
    }
    return;
  }
  
  // Handle tmux terminals
  if (tmuxManager.isTmuxTerminal(terminalId)) {
    try {
      const { sessionName, windowIndex } = tmuxManager.parseTerminalId(terminalId);
      const client = clients.get(clientId);
      
      const clientSessionName = client?.clientSessionName || tmuxManager.generateClientSessionName(sessionName, clientId);
      
      if (!tmuxManager.isAttached(clientSessionName, windowIndex)) {
        ws.send(JSON.stringify({
          type: 'terminalError',
          terminalId,
          message: 'Tmux window is not attached. Attach first.'
        }));
        return;
      }
      tmuxManager.writeToWindow(clientSessionName, windowIndex, data);
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'terminalError',
        terminalId,
        message: error.message
      }));
    }
    return;
  }
  
  ws.send(JSON.stringify({
    type: 'terminalError',
    terminalId,
    message: 'Invalid terminal ID format'
  }));
}

/**
 * Resize a terminal
 */
function handleTerminalResize(clientId, ws, message) {
  const { terminalId, cols, rows } = message;
  
  if (!terminalId || !cols || !rows) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'terminalId, cols, and rows are required'
    }));
    return;
  }
  
  // Handle PTY terminals
  if (ptyManager.isPTYTerminal(terminalId)) {
    try {
      ptyManager.resizeTerminal(terminalId, cols, rows);
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'terminalError',
        terminalId,
        message: error.message
      }));
    }
    return;
  }
  
  // Handle tmux terminals
  if (tmuxManager.isTmuxTerminal(terminalId)) {
    try {
      const { sessionName, windowIndex } = tmuxManager.parseTerminalId(terminalId);
      const client = clients.get(clientId);
      const clientSessionName = client?.clientSessionName || tmuxManager.generateClientSessionName(sessionName, clientId);
      
      if (tmuxManager.isAttached(clientSessionName, windowIndex)) {
        tmuxManager.resizeWindow(clientSessionName, windowIndex, cols, rows);
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'terminalError',
        terminalId,
        message: error.message
      }));
    }
    return;
  }
}

/**
 * Kill a terminal
 */
function handleTerminalKill(clientId, ws, message) {
  const { terminalId } = message;
  
  if (!terminalId) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'terminalId is required'
    }));
    return;
  }
  
  // Handle PTY terminals
  if (ptyManager.isPTYTerminal(terminalId)) {
    try {
      const subscribers = ptySubscribers.get(terminalId);
      if (subscribers) {
        for (const cid of subscribers) {
          const client = clients.get(cid);
          if (client && client.ws.readyState === 1) {
            client.ws.send(JSON.stringify({
              type: 'terminalClosed',
              terminalId
            }));
          }
        }
        ptySubscribers.delete(terminalId);
      }
      
      ptyManager.killTerminal(terminalId);
      
      ws.send(JSON.stringify({
        type: 'terminalKilled',
        terminalId
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'terminalError',
        terminalId,
        message: error.message
      }));
    }
    return;
  }
  
  // Handle tmux terminals
  if (tmuxManager.isTmuxTerminal(terminalId)) {
    try {
      const { sessionName, windowIndex } = tmuxManager.parseTerminalId(terminalId);
      const windowKey = tmuxManager.getWindowKey(sessionName, windowIndex);
      
      const subscribers = tmuxSubscribers.get(windowKey);
      if (subscribers) {
        for (const cid of subscribers) {
          const client = clients.get(cid);
          if (client && client.ws.readyState === 1) {
            client.ws.send(JSON.stringify({
              type: 'terminalClosed',
              terminalId
            }));
          }
        }
        tmuxSubscribers.delete(windowKey);
      }
      
      tmuxManager.killWindow(sessionName, windowIndex);
      
      ws.send(JSON.stringify({
        type: 'terminalKilled',
        terminalId
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'terminalError',
        terminalId,
        message: error.message
      }));
    }
    return;
  }

  ws.send(JSON.stringify({
    type: 'terminalError',
    terminalId,
    message: 'Invalid terminal ID format'
  }));
}

// ============ Chat Session Handlers ============
// Chat processes use ChatProcessManager with JSON output for structured data
// This provides clean content blocks instead of raw terminal ANSI codes

const chatSubscribers = new Map(); // conversationId -> Set of clientIds

/**
 * Attach to a chat session
 */
async function handleChatAttach(clientId, ws, message) {
  console.log(`[WS] handleChatAttach called for client ${clientId}:`, JSON.stringify(message));
  const { conversationId, workspaceId } = message;

  if (!conversationId) {
    ws.send(JSON.stringify({
      type: 'chatError',
      message: 'conversationId is required'
    }));
    return;
  }

  // Check if chat exists
  if (!chatProcessManager.hasChat(conversationId)) {
    ws.send(JSON.stringify({
      type: 'chatError',
      conversationId,
      message: 'Chat not found'
    }));
    return;
  }

  const client = clients.get(clientId);
  if (!client) {
    return;
  }

  // Initialize handlers map if needed
  if (!client.chatHandlers) {
    client.chatHandlers = new Map();
  }

  // Check if already attached - remove old handler first
  if (client.chatHandlers.has(conversationId)) {
    console.log(`[WS] Client ${clientId} already attached to chat ${conversationId}, removing old handler`);
    const oldHandler = client.chatHandlers.get(conversationId);
    chatProcessManager.removeOutputHandler(conversationId, oldHandler);
    client.chatHandlers.delete(conversationId);
  }

  try {
    // Attach to the chat process
    const attachResult = await chatProcessManager.attachChat(conversationId, clientId);
    console.log(`[WS] Client ${clientId} attached to chat session ${conversationId}`);

    // Track subscribers
    if (!chatSubscribers.has(conversationId)) {
      chatSubscribers.set(conversationId, new Set());
    }
    chatSubscribers.get(conversationId).add(clientId);

    // Track for client cleanup
    client.subscribedTerminals.add(conversationId);

    // Set up output handler - forwards structured events to client
    const outputHandler = (event) => {
      const c = clients.get(clientId);
      if (c && c.ws.readyState === 1) {
        // Send structured event directly
        c.ws.send(JSON.stringify({
          type: 'chatEvent',
          conversationId,
          event
        }));
      }
    };

    // Store handler reference for cleanup
    client.chatHandlers.set(conversationId, outputHandler);
    chatProcessManager.addOutputHandler(conversationId, outputHandler);

    const chatInfo = chatProcessManager.getChat(conversationId);

    // Send attachment confirmation
    ws.send(JSON.stringify({
      type: 'chatAttached',
      conversationId,
      tool: chatInfo?.tool || 'unknown',
      workspacePath: workspaceId,
      status: attachResult.status,
      message: 'Attached to chat session'
    }));

    // Send buffered messages (conversation history)
    const bufferedMessages = attachResult.bufferedMessages || [];
    if (bufferedMessages.length > 0) {
      ws.send(JSON.stringify({
        type: 'chatHistory',
        conversationId,
        messages: bufferedMessages
      }));
      console.log(`[WS] Sent ${bufferedMessages.length} buffered messages to client ${clientId}`);
    }

    console.log(`Client ${clientId} attached to chat ${conversationId} (tool: ${chatInfo?.tool})`);
  } catch (error) {
    console.error(`[WS] Failed to attach to chat ${conversationId}:`, error);
    ws.send(JSON.stringify({
      type: 'chatError',
      conversationId,
      message: `Failed to attach to chat: ${error.message}`
    }));
  }
}

/**
 * Detach from a chat session
 */
function handleChatDetach(clientId, message) {
  const { conversationId } = message;

  if (!conversationId) return;

  const client = clients.get(clientId);

  const subscribers = chatSubscribers.get(conversationId);
  if (subscribers) {
    subscribers.delete(clientId);
    if (subscribers.size === 0) {
      chatSubscribers.delete(conversationId);
    }
  }

  // Remove output handler
  if (client && client.chatHandlers) {
    const handler = client.chatHandlers.get(conversationId);
    if (handler) {
      chatProcessManager.removeOutputHandler(conversationId, handler);
      client.chatHandlers.delete(conversationId);
    }
  }

  if (client) {
    client.subscribedTerminals.delete(conversationId);
  }

  console.log(`Client ${clientId} detached from chat ${conversationId}`);
}

/**
 * Send a message to a chat session
 */
async function handleChatMessage(clientId, ws, message) {
  console.log(`[WS] handleChatMessage called for client ${clientId}:`, JSON.stringify(message));
  const { conversationId, content, mode } = message;

  if (!conversationId || content === undefined) {
    ws.send(JSON.stringify({
      type: 'chatError',
      conversationId,
      message: 'conversationId and content are required'
    }));
    return;
  }

  if (!chatProcessManager.hasChat(conversationId)) {
    ws.send(JSON.stringify({
      type: 'chatError',
      conversationId,
      message: 'Chat not found'
    }));
    return;
  }

  try {
    // Check if mode has changed and handle mode switching
    if (mode && chatProcessManager.needsModeSwitch(conversationId, mode)) {
      console.log(`[WS] Mode switch requested for ${conversationId}: ${mode}`);
      await chatProcessManager.switchMode(conversationId, mode);
    }

    const result = await chatProcessManager.sendMessage(conversationId, content);

    // Confirm message was sent
    ws.send(JSON.stringify({
      type: 'chatMessageSent',
      conversationId,
      messageId: result.messageId
    }));

    console.log(`[WS] Sent message to chat ${conversationId}: ${content.substring(0, 50)}...`);
  } catch (error) {
    console.error(`[WS] Failed to send message to chat ${conversationId}:`, error);
    ws.send(JSON.stringify({
      type: 'chatError',
      conversationId,
      message: error.message
    }));
  }
}

/**
 * Send approval response to a chat session
 */
async function handleChatApproval(clientId, ws, message) {
  const { conversationId, approved, blockId } = message;

  if (!conversationId || approved === undefined) {
    ws.send(JSON.stringify({
      type: 'chatError',
      message: 'conversationId and approved are required'
    }));
    return;
  }

  try {
    // Pass blockId (the tool_use_id) so sendApproval can find the specific denied tool
    await chatProcessManager.sendApproval(conversationId, approved, blockId);
    console.log(`[WS] Sent approval (${approved}) for block ${blockId} to chat ${conversationId}`);
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'chatError',
      conversationId,
      message: error.message
    }));
  }
}

/**
 * Cancel/interrupt a chat session
 */
async function handleChatCancel(clientId, ws, message) {
  const { conversationId } = message;

  if (!conversationId) {
    ws.send(JSON.stringify({
      type: 'chatError',
      message: 'conversationId is required'
    }));
    return;
  }

  try {
    await chatProcessManager.cancelChat(conversationId);

    ws.send(JSON.stringify({
      type: 'chatCancelled',
      conversationId,
      message: 'Chat interrupted'
    }));

    console.log(`[WS] Cancelled chat ${conversationId}`);
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'chatError',
      conversationId,
      message: error.message
    }));
  }
}
