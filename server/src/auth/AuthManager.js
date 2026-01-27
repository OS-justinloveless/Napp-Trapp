import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export class AuthManager {
  /**
   * Create an AuthManager with persistent storage
   * @param {Object} options
   * @param {string} options.dataDir - Directory to store auth data (defaults to server root)
   * @param {string} options.masterToken - Override master token (from env var)
   */
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(process.cwd(), '.cursor-mobile-data');
    this.dataFilePath = path.join(this.dataDir, 'auth.json');
    this.sessions = new Map();
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    // Load existing data or initialize new
    const existingData = this._loadData();
    
    if (options.masterToken) {
      // If master token provided via env var, use it (allows override)
      this.masterToken = options.masterToken;
      // Check if it changed from saved token
      if (existingData && existingData.masterToken !== options.masterToken) {
        console.log('[Auth] Master token changed via environment variable');
        // Clear sessions since master token changed
        this.sessions.clear();
      } else if (existingData) {
        // Restore sessions if token matches
        this._restoreSessions(existingData.sessions);
      }
    } else if (existingData && existingData.masterToken) {
      // Use existing persisted token
      this.masterToken = existingData.masterToken;
      this._restoreSessions(existingData.sessions);
      console.log('[Auth] Loaded persisted authentication token');
    } else {
      // Generate new token
      this.masterToken = uuidv4();
      console.log('[Auth] Generated new authentication token');
    }
    
    // Save initial state
    this._saveData();
    
    // Set up periodic cleanup and save (every 5 minutes)
    this._cleanupInterval = setInterval(() => {
      this.cleanup();
      this._saveData();
    }, 5 * 60 * 1000);
  }

  _loadData() {
    try {
      if (fs.existsSync(this.dataFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.dataFilePath, 'utf8'));
        return data;
      }
    } catch (error) {
      console.error('[Auth] Failed to load auth data:', error.message);
    }
    return null;
  }

  _saveData() {
    try {
      const data = {
        masterToken: this.masterToken,
        sessions: this._serializeSessions(),
        lastSaved: Date.now()
      };
      fs.writeFileSync(this.dataFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[Auth] Failed to save auth data:', error.message);
    }
  }

  _serializeSessions() {
    const sessions = {};
    for (const [token, session] of this.sessions) {
      sessions[token] = session;
    }
    return sessions;
  }

  _restoreSessions(sessionsObj) {
    if (!sessionsObj) return;
    
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [token, session] of Object.entries(sessionsObj)) {
      // Only restore sessions that haven't expired
      if (now - session.lastActivity < maxAge) {
        this.sessions.set(token, session);
      }
    }
    
    if (this.sessions.size > 0) {
      console.log(`[Auth] Restored ${this.sessions.size} active session(s)`);
    }
  }

  validateToken(token) {
    if (!token) return false;
    
    // Update session activity on validation
    if (this.sessions.has(token)) {
      this.sessions.get(token).lastActivity = Date.now();
    }
    
    return token === this.masterToken || this.sessions.has(token);
  }

  createSession(masterToken) {
    if (masterToken !== this.masterToken) {
      return null;
    }
    const sessionToken = crypto.randomUUID();
    this.sessions.set(sessionToken, {
      createdAt: Date.now(),
      lastActivity: Date.now()
    });
    this._saveData();
    return sessionToken;
  }

  refreshSession(token) {
    if (this.sessions.has(token)) {
      this.sessions.get(token).lastActivity = Date.now();
      return true;
    }
    return false;
  }

  revokeSession(token) {
    const result = this.sessions.delete(token);
    if (result) {
      this._saveData();
    }
    return result;
  }

  getMasterToken() {
    return this.masterToken;
  }

  // Clean up old sessions (older than 24 hours)
  cleanup() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    let cleaned = 0;
    
    for (const [token, session] of this.sessions) {
      if (now - session.lastActivity > maxAge) {
        this.sessions.delete(token);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[Auth] Cleaned up ${cleaned} expired session(s)`);
      this._saveData();
    }
  }

  // Graceful shutdown
  shutdown() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
    }
    this._saveData();
    console.log('[Auth] Saved authentication state');
  }

  // Get info about persistence
  getInfo() {
    return {
      dataFile: this.dataFilePath,
      sessionCount: this.sessions.size,
      isPersisted: fs.existsSync(this.dataFilePath)
    };
  }
}
