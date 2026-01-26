import Database from 'better-sqlite3';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

export class CursorChatReader {
  constructor() {
    this.workspacePath = this.getWorkspaceStoragePath();
    this.globalStoragePath = this.getGlobalStoragePath();
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
   * Get all chat logs from both global and workspace storage
   */
  async getAllChats() {
    const chats = [];
    
    // Get chats from global storage (newer Cursor versions)
    const globalChats = await this.getGlobalStorageChats();
    chats.push(...globalChats);
    
    // Get chats from workspace storage (legacy and current)
    const workspaceChats = await this.getWorkspaceChats();
    chats.push(...workspaceChats);
    
    // Sort by timestamp, newest first
    chats.sort((a, b) => b.timestamp - a.timestamp);
    
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
   */
  async getChatMessages(chatId, type = 'chat', workspaceId = 'global') {
    const messages = [];
    
    if (workspaceId === 'global') {
      return this.getGlobalChatMessages(chatId);
    } else {
      if (type === 'composer') {
        return this.getComposerMessages(chatId, workspaceId);
      } else {
        return this.getWorkspaceChatMessages(chatId, workspaceId);
      }
    }
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
          
          messages.push({
            id: row.key,
            type: bubble.type === 'user' || bubble.type === 1 ? 'user' : 'assistant',
            text: bubble.text || '',
            timestamp: bubble.timestamp || Date.now(),
            modelType: bubble.modelType || null,
            codeBlocks: this.extractCodeBlocks(bubble),
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
              messages.push({
                id: `${chatId}-${messages.length}`,
                type: bubble.type === 'user' ? 'user' : 'assistant',
                text: bubble.text || '',
                timestamp: bubble.timestamp || Date.now(),
                modelType: bubble.modelType || null,
                codeBlocks: this.extractCodeBlocks(bubble)
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
          messages.push({
            id: msg.bubbleId || `${composerId}-${messages.length}`,
            type: msg.type === 1 ? 'user' : 'assistant',
            text: msg.text || msg.richText || '',
            timestamp: msg.timestamp || Date.now(),
            context: msg.context || null,
            codeBlocks: this.extractCodeBlocks(msg)
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
          
          messages.push({
            id: row.key,
            type: bubble.type === 1 || bubble.type === 'user' ? 'user' : 'assistant',
            text: bubble.text || bubble.richText || '',
            timestamp: bubble.timestamp || Date.now(),
            codeBlocks: this.extractCodeBlocks(bubble)
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
   */
  async getChatsByProjectPath(projectPath) {
    const allChats = await this.getAllChats();
    
    // Normalize the project path for comparison
    const normalizedProjectPath = projectPath.replace(/\/$/, ''); // Remove trailing slash
    
    return allChats.filter(chat => {
      if (!chat.workspaceFolder) return false;
      
      // workspaceFolder is stored as file:///path/to/project
      const chatPath = chat.workspaceFolder.replace('file://', '').replace(/\/$/, '');
      
      return chatPath === normalizedProjectPath;
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
