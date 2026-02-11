import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { chatProcessManager } from "../utils/ChatProcessManager.js";
import { ChatPersistenceStore } from "../utils/ChatPersistenceStore.js";
import { ProjectManager } from "../utils/ProjectManager.js";
import {
  getSupportedTools,
  checkAllToolsAvailability,
} from "../utils/CLIAdapter.js";
import { logger } from "../utils/LogManager.js";

const router = Router();
let projectManager;
const persistenceStore = ChatPersistenceStore.getInstance();

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store files in memory as buffers
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 5, // Max 5 files per request
  },
  fileFilter: (req, file, cb) => {
    // Accept images and common document types
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/json',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

// Initialize projectManager with dataDir from app locals
router.use((req, res, next) => {
  if (!projectManager && req.app.locals.dataDir) {
    projectManager = new ProjectManager({ dataDir: req.app.locals.dataDir });
  }
  next();
});

/**
 * Conversations API - AI Chat Sessions
 *
 * Chats are now managed by ChatProcessManager which spawns CLI processes
 * with structured JSON output. This provides:
 * - Clean content blocks (no ANSI codes)
 * - Proper message streaming
 * - Session resume support
 */

// Get list of all chats for a project
router.get("/", async (req, res) => {
  try {
    const { projectPath, projectId } = req.query;

    // Get project path from projectId if not provided directly
    let resolvedProjectPath = projectPath;
    if (!resolvedProjectPath && projectId && projectId !== "global") {
      const project = await projectManager.getProjectDetails(projectId);
      if (project) {
        resolvedProjectPath = project.path;
      }
    }

    // Get chats from persistence store (includes all conversations, even inactive ones)
    const persistedChats =
      await persistenceStore.getAllConversations(resolvedProjectPath);

    // Format for API response
    const formattedChats = persistedChats.map((chat) => ({
      id: chat.id,
      conversationId: chat.id,
      tool: chat.tool,
      topic: chat.topic,
      model: chat.model,
      mode: chat.mode,
      projectPath: chat.projectPath,
      status: chat.status,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      lastActivity: chat.lastActivity,
      type: "chat",
      title: `${chat.tool}: ${chat.topic}`,
      timestamp: chat.createdAt,
    }));

    res.json({
      chats: formattedChats,
      conversations: formattedChats, // Alias for backwards compatibility
      total: formattedChats.length,
    });
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

// Get and clear pending notifications (session_end events that fired while no client was connected)
// Used by iOS background fetch to check if any chats completed while the app was suspended/killed
router.get("/notifications/pending", async (req, res) => {
  try {
    const pendingNotifications = chatProcessManager.getPendingNotifications();
    const result = [];
    for (const [conversationId, events] of pendingNotifications) {
      for (const event of events) {
        result.push({
          conversationId,
          type: event.type,
          topic: event.topic || null,
          content: event.content || null,
          timestamp: event.timestamp,
          isTurnComplete: event.isTurnComplete || false,
        });
      }
    }
    console.log(`[API] Returning ${result.length} pending notifications`);
    res.json({ notifications: result });
  } catch (error) {
    console.error("Error fetching pending notifications:", error);
    res.status(500).json({ error: "Failed to fetch pending notifications" });
  }
});

// Get tool availability status
router.get("/tools/availability", async (req, res) => {
  try {
    const availability = await checkAllToolsAvailability();
    res.json({ tools: availability });
  } catch (error) {
    console.error("Error checking tool availability:", error);
    res.status(500).json({ error: "Failed to check tool availability" });
  }
});

// Get supported tools list
router.get("/tools", async (req, res) => {
  try {
    const tools = getSupportedTools();
    const availability = await checkAllToolsAvailability();

    res.json({
      tools: tools.map((tool) => ({
        id: tool,
        ...availability[tool],
      })),
    });
  } catch (error) {
    console.error("Error getting tools:", error);
    res.status(500).json({ error: "Failed to get tools" });
  }
});

// Update conversation topic
router.patch("/:conversationId", async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { topic } = req.body;

    console.log(
      `[PATCH /:conversationId] Updating topic for conversation: ${conversationId}`,
    );
    console.log(`[PATCH /:conversationId] New topic: ${topic}`);

    if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
      return res.status(400).json({
        error: "Invalid topic",
        details: "Topic must be a non-empty string",
      });
    }

    const trimmedTopic = topic.trim();

    // Check if conversation exists in persistence store or in-memory
    let conversation = await persistenceStore.getConversation(conversationId);
    console.log(
      `[PATCH /:conversationId] Found conversation in DB:`,
      conversation ? "YES" : "NO",
    );

    // If not in persistence store, check in-memory and save it
    if (!conversation) {
      const inMemoryChat = chatProcessManager.getChat(conversationId);
      console.log(
        `[PATCH /:conversationId] Found conversation in memory:`,
        inMemoryChat ? "YES" : "NO",
      );

      if (!inMemoryChat) {
        return res.status(404).json({ error: "Chat not found" });
      }

      // Save the in-memory chat to persistence store
      conversation = await persistenceStore.saveConversation({
        id: inMemoryChat.id,
        tool: inMemoryChat.tool,
        topic: inMemoryChat.topic,
        model: inMemoryChat.model,
        mode: inMemoryChat.mode,
        projectPath: inMemoryChat.projectPath,
        status: inMemoryChat.status,
        createdAt: inMemoryChat.createdAt,
        sessionId: inMemoryChat.sessionId || null,
      });
      console.log(`[PATCH /:conversationId] Saved in-memory chat to DB`);
    }

    // Update in persistence store
    const updatedConversation = await persistenceStore.updateConversationTopic(
      conversationId,
      trimmedTopic,
    );

    if (!updatedConversation) {
      return res.status(500).json({ error: "Failed to update topic" });
    }

    // Update in-memory chat if it exists
    const inMemoryChat = chatProcessManager.getChat(conversationId);
    if (inMemoryChat) {
      inMemoryChat.topic = trimmedTopic;
    }

    logger.info("Chat", "Topic updated", {
      conversationId,
      oldTopic: conversation.topic,
      newTopic: trimmedTopic,
    });

    res.json({
      success: true,
      conversationId,
      topic: trimmedTopic,
      updatedAt: updatedConversation.updatedAt,
      message: "Topic updated successfully",
    });
  } catch (error) {
    console.error("Error updating chat topic:", error);
    res.status(500).json({ error: "Failed to update chat topic" });
  }
});

// Get specific chat info
router.get("/:conversationId", async (req, res) => {
  try {
    const { conversationId } = req.params;

    // Try to get from persistence store first
    let chatInfo = await persistenceStore.getConversation(conversationId);

    // If not in persistence store, check in-memory
    if (!chatInfo) {
      const inMemoryChat = chatProcessManager.getChat(conversationId);
      if (inMemoryChat) {
        chatInfo = {
          id: inMemoryChat.id,
          tool: inMemoryChat.tool,
          topic: inMemoryChat.topic,
          model: inMemoryChat.model,
          mode: inMemoryChat.mode,
          projectPath: inMemoryChat.projectPath,
          status: inMemoryChat.status,
          createdAt: inMemoryChat.createdAt,
          pid: inMemoryChat.pid,
        };
      }
    }

    if (!chatInfo) {
      return res.status(404).json({ error: "Chat not found" });
    }

    res.json({
      chat: {
        id: chatInfo.id,
        conversationId: chatInfo.id,
        tool: chatInfo.tool,
        topic: chatInfo.topic,
        model: chatInfo.model,
        mode: chatInfo.mode,
        projectPath: chatInfo.projectPath,
        status: chatInfo.status,
        createdAt: chatInfo.createdAt,
        updatedAt: chatInfo.updatedAt,
        lastActivity: chatInfo.lastActivity,
        pid: chatInfo.pid,
        type: "chat",
        title: `${chatInfo.tool}: ${chatInfo.topic}`,
      },
    });
  } catch (error) {
    console.error("Error fetching chat:", error);
    res.status(500).json({ error: "Failed to fetch chat details" });
  }
});

// Create a new chat
router.post("/", async (req, res) => {
  try {
    const {
      projectPath,
      projectId,
      tool = "claude",
      topic,
      model,
      mode = "agent",
      permissionMode = "default",
      sessionId, // For resuming sessions
      initialPrompt, // Optional initial message to send after CLI starts
    } = req.body;

    logger.info("Chat", "Creating new chat", {
      projectPath,
      projectId,
      tool,
      topic,
      model,
      mode,
      permissionMode,
    });

    // Resolve project path
    let resolvedProjectPath = projectPath;
    let projectName = null;

    if (!resolvedProjectPath && projectId && projectId !== "global") {
      const project = await projectManager.getProjectDetails(projectId);
      if (project) {
        resolvedProjectPath = project.path;
        projectName = project.name;
      }
    }

    if (!resolvedProjectPath) {
      return res.status(400).json({
        error: "Project path required",
        details: "Either projectPath or a valid projectId must be provided",
      });
    }

    // Validate tool
    const validTools = getSupportedTools();
    if (!validTools.includes(tool)) {
      return res.status(400).json({
        error: "Invalid tool",
        details: `Tool must be one of: ${validTools.join(", ")}`,
        validTools,
      });
    }

    // Validate mode if provided
    const validModes = ["agent", "plan", "ask"];
    if (mode && !validModes.includes(mode)) {
      return res.status(400).json({
        error: "Invalid mode",
        details: `Mode must be one of: ${validModes.join(", ")}`,
        validModes,
      });
    }

    // Create the chat session
    const chatResult = await chatProcessManager.createChat({
      projectPath: resolvedProjectPath,
      tool,
      topic,
      model,
      mode,
      permissionMode,
      sessionId,
      initialPrompt,
    });

    logger.info("Chat", "Chat created", {
      conversationId: chatResult.conversationId,
      tool,
      topic: chatResult.topic,
    });

    console.log(`Created chat: ${chatResult.conversationId} (${tool})`);

    res.json({
      success: true,
      conversationId: chatResult.conversationId,
      chatId: chatResult.conversationId, // Alias
      terminalId: chatResult.conversationId, // Legacy alias
      tool,
      topic: chatResult.topic,
      model: chatResult.model,
      mode: chatResult.mode,
      projectPath: resolvedProjectPath,
      projectName,
      status: chatResult.status,
    });
  } catch (error) {
    logger.error("Chat", "Failed to create chat", {
      errorMessage: error.message,
    });

    console.error("Error creating chat:", error);
    res.status(500).json({
      error: "Failed to create chat",
      details: error.message,
    });
  }
});

// Close/delete a chat
router.delete("/:conversationId", async (req, res) => {
  try {
    const { conversationId } = req.params;

    // Check both in-memory and persistence store
    const chatInfo = chatProcessManager.getChat(conversationId);
    const persistedChat =
      await persistenceStore.getConversation(conversationId);

    if (!chatInfo && !persistedChat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    // Close the in-memory process if it exists
    if (chatInfo) {
      await chatProcessManager.closeChat(conversationId);
    }

    // Delete from persistence store (removes conversation and all messages via CASCADE)
    await persistenceStore.deleteConversation(conversationId);

    logger.info("Chat", "Chat deleted", {
      conversationId,
      tool: chatInfo?.tool || persistedChat?.tool,
    });

    res.json({
      success: true,
      conversationId,
      message: "Chat deleted",
    });
  } catch (error) {
    console.error("Error deleting chat:", error);
    res.status(500).json({ error: "Failed to delete chat" });
  }
});

// Get chat history/messages
router.get("/:conversationId/messages", async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit, includePartial } = req.query;

    // Check if conversation exists in persistence store or in-memory
    const persistedConv =
      await persistenceStore.getConversation(conversationId);
    const inMemory = chatProcessManager.hasChat(conversationId);

    if (!persistedConv && !inMemory) {
      return res.status(404).json({ error: "Chat not found" });
    }

    // Get all messages from persistence store (includes everything, even partial messages)
    let messages = await persistenceStore.getMessages(
      conversationId,
      limit ? parseInt(limit) : null,
    );

    // Filter out partial messages unless explicitly requested
    if (includePartial !== "true") {
      messages = messages.filter((msg) => !msg.isPartial);
    }

    res.json({
      conversationId,
      messages,
      total: messages.length,
      source: "persistence",
    });
  } catch (error) {
    console.error("Error fetching chat messages:", error);
    res.status(500).json({ error: "Failed to fetch chat messages" });
  }
});

// Fork/clone a chat (creates new chat with same settings)
router.post("/:conversationId/fork", async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { newTopic } = req.body;

    logger.info("Chat", "Forking chat", { conversationId, newTopic });

    const sourceChat = chatProcessManager.getChat(conversationId);
    if (!sourceChat) {
      return res.status(404).json({ error: "Source chat not found" });
    }

    // Generate new topic
    const forkTopic =
      newTopic || `${sourceChat.topic}-fork-${Date.now().toString(36)}`;

    // Create new chat with same settings
    const newChat = await chatProcessManager.createChat({
      projectPath: sourceChat.projectPath,
      tool: sourceChat.tool,
      topic: forkTopic,
      model: sourceChat.model,
      mode: sourceChat.mode,
    });

    logger.info("Chat", "Chat forked successfully", {
      sourceConversationId: conversationId,
      newConversationId: newChat.conversationId,
      tool: sourceChat.tool,
    });

    res.json({
      success: true,
      conversationId: newChat.conversationId,
      sourceConversationId: conversationId,
      tool: sourceChat.tool,
      topic: forkTopic,
      originalTopic: sourceChat.topic,
      projectPath: sourceChat.projectPath,
      message: "Chat forked successfully",
    });
  } catch (error) {
    logger.error("Chat", "Failed to fork chat", {
      errorMessage: error.message,
    });
    console.error("Error forking chat:", error);
    res.status(500).json({
      error: "Failed to fork chat",
      details: error.message,
    });
  }
});

// Upload files for a conversation (images, documents)
router.post("/:conversationId/upload", upload.array("files", 5), async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    // Check if conversation exists
    const chatInfo = chatProcessManager.getChat(conversationId);
    const persistedChat = await persistenceStore.getConversation(conversationId);

    if (!chatInfo && !persistedChat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    // Convert uploaded files to base64 and prepare attachment metadata
    const attachments = req.files.map((file) => {
      const base64Data = file.buffer.toString("base64");
      return {
        id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        base64Data,
      };
    });

    logger.info("Chat", "Files uploaded", {
      conversationId,
      fileCount: attachments.length,
      totalSize: attachments.reduce((sum, a) => sum + a.size, 0),
    });

    res.json({
      success: true,
      conversationId,
      attachments: attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      })),
    });
  } catch (error) {
    logger.error("Chat", "Failed to upload files", {
      errorMessage: error.message,
    });
    console.error("Error uploading files:", error);
    res.status(500).json({
      error: "Failed to upload files",
      details: error.message,
    });
  }
});

export { router as conversationRoutes };
