import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { config } from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

import { setupRoutes } from './routes/index.js';
import { setupWebSocket } from './websocket/index.js';
import { AuthManager } from './auth/AuthManager.js';
import { LogManager } from './utils/LogManager.js';
import { chatProcessManager } from './utils/ChatProcessManager.js';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Configuration
const PORT = process.env.PORT || 3847;

// Determine client dist directory
// When running from npm package (CLI), use bundled client-dist
// When running in development, use ../../client/dist
function getClientDistPath() {
  // First check for bundled client-dist (npm package)
  const bundledPath = path.join(__dirname, '../client-dist');
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }
  
  // Fall back to development path
  const devPath = path.join(__dirname, '../../client/dist');
  if (fs.existsSync(devPath)) {
    return devPath;
  }
  
  // If neither exists, warn but return dev path (will 404 gracefully)
  console.warn('Warning: Client dist directory not found. Run "npm run build" in client/ first.');
  return devPath;
}

const CLIENT_DIST_PATH = getClientDistPath();

// Determine data directory
// Priority: NAPPTRAPP_DATA_DIR env var > ~/.napptrapp > local .napp-trapp-data
function getDataDir() {
  if (process.env.NAPPTRAPP_DATA_DIR) {
    return process.env.NAPPTRAPP_DATA_DIR;
  }
  
  // When running from CLI/npx, use home directory
  if (process.env.NAPPTRAPP_CLI) {
    const homeDir = os.homedir();
    return path.join(homeDir, '.napptrapp');
  }
  
  // Development mode: use local directory
  return path.join(__dirname, '../.napp-trapp-data');
}

const DATA_DIR = getDataDir();

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize logger
const logger = LogManager.getInstance();
logger.info('Server', 'Initializing Napp Trapp server', { dataDir: DATA_DIR });

// Initialize auth manager with persistence
// If AUTH_TOKEN env var is set, it overrides the persisted token
// Otherwise, the token is loaded from disk (or generated once and saved)
const authManager = new AuthManager({
  dataDir: DATA_DIR,
  masterToken: process.env.AUTH_TOKEN || null  // Only override if explicitly set
});

// Get the auth token (may be loaded from persistence)
const AUTH_TOKEN = authManager.getMasterToken();
logger.info('Server', 'Auth manager initialized', { tokenLength: AUTH_TOKEN?.length || 0 });

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();

// Generate connection URL for QR code - includes token in URL for one-scan connection
function getConnectionUrl() {
  return `http://${LOCAL_IP}:${PORT}/?token=${AUTH_TOKEN}`;
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(CLIENT_DIST_PATH));

// Auth middleware for API routes
app.use('/api', (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!authManager.validateToken(token)) {
    logger.warn('Auth', 'Unauthorized API access attempt', { 
      path: req.path, 
      method: req.method,
      ip: req.ip 
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Request logging middleware for API routes
app.use('/api', (req, res, next) => {
  const startTime = Date.now();
  
  // Log when response finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'debug';
    logger.log(logLevel, 'API', `${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });
  
  next();
});

// Setup routes
setupRoutes(app);

// Setup WebSocket
setupWebSocket(wss, authManager);

// QR Code endpoint (no auth required - used for initial connection)
app.get('/qr', async (req, res) => {
  try {
    const connectionUrl = getConnectionUrl();
    const qrDataUrl = await QRCode.toDataURL(connectionUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    res.json({ 
      qr: qrDataUrl,
      connectionUrl,
      url: `http://${LOCAL_IP}:${PORT}`,
      ip: LOCAL_IP,
      port: PORT
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// QR Code image endpoint
app.get('/qr.png', async (req, res) => {
  try {
    const connectionUrl = getConnectionUrl();
    const buffer = await QRCode.toBuffer(connectionUrl, {
      width: 300,
      margin: 2
    });
    res.type('png').send(buffer);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Serve client app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(CLIENT_DIST_PATH, 'index.html'));
});

// Display startup message with QR code
async function displayStartupMessage() {
  const connectionUrl = getConnectionUrl();
  
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║              Napp Trapp Server                                      ║');
  console.log('╠═══════════════════════════════════════════════════════════════════╣');
  console.log('║                                                                    ║');
  console.log('║   Scan this QR code with your phone camera to connect:            ║');
  console.log('║                                                                    ║');
  
  // Generate QR code for terminal
  try {
    const qrString = await QRCode.toString(connectionUrl, {
      type: 'terminal',
      small: true
    });
    
    // Indent and display QR code
    const lines = qrString.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.log('║    ' + line.padEnd(64) + '║');
      }
    }
  } catch (e) {
    console.log('║   (QR code generation failed - use manual connection below)      ║');
  }
  
  console.log('║                                                                    ║');
  console.log('╠═══════════════════════════════════════════════════════════════════╣');
  console.log('║   Just point your phone camera at the QR code above!              ║');
  console.log('║   It will open the app and connect automatically.                 ║');
  console.log('╠═══════════════════════════════════════════════════════════════════╣');
  console.log('║   Manual Connection (if QR doesn\'t work):                          ║');
  console.log(`║   URL:   http://${LOCAL_IP}:${PORT}`.padEnd(68) + '║');
  console.log(`║   Token: ${AUTH_TOKEN}            ║`);
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('\n');
}

server.listen(PORT, '0.0.0.0', async () => {
  logger.info('Server', 'Server started successfully', {
    port: PORT,
    ip: LOCAL_IP,
    url: `http://${LOCAL_IP}:${PORT}`
  });

  // Load persisted conversations
  await chatProcessManager.loadPersistedConversations().catch(err => {
    logger.error('Server', 'Failed to load persisted conversations', { error: err.message });
  });

  displayStartupMessage();
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Server', 'Shutting down server...');
  console.log('\nShutting down server...');
  authManager.shutdown();  // Save auth state before exit
  await chatProcessManager.cleanup();  // Clean up chat processes (now async)
  server.close(() => {
    logger.info('Server', 'Server closed');
    console.log('Server closed');
    process.exit(0);
  });
});
