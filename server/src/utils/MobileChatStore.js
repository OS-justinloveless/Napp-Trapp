import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this module for consistent path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * MobileChatStore - Persists mobile chat data locally
 * 
 * This store maintains chat conversations and messages that were created
 * or continued from the mobile app. This ensures persistence even when
 * cursor-agent doesn't write to the same locations as Cursor IDE.
 * 
 * Uses a singleton pattern to ensure all parts of the app share the same instance.
 * 
 * Data structure:
 * {
 *   conversations: {
 *     [chatId]: {
 *       id: string,
 *       title: string,
 *       type: 'chat' | 'composer',
 *       workspaceId: string,
 *       workspaceFolder: string | null,
 *       projectName: string | null,
 *       tool: 'cursor-agent' | 'claude' | 'gemini',
 *       model: string | null,
 *       mode: 'agent' | 'plan' | 'ask',
 *       createdAt: number,
 *       updatedAt: number,
 *       source: 'mobile',
 *       // Phase 4: Session state
 *       sessionState: 'active' | 'suspended' | 'ended' | null,
 *       lastSessionAt: number | null,
 *       suspendReason: string | null
 *     }
 *   },
 *   messages: {
 *     [chatId]: [
 *       {
 *         id: string,
 *         type: 'user' | 'assistant',
 *         text: string,
 *         timestamp: number,
 *         toolCalls: array | null
 *       }
 *     ]
 *   },
 *   // Phase 4: Session configuration
 *   sessionConfig: {
 *     inactivityTimeoutMs: number,
 *     maxConcurrentSessions: number,
 *     autoResumeEnabled: boolean
 *   }
 * }
 */

// Singleton instance
let _instance = null;

// Default retention settings (can be overridden via env vars)
const DEFAULT_RETENTION_DAYS = 30; // Keep conversations for 30 days
const DEFAULT_MAX_CONVERSATIONS = 100; // Keep at most 100 conversations
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Run cleanup every hour

export class MobileChatStore {
  constructor() {
    // Use the server directory (parent of utils) for consistent path
    const serverDir = path.resolve(__dirname, '../..');
    this.dataDir = path.join(serverDir, '.napp-trapp-data');
    this.storePath = path.join(this.dataDir, 'mobile-chats.json');
    this.data = null;
    this.saveTimeout = null;
    this.cleanupInterval = null;
    
    // Retention configuration
    this.retentionDays = parseInt(process.env.MOBILE_CHAT_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
    this.maxConversations = parseInt(process.env.MOBILE_CHAT_MAX_CONVERSATIONS) || DEFAULT_MAX_CONVERSATIONS;
  }
  
  /**
   * Get the singleton instance of MobileChatStore
   */
  static getInstance() {
    if (!_instance) {
      _instance = new MobileChatStore();
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
      } catch (error) {
        console.error('Error loading mobile chat store:', error);
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
    
    // Debounce saves to avoid excessive disk writes
    this.saveTimeout = setTimeout(async () => {
      try {
        await fs.writeFile(
          this.storePath, 
          JSON.stringify(this.data, null, 2),
          'utf-8'
        );
      } catch (error) {
        console.error('Error saving mobile chat store:', error);
      }
    }, 100);
  }

  /**
   * Create or update a conversation record
   */
  async upsertConversation(chatId, conversationData) {
    await this.init();

    const existing = this.data.conversations[chatId];
    const now = Date.now();

    // Validate tool if provided
    const validTools = ['cursor-agent', 'claude', 'gemini'];
    const tool = conversationData.tool || existing?.tool || 'cursor-agent';
    if (!validTools.includes(tool)) {
      throw new Error(`Invalid tool: ${tool}. Must be one of: ${validTools.join(', ')}`);
    }

    // Validate mode if provided
    const validModes = ['agent', 'plan', 'ask'];
    const mode = conversationData.mode || existing?.mode || 'agent';
    if (mode && !validModes.includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Must be one of: ${validModes.join(', ')}`);
    }

    this.data.conversations[chatId] = {
      id: chatId,
      title: conversationData.title || existing?.title || `Chat ${chatId.slice(0, 8)}`,
      type: conversationData.type || existing?.type || 'chat',
      workspaceId: conversationData.workspaceId || existing?.workspaceId || 'global',
      workspaceFolder: conversationData.workspaceFolder || existing?.workspaceFolder || null,
      projectName: conversationData.projectName || existing?.projectName || null,
      tool,
      model: conversationData.model !== undefined ? conversationData.model : (existing?.model || null),
      mode,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      messageCount: this.data.messages[chatId]?.length || 0,
      source: 'mobile'
    };

    await this.save();
    return this.data.conversations[chatId];
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(chatId) {
    await this.init();
    return this.data.conversations[chatId] || null;
  }

  /**
   * Get all mobile-created conversations
   */
  async getAllConversations() {
    await this.init();
    return Object.values(this.data.conversations);
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(chatId, message) {
    await this.init();
    
    // Ensure messages array exists for this chat
    if (!this.data.messages[chatId]) {
      this.data.messages[chatId] = [];
    }
    
    // Check if message already exists (by ID or content+timestamp)
    const existingIndex = this.data.messages[chatId].findIndex(m => 
      m.id === message.id || 
      (m.text === message.text && Math.abs(m.timestamp - message.timestamp) < 1000)
    );
    
    if (existingIndex >= 0) {
      // Update existing message
      this.data.messages[chatId][existingIndex] = {
        ...this.data.messages[chatId][existingIndex],
        ...message
      };
    } else {
      // Add new message
      this.data.messages[chatId].push({
        id: message.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: message.type || 'user',
        text: message.text || '',
        timestamp: message.timestamp || Date.now(),
        toolCalls: message.toolCalls || null,
        attachments: message.attachments || null
      });
    }
    
    // Update conversation timestamp and message count
    if (this.data.conversations[chatId]) {
      this.data.conversations[chatId].updatedAt = Date.now();
      this.data.conversations[chatId].messageCount = this.data.messages[chatId].length;
      
      // Update title from first user message if not set
      if (!this.data.conversations[chatId].title || 
          this.data.conversations[chatId].title.startsWith('Chat ')) {
        const firstUserMsg = this.data.messages[chatId].find(m => m.type === 'user');
        if (firstUserMsg?.text) {
          this.data.conversations[chatId].title = firstUserMsg.text.split('\n')[0].slice(0, 100);
        }
      }
    }
    
    await this.save();
    return message;
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(chatId) {
    await this.init();
    return this.data.messages[chatId] || [];
  }

  /**
   * Check if a conversation exists in mobile store
   */
  async hasConversation(chatId) {
    await this.init();
    return !!this.data.conversations[chatId];
  }

  /**
   * Check if we have any messages for a conversation
   */
  async hasMessages(chatId) {
    await this.init();
    const messages = this.data.messages[chatId];
    return messages && messages.length > 0;
  }

  /**
   * Delete a conversation and its messages
   */
  async deleteConversation(chatId) {
    await this.init();
    
    delete this.data.conversations[chatId];
    delete this.data.messages[chatId];
    
    await this.save();
  }

  /**
   * Get store statistics
   */
  async getStats() {
    await this.init();
    
    const conversationCount = Object.keys(this.data.conversations).length;
    let totalMessages = 0;
    
    for (const chatId in this.data.messages) {
      totalMessages += this.data.messages[chatId].length;
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
   * Returns count of conversations deleted
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
    
    // Find conversations to delete based on age
    for (const conv of conversations) {
      if (conv.updatedAt < cutoffTime) {
        toDelete.push(conv.id);
      }
    }
    
    // If still over max limit, delete oldest conversations
    if (conversations.length - toDelete.length > this.maxConversations) {
      const remaining = conversations.filter(c => !toDelete.includes(c.id));
      remaining.sort((a, b) => a.updatedAt - b.updatedAt);
      
      const excess = remaining.length - this.maxConversations;
      for (let i = 0; i < excess; i++) {
        toDelete.push(remaining[i].id);
      }
    }
    
    // Delete conversations and their messages
    for (const chatId of toDelete) {
      delete this.data.conversations[chatId];
      delete this.data.messages[chatId];
      deletedCount++;
    }
    
    if (deletedCount > 0) {
      await this.save();
      console.log(`[MobileChatStore] Cleaned up ${deletedCount} old conversations`);
    }
    
    return deletedCount;
  }

  /**
   * Start automatic cleanup timer
   */
  startAutoCleanup() {
    if (this.cleanupInterval) return;
    
    // Run cleanup immediately on start (after a short delay)
    setTimeout(() => this.cleanup().catch(err => 
      console.error('[MobileChatStore] Cleanup error:', err)
    ), 5000);
    
    // Then run periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch(err => 
        console.error('[MobileChatStore] Cleanup error:', err)
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

  // ============ Phase 4: Session State Management ============

  /**
   * Update session state for a conversation
   * 
   * @param {string} chatId - The conversation ID
   * @param {string} state - 'active' | 'suspended' | 'ended'
   * @param {string|null} reason - Optional reason for the state change
   */
  async updateSessionState(chatId, state, reason = null) {
    await this.init();
    
    if (!this.data.conversations[chatId]) {
      return null;
    }
    
    const validStates = ['active', 'suspended', 'ended'];
    if (!validStates.includes(state)) {
      throw new Error(`Invalid session state: ${state}. Must be one of: ${validStates.join(', ')}`);
    }
    
    this.data.conversations[chatId].sessionState = state;
    this.data.conversations[chatId].lastSessionAt = Date.now();
    
    if (reason) {
      this.data.conversations[chatId].suspendReason = reason;
    } else if (state === 'active') {
      this.data.conversations[chatId].suspendReason = null;
    }
    
    await this.save();
    return this.data.conversations[chatId];
  }

  /**
   * Get all conversations that have a suspended session (can be resumed)
   * 
   * @returns {Array} Conversations with suspended sessions
   */
  async getSuspendedSessions() {
    await this.init();
    
    return Object.values(this.data.conversations)
      .filter(conv => conv.sessionState === 'suspended')
      .sort((a, b) => (b.lastSessionAt || 0) - (a.lastSessionAt || 0));
  }

  /**
   * Get all conversations that have been used recently (within last N hours)
   * Useful for showing "recent sessions" in the app
   * 
   * @param {number} hours - Number of hours to look back
   * @returns {Array} Recently used conversations
   */
  async getRecentSessions(hours = 24) {
    await this.init();
    
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    
    return Object.values(this.data.conversations)
      .filter(conv => (conv.lastSessionAt || conv.updatedAt) > cutoff)
      .sort((a, b) => (b.lastSessionAt || b.updatedAt) - (a.lastSessionAt || a.updatedAt));
  }

  /**
   * Check if a conversation has a resumable session
   * 
   * @param {string} chatId - The conversation ID
   * @returns {boolean}
   */
  async isResumable(chatId) {
    await this.init();
    
    const conv = this.data.conversations[chatId];
    return conv && conv.sessionState === 'suspended';
  }

  /**
   * Mark all active sessions as suspended (e.g., on server shutdown)
   * 
   * @returns {number} Number of sessions marked as suspended
   */
  async suspendAllSessions() {
    await this.init();
    
    let count = 0;
    for (const chatId in this.data.conversations) {
      if (this.data.conversations[chatId].sessionState === 'active') {
        this.data.conversations[chatId].sessionState = 'suspended';
        this.data.conversations[chatId].lastSessionAt = Date.now();
        this.data.conversations[chatId].suspendReason = 'server_shutdown';
        count++;
      }
    }
    
    if (count > 0) {
      await this.save();
    }
    
    return count;
  }

  // ============ Phase 4: Session Configuration ============

  /**
   * Get session configuration
   * 
   * @returns {Object} Session configuration
   */
  async getSessionConfig() {
    await this.init();
    
    // Return defaults if not set
    return this.data.sessionConfig || {
      inactivityTimeoutMs: 60 * 1000, // 60 seconds
      maxConcurrentSessions: 20,
      autoResumeEnabled: true
    };
  }

  /**
   * Update session configuration
   * 
   * @param {Object} config - Configuration options to update
   * @returns {Object} Updated configuration
   */
  async updateSessionConfig(config) {
    await this.init();
    
    if (!this.data.sessionConfig) {
      this.data.sessionConfig = {
        inactivityTimeoutMs: 60 * 1000,
        maxConcurrentSessions: 20,
        autoResumeEnabled: true
      };
    }
    
    // Validate and update each config option
    if (config.inactivityTimeoutMs !== undefined) {
      const timeout = parseInt(config.inactivityTimeoutMs);
      if (timeout < 10000 || timeout > 3600000) {
        throw new Error('inactivityTimeoutMs must be between 10000 (10s) and 3600000 (1hr)');
      }
      this.data.sessionConfig.inactivityTimeoutMs = timeout;
    }
    
    if (config.maxConcurrentSessions !== undefined) {
      const max = parseInt(config.maxConcurrentSessions);
      if (max < 1 || max > 50) {
        throw new Error('maxConcurrentSessions must be between 1 and 50');
      }
      this.data.sessionConfig.maxConcurrentSessions = max;
    }
    
    if (config.autoResumeEnabled !== undefined) {
      this.data.sessionConfig.autoResumeEnabled = !!config.autoResumeEnabled;
    }
    
    await this.save();
    return this.data.sessionConfig;
  }
}
