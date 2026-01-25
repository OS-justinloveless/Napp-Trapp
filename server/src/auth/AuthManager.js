export class AuthManager {
  constructor(masterToken) {
    this.masterToken = masterToken;
    this.sessions = new Map();
  }

  validateToken(token) {
    if (!token) return false;
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
    return this.sessions.delete(token);
  }

  getMasterToken() {
    return this.masterToken;
  }

  // Clean up old sessions (older than 24 hours)
  cleanup() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [token, session] of this.sessions) {
      if (now - session.lastActivity > maxAge) {
        this.sessions.delete(token);
      }
    }
  }
}
