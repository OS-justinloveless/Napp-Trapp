import chokidar from 'chokidar';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { terminalManager } from '../routes/terminals.js';

const clients = new Map();
const watchers = new Map();
const dbWatchers = new Map();
const cursorTerminalWatchers = new Map(); // terminalId -> { watcher, filePath, subscribers, lastContent }

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
      depth: dbPath.endsWith('workspaceStorage') ? 2 : 0, // Watch workspace subdirectories
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });
    
    watcher.on('change', (filePath) => {
      console.log(`Database changed: ${filePath}`);
      
      // Broadcast to all connected clients
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
  // Setup database watchers
  setupDatabaseWatchers();
  
  wss.on('connection', (ws, req) => {
    const clientId = crypto.randomUUID();
    let authenticated = false;
    let watchedPaths = new Set();
    let subscribedTerminals = new Set();
    
    console.log(`Client connected: ${clientId}`);
    
    // Send initial connection message
    ws.send(JSON.stringify({
      type: 'connection',
      clientId,
      message: 'Connected. Please authenticate.'
    }));
    
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Handle authentication
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
        
        // Require authentication for all other messages
        if (!authenticated) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Not authenticated'
          }));
          return;
        }
        
        // Handle different message types
        switch (message.type) {
          case 'watch':
            handleWatch(clientId, ws, message);
            break;
            
          case 'unwatch':
            handleUnwatch(clientId, message);
            break;
            
          case 'terminalAttach':
            handleTerminalAttach(clientId, ws, message);
            break;
            
          case 'terminalDetach':
            handleTerminalDetach(clientId, message);
            break;
            
          case 'terminalInput':
            handleTerminalInput(clientId, message);
            break;
            
          case 'terminalResize':
            handleTerminalResize(clientId, message);
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
      
      // Clean up file watchers for this client
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
      
      // Clean up Cursor IDE terminal watchers
      for (const terminalId of subscribedTerminals) {
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
  
  // Check if we already have a watcher for this path
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
  
  // Create new watcher
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
    
    // Notify all clients watching this path
    for (const cid of clientsWatching) {
      const client = clients.get(cid);
      if (client && client.ws.readyState === 1) { // OPEN
        client.ws.send(JSON.stringify(notification));
      }
    }
  });
  
  watcher.on('error', (error) => {
    console.error(`Watcher error for ${watchPath}:`, error);
  });
  
  watchers.set(watchPath, { watcher, clients: clientsWatching });
  
  // Track for client cleanup
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
    if (client.ws.readyState === 1) { // OPEN
      client.ws.send(data);
    }
  }
}

// Cleanup on shutdown
export function cleanup() {
  // Close all database watchers
  for (const [, watcher] of dbWatchers) {
    watcher.close();
  }
  dbWatchers.clear();
  
  // Close all file watchers
  for (const [, watcherInfo] of watchers) {
    watcherInfo.watcher.close();
  }
  watchers.clear();
  
  // Close all Cursor terminal file watchers
  for (const [terminalId, watcherInfo] of cursorTerminalWatchers) {
    watcherInfo.watcher.close();
    console.log(`Closed file watcher for Cursor terminal: ${terminalId}`);
  }
  cursorTerminalWatchers.clear();
  
  // Clear TTY cache
  if (terminalManager) {
    terminalManager.clearTTYCache();
  }
}

// Terminal handler functions
function handleTerminalAttach(clientId, ws, message) {
  const { terminalId, projectPath } = message;
  
  if (!terminalId) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'terminalId is required'
    }));
    return;
  }
  
  // Only Cursor IDE terminals are supported
  if (!terminalManager.isCursorIDETerminal(terminalId)) {
    ws.send(JSON.stringify({
      type: 'terminalError',
      terminalId,
      message: 'Only Cursor IDE terminals are supported. Terminal IDs should be in format: cursor-N (e.g., cursor-1)'
    }));
    return;
  }
  
  handleCursorTerminalAttach(clientId, ws, terminalId, projectPath);
}

/**
 * Handle attaching to a Cursor IDE terminal (file-based, read-only)
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
  
  // Try to read the terminal content
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
  
  // Set up file watcher if not already watching
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
      
      // Read updated content
      const newData = terminalManager.readCursorTerminalContent(terminalId, projectPath);
      if (!newData) return;
      
      const newContent = newData.content;
      const lastContent = watcherInfo.lastContent || '';
      
      // Calculate the diff (new content since last read)
      let diff = '';
      if (newContent.length > lastContent.length && newContent.startsWith(lastContent)) {
        // Append-only change - send just the new part
        diff = newContent.substring(lastContent.length);
      } else {
        // Content changed in a different way - send full content with clear signal
        diff = '\x1b[2J\x1b[H' + newContent; // Clear screen + move to home + new content
      }
      
      watcherInfo.lastContent = newContent;
      
      // Send update to all subscribers
      const message = JSON.stringify({
        type: 'terminalData',
        terminalId,
        data: diff
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
  
  // Add subscriber
  cursorTerminalWatchers.get(terminalId).subscribers.add(clientId);
  
  // Track for client cleanup
  const client = clients.get(clientId);
  if (client) {
    client.subscribedTerminals.add(terminalId);
  }
  
  // Send attachment confirmation
  ws.send(JSON.stringify({
    type: 'terminalAttached',
    terminalId,
    message: 'Attached to Cursor IDE terminal',
    readOnly: false,
    metadata
  }));
  
  // Send initial content
  ws.send(JSON.stringify({
    type: 'terminalData',
    terminalId,
    data: content
  }));
}

function handleTerminalDetach(clientId, message) {
  const { terminalId } = message;
  
  if (!terminalId) return;
  
  // Handle Cursor IDE terminal watchers
  const cursorWatcher = cursorTerminalWatchers.get(terminalId);
  if (cursorWatcher) {
    cursorWatcher.subscribers.delete(clientId);
    
    if (cursorWatcher.subscribers.size === 0) {
      // Close the file watcher
      cursorWatcher.watcher.close();
      cursorTerminalWatchers.delete(terminalId);
      console.log(`Closed file watcher for Cursor terminal: ${terminalId}`);
    }
  }
  
  const client = clients.get(clientId);
  if (client) {
    client.subscribedTerminals.delete(terminalId);
  }
}

function handleTerminalInput(clientId, message) {
  const { terminalId, data } = message;
  
  if (!terminalId || data === undefined) {
    const client = clients.get(clientId);
    if (client && client.ws) {
      client.ws.send(JSON.stringify({
        type: 'error',
        message: 'terminalId and data are required'
      }));
    }
    return;
  }
  
  // Only Cursor IDE terminals are supported
  if (!terminalManager.isCursorIDETerminal(terminalId)) {
    const client = clients.get(clientId);
    if (client && client.ws) {
      client.ws.send(JSON.stringify({
        type: 'terminalError',
        terminalId,
        message: 'Only Cursor IDE terminals are supported'
      }));
    }
    return;
  }
  
  // Write to Cursor IDE terminal via TTY
  const watcherInfo = cursorTerminalWatchers.get(terminalId);
  if (!watcherInfo || !watcherInfo.projectPath) {
    const client = clients.get(clientId);
    if (client && client.ws) {
      client.ws.send(JSON.stringify({
        type: 'terminalError',
        terminalId,
        message: 'Terminal not attached. Please reopen the terminal.'
      }));
    }
    return;
  }
  
  try {
    terminalManager.writeToCursorTerminalFast(terminalId, watcherInfo.projectPath, data);
  } catch (error) {
    const client = clients.get(clientId);
    if (client && client.ws) {
      client.ws.send(JSON.stringify({
        type: 'terminalError',
        terminalId,
        message: error.message
      }));
    }
  }
}

function handleTerminalResize(clientId, message) {
  // Cursor IDE terminals don't support resize via API - silently ignore
  // The terminal size is controlled by the Cursor IDE itself
}
