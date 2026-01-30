import Database from 'better-sqlite3';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { MobileChatStore } from './MobileChatStore.js';

export class CursorChatReader {
  constructor() {
    this.workspacePath = this.getWorkspaceStoragePath();
    this.globalStoragePath = this.getGlobalStoragePath();
    this.mobileChatStore = MobileChatStore.getInstance();
  }

  /**
   * Estimate token count from text
   * Uses a rough approximation of ~4 characters per token for English text
   * This matches the typical tokenization ratio for GPT-style models
   */
  estimateTokens(text) {
    if (!text) return 0;
    // Average English word is ~5 characters, average token is ~4 characters
    // This is a reasonable approximation for most LLM tokenizers
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate total tokens for a conversation based on its messages
   */
  async estimateConversationTokens(chatId, type = 'chat', workspaceId = 'global') {
    const messages = await this.getChatMessages(chatId, type, workspaceId);
    let totalTokens = 0;
    
    for (const msg of messages) {
      if (msg.text) {
        totalTokens += this.estimateTokens(msg.text);
      }
      // Also count tool call inputs/outputs
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (tc.input) {
            totalTokens += this.estimateTokens(JSON.stringify(tc.input));
          }
          if (tc.result) {
            totalTokens += this.estimateTokens(tc.result);
          }
        }
      }
    }
    
    return totalTokens;
  }

  getWorkspaceStoragePath() {
    const homeDir = os.homedir();
    
    switch (process.platform) {
      case 'darwin':
        return path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage');
      case 'win32':
        return path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'workspaceStorage');
      case 'linux':
        // Check for remote/SSH environment
        if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) {
          return path.join(homeDir, '.cursor-server', 'data', 'User', 'workspaceStorage');
        }
        return path.join(homeDir, '.config', 'Cursor', 'User', 'workspaceStorage');
      default:
        return path.join(homeDir, '.cursor', 'workspaceStorage');
    }
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

  /**
   * Get all chat logs from global storage, workspace storage, and mobile store
   * 
   * Cursor stores chats in multiple places:
   * - Global storage: Contains bubble data (messages) with workspaceId = 'global'
   * - Workspace storage: Contains composer metadata with proper workspaceFolder
   * 
   * Many chats exist in BOTH, so we need to merge them properly:
   * - Use workspace metadata when available (for project association)
   * - Use global message counts (often more accurate)
   */
  async getAllChats() {
    const chatMap = new Map(); // id -> chat object
    
    // First, load global storage chats
    const globalChats = await this.getGlobalStorageChats();
    for (const chat of globalChats) {
      chatMap.set(chat.id, chat);
    }
    
    // Then, load workspace chats and MERGE with global data
    // Workspace data has better metadata (workspaceFolder, projectName)
    const workspaceChats = await this.getWorkspaceChats();
    for (const chat of workspaceChats) {
      const existing = chatMap.get(chat.id);
      if (existing) {
        // Merge: prefer workspace metadata, but keep global message count if higher
        chatMap.set(chat.id, {
          ...existing,
          ...chat,
          // Keep the higher message count (global often has the actual bubbles)
          messageCount: Math.max(existing.messageCount || 0, chat.messageCount || 0),
          // Mark that this chat exists in both storages
          source: 'workspace'
        });
      } else {
        chatMap.set(chat.id, chat);
      }
    }
    
    // Finally, load mobile chats and merge
    const mobileChats = await this.getMobileChats();
    for (const chat of mobileChats) {
      const existing = chatMap.get(chat.id);
      if (existing) {
        // Merge: update with mobile message count if higher
        chatMap.set(chat.id, {
          ...existing,
          hasMobileMessages: true,
          messageCount: Math.max(existing.messageCount || 0, chat.messageCount || 0)
        });
      } else {
        chatMap.set(chat.id, chat);
      }
    }
    
    // Convert to array and sort by timestamp, newest first
    const chats = Array.from(chatMap.values());
    chats.sort((a, b) => b.timestamp - a.timestamp);
    
    return chats;
  }

  /**
   * Get chats from mobile store
   */
  async getMobileChats() {
    const chats = [];
    
    try {
      const mobileConversations = await this.mobileChatStore.getAllConversations();
      
      for (const conv of mobileConversations) {
        chats.push({
          id: conv.id,
          type: conv.type || 'chat',
          title: conv.title || `Chat ${conv.id.slice(0, 8)}`,
          timestamp: conv.updatedAt || conv.createdAt || Date.now(),
          messageCount: conv.messageCount || 0,
          workspaceId: conv.workspaceId || 'global',
          workspaceFolder: conv.workspaceFolder,
          projectName: conv.projectName,
          source: 'mobile'
        });
      }
    } catch (error) {
      console.error('Error reading mobile chats:', error);
    }
    
    return chats;
  }

  /**
   * Get chats from global storage (bubbleId entries in cursorDiskKV)
   */
  async getGlobalStorageChats() {
    const chats = [];
    const globalDbPath = path.join(this.globalStoragePath, 'state.vscdb');
    
    if (!existsSync(globalDbPath)) {
      return chats;
    }
    
    try {
      const db = new Database(globalDbPath, { readonly: true });
      
      // Get all bubbleId entries (chat messages)
      const bubbleRows = db.prepare(
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'"
      ).all();
      
      // Map: chatId -> array of bubbles
      const chatMap = new Map();
      
      for (const row of bubbleRows) {
        const chatId = this.extractChatIdFromBubbleKey(row.key);
        if (!chatId) continue;
        
        try {
          const bubble = JSON.parse(row.value);
          if (!bubble || typeof bubble !== 'object') continue;
          
          if (!chatMap.has(chatId)) {
            chatMap.set(chatId, []);
          }
          chatMap.get(chatId).push(bubble);
        } catch (e) {
          // Skip invalid JSON
        }
      }
      
      // Create chat entries from the bubble map
      for (const [chatId, bubbles] of chatMap) {
        const validBubbles = bubbles.filter(b => b && typeof b === 'object');
        if (!validBubbles.length) continue;
        
        // Sort by timestamp
        validBubbles.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        
        const firstBubble = validBubbles[0];
        const lastBubble = validBubbles[validBubbles.length - 1];
        
        // Extract title from first user message
        let title = `Chat ${chatId.slice(0, 8)}`;
        const firstUserBubble = validBubbles.find(b => b.type === 'user' || b.type === 1);
        if (firstUserBubble?.text) {
          title = firstUserBubble.text.split('\n')[0].slice(0, 100);
        }
        
        chats.push({
          id: chatId,
          type: 'chat',
          title,
          timestamp: lastBubble.timestamp || Date.now(),
          messageCount: validBubbles.length,
          workspaceId: 'global',
          source: 'global'
        });
      }
      
      db.close();
    } catch (error) {
      console.error('Error reading global storage chats:', error);
    }
    
    return chats;
  }

  /**
   * Get chats from workspace storage (both chat and composer logs)
   */
  async getWorkspaceChats() {
    const chats = [];
    
    if (!existsSync(this.workspacePath)) {
      return chats;
    }
    
    try {
      const entries = await fs.readdir(this.workspacePath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const workspaceDir = path.join(this.workspacePath, entry.name);
        const dbPath = path.join(workspaceDir, 'state.vscdb');
        const workspaceJsonPath = path.join(workspaceDir, 'workspace.json');
        
        if (!existsSync(dbPath)) continue;
        
        // Get workspace folder info
        let workspaceFolder = null;
        let projectName = `Project ${entry.name.slice(0, 8)}`;
        
        try {
          const workspaceData = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf-8'));
          workspaceFolder = workspaceData.folder;
          if (workspaceFolder) {
            const folderPath = workspaceFolder.replace('file://', '');
            projectName = path.basename(folderPath);
          }
        } catch (e) {
          // No workspace.json
        }
        
        try {
          const db = new Database(dbPath, { readonly: true });
          
          // Get AI Chat data (from ItemTable)
          try {
            const chatResult = db.prepare(
              `SELECT value FROM ItemTable WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'`
            ).get();
            
            if (chatResult?.value) {
              const chatData = JSON.parse(chatResult.value);
              
              if (chatData.tabs && Array.isArray(chatData.tabs)) {
                for (const tab of chatData.tabs) {
                  chats.push({
                    id: tab.id || `${entry.name}-chat-${Date.now()}`,
                    type: 'chat',
                    title: tab.title || `Chat ${(tab.id || '').slice(0, 8)}`,
                    timestamp: new Date(tab.timestamp).getTime(),
                    messageCount: tab.bubbles?.length || 0,
                    workspaceId: entry.name,
                    workspaceFolder,
                    projectName,
                    source: 'workspace'
                  });
                }
              }
            }
          } catch (e) {
            // No chat data in ItemTable
          }
          
          // Get Composer data
          try {
            const composerResult = db.prepare(
              `SELECT value FROM ItemTable WHERE [key] = 'composer.composerData'`
            ).get();
            
            if (composerResult?.value) {
              const composerData = JSON.parse(composerResult.value);
              
              if (composerData.allComposers && Array.isArray(composerData.allComposers)) {
                for (const composer of composerData.allComposers) {
                  // Get title from composer name or first message
                  let title = composer.name || composer.text || `Composer ${(composer.composerId || '').slice(0, 8)}`;
                  if (title.length > 100) {
                    title = title.slice(0, 100) + '...';
                  }
                  
                  chats.push({
                    id: composer.composerId || `${entry.name}-composer-${Date.now()}`,
                    type: 'composer',
                    title,
                    timestamp: composer.lastUpdatedAt || composer.createdAt || Date.now(),
                    messageCount: composer.conversation?.length || 0,
                    workspaceId: entry.name,
                    workspaceFolder,
                    projectName,
                    source: 'workspace'
                  });
                }
              }
            }
          } catch (e) {
            // No composer data
          }
          
          // Also check cursorDiskKV for newer format
          try {
            const composerRows = db.prepare(
              "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND LENGTH(value) > 10"
            ).all();
            
            for (const row of composerRows) {
              try {
                const composerData = JSON.parse(row.value);
                const composerId = row.key.split(':')[1];
                
                let title = composerData.name || `Composer ${composerId.slice(0, 8)}`;
                
                chats.push({
                  id: composerId,
                  type: 'composer',
                  title,
                  timestamp: composerData.lastUpdatedAt || composerData.createdAt || Date.now(),
                  messageCount: composerData.conversation?.length || composerData.fullConversationHeadersOnly?.length || 0,
                  workspaceId: entry.name,
                  workspaceFolder,
                  projectName,
                  source: 'workspace-kv'
                });
              } catch (e) {
                // Skip invalid entries
              }
            }
          } catch (e) {
            // No cursorDiskKV table
          }
          
          db.close();
        } catch (error) {
          console.error(`Error reading workspace ${entry.name}:`, error);
        }
      }
    } catch (error) {
      console.error('Error reading workspace storage:', error);
    }
    
    return chats;
  }

  /**
   * Get messages for a specific chat
   * Merges messages from Cursor IDE storage and mobile store
   */
  async getChatMessages(chatId, type = 'chat', workspaceId = 'global') {
    let cursorMessages = [];
    
    // Get messages from Cursor IDE storage
    if (workspaceId === 'global') {
      cursorMessages = await this.getGlobalChatMessages(chatId);
    } else {
      if (type === 'composer') {
        cursorMessages = await this.getComposerMessages(chatId, workspaceId);
      } else {
        cursorMessages = await this.getWorkspaceChatMessages(chatId, workspaceId);
      }
    }
    
    // Get messages from mobile store
    const mobileMessages = await this.getMobileMessages(chatId);
    
    // Merge messages, avoiding duplicates
    const mergedMessages = this.mergeMessages(cursorMessages, mobileMessages);
    
    return mergedMessages;
  }

  /**
   * Get messages from mobile store
   */
  async getMobileMessages(chatId) {
    const messages = [];
    
    try {
      const mobileMessages = await this.mobileChatStore.getMessages(chatId);
      
      for (const msg of mobileMessages) {
        // Process message content to extract tool calls and clean text
        const { text, toolCalls } = this.processMessageContent(msg);
        
        // Merge with any existing toolCalls from the stored message
        const finalToolCalls = toolCalls || msg.toolCalls || null;
        
        messages.push({
          id: msg.id,
          type: msg.type === 'user' ? 'user' : 'assistant',
          text: text,
          timestamp: msg.timestamp || Date.now(),
          modelType: null,
          codeBlocks: this.extractCodeBlocksFromText(text),
          toolCalls: finalToolCalls,
          source: 'mobile'
        });
      }
    } catch (error) {
      console.error('Error reading mobile messages:', error);
    }
    
    return messages;
  }

  /**
   * Extract code blocks from markdown text
   */
  extractCodeBlocksFromText(text) {
    if (!text) return [];
    
    const codeBlocks = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let match;
    
    while ((match = codeBlockRegex.exec(text)) !== null) {
      codeBlocks.push({
        type: 'code',
        language: match[1] || 'text',
        content: match[2]
      });
    }
    
    return codeBlocks;
  }

  /**
   * Merge messages from Cursor IDE and mobile store
   * Removes duplicates based on content and timestamp proximity
   */
  mergeMessages(cursorMessages, mobileMessages) {
    // If one is empty, return the other
    if (cursorMessages.length === 0) return mobileMessages;
    if (mobileMessages.length === 0) return cursorMessages;
    
    const merged = [...cursorMessages];
    const cursorTimestamps = new Set(cursorMessages.map(m => m.timestamp));
    
    // Add mobile messages that don't have a close timestamp match in cursor messages
    for (const mobileMsg of mobileMessages) {
      // Check if this message already exists in cursor messages
      const isDuplicate = cursorMessages.some(cursorMsg => {
        // Consider duplicate if same type and similar timestamp (within 5 seconds)
        if (cursorMsg.type !== mobileMsg.type) return false;
        const timeDiff = Math.abs((cursorMsg.timestamp || 0) - (mobileMsg.timestamp || 0));
        if (timeDiff > 5000) return false;
        
        // Also check text similarity for user messages
        if (mobileMsg.type === 'user') {
          const cursorText = (cursorMsg.text || '').slice(0, 100);
          const mobileText = (mobileMsg.text || '').slice(0, 100);
          return cursorText === mobileText;
        }
        
        return true;
      });
      
      if (!isDuplicate) {
        merged.push({
          ...mobileMsg,
          source: 'mobile'
        });
      }
    }
    
    // Sort by timestamp
    merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    
    return merged;
  }

  /**
   * Get messages from global storage chat
   */
  async getGlobalChatMessages(chatId) {
    const messages = [];
    const globalDbPath = path.join(this.globalStoragePath, 'state.vscdb');
    
    if (!existsSync(globalDbPath)) {
      return messages;
    }
    
    try {
      const db = new Database(globalDbPath, { readonly: true });
      
      // Get all bubbles for this chat
      const bubbleRows = db.prepare(
        `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:${chatId}:%'`
      ).all();
      
      for (const row of bubbleRows) {
        try {
          const bubble = JSON.parse(row.value);
          if (!bubble || typeof bubble !== 'object') continue;
          
          // Process message content to extract tool calls and clean text
          const { text, toolCalls } = this.processMessageContent(bubble);
          
          messages.push({
            id: row.key,
            type: bubble.type === 'user' || bubble.type === 1 ? 'user' : 'assistant',
            text: text,
            timestamp: bubble.timestamp || Date.now(),
            modelType: bubble.modelType || null,
            codeBlocks: this.extractCodeBlocks(bubble),
            toolCalls: toolCalls,
            selections: bubble.selections || [],
            relevantFiles: bubble.relevantFiles || []
          });
        } catch (e) {
          // Skip invalid entries
        }
      }
      
      db.close();
      
      // Sort by timestamp
      messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    } catch (error) {
      console.error('Error reading global chat messages:', error);
    }
    
    return messages;
  }

  /**
   * Get messages from workspace chat (ItemTable)
   */
  async getWorkspaceChatMessages(chatId, workspaceId) {
    const messages = [];
    const dbPath = path.join(this.workspacePath, workspaceId, 'state.vscdb');
    
    if (!existsSync(dbPath)) {
      return messages;
    }
    
    try {
      const db = new Database(dbPath, { readonly: true });
      
      const chatResult = db.prepare(
        `SELECT value FROM ItemTable WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'`
      ).get();
      
      if (chatResult?.value) {
        const chatData = JSON.parse(chatResult.value);
        
        if (chatData.tabs && Array.isArray(chatData.tabs)) {
          const tab = chatData.tabs.find(t => t.id === chatId);
          
          if (tab && tab.bubbles) {
            for (const bubble of tab.bubbles) {
              // Process message content to extract tool calls and clean text
              const { text, toolCalls } = this.processMessageContent(bubble);
              
              messages.push({
                id: `${chatId}-${messages.length}`,
                type: bubble.type === 'user' ? 'user' : 'assistant',
                text: text,
                timestamp: bubble.timestamp || Date.now(),
                modelType: bubble.modelType || null,
                codeBlocks: this.extractCodeBlocks(bubble),
                toolCalls: toolCalls
              });
            }
          }
        }
      }
      
      db.close();
    } catch (error) {
      console.error('Error reading workspace chat messages:', error);
    }
    
    return messages;
  }

  /**
   * Get messages from composer
   */
  async getComposerMessages(composerId, workspaceId) {
    const messages = [];
    const dbPath = path.join(this.workspacePath, workspaceId, 'state.vscdb');
    
    if (!existsSync(dbPath)) {
      return messages;
    }
    
    try {
      const db = new Database(dbPath, { readonly: true });
      
      // Try ItemTable first
      const composerResult = db.prepare(
        `SELECT value FROM ItemTable WHERE [key] = 'composer.composerData'`
      ).get();
      
      let composerData = null;
      
      if (composerResult?.value) {
        const data = JSON.parse(composerResult.value);
        if (data.allComposers) {
          composerData = data.allComposers.find(c => c.composerId === composerId);
        }
      }
      
      // Try cursorDiskKV if not found
      if (!composerData) {
        try {
          const kvResult = db.prepare(
            `SELECT value FROM cursorDiskKV WHERE key = 'composerData:${composerId}'`
          ).get();
          
          if (kvResult?.value) {
            composerData = JSON.parse(kvResult.value);
          }
        } catch (e) {
          // No cursorDiskKV table
        }
      }
      
      if (composerData && composerData.conversation) {
        for (const msg of composerData.conversation) {
          // Process message content to extract tool calls and clean text
          const { text, toolCalls } = this.processMessageContent(msg);
          
          messages.push({
            id: msg.bubbleId || `${composerId}-${messages.length}`,
            type: msg.type === 1 ? 'user' : 'assistant',
            text: text,
            timestamp: msg.timestamp || Date.now(),
            context: msg.context || null,
            codeBlocks: this.extractCodeBlocks(msg),
            toolCalls: toolCalls
          });
        }
      }
      
      // If no conversation, try to get bubble data from global storage
      if (messages.length === 0) {
        const globalMessages = await this.getComposerBubbles(composerId);
        messages.push(...globalMessages);
      }
      
      db.close();
    } catch (error) {
      console.error('Error reading composer messages:', error);
    }
    
    return messages;
  }

  /**
   * Get composer bubbles from global storage
   */
  async getComposerBubbles(composerId) {
    const messages = [];
    const globalDbPath = path.join(this.globalStoragePath, 'state.vscdb');
    
    if (!existsSync(globalDbPath)) {
      return messages;
    }
    
    try {
      const db = new Database(globalDbPath, { readonly: true });
      
      // Get bubble entries for this composer
      const bubbleRows = db.prepare(
        `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:${composerId}:%'`
      ).all();
      
      for (const row of bubbleRows) {
        try {
          const bubble = JSON.parse(row.value);
          if (!bubble || typeof bubble !== 'object') continue;
          
          // Process message content to extract tool calls and clean text
          const { text, toolCalls } = this.processMessageContent(bubble);
          
          messages.push({
            id: row.key,
            type: bubble.type === 1 || bubble.type === 'user' ? 'user' : 'assistant',
            text: text,
            timestamp: bubble.timestamp || Date.now(),
            codeBlocks: this.extractCodeBlocks(bubble),
            toolCalls: toolCalls
          });
        } catch (e) {
          // Skip invalid entries
        }
      }
      
      db.close();
      
      messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    } catch (error) {
      console.error('Error reading composer bubbles:', error);
    }
    
    return messages;
  }

  /**
   * Extract code blocks from a bubble/message
   */
  extractCodeBlocks(bubble) {
    const codeBlocks = [];
    
    // Check for codeBlockDiffs
    if (bubble.codeBlockDiffs && Array.isArray(bubble.codeBlockDiffs)) {
      for (const diff of bubble.codeBlockDiffs) {
        codeBlocks.push({
          type: 'diff',
          diffId: diff.diffId,
          content: diff
        });
      }
    }
    
    // Check for code in text using markdown code block pattern
    if (bubble.text) {
      const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
      let match;
      
      while ((match = codeBlockRegex.exec(bubble.text)) !== null) {
        codeBlocks.push({
          type: 'code',
          language: match[1] || 'text',
          content: match[2]
        });
      }
    }
    
    return codeBlocks;
  }

  /**
   * Extract tool calls from a bubble/message
   * Cursor stores tool calls in various formats depending on version
   */
  extractToolCalls(bubble) {
    const toolCalls = [];
    
    // Check for toolResults (common in composer format)
    if (bubble.toolResults && Array.isArray(bubble.toolResults)) {
      for (const tool of bubble.toolResults) {
        toolCalls.push({
          id: tool.id || tool.toolUseId || `tool-${toolCalls.length}`,
          name: tool.name || tool.toolName || 'Unknown',
          input: tool.input || tool.args || {},
          status: tool.error ? 'error' : 'complete',
          result: tool.result || tool.output || null
        });
      }
    }
    
    // Check for toolCalls array
    if (bubble.toolCalls && Array.isArray(bubble.toolCalls)) {
      for (const tool of bubble.toolCalls) {
        toolCalls.push({
          id: tool.id || `tool-${toolCalls.length}`,
          name: tool.name || tool.function?.name || 'Unknown',
          input: tool.input || tool.function?.arguments || tool.args || {},
          status: tool.status || 'complete',
          result: tool.result || tool.output || null
        });
      }
    }
    
    // Check for tool_use in content array (Anthropic format)
    if (bubble.content && Array.isArray(bubble.content)) {
      for (const item of bubble.content) {
        if (item.type === 'tool_use') {
          toolCalls.push({
            id: item.id,
            name: item.name,
            input: item.input || {},
            status: 'complete',
            result: null
          });
        }
      }
    }
    
    // Check for codeBlocks that are actually tool calls (Cursor-specific)
    if (bubble.codeBlocks && Array.isArray(bubble.codeBlocks)) {
      for (const block of bubble.codeBlocks) {
        if (block.type === 'tool' || block.toolName) {
          toolCalls.push({
            id: block.id || `tool-${toolCalls.length}`,
            name: block.toolName || block.name || 'Tool',
            input: block.input || block.args || {},
            status: block.error ? 'error' : 'complete',
            result: block.result || block.output || null
          });
        }
      }
    }
    
    // Parse tool calls embedded as JSON in text
    if (bubble.text) {
      const embeddedToolCalls = this.parseToolCallsFromText(bubble.text);
      toolCalls.push(...embeddedToolCalls);
    }
    
    return toolCalls.length > 0 ? toolCalls : null;
  }

  /**
   * Parse tool calls embedded as JSON in message text
   * Handles formats like: {"type":"tool_call","subtype":"completed","call_id":"...","tool_call":{...}}
   */
  parseToolCallsFromText(text) {
    const toolCalls = [];
    if (!text) return toolCalls;

    // Find all JSON objects in the text using balanced brace matching
    const jsonObjects = this.findJsonObjects(text);
    
    for (const jsonStr of jsonObjects) {
      try {
        const obj = JSON.parse(jsonStr);
        
        // Check if this is a tool_call type object
        if (obj.type === 'tool_call' || obj.tool_call) {
          const toolCall = this.parseToolCallObject(obj, toolCalls.length);
          if (toolCall) {
            toolCalls.push(toolCall);
          }
        }
        // Check for tool_result type
        else if (obj.type === 'tool_result') {
          // Tool results are handled separately - we might want to merge with existing tool calls
          const toolId = obj.tool_use_id || obj.call_id;
          const existingTool = toolCalls.find(t => t.id === toolId);
          if (existingTool) {
            existingTool.result = obj.content || obj.result;
            existingTool.status = obj.is_error ? 'error' : 'complete';
          }
        }
      } catch (e) {
        // Not valid JSON, skip
      }
    }

    return toolCalls;
  }

  /**
   * Find all JSON objects in text using balanced brace matching
   * This handles deeply nested JSON structures
   */
  findJsonObjects(text) {
    const objects = [];
    let i = 0;
    
    while (i < text.length) {
      if (text[i] === '{') {
        const start = i;
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let j = i; j < text.length; j++) {
          const char = text[j];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\' && inString) {
            escapeNext = true;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') {
              depth++;
            } else if (char === '}') {
              depth--;
              if (depth === 0) {
                const jsonStr = text.substring(start, j + 1);
                objects.push(jsonStr);
                i = j;
                break;
              }
            }
          }
        }
      }
      i++;
    }
    
    return objects;
  }

  /**
   * Parse a single tool call object into our standard format
   */
  parseToolCallObject(obj, index) {
    // Handle {"type":"tool_call","subtype":"completed","call_id":"...","tool_call":{...}} format
    if (obj.tool_call) {
      const toolCallData = obj.tool_call;
      // The tool_call object has keys like "readToolCall", "writeToolCall", etc.
      const toolType = Object.keys(toolCallData)[0];
      if (toolType) {
        const toolData = toolCallData[toolType];
        // Extract tool name from the key (e.g., "readToolCall" -> "Read")
        let name = toolType.replace(/ToolCall$/i, '');
        name = name.charAt(0).toUpperCase() + name.slice(1);
        
        // Extract result - handle nested formats like {success: {content: "..."}}
        let result = this.extractResult(obj.result) || this.extractResult(toolData?.result);
        
        return {
          id: obj.call_id || `embedded-tool-${index}`,
          name: name,
          input: toolData?.args || toolData || {},
          status: obj.subtype === 'completed' ? 'complete' : (obj.subtype === 'error' ? 'error' : 'running'),
          result: result
        };
      }
    }
    
    // Handle direct tool call format
    if (obj.name || obj.function) {
      return {
        id: obj.id || obj.call_id || `embedded-tool-${index}`,
        name: obj.name || obj.function?.name || 'Unknown',
        input: obj.input || obj.args || obj.function?.arguments || {},
        status: obj.status || obj.subtype || 'complete',
        result: this.extractResult(obj.result) || obj.output || null
      };
    }

    return null;
  }

  /**
   * Extract result content from various formats
   * Handles: string, {success: {content: "..."}}, {content: "..."}, etc.
   */
  extractResult(result) {
    if (!result) return null;
    
    // Already a string
    if (typeof result === 'string') return result;
    
    // {success: {content: "..."}} format
    if (result.success && result.success.content) {
      return result.success.content;
    }
    
    // {content: "..."} format
    if (result.content) {
      return typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    }
    
    // {error: "..."} or {error: {message: "..."}} format
    if (result.error) {
      if (typeof result.error === 'string') return result.error;
      if (result.error.message) return result.error.message;
      return JSON.stringify(result.error);
    }
    
    // Object - stringify it
    if (typeof result === 'object') {
      return JSON.stringify(result);
    }
    
    return String(result);
  }

  /**
   * Clean message text by removing embedded tool call JSON
   * Returns the text without the JSON blobs
   */
  cleanTextFromToolCalls(text) {
    if (!text) return text;

    let cleaned = text;

    // Find all JSON objects using balanced brace matching
    const jsonObjects = this.findJsonObjects(text);
    const toRemove = [];

    for (const jsonStr of jsonObjects) {
      try {
        const obj = JSON.parse(jsonStr);
        
        // Check if this is a tool-related JSON object
        if (obj.type === 'tool_call' || obj.type === 'tool_result' || 
            obj.tool_call || obj.tool_use_id || obj.call_id ||
            (obj.type && obj.subtype && (obj.subtype === 'completed' || obj.subtype === 'running' || obj.subtype === 'error'))) {
          toRemove.push(jsonStr);
        }
      } catch (e) {
        // Not valid JSON, keep it
      }
    }

    // Remove the JSON strings from the text
    for (const jsonStr of toRemove) {
      cleaned = cleaned.replace(jsonStr, '');
    }

    // Clean up extra whitespace and newlines left behind
    cleaned = cleaned
      .replace(/\n{3,}/g, '\n\n')  // Replace 3+ newlines with 2
      .replace(/^\s+|\s+$/g, '')   // Trim start and end
      .replace(/  +/g, ' ');       // Replace multiple spaces with single space (but preserve newlines)
    
    return cleaned;
  }

  /**
   * Process a message to extract tool calls and clean text
   * Returns { text, toolCalls } with cleaned text and parsed tool calls
   */
  processMessageContent(bubble) {
    const toolCalls = this.extractToolCalls(bubble);
    let text = bubble.text || bubble.richText || '';
    
    // If we found tool calls, clean the text
    if (toolCalls && toolCalls.length > 0) {
      text = this.cleanTextFromToolCalls(text);
    }
    
    return { text, toolCalls };
  }

  /**
   * Extract chat ID from bubble key
   */
  extractChatIdFromBubbleKey(key) {
    // key format: bubbleId:<chatId>:<bubbleId>
    const match = key.match(/^bubbleId:([^:]+):/);
    return match ? match[1] : null;
  }

  /**
   * Search across all chats
   */
  async searchChats(query) {
    const results = [];
    const allChats = await this.getAllChats();
    
    const lowerQuery = query.toLowerCase();
    
    for (const chat of allChats) {
      // Search in title
      if (chat.title.toLowerCase().includes(lowerQuery)) {
        results.push({
          ...chat,
          matchType: 'title',
          matchText: chat.title
        });
        continue;
      }
      
      // Search in messages
      const messages = await this.getChatMessages(chat.id, chat.type, chat.workspaceId);
      
      for (const message of messages) {
        if (message.text.toLowerCase().includes(lowerQuery)) {
          results.push({
            ...chat,
            matchType: 'message',
            matchText: message.text.slice(0, 200)
          });
          break;
        }
      }
    }
    
    return results;
  }

  /**
   * Get all chats for a specific project path
   * Returns only project-scoped chats (from workspace storage and mobile store)
   */
  async getChatsByProjectPath(projectPath) {
    const allChats = await this.getAllChats();
    
    // Normalize the project path for comparison
    const normalizedProjectPath = projectPath.replace(/\/$/, ''); // Remove trailing slash
    const projectName = normalizedProjectPath.split('/').pop();
    
    return allChats.filter(chat => {
      // Check workspaceFolder (file:// format) - workspace-specific chats
      if (chat.workspaceFolder) {
        const chatPath = chat.workspaceFolder.replace('file://', '').replace(/\/$/, '');
        if (chatPath === normalizedProjectPath) return true;
      }
      
      // Check if mobile-created chats have matching workspaceId or projectName
      if (chat.source === 'mobile' && chat.projectName) {
        if (chat.projectName === projectName) return true;
      }
      
      return false;
    });
  }

  /**
   * Get workspaces with chat/composer counts
   */
  async getWorkspacesWithCounts() {
    const workspaces = [];
    
    if (!existsSync(this.workspacePath)) {
      return workspaces;
    }
    
    try {
      const entries = await fs.readdir(this.workspacePath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const workspaceDir = path.join(this.workspacePath, entry.name);
        const dbPath = path.join(workspaceDir, 'state.vscdb');
        const workspaceJsonPath = path.join(workspaceDir, 'workspace.json');
        
        if (!existsSync(dbPath)) continue;
        
        let workspaceFolder = null;
        let projectName = `Project ${entry.name.slice(0, 8)}`;
        
        try {
          const workspaceData = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf-8'));
          workspaceFolder = workspaceData.folder;
          if (workspaceFolder) {
            const folderPath = workspaceFolder.replace('file://', '');
            projectName = path.basename(folderPath);
          }
        } catch (e) {
          // No workspace.json
        }
        
        let chatCount = 0;
        let composerCount = 0;
        
        try {
          const db = new Database(dbPath, { readonly: true });
          
          // Count chats
          try {
            const chatResult = db.prepare(
              `SELECT value FROM ItemTable WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'`
            ).get();
            
            if (chatResult?.value) {
              const chatData = JSON.parse(chatResult.value);
              chatCount = chatData.tabs?.length || 0;
            }
          } catch (e) {}
          
          // Count composers
          try {
            const composerResult = db.prepare(
              `SELECT value FROM ItemTable WHERE [key] = 'composer.composerData'`
            ).get();
            
            if (composerResult?.value) {
              const composerData = JSON.parse(composerResult.value);
              composerCount = composerData.allComposers?.length || 0;
            }
          } catch (e) {}
          
          db.close();
        } catch (error) {
          console.error(`Error reading workspace ${entry.name}:`, error);
        }
        
        const stats = await fs.stat(dbPath);
        
        workspaces.push({
          id: entry.name,
          name: projectName,
          folder: workspaceFolder,
          chatCount,
          composerCount,
          lastModified: stats.mtime.toISOString()
        });
      }
      
      // Sort by last modified
      workspaces.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    } catch (error) {
      console.error('Error reading workspaces:', error);
    }
    
    return workspaces;
  }
}
