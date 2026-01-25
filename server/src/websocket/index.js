import chokidar from 'chokidar';
import path from 'path';

const clients = new Map();
const watchers = new Map();

export function setupWebSocket(wss, authManager) {
  wss.on('connection', (ws, req) => {
    const clientId = crypto.randomUUID();
    let authenticated = false;
    let watchedPaths = new Set();
    
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
            clients.set(clientId, { ws, watchedPaths });
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
      
      // Clean up watchers for this client
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
