import chokidar from 'chokidar';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { terminalManager, ptyManager } from '../routes/terminals.js';

const clients = new Map();
const watchers = new Map();
const dbWatchers = new Map();
const cursorTerminalWatchers = new Map(); // terminalId -> { watcher, filePath, subscribers, lastContent }
const ptySubscribers = new Map(); // terminalId -> Set of clientIds

/**
 * Get Cursor database paths
 */
function getCursorDbPaths() {
  const homeDir = os.homedir();
  const paths = [];
  
  switch (process.platform) {
    case 'darwin':
      paths.push(
        path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
        path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage')
      );
      break;
    case 'win32':
      paths.push(
        path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
        path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'workspaceStorage')
      );
      break;
    case 'linux':
      if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) {
        paths.push(
          path.join(homeDir, '.cursor-server', 'data', 'User', 'globalStorage', 'state.vscdb'),
          path.join(homeDir, '.cursor-server', 'data', 'User', 'workspaceStorage')
        );
      } else {
        paths.push(
          path.join(homeDir, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
          path.join(homeDir, '.config', 'Cursor', 'User', 'workspaceStorage')
        );
      }
      break;
  }
  
  return paths;
}

/**
 * Setup database watchers for Cursor chat updates
 */
function setupDatabaseWatchers() {
  const dbPaths = getCursorDbPaths();
  
  for (const dbPath of dbPaths) {
    if (!fs.existsSync(dbPath)) {
      console.log(`Database path does not exist, skipping: ${dbPath}`);
      continue;
    }
    
    console.log(`Setting up database watcher for: ${dbPath}`);
    
    const watcher = chokidar.watch(dbPath, {
      persistent: true,
      ignoreInitial: true,
      depth: dbPath.endsWith('workspaceStorage') ? 2 : 0,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });
    
    watcher.on('change', (filePath) => {
      broadcast({
        type: 'chatUpdate',
        message: 'Chat database updated',
        path: filePath,
        timestamp: Date.now()
      });
    });
    
    watcher.on('error', (error) => {
      console.error(`Database watcher error for ${dbPath}:`, error);
    });
    
    dbWatchers.set(dbPath, watcher);
  }
}

export function setupWebSocket(wss, authManager) {
  setupDatabaseWatchers();
  
  wss.on('connection', (ws, req) => {
    const clientId = crypto.randomUUID();
    let authenticated = false;
    let watchedPaths = new Set();
    let subscribedTerminals = new Set();
    
    console.log(`Client connected: ${clientId}`);
    
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
            
          default:
            ws.send(JSON.stringify({
              type: 'error',
              message: `Unknown message type: ${message.type}`
            }));
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message
        }));
      }
    });
    
    ws.on('close', () => {
      console.log(`Client disconnected: ${clientId}`);
      
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
      
      // Clean up terminal subscriptions
      for (const terminalId of subscribedTerminals) {
        // PTY terminals
        if (ptyManager.isPTYTerminal(terminalId)) {
          const subscribers = ptySubscribers.get(terminalId);
          if (subscribers) {
            subscribers.delete(clientId);
          }
        }
        
        // Cursor IDE terminals
        const cursorWatcher = cursorTerminalWatchers.get(terminalId);
        if (cursorWatcher) {
          cursorWatcher.subscribers.delete(clientId);
          if (cursorWatcher.subscribers.size === 0) {
            cursorWatcher.watcher.close();
            cursorTerminalWatchers.delete(terminalId);
            console.log(`Closed file watcher for Cursor terminal: ${terminalId}`);
          }
        }
      }
      
      clients.delete(clientId);
    });
    
    ws.on('error', (error) => {
      console.error(`WebSocket error for ${clientId}:`, error);
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
export function cleanup() {
  for (const [, watcher] of dbWatchers) {
    watcher.close();
  }
  dbWatchers.clear();
  
  for (const [, watcherInfo] of watchers) {
    watcherInfo.watcher.close();
  }
  watchers.clear();
  
  for (const [terminalId, watcherInfo] of cursorTerminalWatchers) {
    watcherInfo.watcher.close();
    console.log(`Closed file watcher for Cursor terminal: ${terminalId}`);
  }
  cursorTerminalWatchers.clear();
  
  // Clean up PTY terminals
  ptyManager.cleanup();
  ptySubscribers.clear();
  
  if (terminalManager) {
    terminalManager.clearTTYCache();
  }
}

// ============ Terminal Handlers ============

/**
 * Create a new PTY terminal
 */
function handleTerminalCreate(clientId, ws, message) {
  const { cwd, shell, cols, rows } = message;
  
  console.log(`[WS] Creating terminal for client ${clientId}:`, { cwd, shell, cols, rows });
  
  try {
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
    
    // Note: Don't auto-attach here - the iOS client will call terminalAttach
    // when navigating to the terminal view. This prevents duplicate handlers.
    
  } catch (error) {
    console.error(`[WS] Failed to create terminal:`, error);
    ws.send(JSON.stringify({
      type: 'terminalError',
      message: `Failed to create terminal: ${error.message}`
    }));
  }
}

/**
 * Attach to a terminal (PTY or Cursor IDE)
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
  
  // Handle Cursor IDE terminals
  if (terminalManager.isCursorIDETerminal(terminalId)) {
    handleCursorTerminalAttach(clientId, ws, terminalId, projectPath);
    return;
  }
  
  ws.send(JSON.stringify({
    type: 'terminalError',
    terminalId,
    message: 'Invalid terminal ID format. Use pty-N for PTY terminals or cursor-N for Cursor IDE terminals.'
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
    // Send clear screen + home cursor first, then the buffered content
    // This ensures no duplicate content if the client had partial state
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
 * Format Cursor IDE terminal content for clean display
 * The file content is "rendered" text without ANSI sequences,
 * so we need to format it properly for terminal display
 */
function formatCursorTerminalContent(content) {
  // Clear screen + home cursor + reset attributes
  let formatted = '\x1b[2J\x1b[H\x1b[0m';
  
  // Split into lines and process each
  const lines = content.split('\n');
  
  for (const line of lines) {
    // Output the line with carriage return + newline for proper terminal display
    formatted += line + '\r\n';
  }
  
  return formatted;
}

/**
 * Attach to a Cursor IDE terminal (file-based)
 */
function handleCursorTerminalAttach(clientId, ws, terminalId, projectPath) {
  if (!projectPath) {
    ws.send(JSON.stringify({
      type: 'terminalError',
      terminalId,
      message: 'projectPath is required for Cursor IDE terminals'
    }));
    return;
  }
  
  const terminalData = terminalManager.readCursorTerminalContent(terminalId, projectPath);
  
  if (!terminalData) {
    ws.send(JSON.stringify({
      type: 'terminalError',
      terminalId,
      message: 'Terminal not found or not active'
    }));
    return;
  }
  
  const { content, metadata, filePath } = terminalData;
  
  if (!cursorTerminalWatchers.has(terminalId)) {
    console.log(`Setting up file watcher for Cursor terminal: ${terminalId} at ${filePath}`);
    
    const watcher = chokidar.watch(filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });
    
    watcher.on('change', () => {
      const watcherInfo = cursorTerminalWatchers.get(terminalId);
      if (!watcherInfo) return;
      
      const newData = terminalManager.readCursorTerminalContent(terminalId, projectPath);
      if (!newData) return;
      
      const newContent = newData.content;
      const lastContent = watcherInfo.lastContent || '';
      
      // For Cursor IDE terminals, always send the full formatted content
      // since we don't have proper ANSI sequences for incremental updates
      let formattedData = '';
      if (newContent.length > lastContent.length && newContent.startsWith(lastContent)) {
        // Append-only change - just send the new lines with proper formatting
        const newPart = newContent.substring(lastContent.length);
        const lines = newPart.split('\n');
        formattedData = lines.join('\r\n');
      } else {
        // Content changed in a different way - send full formatted content
        formattedData = formatCursorTerminalContent(newContent);
      }
      
      watcherInfo.lastContent = newContent;
      
      const message = JSON.stringify({
        type: 'terminalData',
        terminalId,
        data: formattedData
      });
      
      for (const cid of watcherInfo.subscribers) {
        const client = clients.get(cid);
        if (client && client.ws.readyState === 1) {
          client.ws.send(message);
        }
      }
    });
    
    watcher.on('error', (error) => {
      console.error(`Cursor terminal watcher error for ${terminalId}:`, error);
    });
    
    cursorTerminalWatchers.set(terminalId, {
      watcher,
      filePath,
      projectPath,
      subscribers: new Set(),
      lastContent: content
    });
  }
  
  cursorTerminalWatchers.get(terminalId).subscribers.add(clientId);
  
  const client = clients.get(clientId);
  if (client) {
    client.subscribedTerminals.add(terminalId);
  }
  
  ws.send(JSON.stringify({
    type: 'terminalAttached',
    terminalId,
    message: 'Attached to Cursor IDE terminal (read-only output, limited input)',
    readOnly: true,
    metadata
  }));
  
  // Send formatted content for proper display
  ws.send(JSON.stringify({
    type: 'terminalData',
    terminalId,
    data: formatCursorTerminalContent(content)
  }));
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
  
  // Handle Cursor IDE terminal
  const cursorWatcher = cursorTerminalWatchers.get(terminalId);
  if (cursorWatcher) {
    cursorWatcher.subscribers.delete(clientId);
    
    if (cursorWatcher.subscribers.size === 0) {
      cursorWatcher.watcher.close();
      cursorTerminalWatchers.delete(terminalId);
      console.log(`Closed file watcher for Cursor terminal: ${terminalId}`);
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
  
  // Handle PTY terminals - full bidirectional support
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
  
  // Handle Cursor IDE terminals - limited support
  if (terminalManager.isCursorIDETerminal(terminalId)) {
    ws.send(JSON.stringify({
      type: 'terminalError',
      terminalId,
      message: 'Input to Cursor IDE terminals is not supported due to macOS security restrictions. Use PTY terminals for full input support.'
    }));
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
  
  // Cursor IDE terminals don't support resize via API - silently ignore
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
      // Notify all subscribers that terminal is closing
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
  
  ws.send(JSON.stringify({
    type: 'terminalError',
    terminalId,
    message: 'Cannot kill Cursor IDE terminals from here'
  }));
}
