import Database from 'better-sqlite3';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

/**
 * CursorChatWriter - Writes messages to Cursor's native SQLite database
 * 
 * This enables bidirectional sync: messages sent from mobile will appear
 * in the Cursor IDE because they're written to the same database Cursor reads from.
 * 
 * Cursor stores chat bubbles in the `cursorDiskKV` table with keys like:
 *   bubbleId:<chatId>:<bubbleId>
 * 
 * The value is JSON containing the bubble data (type, text, timestamp, etc.)
 */
export class CursorChatWriter {
  constructor() {
    this.globalStoragePath = this.getGlobalStoragePath();
    this.workspaceStoragePath = this.getWorkspaceStoragePath();
  }

  getGlobalStoragePath() {
    const homeDir = os.homedir();
    
    switch (process.platform) {
      case 'darwin':
        return path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage');
      case 'win32':
        return path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage');
      case 'linux':
        if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) {
          return path.join(homeDir, '.cursor-server', 'data', 'User', 'globalStorage');
        }
        return path.join(homeDir, '.config', 'Cursor', 'User', 'globalStorage');
      default:
        return path.join(homeDir, '.cursor', 'globalStorage');
    }
  }

  getWorkspaceStoragePath() {
    const homeDir = os.homedir();
    
    switch (process.platform) {
      case 'darwin':
        return path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage');
      case 'win32':
        return path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'workspaceStorage');
      case 'linux':
        if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) {
          return path.join(homeDir, '.cursor-server', 'data', 'User', 'workspaceStorage');
        }
        return path.join(homeDir, '.config', 'Cursor', 'User', 'workspaceStorage');
      default:
        return path.join(homeDir, '.cursor', 'workspaceStorage');
    }
  }

  /**
   * Generate a unique bubble ID
   */
  generateBubbleId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Write a message bubble to Cursor's database
   * 
   * @param {string} chatId - The conversation/chat ID (composerId for Agent mode)
   * @param {object} message - Message object with type, text, timestamp, etc.
   * @param {string} workspaceId - Optional workspace ID for workspace-specific storage
   * @returns {object} - Result with success status and bubble info
   */
  async writeBubble(chatId, message, workspaceId = null) {
    const bubbleId = message.id || this.generateBubbleId();
    const key = `bubbleId:${chatId}:${bubbleId}`;
    
    // Create bubble in Cursor's FULL format (matching version 3 schema)
    const bubble = {
      _v: 3, // Schema version - CRITICAL!
      type: message.type === 'user' ? 1 : 2, // 1 = user, 2 = assistant
      bubbleId: bubbleId, // Bubble ID inside the object
      text: message.text || '',
      createdAt: new Date(message.timestamp || Date.now()).toISOString(),
      
      // Required empty arrays (Cursor expects these)
      approximateLintErrors: [],
      lints: [],
      codebaseContextChunks: [],
      commits: [],
      pullRequests: [],
      attachedCodeChunks: [],
      assistantSuggestedDiffs: [],
      gitDiffs: [],
      interpreterResults: [],
      images: message.attachments?.filter(a => a.type === 'image').map(att => ({
        type: 'base64',
        data: att.data,
        mimeType: att.mimeType || 'image/jpeg',
        name: att.filename
      })) || [],
      attachedFolders: [],
      attachedFoldersNew: [],
      userResponsesToSuggestedCodeBlocks: [],
      suggestedCodeBlocks: [],
      diffsForCompressingFiles: [],
      relevantFiles: message.relevantFiles || [],
      toolResults: message.toolResults || [],
      notepads: [],
      capabilities: [],
      multiFileLinterErrors: [],
      diffHistories: [],
      recentLocationsHistory: [],
      recentlyViewedFiles: [],
      isAgentic: false,
      fileDiffTrajectories: [],
      existedSubsequentTerminalCommand: false,
      existedPreviousTerminalCommand: false,
      docsReferences: [],
      webReferences: [],
      aiWebSearchResults: [],
      requestId: '',
      attachedFoldersListDirResults: [],
      humanChanges: [],
      attachedHumanChanges: false,
      summarizedComposers: [],
      cursorRules: [],
      contextPieces: [],
      editTrailContexts: [],
      allThinkingBlocks: [],
      diffsSinceLastApply: [],
      deletedFiles: [],
      supportedTools: [],
      tokenCount: { inputTokens: 0, outputTokens: 0 },
      attachedFileCodeChunksMetadataOnly: [],
      consoleLogs: [],
      uiElementPicked: [],
      isRefunded: false,
      knowledgeItems: [],
      documentationSelections: [],
      externalLinks: [],
      projectLayouts: [],
      unifiedMode: 2, // Agent mode
      capabilityContexts: [],
      todos: [],
      mcpDescriptors: [],
      workspaceUris: [],
      conversationState: '~',
      codeBlocks: [],
    };

    const bubbleJson = JSON.stringify(bubble);
    const results = {
      success: false,
      globalWritten: false,
      workspaceWritten: false,
      key,
      bubbleId,
      errors: []
    };

    // Write to global storage (primary location for chat bubbles)
    try {
      const globalDbPath = path.join(this.globalStoragePath, 'state.vscdb');
      if (existsSync(globalDbPath)) {
        await this.writeToDatabase(globalDbPath, key, bubbleJson);
        results.globalWritten = true;
        console.log(`Wrote bubble to global storage: ${key}`);
      } else {
        results.errors.push('Global storage database not found');
      }
    } catch (error) {
      console.error('Error writing to global storage:', error);
      results.errors.push(`Global storage error: ${error.message}`);
    }

    // Also write to workspace storage if workspaceId is provided
    if (workspaceId && workspaceId !== 'global') {
      try {
        const workspaceDbPath = path.join(this.workspaceStoragePath, workspaceId, 'state.vscdb');
        if (existsSync(workspaceDbPath)) {
          await this.writeToDatabase(workspaceDbPath, key, bubbleJson);
          results.workspaceWritten = true;
          console.log(`Wrote bubble to workspace storage: ${key}`);
        }
      } catch (error) {
        console.error('Error writing to workspace storage:', error);
        results.errors.push(`Workspace storage error: ${error.message}`);
      }
    }

    results.success = results.globalWritten || results.workspaceWritten;
    
    // Also update the composer's conversation headers to include this bubble
    if (results.success) {
      try {
        const headerResult = await this.addBubbleToConversationHeaders(chatId, bubbleId, message.type === 'user' ? 1 : 2);
        results.headerUpdated = headerResult.success;
        if (!headerResult.success) {
          results.errors.push(...(headerResult.errors || []));
        }
      } catch (headerError) {
        console.error('Error updating conversation headers:', headerError);
        results.errors.push(`Header update error: ${headerError.message}`);
      }
    }
    
    return results;
  }
  
  /**
   * Add a bubble to the composer's fullConversationHeadersOnly array
   * This is CRITICAL for the bubble to appear in Cursor's UI
   */
  async addBubbleToConversationHeaders(composerId, bubbleId, type) {
    const globalDbPath = path.join(this.globalStoragePath, 'state.vscdb');
    const key = `composerData:${composerId}`;
    const results = { success: false, errors: [] };
    
    if (!existsSync(globalDbPath)) {
      results.errors.push('Global storage database not found');
      return results;
    }
    
    let db = null;
    try {
      db = new Database(globalDbPath, { 
        timeout: 5000,
        fileMustExist: true
      });
      
      db.pragma('journal_mode = WAL');
      
      // Read existing composer data
      const result = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(key);
      
      if (!result?.value) {
        results.errors.push('Composer data not found - this may be a new conversation');
        return results;
      }
      
      const composerData = JSON.parse(result.value);
      
      // Ensure fullConversationHeadersOnly array exists
      if (!composerData.fullConversationHeadersOnly) {
        composerData.fullConversationHeadersOnly = [];
      }
      
      // Check if bubble already exists in headers
      const existingIndex = composerData.fullConversationHeadersOnly.findIndex(
        h => h.bubbleId === bubbleId
      );
      
      if (existingIndex === -1) {
        // Add new bubble header at the end
        composerData.fullConversationHeadersOnly.push({
          bubbleId: bubbleId,
          type: type // 1 = user, 2 = assistant
        });
        
        // Update the composer data
        const stmt = db.prepare('UPDATE cursorDiskKV SET value = ? WHERE key = ?');
        stmt.run(JSON.stringify(composerData), key);
        
        db.pragma('wal_checkpoint(PASSIVE)');
        
        console.log(`Added bubble ${bubbleId} to conversation headers`);
        results.success = true;
      } else {
        console.log(`Bubble ${bubbleId} already in conversation headers`);
        results.success = true;
      }
      
    } catch (error) {
      console.error('Error updating conversation headers:', error);
      results.errors.push(error.message);
    } finally {
      if (db) {
        db.close();
      }
    }
    
    return results;
  }

  /**
   * Write a key-value pair to a Cursor database
   * 
   * Uses WAL mode-compatible writes with proper transaction handling.
   */
  async writeToDatabase(dbPath, key, value) {
    let db = null;
    
    try {
      // Open database in read-write mode
      // timeout: wait up to 5 seconds if database is locked
      db = new Database(dbPath, { 
        timeout: 5000,
        fileMustExist: true
      });
      
      // Enable WAL mode for better concurrent access
      db.pragma('journal_mode = WAL');
      
      // Use INSERT OR REPLACE to handle both new and existing entries
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO cursorDiskKV (key, value) 
        VALUES (?, ?)
      `);
      
      stmt.run(key, value);
      
      // Checkpoint to ensure data is written to main database file
      // This helps Cursor detect the changes faster
      db.pragma('wal_checkpoint(PASSIVE)');
      
    } finally {
      if (db) {
        db.close();
      }
    }
  }

  /**
   * Write multiple bubbles in a single transaction (more efficient)
   */
  async writeBubbles(chatId, messages, workspaceId = null) {
    const results = [];
    
    for (const message of messages) {
      const result = await this.writeBubble(chatId, message, workspaceId);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Check if a bubble already exists in Cursor's database
   */
  async bubbleExists(chatId, bubbleId) {
    const key = `bubbleId:${chatId}:${bubbleId}`;
    const globalDbPath = path.join(this.globalStoragePath, 'state.vscdb');
    
    if (!existsSync(globalDbPath)) {
      return false;
    }
    
    let db = null;
    try {
      db = new Database(globalDbPath, { readonly: true });
      const result = db.prepare('SELECT 1 FROM cursorDiskKV WHERE key = ?').get(key);
      return !!result;
    } catch (error) {
      console.error('Error checking bubble existence:', error);
      return false;
    } finally {
      if (db) {
        db.close();
      }
    }
  }

  /**
   * Get all bubble IDs for a chat from Cursor's database
   */
  async getChatBubbleIds(chatId) {
    const globalDbPath = path.join(this.globalStoragePath, 'state.vscdb');
    const bubbleIds = [];
    
    if (!existsSync(globalDbPath)) {
      return bubbleIds;
    }
    
    let db = null;
    try {
      db = new Database(globalDbPath, { readonly: true });
      const rows = db.prepare(
        `SELECT key FROM cursorDiskKV WHERE key LIKE 'bubbleId:${chatId}:%'`
      ).all();
      
      for (const row of rows) {
        // Extract bubble ID from key format: bubbleId:<chatId>:<bubbleId>
        const parts = row.key.split(':');
        if (parts.length >= 3) {
          bubbleIds.push(parts.slice(2).join(':'));
        }
      }
    } catch (error) {
      console.error('Error getting chat bubble IDs:', error);
    } finally {
      if (db) {
        db.close();
      }
    }
    
    return bubbleIds;
  }

  /**
   * Delete a bubble from Cursor's database
   */
  async deleteBubble(chatId, bubbleId, workspaceId = null) {
    const key = `bubbleId:${chatId}:${bubbleId}`;
    const results = {
      success: false,
      globalDeleted: false,
      workspaceDeleted: false,
      errors: []
    };

    // Delete from global storage
    try {
      const globalDbPath = path.join(this.globalStoragePath, 'state.vscdb');
      if (existsSync(globalDbPath)) {
        await this.deleteFromDatabase(globalDbPath, key);
        results.globalDeleted = true;
      }
    } catch (error) {
      results.errors.push(`Global storage error: ${error.message}`);
    }

    // Delete from workspace storage if applicable
    if (workspaceId && workspaceId !== 'global') {
      try {
        const workspaceDbPath = path.join(this.workspaceStoragePath, workspaceId, 'state.vscdb');
        if (existsSync(workspaceDbPath)) {
          await this.deleteFromDatabase(workspaceDbPath, key);
          results.workspaceDeleted = true;
        }
      } catch (error) {
        results.errors.push(`Workspace storage error: ${error.message}`);
      }
    }

    results.success = results.globalDeleted || results.workspaceDeleted;
    return results;
  }

  /**
   * Delete a key from a Cursor database
   */
  async deleteFromDatabase(dbPath, key) {
    let db = null;
    
    try {
      db = new Database(dbPath, { 
        timeout: 5000,
        fileMustExist: true
      });
      
      db.pragma('journal_mode = WAL');
      
      const stmt = db.prepare('DELETE FROM cursorDiskKV WHERE key = ?');
      stmt.run(key);
      
      db.pragma('wal_checkpoint(PASSIVE)');
      
    } finally {
      if (db) {
        db.close();
      }
    }
  }

  /**
   * Ensure a chat exists in Cursor's chat data structure
   * This creates the chat tab entry if it doesn't exist
   * 
   * @param {string} chatId - The conversation/chat ID
   * @param {string} workspaceId - The workspace ID (folder hash)
   * @param {object} metadata - Optional metadata (title, etc.)
   */
  async ensureChatExists(chatId, workspaceId, metadata = {}) {
    const results = {
      success: false,
      created: false,
      updated: false,
      errors: []
    };

    // Determine which database to update
    let dbPath;
    if (workspaceId && workspaceId !== 'global') {
      dbPath = path.join(this.workspaceStoragePath, workspaceId, 'state.vscdb');
    } else {
      // For global chats, we still need a workspace to show the tab
      // Global storage doesn't have the chat tabs structure
      console.log('Global chats require a workspace context to appear in Cursor UI');
      results.errors.push('Global chats cannot be registered without a workspace');
      return results;
    }

    if (!existsSync(dbPath)) {
      results.errors.push(`Database not found: ${dbPath}`);
      return results;
    }

    let db = null;
    try {
      db = new Database(dbPath, { 
        timeout: 5000,
        fileMustExist: true
      });
      
      db.pragma('journal_mode = WAL');

      // Read existing chat data
      const chatDataKey = 'workbench.panel.aichat.view.aichat.chatdata';
      let chatData = { tabs: [], currentTabId: null };
      
      try {
        const result = db.prepare(
          `SELECT value FROM ItemTable WHERE [key] = ?`
        ).get(chatDataKey);
        
        if (result?.value) {
          chatData = JSON.parse(result.value);
          if (!chatData.tabs) {
            chatData.tabs = [];
          }
        }
      } catch (e) {
        // No existing chat data, start fresh
      }

      // Check if chat tab already exists
      const existingTabIndex = chatData.tabs.findIndex(tab => tab.id === chatId);
      
      if (existingTabIndex >= 0) {
        // Update existing tab - add bubble if provided
        const existingTab = chatData.tabs[existingTabIndex];
        
        if (metadata.bubble) {
          if (!existingTab.bubbles) {
            existingTab.bubbles = [];
          }
          // Add bubble if not already present
          const bubbleExists = existingTab.bubbles.some(b => 
            b.text === metadata.bubble.text && 
            Math.abs((b.timestamp || 0) - (metadata.bubble.timestamp || 0)) < 1000
          );
          if (!bubbleExists) {
            existingTab.bubbles.push(metadata.bubble);
          }
        }
        
        chatData.tabs[existingTabIndex] = {
          ...existingTab,
          timestamp: new Date().toISOString(),
          ...(metadata.title && { title: metadata.title })
        };
        results.updated = true;
        console.log(`Updated existing chat tab: ${chatId}`);
      } else {
        // Create new tab with initial bubble if provided
        const bubbles = metadata.bubble ? [metadata.bubble] : [];
        
        const newTab = {
          id: chatId,
          title: metadata.title || `Mobile Chat ${chatId.slice(0, 8)}`,
          timestamp: new Date().toISOString(),
          bubbles: bubbles
        };
        
        // Add to beginning of tabs array (most recent first)
        chatData.tabs.unshift(newTab);
        
        // Set as current tab so it's visible
        chatData.currentTabId = chatId;
        
        results.created = true;
        console.log(`Created new chat tab: ${chatId}`);
      }

      // Write updated chat data back to database
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO ItemTable ([key], value) 
        VALUES (?, ?)
      `);
      
      stmt.run(chatDataKey, JSON.stringify(chatData));
      
      // Checkpoint to ensure data is written
      db.pragma('wal_checkpoint(PASSIVE)');
      
      results.success = true;
      
    } catch (error) {
      console.error('Error ensuring chat exists:', error);
      results.errors.push(error.message);
    } finally {
      if (db) {
        db.close();
      }
    }

    return results;
  }

  /**
   * Get the title from the first user message in a chat
   */
  async inferChatTitle(chatId) {
    const globalDbPath = path.join(this.globalStoragePath, 'state.vscdb');
    
    if (!existsSync(globalDbPath)) {
      return null;
    }

    let db = null;
    try {
      db = new Database(globalDbPath, { readonly: true });
      
      const rows = db.prepare(
        `SELECT value FROM cursorDiskKV WHERE key LIKE 'bubbleId:${chatId}:%' ORDER BY key ASC LIMIT 5`
      ).all();
      
      for (const row of rows) {
        try {
          const bubble = JSON.parse(row.value);
          // Type 1 is user message
          if ((bubble.type === 1 || bubble.type === 'user') && bubble.text) {
            // Return first line, truncated
            return bubble.text.split('\n')[0].slice(0, 100);
          }
        } catch (e) {
          continue;
        }
      }
    } catch (error) {
      console.error('Error inferring chat title:', error);
    } finally {
      if (db) {
        db.close();
      }
    }
    
    return null;
  }
}

// Singleton instance
let _writerInstance = null;

export function getCursorChatWriter() {
  if (!_writerInstance) {
    _writerInstance = new CursorChatWriter();
  }
  return _writerInstance;
}
