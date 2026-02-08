import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ChatPersistenceStore - Persists chat conversations and messages
 *
 * This store maintains all chat data to survive server restarts.
 * Adapted from MobileChatStore.js to work with ChatProcessManager's data model.
 *
 * Uses a singleton pattern to ensure all parts of the app share the same instance.
 *
 * Data structure:
 * {
 *   conversations: {
 *     [conversationId]: {
 *       id: string,
 *       tool: 'claude' | 'cursor-agent' | 'gemini',
 *       topic: string,
 *       model: string | null,
 *       mode: 'agent' | 'plan' | 'ask',
 *       projectPath: string,
 *       status: 'created' | 'running' | 'suspended' | 'ended',
 *       createdAt: number,
 *       updatedAt: number,
 *       sessionId: string | null,
 *       lastActivity: number
 *     }
 *   },
 *   messages: {
 *     [conversationId]: [
 *       {
 *         id: string,
 *         type: 'text' | 'tool_use_start' | 'tool_use_result' | 'thinking' | 'error' | etc.,
 *         conversationId: string,
 *         content: string,
 *         timestamp: number,
 *         isPartial: boolean,
 *         toolId: string | null,
 *         toolName: string | null,
 *         ...other ContentBlock fields
 *       }
 *     ]
 *   }
 * }
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
    this.storePath = path.join(this.dataDir, 'chat-persistence.json');
    this.data = null;
    this.saveTimeout = null;
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
   * Ensure the data directory exists and load data
   */
  async init() {
    if (this.data) return;

    // Create data directory if it doesn't exist
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    // Load existing data or create empty structure
    if (existsSync(this.storePath)) {
      try {
        const content = await fs.readFile(this.storePath, 'utf-8');
        this.data = JSON.parse(content);
        console.log(`[ChatPersistenceStore] Loaded ${Object.keys(this.data.conversations || {}).length} conversations from disk`);
      } catch (error) {
        console.error('[ChatPersistenceStore] Error loading store:', error);
        this.data = { conversations: {}, messages: {} };
      }
    } else {
      this.data = { conversations: {}, messages: {} };
    }

    // Start automatic cleanup if not already running
    this.startAutoCleanup();
  }

  /**
   * Save data to disk (debounced)
   */
  async save() {
    if (!this.data) return;

    // Clear any pending save
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // Debounce saves to avoid excessive disk writes during streaming
    this.saveTimeout = setTimeout(async () => {
      try {
        await fs.writeFile(
          this.storePath,
          JSON.stringify(this.data, null, 2),
          'utf-8'
        );
      } catch (error) {
        console.error('[ChatPersistenceStore] Error saving store:', error);
      }
    }, 100);
  }

  /**
   * Save or update a conversation
   */
  async saveConversation(chatInfo) {
    await this.init();

    const existing = this.data.conversations[chatInfo.id];

    this.data.conversations[chatInfo.id] = {
      id: chatInfo.id,
      tool: chatInfo.tool,
      topic: chatInfo.topic,
      model: chatInfo.model || null,
      mode: chatInfo.mode,
      projectPath: chatInfo.projectPath,
      status: chatInfo.status,
      createdAt: existing?.createdAt || chatInfo.createdAt || Date.now(),
      updatedAt: Date.now(),
      sessionId: chatInfo.sessionId || null,
      lastActivity: Date.now()
    };

    await this.save();
    return this.data.conversations[chatInfo.id];
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(conversationId) {
    await this.init();
    return this.data.conversations[conversationId] || null;
  }

  /**
   * Get all conversations, optionally filtered by project path
   */
  async getAllConversations(projectPath = null) {
    await this.init();
    const conversations = Object.values(this.data.conversations);

    if (projectPath) {
      return conversations.filter(conv => conv.projectPath === projectPath);
    }

    return conversations;
  }

  /**
   * Update conversation status
   */
  async updateConversationStatus(conversationId, status) {
    await this.init();

    if (!this.data.conversations[conversationId]) {
      return null;
    }

    this.data.conversations[conversationId].status = status;
    this.data.conversations[conversationId].updatedAt = Date.now();
    this.data.conversations[conversationId].lastActivity = Date.now();

    await this.save();
    return this.data.conversations[conversationId];
  }

  /**
   * Save a message (only complete messages, not partial/streaming)
   */
  async saveMessage(conversationId, contentBlock) {
    await this.init();

    // Skip partial/streaming messages
    if (contentBlock.isPartial) {
      return;
    }

    // Ensure messages array exists for this chat
    if (!this.data.messages[conversationId]) {
      this.data.messages[conversationId] = [];
    }

    // Check if message already exists by ID
    const existingIndex = this.data.messages[conversationId].findIndex(m => m.id === contentBlock.id);

    if (existingIndex >= 0) {
      // Update existing message
      this.data.messages[conversationId][existingIndex] = {
        ...this.data.messages[conversationId][existingIndex],
        ...contentBlock
      };
    } else {
      // Add new message
      this.data.messages[conversationId].push({
        ...contentBlock,
        conversationId
      });
    }

    await this.save();
    return contentBlock;
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId, limit = null) {
    await this.init();
    const messages = this.data.messages[conversationId] || [];

    if (limit && limit > 0) {
      return messages.slice(-limit);
    }

    return messages;
  }

  /**
   * Delete a conversation and its messages
   */
  async deleteConversation(conversationId) {
    await this.init();

    delete this.data.conversations[conversationId];
    delete this.data.messages[conversationId];

    await this.save();
  }

  /**
   * Get conversations that can be resumed (suspended or created but not running)
   */
  async getResumableChats() {
    await this.init();

    return Object.values(this.data.conversations)
      .filter(conv => conv.status === 'suspended' || conv.status === 'created')
      .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  }

  /**
   * Mark all active/running sessions as suspended (on server shutdown)
   */
  async suspendAllActiveChats() {
    await this.init();

    let count = 0;
    for (const conversationId in this.data.conversations) {
      const conv = this.data.conversations[conversationId];
      if (conv.status === 'running' || conv.status === 'created') {
        conv.status = 'suspended';
        conv.updatedAt = Date.now();
        conv.lastActivity = Date.now();
        count++;
      }
    }

    if (count > 0) {
      await this.save();
      console.log(`[ChatPersistenceStore] Suspended ${count} active chats`);
    }

    return count;
  }

  /**
   * Get store statistics
   */
  async getStats() {
    await this.init();

    const conversationCount = Object.keys(this.data.conversations).length;
    let totalMessages = 0;

    for (const conversationId in this.data.messages) {
      totalMessages += this.data.messages[conversationId].length;
    }

    return {
      conversationCount,
      totalMessages,
      retentionDays: this.retentionDays,
      maxConversations: this.maxConversations
    };
  }

  /**
   * Clean up old conversations based on retention policy
   */
  async cleanup() {
    await this.init();

    const conversations = Object.values(this.data.conversations);
    if (conversations.length === 0) return 0;

    const now = Date.now();
    const retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = now - retentionMs;

    let deletedCount = 0;
    const toDelete = [];

    // Find conversations to delete based on age and ended status
    for (const conv of conversations) {
      // Delete ended chats older than 7 days
      if (conv.status === 'ended' && conv.updatedAt < (now - 7 * 24 * 60 * 60 * 1000)) {
        toDelete.push(conv.id);
      }
      // Delete any chat older than retention period
      else if (conv.lastActivity < cutoffTime) {
        toDelete.push(conv.id);
      }
    }

    // If still over max limit, delete oldest conversations
    if (conversations.length - toDelete.length > this.maxConversations) {
      const remaining = conversations.filter(c => !toDelete.includes(c.id));
      remaining.sort((a, b) => a.lastActivity - b.lastActivity);

      const excess = remaining.length - this.maxConversations;
      for (let i = 0; i < excess; i++) {
        toDelete.push(remaining[i].id);
      }
    }

    // Delete conversations and their messages
    for (const conversationId of toDelete) {
      delete this.data.conversations[conversationId];
      delete this.data.messages[conversationId];
      deletedCount++;
    }

    if (deletedCount > 0) {
      await this.save();
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
}
