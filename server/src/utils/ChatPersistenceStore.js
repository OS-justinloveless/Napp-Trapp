import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ChatPersistenceStore - Persists chat conversations and messages using SQLite
 *
 * This store maintains all chat data to survive server restarts.
 * Uses SQLite for efficient storage and querying of conversations and messages.
 *
 * Database schema:
 * - conversations: Stores conversation metadata
 * - messages: Stores ALL messages including partial/streaming, tool calls, etc.
 *
 * Uses a singleton pattern to ensure all parts of the app share the same instance.
 */

// Singleton instance
let _instance = null;

// Default retention settings (can be overridden via env vars)
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_CONVERSATIONS = 100;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Run cleanup every hour

export class ChatPersistenceStore {
  constructor() {
    const serverDir = path.resolve(__dirname, '..');
    this.dataDir = path.join(serverDir, '.napp-trapp-data');
    this.dbPath = path.join(this.dataDir, 'chat-persistence.db');
    this.db = null;
    this.cleanupInterval = null;

    // Retention configuration
    this.retentionDays = parseInt(process.env.CHAT_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
    this.maxConversations = parseInt(process.env.CHAT_MAX_CONVERSATIONS) || DEFAULT_MAX_CONVERSATIONS;
  }

  /**
   * Get the singleton instance of ChatPersistenceStore
   */
  static getInstance() {
    if (!_instance) {
      _instance = new ChatPersistenceStore();
    }
    return _instance;
  }

  /**
   * Initialize the database and create tables
   */
  async init() {
    if (this.db) return;

    // Create data directory if it doesn't exist
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    // Open database connection
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        topic TEXT NOT NULL,
        model TEXT,
        mode TEXT NOT NULL,
        projectPath TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        sessionId TEXT,
        lastActivity INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        type TEXT NOT NULL,
        role TEXT,
        content TEXT,
        timestamp INTEGER NOT NULL,
        isPartial INTEGER DEFAULT 0,
        toolId TEXT,
        toolName TEXT,
        isError INTEGER DEFAULT 0,
        metadata TEXT,
        FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversationId ON messages(conversationId);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(conversationId, timestamp);
      CREATE INDEX IF NOT EXISTS idx_conversations_projectPath ON conversations(projectPath);
      CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
      CREATE INDEX IF NOT EXISTS idx_conversations_lastActivity ON conversations(lastActivity);
    `);

    const count = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get();
    console.log(`[ChatPersistenceStore] SQLite database initialized with ${count.count} conversations`);

    // Start automatic cleanup if not already running
    this.startAutoCleanup();
  }

  /**
   * Save or update a conversation
   */
  async saveConversation(chatInfo) {
    await this.init();

    const now = Date.now();
    const existing = this.db.prepare('SELECT createdAt FROM conversations WHERE id = ?').get(chatInfo.id);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO conversations (id, tool, topic, model, mode, projectPath, status, createdAt, updatedAt, sessionId, lastActivity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      chatInfo.id,
      chatInfo.tool,
      chatInfo.topic,
      chatInfo.model || null,
      chatInfo.mode,
      chatInfo.projectPath,
      chatInfo.status,
      existing?.createdAt || chatInfo.createdAt || now,
      now,
      chatInfo.sessionId || null,
      now
    );

    return this.getConversation(chatInfo.id);
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(conversationId) {
    await this.init();
    const stmt = this.db.prepare('SELECT * FROM conversations WHERE id = ?');
    return stmt.get(conversationId) || null;
  }

  /**
   * Get all conversations, optionally filtered by project path
   */
  async getAllConversations(projectPath = null) {
    await this.init();

    let stmt;
    if (projectPath) {
      stmt = this.db.prepare('SELECT * FROM conversations WHERE projectPath = ? ORDER BY lastActivity DESC');
      return stmt.all(projectPath);
    } else {
      stmt = this.db.prepare('SELECT * FROM conversations ORDER BY lastActivity DESC');
      return stmt.all();
    }
  }

  /**
   * Update conversation status
   */
  async updateConversationStatus(conversationId, status) {
    await this.init();

    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE conversations
      SET status = ?, updatedAt = ?, lastActivity = ?
      WHERE id = ?
    `);

    const result = stmt.run(status, now, now, conversationId);

    if (result.changes === 0) {
      return null;
    }

    return this.getConversation(conversationId);
  }

  /**
   * Update conversation topic
   */
  async updateConversationTopic(conversationId, newTopic) {
    await this.init();

    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE conversations
      SET topic = ?, updatedAt = ?, lastActivity = ?
      WHERE id = ?
    `);

    const result = stmt.run(newTopic, now, now, conversationId);

    if (result.changes === 0) {
      return null;
    }

    return this.getConversation(conversationId);
  }

  /**
   * Save a message (saves ALL messages including partial/streaming)
   */
  async saveMessage(conversationId, contentBlock) {
    await this.init();

    // Store additional fields as JSON metadata
    const metadata = {};
    const knownFields = ['id', 'conversationId', 'type', 'role', 'content', 'timestamp', 'isPartial', 'toolId', 'toolName', 'isError'];

    for (const key in contentBlock) {
      if (!knownFields.includes(key)) {
        metadata[key] = contentBlock[key];
      }
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages (id, conversationId, type, role, content, timestamp, isPartial, toolId, toolName, isError, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      contentBlock.id,
      conversationId,
      contentBlock.type,
      contentBlock.role || null,
      contentBlock.content || null,
      contentBlock.timestamp || Date.now(),
      contentBlock.isPartial ? 1 : 0,
      contentBlock.toolId || null,
      contentBlock.toolName || null,
      contentBlock.isError ? 1 : 0,
      Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null
    );

    return contentBlock;
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId, limit = null) {
    await this.init();

    let stmt;
    if (limit && limit > 0) {
      stmt = this.db.prepare(`
        SELECT * FROM messages
        WHERE conversationId = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);
      const messages = stmt.all(conversationId, limit);
      return messages.reverse().map(this._deserializeMessage);
    } else {
      stmt = this.db.prepare(`
        SELECT * FROM messages
        WHERE conversationId = ?
        ORDER BY timestamp ASC
      `);
      return stmt.all(conversationId).map(this._deserializeMessage);
    }
  }

  /**
   * Deserialize a message from database format
   */
  _deserializeMessage(row) {
    const message = {
      id: row.id,
      conversationId: row.conversationId,
      type: row.type,
      timestamp: row.timestamp,
      isPartial: row.isPartial === 1,
    };

    if (row.role) message.role = row.role;
    if (row.content) message.content = row.content;
    if (row.toolId) message.toolId = row.toolId;
    if (row.toolName) message.toolName = row.toolName;
    if (row.isError === 1) message.isError = true;

    // Merge in metadata
    if (row.metadata) {
      try {
        const metadata = JSON.parse(row.metadata);
        Object.assign(message, metadata);
      } catch (err) {
        console.error('[ChatPersistenceStore] Failed to parse metadata:', err);
      }
    }

    return message;
  }

  /**
   * Delete a conversation and its messages
   */
  async deleteConversation(conversationId) {
    await this.init();

    // Messages are deleted automatically via CASCADE
    const stmt = this.db.prepare('DELETE FROM conversations WHERE id = ?');
    stmt.run(conversationId);
  }

  /**
   * Get conversations that can be resumed (suspended or created but not running)
   */
  async getResumableChats() {
    await this.init();

    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      WHERE status IN ('suspended', 'created')
      ORDER BY lastActivity DESC
    `);
    return stmt.all();
  }

  /**
   * Mark all active/running sessions as suspended (on server shutdown)
   */
  async suspendAllActiveChats() {
    await this.init();

    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE conversations
      SET status = 'suspended', updatedAt = ?, lastActivity = ?
      WHERE status IN ('running', 'created')
    `);

    const result = stmt.run(now, now);
    const count = result.changes;

    if (count > 0) {
      console.log(`[ChatPersistenceStore] Suspended ${count} active chats`);
    }

    return count;
  }

  /**
   * Get store statistics
   */
  async getStats() {
    await this.init();

    const convCount = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get();
    const msgCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get();

    return {
      conversationCount: convCount.count,
      totalMessages: msgCount.count,
      retentionDays: this.retentionDays,
      maxConversations: this.maxConversations
    };
  }

  /**
   * Clean up old conversations based on retention policy
   */
  async cleanup() {
    await this.init();

    const now = Date.now();
    const retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = now - retentionMs;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    let deletedCount = 0;

    // Delete ended chats older than 7 days
    const deleteEnded = this.db.prepare(`
      DELETE FROM conversations
      WHERE status = 'ended' AND updatedAt < ?
    `);
    deletedCount += deleteEnded.run(sevenDaysAgo).changes;

    // Delete any chat older than retention period
    const deleteOld = this.db.prepare(`
      DELETE FROM conversations
      WHERE lastActivity < ?
    `);
    deletedCount += deleteOld.run(cutoffTime).changes;

    // If still over max limit, delete oldest conversations
    const count = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get();
    if (count.count > this.maxConversations) {
      const excess = count.count - this.maxConversations;

      // Get IDs of oldest conversations to delete
      const oldestIds = this.db.prepare(`
        SELECT id FROM conversations
        ORDER BY lastActivity ASC
        LIMIT ?
      `).all(excess);

      const deleteStmt = this.db.prepare('DELETE FROM conversations WHERE id = ?');
      for (const row of oldestIds) {
        deleteStmt.run(row.id);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`[ChatPersistenceStore] Cleaned up ${deletedCount} old conversations`);
    }

    return deletedCount;
  }

  /**
   * Start automatic cleanup timer
   */
  startAutoCleanup() {
    if (this.cleanupInterval) return;

    // Run cleanup on start (after a short delay)
    setTimeout(() => this.cleanup().catch(err =>
      console.error('[ChatPersistenceStore] Cleanup error:', err)
    ), 5000);

    // Then run periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch(err =>
        console.error('[ChatPersistenceStore] Cleanup error:', err)
      );
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop automatic cleanup timer (useful for shutdown)
   */
  stopAutoCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
