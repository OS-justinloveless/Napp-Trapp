import { spawn, execSync } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getCLIAdapter, getSupportedTools } from './CLIAdapter.js';
import { ChatPersistenceStore } from './ChatPersistenceStore.js';

/**
 * ChatProcessManager - Manages AI CLI chat processes with structured JSON output
 *
 * Unlike TmuxManager which uses terminal emulation, this manager:
 * - Spawns CLI processes directly with --output-format stream-json
 * - Parses structured JSON events from CLI output
 * - Sends clean content blocks to clients (no ANSI codes)
 * - Maintains conversation state for session resume
 */
class ChatProcessManager extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map();        // conversationId -> process info
    this.outputHandlers = new Map();   // conversationId -> Set<handler>
    this.messageBuffers = new Map();   // conversationId -> message history
    this.contentBlockIds = new Map();  // conversationId -> Map<index, blockId> for tracking streaming blocks
    this.pendingPermissions = new Map(); // conversationId -> Map<toolUseId, denial info> for permission denials awaiting user approval
    this.pendingNotifications = new Map(); // conversationId -> Array<session_end events> for delivery when client reconnects
    this.conversationCounter = 0;

    // Max messages to buffer per conversation
    this.maxBufferSize = 500;

    // Initialize persistence store
    this.persistenceStore = ChatPersistenceStore.getInstance();
    this.persistenceStore.init().catch(err => {
      console.error('[ChatProcessManager] Failed to initialize persistence store:', err);
    });
  }

  /**
   * Generate a unique conversation ID
   */
  generateConversationId() {
    return `chat-${Date.now()}-${++this.conversationCounter}`;
  }

  /**
   * Create a new chat session
   * @param {object} options - Chat options
   * @returns {object} - Chat session info
   */
  async createChat(options = {}) {
    const {
      projectPath,
      tool = 'claude',
      topic,
      model,
      mode = 'agent',
      permissionMode = 'default',
      sessionId,  // For resuming sessions
      initialPrompt,  // Optional initial message to send after CLI starts
    } = options;

    if (!projectPath) {
      throw new Error('projectPath is required');
    }

    // Validate tool
    const supportedTools = getSupportedTools();
    if (!supportedTools.includes(tool)) {
      throw new Error(`Unsupported tool: ${tool}. Supported: ${supportedTools.join(', ')}`);
    }

    const conversationId = this.generateConversationId();

    // Get CLI adapter and executable path
    const adapter = getCLIAdapter(tool);
    if (!adapter) {
      throw new Error(`No adapter found for tool: ${tool}`);
    }

    const cliPath = adapter.getExecutable();
    if (!cliPath) {
      throw new Error(`CLI not found for tool: ${tool}`);
    }

    // Build CLI arguments for JSON streaming output
    const args = this.buildCLIArgs(tool, {
      model,
      mode,
      permissionMode,
      sessionId,
      projectPath,
    });

    console.log(`[ChatProcessManager] Creating chat ${conversationId} with ${tool}: ${cliPath} ${args.join(' ')}`);

    // Store chat info (process will be spawned on first message or attach)
    const chatInfo = {
      id: conversationId,
      tool,
      cliPath,
      args,
      projectPath,
      topic: topic || `New ${tool} chat`,
      model,
      mode,
      sessionId,
      initialPrompt: initialPrompt || null,
      createdAt: Date.now(),
      process: null,
      status: 'created',  // created, running, suspended, ended
    };

    this.processes.set(conversationId, chatInfo);
    this.outputHandlers.set(conversationId, new Set());
    this.messageBuffers.set(conversationId, []);
    this.contentBlockIds.set(conversationId, new Map());  // Track block IDs by index for streaming
    this.pendingPermissions.set(conversationId, new Map()); // Track permission denials awaiting user approval

    // Save conversation to persistence store
    await this.persistenceStore.saveConversation({
      id: conversationId,
      tool,
      topic: chatInfo.topic,
      model,
      mode,
      projectPath,
      status: chatInfo.status,
      createdAt: chatInfo.createdAt,
      sessionId: chatInfo.sessionId || null,
    }).catch(err => {
      console.error(`[ChatProcessManager] Failed to save conversation ${conversationId}:`, err);
    });

    return {
      conversationId,
      tool,
      topic: chatInfo.topic,
      model,
      mode,
      projectPath,
      status: chatInfo.status,
    };
  }

  /**
   * Build CLI arguments for the specified tool
   */
  buildCLIArgs(tool, options = {}) {
    const { model, mode, permissionMode = 'default', sessionId, projectPath } = options;
    const args = [];

    switch (tool) {
      case 'claude':
        // Streaming JSON mode for bidirectional communication
        args.push('--print');
        args.push('--verbose');
        args.push('--output-format', 'stream-json');
        args.push('--input-format', 'stream-json');
        args.push('--include-partial-messages');
        args.push('--replay-user-messages');

        // Add model if specified
        if (model) {
          args.push('--model', model);
        }

        // Set permission mode based on what was requested
        // In 'plan' mode, default to 'plan' permission mode unless explicitly overridden
        if (mode === 'plan' && permissionMode === 'default') {
          args.push('--permission-mode', 'plan');
        } else {
          args.push('--permission-mode', permissionMode);
        }

        // Resume session if sessionId provided
        if (sessionId) {
          args.push('--resume', sessionId);
        }

        // Note: Working directory is set via spawn cwd option, not CLI flag
        break;

      case 'cursor-agent':
        // Cursor agent may have different flags
        if (model) args.push('--model', model);
        break;

      case 'gemini':
        // Gemini CLI flags
        if (model) args.push('--model', model);
        break;

      default:
        break;
    }

    return args;
  }

  /**
   * Start/attach to a chat process
   */
  async attachChat(conversationId, clientId) {
    const chatInfo = this.processes.get(conversationId);
    if (!chatInfo) {
      throw new Error(`Chat not found: ${conversationId}`);
    }

    // If process already running, just track the client
    if (chatInfo.process && chatInfo.status === 'running') {
      console.log(`[ChatProcessManager] Client ${clientId} attaching to existing chat ${conversationId}`);
      return {
        conversationId,
        status: 'running',
        tool: chatInfo.tool,
        bufferedMessages: this.messageBuffers.get(conversationId) || [],
      };
    }

    // Spawn the CLI process
    console.log(`[ChatProcessManager] Spawning ${chatInfo.tool} process for ${conversationId}`);

    const childProcess = spawn(chatInfo.cliPath, chatInfo.args, {
      cwd: chatInfo.projectPath,
      env: {
        ...globalThis.process.env,
        // Force non-interactive mode
        TERM: 'dumb',
        NO_COLOR: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    chatInfo.process = childProcess;
    chatInfo.status = 'running';
    chatInfo.pid = childProcess.pid;

    // If resuming a session, mark as replay phase so we don't duplicate
    // consolidated messages when the CLI replays previous turns via --resume
    if (chatInfo.sessionId) {
      chatInfo.replayPhase = true;
    }

    // Update status in persistence store
    await this.persistenceStore.updateConversationStatus(conversationId, 'running').catch(err => {
      console.error(`[ChatProcessManager] Failed to update conversation status:`, err);
    });

    // Handle stdout - parse JSON events
    let stdoutBuffer = '';
    childProcess.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();

      // Process complete JSON lines
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          this.handleCLIOutput(conversationId, line.trim());
        }
      }
    });

    // Handle stderr
    childProcess.stderr.on('data', (data) => {
      const errorText = data.toString();
      console.error(`[ChatProcessManager] stderr from ${conversationId}: ${errorText}`);
      this.notifyHandlers(conversationId, {
        id: `error-${Date.now()}`,
        type: 'error',
        conversationId,
        content: errorText,
        timestamp: Date.now(),
      });
    });

    // Handle process exit
    childProcess.on('exit', (code, signal) => {
      console.log(`[ChatProcessManager] Process ${conversationId} exited: code=${code}, signal=${signal}`);
      chatInfo.status = 'ended';
      chatInfo.exitCode = code;
      chatInfo.exitSignal = signal;

      // Update status in persistence store
      this.persistenceStore.updateConversationStatus(conversationId, 'ended').catch(err => {
        console.error(`[ChatProcessManager] Failed to update conversation status on exit:`, err);
      });

      this.notifyHandlers(conversationId, {
        id: `session_end-${Date.now()}`,
        type: 'session_end',
        conversationId,
        content: `Process ended with code ${code}`,
        timestamp: Date.now(),
        isTurnComplete: true, // Process exit is a final turn completion
      });
    });

    childProcess.on('error', (err) => {
      console.error(`[ChatProcessManager] Process error for ${conversationId}:`, err);
      chatInfo.status = 'error';

      this.notifyHandlers(conversationId, {
        id: `error-${Date.now()}`,
        type: 'error',
        conversationId,
        content: err.message,
        timestamp: Date.now(),
      });
    });

    // Send initial prompt after a short delay to let the CLI initialize
    if (chatInfo.initialPrompt) {
      const prompt = chatInfo.initialPrompt;
      chatInfo.initialPrompt = null; // Clear so it's not sent again on re-attach
      setTimeout(() => {
        try {
          if (chatInfo.process && chatInfo.status === 'running') {
            console.log(`[ChatProcessManager] Sending initial prompt for ${conversationId}: ${prompt.substring(0, 50)}...`);
            this.sendMessage(conversationId, prompt);
          }
        } catch (err) {
          console.error(`[ChatProcessManager] Failed to send initial prompt:`, err);
        }
      }, 1000);
    }

    return {
      conversationId,
      status: 'running',
      tool: chatInfo.tool,
      pid: childProcess.pid,
      bufferedMessages: this.messageBuffers.get(conversationId) || [],
    };
  }

  /**
   * Handle CLI output - parse JSON and transform to ContentBlock format
   */
  handleCLIOutput(conversationId, line) {
    try {
      const cliEvent = JSON.parse(line);

      // Debug: Log all tool-related events with full data
      if (cliEvent.type?.includes('tool') || cliEvent.type === 'result') {
        console.log(`[ChatProcessManager] TOOL EVENT from ${conversationId}:`, JSON.stringify(cliEvent, null, 2));
      }

      // Transform CLI event to our ContentBlock format
      const contentBlock = this.transformCLIEvent(conversationId, cliEvent);

      if (contentBlock) {
        // Buffer the message
        this.bufferMessage(conversationId, contentBlock);

        // Notify all handlers
        this.notifyHandlers(conversationId, contentBlock);

        console.log(`[ChatProcessManager] Event from ${conversationId}:`, contentBlock.type);
      } else {
        // Log filtered events for debugging
        const innerType = cliEvent.event?.type || '';
        console.log(`[ChatProcessManager] Filtered event from ${conversationId}: ${cliEvent.type}${innerType ? ' -> ' + innerType : ''}`);
      }
    } catch (err) {
      // Not valid JSON - might be plain text output
      console.log(`[ChatProcessManager] Non-JSON output from ${conversationId}: ${line.substring(0, 100)}`);

      // Send as text event
      const textEvent = {
        id: `text-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'text',
        conversationId,
        content: line,
        timestamp: Date.now(),
      };

      this.bufferMessage(conversationId, textEvent);
      this.notifyHandlers(conversationId, textEvent);
    }
  }

  /**
   * Capture session ID from a CLI event if present, and persist it
   * so we can use --resume on server restart.
   */
  captureSessionId(conversationId, cliEvent) {
    const sessionId = cliEvent.session_id || cliEvent.sessionId;
    if (!sessionId) return;

    const chatInfo = this.processes.get(conversationId);
    if (!chatInfo) return;

    // Only save if we don't already have this session ID
    if (chatInfo.sessionId === sessionId) return;

    chatInfo.sessionId = sessionId;

    // Rebuild CLI args so future process spawns will use --resume
    chatInfo.args = this.buildCLIArgs(chatInfo.tool, {
      model: chatInfo.model,
      mode: chatInfo.mode,
      sessionId: sessionId,
      projectPath: chatInfo.projectPath,
    });

    // Persist the session ID to the database
    this.persistenceStore.saveConversation({
      id: conversationId,
      tool: chatInfo.tool,
      topic: chatInfo.topic,
      model: chatInfo.model,
      mode: chatInfo.mode,
      projectPath: chatInfo.projectPath,
      status: chatInfo.status,
      createdAt: chatInfo.createdAt,
      sessionId: sessionId,
    }).catch(err => {
      console.error(`[ChatProcessManager] Failed to persist session ID:`, err);
    });

    console.log(`[ChatProcessManager] Captured session ID for ${conversationId}: ${sessionId}`);
  }

  /**
   * Transform Claude CLI JSON event to our ContentBlock format
   */
  transformCLIEvent(conversationId, cliEvent) {
    const id = `${cliEvent.type || 'event'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();

    // Try to capture session ID from any event that contains one
    this.captureSessionId(conversationId, cliEvent);

    // Handle different Claude CLI event types
    switch (cliEvent.type) {
      case 'assistant': {
        // Complete assistant message - save consolidated version to persistence store
        // but don't emit as a content block (already streamed via content_block_delta)
        const chatInfoForAssistant = this.processes.get(conversationId);

        // Skip saving during replay phase (resumed session replaying old messages)
        if (chatInfoForAssistant?.replayPhase) {
          console.log(`[ChatProcessManager] Skipping consolidated save for replayed assistant message in ${conversationId}`);
          return null;
        }

        const assistantContent = cliEvent.message?.content || cliEvent.content;
        if (assistantContent && Array.isArray(assistantContent)) {
          // Extract full text from content blocks
          const textParts = assistantContent
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('');

          if (textParts) {
            const consolidatedId = `assistant-consolidated-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
            this.persistenceStore.saveMessage(conversationId, {
              id: consolidatedId,
              type: 'text',
              role: 'assistant',
              content: textParts,
              timestamp,
              isPartial: false,
            }).catch(err => {
              console.error(`[ChatProcessManager] Failed to save consolidated assistant message:`, err);
            });
            console.log(`[ChatProcessManager] Saved consolidated assistant message (${textParts.length} chars) for ${conversationId}`);
          }

          // Also save tool_use blocks as consolidated entries
          for (const block of assistantContent) {
            if (block.type === 'tool_use') {
              const toolConsolidatedId = `tool-consolidated-${block.id || timestamp}-${Math.random().toString(36).substr(2, 9)}`;
              this.persistenceStore.saveMessage(conversationId, {
                id: toolConsolidatedId,
                type: 'tool_use_start',
                toolId: block.id,
                toolName: block.name,
                content: JSON.stringify(block.input || {}),
                timestamp,
                isPartial: false,
              }).catch(err => {
                console.error(`[ChatProcessManager] Failed to save consolidated tool_use message:`, err);
              });
            }
          }
        }
        return null;
      }

      case 'content_block_start': {
        // Start of a content block (text or tool_use)
        const blockIndex = cliEvent.index;
        const blockIdMap = this.contentBlockIds.get(conversationId);
        console.log(`[ChatProcessManager] content_block_start: index=${blockIndex}, type=${cliEvent.content_block?.type}, hasMap=${!!blockIdMap}`);

        if (cliEvent.content_block?.type === 'tool_use') {
          const blockId = cliEvent.content_block.id || id;
          // Track this block ID by index for later deltas
          if (blockIdMap && blockIndex !== undefined) {
            blockIdMap.set(blockIndex, blockId);
            console.log(`[ChatProcessManager] Stored block ID: index=${blockIndex} -> id=${blockId}`);
          }
          return {
            id: blockId,
            type: 'tool_use_start',
            conversationId,
            toolId: blockId,
            toolName: cliEvent.content_block.name,
            input: {},
            timestamp,
            isPartial: true,
          };
        } else if (cliEvent.content_block?.type === 'thinking') {
          const blockId = id;
          if (blockIdMap && blockIndex !== undefined) {
            blockIdMap.set(blockIndex, blockId);
          }
          return {
            id: blockId,
            type: 'thinking',
            conversationId,
            content: '',
            timestamp,
            isPartial: true,
          };
        } else if (cliEvent.content_block?.type === 'text') {
          const blockId = id;
          if (blockIdMap && blockIndex !== undefined) {
            blockIdMap.set(blockIndex, blockId);
          }
          // Don't emit anything for text block start - content comes in deltas
          return null;
        }
        break;
      }

      case 'content_block_delta': {
        // Incremental update to a content block
        // Look up the block ID by index so we can update the same block
        const blockIndex = cliEvent.index;
        const blockIdMap = this.contentBlockIds.get(conversationId);
        const trackedBlockId = blockIdMap?.get(blockIndex) || id;
        console.log(`[ChatProcessManager] content_block_delta: index=${blockIndex}, deltaType=${cliEvent.delta?.type}, trackedId=${trackedBlockId}, foundInMap=${blockIdMap?.has(blockIndex)}`);

        if (cliEvent.delta?.type === 'text_delta') {
          return {
            id: trackedBlockId,
            type: 'text',
            conversationId,
            content: cliEvent.delta.text,
            timestamp,
            isPartial: true,
          };
        } else if (cliEvent.delta?.type === 'thinking_delta') {
          return {
            id: trackedBlockId,
            type: 'thinking',
            conversationId,
            content: cliEvent.delta.thinking,
            timestamp,
            isPartial: true,
          };
        } else if (cliEvent.delta?.type === 'input_json_delta') {
          // Stream tool input JSON with the same block ID
          return {
            id: trackedBlockId,
            type: 'tool_use_start',
            conversationId,
            toolId: trackedBlockId,
            content: cliEvent.delta.partial_json,
            timestamp,
            isPartial: true,
          };
        }
        break;
      }

      case 'content_block_stop':
        // End of a content block - just a signal, no content to display
        return null;

      case 'tool_use':
        // Check if this is an AskUserQuestion tool - transform to question_prompt event
        if (cliEvent.name === 'AskUserQuestion') {
          console.log(`[ChatProcessManager] ASKUSERQUESTION TOOL USE:`, JSON.stringify(cliEvent, null, 2));

          // Extract questions array from tool input
          const questions = cliEvent.input?.questions || [];

          // Transform each question into our format
          const formattedQuestions = questions.map(q => ({
            question: q.question,
            header: q.header,
            options: q.options || [],
            multiSelect: q.multiSelect || false,
          }));

          return {
            id: cliEvent.id || id,
            type: 'question_prompt',
            conversationId,
            toolId: cliEvent.id,
            questions: formattedQuestions,
            timestamp,
          };
        }

        // Regular tool use event
        return {
          id: cliEvent.id || id,
          type: 'tool_use_start',
          conversationId,
          toolId: cliEvent.id,
          toolName: cliEvent.name,
          input: cliEvent.input,
          timestamp,
        };

      case 'tool_result':
        // Tool result event from API
        console.log(`[ChatProcessManager] TOOL_RESULT EVENT:`, JSON.stringify(cliEvent, null, 2));
        return {
          id: cliEvent.tool_use_id || id,
          type: 'tool_use_result',
          conversationId,
          toolId: cliEvent.tool_use_id,
          content: typeof cliEvent.content === 'string'
            ? cliEvent.content
            : JSON.stringify(cliEvent.content),
          isError: cliEvent.is_error,
          timestamp,
        };

      case 'tool_output':
        // Alternative event name for tool results
        console.log(`[ChatProcessManager] TOOL_OUTPUT EVENT:`, JSON.stringify(cliEvent, null, 2));
        return {
          id: cliEvent.tool_use_id || cliEvent.id || id,
          type: 'tool_use_result',
          conversationId,
          toolId: cliEvent.tool_use_id || cliEvent.id,
          content: typeof cliEvent.output === 'string'
            ? cliEvent.output
            : (typeof cliEvent.content === 'string' ? cliEvent.content : JSON.stringify(cliEvent.output || cliEvent.content)),
          isError: cliEvent.is_error || cliEvent.error,
          timestamp,
        };

      case 'message_start':
        // Just a signal that message is starting - filter out
        // The actual content will come in content_block_delta events
        return null;

      case 'message_stop':
        return {
          id,
          type: 'session_end',
          conversationId,
          content: cliEvent.stop_reason || 'completed',
          timestamp,
          isTurnComplete: false, // Intermediate message end, not final turn completion
        };

      case 'message_delta':
        // Usage information at end of message - filter out for now
        // The iOS client expects specific fields, not JSON string
        return null;

      case 'error':
        return {
          id,
          type: 'error',
          conversationId,
          content: cliEvent.error?.message || cliEvent.message || 'Unknown error',
          timestamp,
        };

      // Human/user messages - check if this is a tool result and save consolidated user messages
      case 'human':
      case 'user': {
        const chatInfoForUser = this.processes.get(conversationId);

        // Check if this contains tool results (nested in message.content)
        const messageContent = cliEvent.message?.content || cliEvent.content;
        let hasToolResult = false;
        let toolResultBlock = null;

        if (messageContent && Array.isArray(messageContent)) {
          // Only save consolidated messages if NOT in replay phase
          if (!chatInfoForUser?.replayPhase) {
            // Save consolidated user text messages to persistence store
            const userTextParts = messageContent
              .filter(item => item.type === 'text')
              .map(item => item.text)
              .join('');

            if (userTextParts) {
              const userConsolidatedId = `user-consolidated-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
              this.persistenceStore.saveMessage(conversationId, {
                id: userConsolidatedId,
                type: 'text',
                role: 'user',
                content: userTextParts,
                timestamp,
                isPartial: false,
              }).catch(err => {
                console.error(`[ChatProcessManager] Failed to save consolidated user message:`, err);
              });
              console.log(`[ChatProcessManager] Saved consolidated user message (${userTextParts.length} chars) for ${conversationId}`);
            }

            // Also save tool results as consolidated entries
            for (const item of messageContent) {
              if (item.type === 'tool_result') {
                console.log(`[ChatProcessManager] FOUND TOOL RESULT:`, item.tool_use_id, `content length: ${item.content?.length || 0}`);

                // Save consolidated tool result
                const toolResultConsolidatedId = `tool-result-consolidated-${item.tool_use_id || timestamp}-${Math.random().toString(36).substr(2, 9)}`;
                this.persistenceStore.saveMessage(conversationId, {
                  id: toolResultConsolidatedId,
                  type: 'tool_use_result',
                  toolId: item.tool_use_id,
                  content: typeof item.content === 'string'
                    ? item.content
                    : JSON.stringify(item.content),
                  isError: item.is_error || false,
                  timestamp,
                  isPartial: false,
                }).catch(err => {
                  console.error(`[ChatProcessManager] Failed to save consolidated tool result:`, err);
                });

                if (!hasToolResult) {
                  hasToolResult = true;
                  toolResultBlock = {
                    id: item.tool_use_id || id,
                    type: 'tool_use_result',
                    conversationId,
                    toolId: item.tool_use_id,
                    content: typeof item.content === 'string'
                      ? item.content
                      : JSON.stringify(item.content),
                    isError: item.is_error,
                    timestamp,
                  };
                }
              }
            }
          } else {
            console.log(`[ChatProcessManager] Skipping consolidated save for replayed user message in ${conversationId}`);

            // Still extract tool results for live streaming even during replay
            for (const item of messageContent) {
              if (item.type === 'tool_result' && !hasToolResult) {
                hasToolResult = true;
                toolResultBlock = {
                  id: item.tool_use_id || id,
                  type: 'tool_use_result',
                  conversationId,
                  toolId: item.tool_use_id,
                  content: typeof item.content === 'string'
                    ? item.content
                    : JSON.stringify(item.content),
                  isError: item.is_error,
                  timestamp,
                };
              }
            }
          }
        }

        // Return the first tool result block for live streaming (if any)
        if (hasToolResult && toolResultBlock) {
          return toolResultBlock;
        }
        // Filter out regular user messages (replay of user input) from live streaming
        return null;
      }

      // System events (hooks, init, etc.) - check for tool results and permission requests
      case 'system':
        // Log full system event to see what's available
        console.log(`[ChatProcessManager] SYSTEM EVENT:`, JSON.stringify(cliEvent, null, 2));
        // Check if this is a permission/approval related system event
        if (cliEvent.subtype === 'permission_request' || cliEvent.subtype === 'approval_request') {
          return {
            id,
            type: 'approval_request',
            conversationId,
            prompt: cliEvent.message || cliEvent.description || 'Permission required',
            action: cliEvent.action || 'generic',
            toolName: cliEvent.tool_name || cliEvent.toolName,
            timestamp,
          };
        }
        return null;

      // Permission / input request events from Claude CLI
      case 'input_request':
      case 'permission_request':
      case 'permission_prompt': {
        console.log(`[ChatProcessManager] PERMISSION REQUEST EVENT:`, JSON.stringify(cliEvent, null, 2));
        return {
          id,
          type: 'approval_request',
          conversationId,
          prompt: cliEvent.message || cliEvent.prompt || cliEvent.description || 'Permission required',
          action: cliEvent.action || cliEvent.permission_type || 'generic',
          toolName: cliEvent.tool_name || cliEvent.toolName || cliEvent.tool,
          toolId: cliEvent.tool_use_id || cliEvent.id,
          timestamp,
        };
      }

      // Stream event wrapper - unwrap and process inner event
      case 'stream_event':
        if (cliEvent.event) {
          console.log(`[ChatProcessManager] Unwrapping stream_event -> ${cliEvent.event.type}, index=${cliEvent.event.index}`);
          // Recursively process the inner event
          return this.transformCLIEvent(conversationId, cliEvent.event);
        }
        return null;

      // Result event - signals turn completion. Check for permission_denials.
      case 'result':
        console.log(`[ChatProcessManager] RESULT EVENT FULL:`, JSON.stringify(cliEvent, null, 2));

        // Check for permission_denials -- the CLI auto-denied tool calls and
        // reports them here.  Emit approval_request blocks so the iOS client
        // can prompt the user, then store the denial details so sendApproval
        // can execute the tool on the user's behalf if approved.
        if (cliEvent.permission_denials && Array.isArray(cliEvent.permission_denials) && cliEvent.permission_denials.length > 0) {
          console.log(`[ChatProcessManager] Found ${cliEvent.permission_denials.length} permission denials in result`);

          const permMap = this.pendingPermissions.get(conversationId);

          for (const denial of cliEvent.permission_denials) {
            const denialId = denial.tool_use_id || `denial-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Store for later execution if user approves
            if (permMap) {
              permMap.set(denialId, denial);
            }

            // Build a human-readable prompt from the tool input
            let prompt = `Permission required to use ${denial.tool_name}`;
            if (denial.tool_name === 'Edit' && denial.tool_input?.file_path) {
              prompt = `Edit file: ${denial.tool_input.file_path}`;
            } else if (denial.tool_name === 'Write' && denial.tool_input?.file_path) {
              prompt = `Write file: ${denial.tool_input.file_path}`;
            } else if ((denial.tool_name === 'Bash' || denial.tool_name === 'shell') && denial.tool_input?.command) {
              const cmd = denial.tool_input.command;
              prompt = `Run command: ${cmd.length > 80 ? cmd.substring(0, 80) + '...' : cmd}`;
            }

            const approvalBlock = {
              id: denialId,
              type: 'approval_request',
              conversationId,
              prompt,
              action: denial.tool_name,
              toolName: denial.tool_name,
              toolId: denialId,
              timestamp,
            };

            // Emit each approval request directly (transformCLIEvent can only return one block)
            this.bufferMessage(conversationId, approvalBlock);
            this.notifyHandlers(conversationId, approvalBlock);
            console.log(`[ChatProcessManager] Emitted approval_request for ${denial.tool_name} (${denialId})`);
          }

          // Do NOT emit session_end when there are pending approvals --
          // the conversation should stay "alive" so the user can respond.
          return null;
        }

        // Check if this result contains tool execution info
        if (cliEvent.subtype === 'success' && cliEvent.result) {
          console.log(`[ChatProcessManager] Result content:`, cliEvent.result);
        }

        // Normal completion -- emit session_end
        return {
          id,
          type: 'session_end',
          conversationId,
          content: 'Turn completed',
          timestamp,
          isTurnComplete: true, // Final turn completion from result event
        };

      default:
        // Log ALL unknown events with full data for debugging permission flow
        console.log(`[ChatProcessManager] UNKNOWN EVENT TYPE '${cliEvent.type}':`, JSON.stringify(cliEvent, null, 2));

        // Check if unknown event looks like a permission/approval request
        // by examining common fields that indicate the CLI is waiting for user input
        if (cliEvent.permission || cliEvent.approval || cliEvent.requires_approval ||
            cliEvent.waiting_for_input || cliEvent.input_required) {
          console.log(`[ChatProcessManager] Detected permission-like fields in unknown event`);
          return {
            id,
            type: 'approval_request',
            conversationId,
            prompt: cliEvent.message || cliEvent.prompt || cliEvent.description || 'Permission required',
            action: cliEvent.action || 'generic',
            toolName: cliEvent.tool_name || cliEvent.toolName || cliEvent.tool,
            toolId: cliEvent.tool_use_id || cliEvent.id,
            timestamp,
          };
        }

        return {
          id,
          type: 'raw',
          conversationId,
          content: JSON.stringify(cliEvent),
          timestamp,
        };
    }

    return null;
  }

  /**
   * Buffer a message for reconnection support
   */
  bufferMessage(conversationId, message) {
    const buffer = this.messageBuffers.get(conversationId);
    if (buffer) {
      buffer.push(message);
      // Trim to max size
      while (buffer.length > this.maxBufferSize) {
        buffer.shift();
      }
    }

    // Save ALL messages to persistence store (including partial/streaming)
    this.persistenceStore.saveMessage(conversationId, message).catch(err => {
      console.error(`[ChatProcessManager] Failed to save message to persistence:`, err);
    });
  }

  /**
   * Notify all handlers for a conversation.
   * If a session_end event has no handlers to deliver to, store it as a
   * pending notification so it can be sent when a client reconnects.
   */
  notifyHandlers(conversationId, event) {
    const handlers = this.outputHandlers.get(conversationId);
    let delivered = false;

    if (handlers && handlers.size > 0) {
      for (const handler of handlers) {
        try {
          handler(event);
          delivered = true;
        } catch (err) {
          console.error(`[ChatProcessManager] Handler error:`, err);
        }
      }
    }

    // If this is a session_end event and nobody received it, store it
    // so a reconnecting client can pick it up later.
    if (event.type === 'session_end' && !delivered) {
      // Enrich the event with the chat topic so notifications can display it
      const chatInfo = this.processes.get(conversationId);
      const enrichedEvent = {
        ...event,
        topic: chatInfo?.topic || null,
      };

      if (!this.pendingNotifications.has(conversationId)) {
        this.pendingNotifications.set(conversationId, []);
      }
      this.pendingNotifications.get(conversationId).push(enrichedEvent);
      console.log(`[ChatProcessManager] Stored pending session_end notification for ${conversationId} (topic: ${enrichedEvent.topic || 'none'}, no connected handlers)`);
    }
  }

  /**
   * Get and clear all pending notifications (session_end events that had no
   * connected handler when they fired). Called when a client reconnects.
   */
  getPendingNotifications() {
    const all = new Map(this.pendingNotifications);
    this.pendingNotifications.clear();
    return all;
  }

  /**
   * Get and clear pending notifications for a specific conversation.
   */
  getPendingNotificationsFor(conversationId) {
    const pending = this.pendingNotifications.get(conversationId) || [];
    this.pendingNotifications.delete(conversationId);
    return pending;
  }

  /**
   * Add output handler for a conversation
   */
  addOutputHandler(conversationId, handler) {
    const handlers = this.outputHandlers.get(conversationId);
    if (handlers) {
      handlers.add(handler);
      console.log(`[ChatProcessManager] Added handler for ${conversationId}, total: ${handlers.size}`);
    }
  }

  /**
   * Remove output handler
   */
  removeOutputHandler(conversationId, handler) {
    const handlers = this.outputHandlers.get(conversationId);
    if (handlers) {
      handlers.delete(handler);
      console.log(`[ChatProcessManager] Removed handler for ${conversationId}, remaining: ${handlers.size}`);
    }
  }

  /**
   * Generate a short topic string from a user message.
   * Used to auto-set the topic on the first user message.
   * Uses the configured CLI agent (claude, cursor-agent, etc.) to generate a concise 2-3 word topic.
   */
  async generateTopicFromMessage(message, tool = 'claude') {
    try {
      // Get CLI adapter and executable path
      const adapter = getCLIAdapter(tool);
      if (!adapter) {
        console.log(`[ChatProcessManager] No adapter found for tool: ${tool}, using fallback`);
        return this.fallbackTopicGeneration(message);
      }

      const cliPath = adapter.getExecutable();
      if (!cliPath) {
        console.log(`[ChatProcessManager] CLI not found for tool: ${tool}, using fallback`);
        return this.fallbackTopicGeneration(message);
      }

      // Spawn a quick CLI process to generate the topic
      const prompt = `Generate a very short (2-3 words) topic title for this message. Only respond with the topic title, nothing else:\n\n${message.substring(0, 500)}`;

      // Use --print with the prompt as an argument for non-interactive execution
      const args = ['--print', '--model', 'haiku', prompt];

      console.log(`[ChatProcessManager] Generating topic using ${tool} CLI`);

      const result = await new Promise((resolve, reject) => {
        let resolved = false;
        const childProcess = spawn(cliPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        childProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        childProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        childProcess.on('close', (code) => {
          if (resolved) return;
          resolved = true;

          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(`CLI exited with code ${code}: ${stderr}`));
          }
        });

        childProcess.on('error', (err) => {
          if (resolved) return;
          resolved = true;
          reject(err);
        });

        // Timeout after 15 seconds
        const timeout = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          childProcess.kill('SIGTERM');
          reject(new Error('Topic generation timeout'));
        }, 15000);

        // Clear timeout if process completes
        childProcess.on('close', () => clearTimeout(timeout));
      });

      // Extract the topic from the response
      let topic = result.trim();

      // Clean up markdown formatting if present
      topic = topic.replace(/^#+\s*/, ''); // Remove markdown headers
      topic = topic.replace(/\*\*/g, ''); // Remove bold markers
      topic = topic.replace(/\n.*$/s, ''); // Take only first line

      // Clean up quotes if AI added them
      if ((topic.startsWith('"') && topic.endsWith('"')) ||
          (topic.startsWith("'") && topic.endsWith("'"))) {
        topic = topic.slice(1, -1).trim();
      }

      // Ensure it's not too long (max 50 chars)
      if (topic.length > 50) {
        const truncated = topic.substring(0, 47);
        const lastSpace = truncated.lastIndexOf(' ');
        topic = lastSpace > 20 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
      }

      // If the result is empty or too short, fall back
      if (!topic || topic.length < 2) {
        console.log(`[ChatProcessManager] Generated topic too short, using fallback`);
        return this.fallbackTopicGeneration(message);
      }

      console.log(`[ChatProcessManager] AI-generated topic: "${topic}" from message: "${message.substring(0, 50)}..."`);
      return topic;
    } catch (error) {
      console.error(`[ChatProcessManager] Failed to generate AI topic, falling back to truncation:`, error.message);
      return this.fallbackTopicGeneration(message);
    }
  }

  /**
   * Fallback topic generation when AI is not available
   */
  fallbackTopicGeneration(message) {
    // Fallback: truncate the message
    let topic = message.replace(/\s+/g, ' ').trim();
    if ((topic.startsWith('"') && topic.endsWith('"')) ||
        (topic.startsWith("'") && topic.endsWith("'"))) {
      topic = topic.slice(1, -1).trim();
    }

    const maxLength = 60;
    if (topic.length <= maxLength) {
      return topic;
    }

    const truncated = topic.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.4) {
      return truncated.substring(0, lastSpace) + '...';
    }

    return truncated + '...';
  }

  /**
   * Send a message to the chat
   * @param {string} conversationId - The conversation ID
   * @param {string|object} content - Text content or message object with attachments
   * @param {Array} [attachments] - Optional array of attachment objects with {mimeType, base64Data, filename}
   */
  async sendMessage(conversationId, content, attachments = null) {
    const chatInfo = this.processes.get(conversationId);
    if (!chatInfo) {
      throw new Error(`Chat not found: ${conversationId}`);
    }

    if (!chatInfo.process || chatInfo.status !== 'running') {
      throw new Error(`Chat process not running: ${conversationId}`);
    }

    const textContent = typeof content === 'string' ? content : content.text || '';
    console.log(`[ChatProcessManager] Sending message to ${conversationId}: ${textContent.substring(0, 50)}...`);

    // End replay phase -- user is sending a new message, so any subsequent
    // assistant/user events from the CLI are NEW, not replayed history
    if (chatInfo.replayPhase) {
      console.log(`[ChatProcessManager] Ending replay phase for ${conversationId} (user sent new message)`);
      chatInfo.replayPhase = false;
    }

    // Auto-generate topic from the first user message if topic is still the default
    const defaultTopicPattern = /^New \w+ chat$/;
    if (defaultTopicPattern.test(chatInfo.topic) && !chatInfo.topicAutoGenerated) {
      // Generate topic asynchronously (don't await to avoid blocking message send)
      this.generateTopicFromMessage(content, chatInfo.tool).then(newTopic => {
        if (newTopic) {
          const oldTopic = chatInfo.topic;
          chatInfo.topic = newTopic;
          chatInfo.topicAutoGenerated = true;

          console.log(`[ChatProcessManager] Auto-generated topic for ${conversationId}: "${oldTopic}" -> "${newTopic}"`);

          // Update in persistence store
          this.persistenceStore.updateConversationTopic(conversationId, newTopic).catch(err => {
            console.error(`[ChatProcessManager] Failed to update auto-generated topic:`, err);
          });

          // Notify connected clients about the topic change
          this.notifyHandlers(conversationId, {
            id: `topic-updated-${Date.now()}`,
            type: 'topic_updated',
            conversationId,
            topic: newTopic,
            timestamp: Date.now(),
          });
        }
      }).catch(err => {
        console.error(`[ChatProcessManager] Error during topic generation:`, err);
      });
    }

    // Build content array with text and optional attachments
    const contentBlocks = [{ type: 'text', text: textContent }];

    // Add image/document attachments if provided
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      for (const attachment of attachments) {
        // Check if it's an image
        if (attachment.mimeType && attachment.mimeType.startsWith('image/')) {
          contentBlocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: attachment.mimeType,
              data: attachment.base64Data
            }
          });
          console.log(`[ChatProcessManager] Added image attachment: ${attachment.filename} (${attachment.mimeType})`);
        } else {
          // For non-image files, include them as text content blocks
          // The CLI will handle them appropriately
          const fileInfo = `[Attached file: ${attachment.filename} (${attachment.mimeType}, ${attachment.size} bytes)]`;
          contentBlocks[0].text += `\n\n${fileInfo}`;
          console.log(`[ChatProcessManager] Added file reference: ${attachment.filename}`);
        }
      }
    }

    // For stream-json input format, send JSON object with message wrapper
    // Claude CLI expects: {"type": "user", "message": {"role": "user", "content": [...]}}
    const inputMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: contentBlocks
      }
    });

    chatInfo.process.stdin.write(inputMessage + '\n');

    // Buffer the user message so it appears in chat history on reconnect
    this.bufferMessage(conversationId, {
      id: `user-${Date.now()}`,
      type: 'text',
      role: 'user',
      conversationId,
      content: textContent,
      timestamp: Date.now(),
    });

    return { success: true, messageId: Date.now().toString() };
  }

  /**
   * Send approval response for a permission-denied tool call.
   *
   * Because Claude CLI in --permission-mode default auto-denies tool calls
   * (reporting them in the result event's permission_denials array), we
   * cannot simply ask the CLI to retry.  Instead we:
   *   1. Look up the denied tool call details from pendingPermissions
   *   2. If approved, execute the tool action ourselves on the server
   *   3. Send a follow-up message to Claude telling it the action succeeded/failed
   *   4. If rejected, inform Claude that the user declined
   *
   * @param {string} conversationId
   * @param {boolean} approved
   * @param {string} [toolUseId] - specific denied tool call to approve (optional; approves first pending if omitted)
   */
  async sendApproval(conversationId, approved, toolUseId) {
    const chatInfo = this.processes.get(conversationId);
    if (!chatInfo) {
      throw new Error(`Chat not found: ${conversationId}`);
    }

    const permMap = this.pendingPermissions.get(conversationId);
    if (!permMap || permMap.size === 0) {
      console.log(`[ChatProcessManager] No pending permissions for ${conversationId}, ignoring approval`);
      return { success: false, message: 'No pending permissions' };
    }

    // Find the specific denial, or take the first pending one
    let denialKey = toolUseId;
    if (!denialKey) {
      denialKey = permMap.keys().next().value;
    }
    const denial = permMap.get(denialKey);
    if (!denial) {
      console.log(`[ChatProcessManager] No pending permission found for toolUseId ${toolUseId}`);
      return { success: false, message: 'Permission not found' };
    }

    // Remove from pending
    permMap.delete(denialKey);

    console.log(`[ChatProcessManager] Processing approval (${approved}) for ${denial.tool_name} (${denialKey})`);

    if (approved) {
      // Execute the denied tool action directly
      const result = await this.executeDeniedTool(denial, chatInfo.projectPath);

      // Notify the client about the result
      const resultBlock = {
        id: `tool-result-${Date.now()}`,
        type: 'tool_use_result',
        conversationId,
        toolId: denialKey,
        content: result.success ? (result.output || 'Action completed successfully') : (result.error || 'Action failed'),
        isError: !result.success,
        timestamp: Date.now(),
      };
      this.bufferMessage(conversationId, resultBlock);
      this.notifyHandlers(conversationId, resultBlock);

      // Send a follow-up message to Claude so it knows the action was taken
      if (chatInfo.process && chatInfo.status === 'running') {
        const followUp = result.success
          ? `The user approved the ${denial.tool_name} action and it was executed successfully. ${result.output ? 'Output: ' + result.output.substring(0, 500) : 'Please continue.'}`
          : `The user approved the ${denial.tool_name} action but it failed: ${result.error}`;
        try {
          await this.sendMessage(conversationId, followUp);
        } catch (err) {
          console.error(`[ChatProcessManager] Failed to send follow-up message:`, err);
        }
      }
    } else {
      // User rejected - tell Claude
      const rejectionBlock = {
        id: `rejection-${Date.now()}`,
        type: 'tool_use_result',
        conversationId,
        toolId: denialKey,
        content: `User rejected the ${denial.tool_name} action`,
        isError: true,
        timestamp: Date.now(),
      };
      this.bufferMessage(conversationId, rejectionBlock);
      this.notifyHandlers(conversationId, rejectionBlock);

      if (chatInfo.process && chatInfo.status === 'running') {
        try {
          await this.sendMessage(conversationId, `The user rejected the ${denial.tool_name} action. Please suggest an alternative approach or ask what they would like to do instead.`);
        } catch (err) {
          console.error(`[ChatProcessManager] Failed to send rejection message:`, err);
        }
      }
    }

    // If no more pending permissions, emit session_end
    if (permMap.size === 0) {
      const endBlock = {
        id: `session_end-${Date.now()}`,
        type: 'session_end',
        conversationId,
        content: 'Turn completed',
        timestamp: Date.now(),
        isTurnComplete: true, // All permissions resolved, turn is complete
      };
      this.bufferMessage(conversationId, endBlock);
      this.notifyHandlers(conversationId, endBlock);
    }

    return { success: true };
  }

  /**
   * Execute a denied tool call on behalf of the user.
   * Supports Edit, Write, and Bash tools.
   */
  async executeDeniedTool(denial, projectPath) {
    const { tool_name, tool_input } = denial;

    console.log(`[ChatProcessManager] Executing denied tool: ${tool_name}`, JSON.stringify(tool_input, null, 2));

    try {
      switch (tool_name) {
        case 'Edit': {
          // Edit uses old_string/new_string replacement
          const filePath = tool_input.file_path;
          if (!filePath) {
            return { success: false, error: 'No file_path provided' };
          }

          const content = fs.readFileSync(filePath, 'utf8');
          const oldStr = tool_input.old_string;
          const newStr = tool_input.new_string;

          if (!content.includes(oldStr)) {
            return { success: false, error: `old_string not found in ${filePath}` };
          }

          let updatedContent;
          if (tool_input.replace_all) {
            updatedContent = content.split(oldStr).join(newStr);
          } else {
            updatedContent = content.replace(oldStr, newStr);
          }

          fs.writeFileSync(filePath, updatedContent, 'utf8');
          console.log(`[ChatProcessManager] Successfully edited ${filePath}`);
          return { success: true, output: `File edited: ${filePath}` };
        }

        case 'Write': {
          const filePath = tool_input.file_path;
          const fileContent = tool_input.content;
          if (!filePath || fileContent === undefined) {
            return { success: false, error: 'file_path and content required' };
          }

          // Ensure parent directory exists
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          fs.writeFileSync(filePath, fileContent, 'utf8');
          console.log(`[ChatProcessManager] Successfully wrote ${filePath}`);
          return { success: true, output: `File written: ${filePath}` };
        }

        case 'Bash':
        case 'shell': {
          const command = tool_input.command;
          if (!command) {
            return { success: false, error: 'No command provided' };
          }

          // Execute the command synchronously with a timeout
          try {
            const output = execSync(command, {
              cwd: projectPath,
              timeout: 30000,
              maxBuffer: 1024 * 1024,
              encoding: 'utf8',
            });
            console.log(`[ChatProcessManager] Command executed successfully: ${command.substring(0, 50)}`);
            return { success: true, output: output.substring(0, 2000) };
          } catch (cmdErr) {
            return { success: false, error: `Command failed: ${cmdErr.message}` };
          }
        }

        default:
          return { success: false, error: `Unsupported tool: ${tool_name}` };
      }
    } catch (err) {
      console.error(`[ChatProcessManager] Error executing denied tool:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Send question answer(s) back to the Claude CLI for AskUserQuestion tool
   * @param {string} conversationId
   * @param {string} toolUseId - The tool use ID from the question_prompt event
   * @param {object} answers - Map of question IDs to selected answer(s)
   */
  async sendQuestionAnswer(conversationId, toolUseId, answers) {
    const chatInfo = this.processes.get(conversationId);
    if (!chatInfo) {
      throw new Error(`Chat not found: ${conversationId}`);
    }

    if (!chatInfo.process || chatInfo.status !== 'running') {
      throw new Error(`Chat process not running: ${conversationId}`);
    }

    console.log(`[ChatProcessManager] Sending question answer for tool ${toolUseId}:`, JSON.stringify(answers, null, 2));

    // Send tool result back to CLI with the answers
    // The CLI expects a tool_result message for the AskUserQuestion tool
    const toolResult = JSON.stringify({
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: JSON.stringify({ answers }),
    });

    chatInfo.process.stdin.write(toolResult + '\n');

    // Notify clients that the question was answered
    const answerBlock = {
      id: `question-answered-${Date.now()}`,
      type: 'question_answered',
      conversationId,
      toolId: toolUseId,
      answers,
      timestamp: Date.now(),
    };
    this.bufferMessage(conversationId, answerBlock);
    this.notifyHandlers(conversationId, answerBlock);

    return { success: true };
  }

  /**
   * Cancel/interrupt the chat (Ctrl+C equivalent)
   */
  async cancelChat(conversationId) {
    const chatInfo = this.processes.get(conversationId);
    if (!chatInfo || !chatInfo.process) {
      throw new Error(`Chat not found or not running: ${conversationId}`);
    }

    console.log(`[ChatProcessManager] Cancelling chat ${conversationId}`);

    // Send SIGINT
    chatInfo.process.kill('SIGINT');

    this.notifyHandlers(conversationId, {
      type: 'cancelled',
      conversationId,
      timestamp: Date.now(),
    });

    return { success: true };
  }

  /**
   * Close/end a chat session
   */
  async closeChat(conversationId) {
    const chatInfo = this.processes.get(conversationId);
    if (!chatInfo) {
      return { success: true, message: 'Chat not found' };
    }

    console.log(`[ChatProcessManager] Closing chat ${conversationId}`);

    // Update status in persistence store
    await this.persistenceStore.updateConversationStatus(conversationId, 'ended').catch(err => {
      console.error(`[ChatProcessManager] Failed to update conversation status on close:`, err);
    });

    // Kill process if running
    if (chatInfo.process) {
      chatInfo.process.kill('SIGTERM');
    }

    // Cleanup
    this.processes.delete(conversationId);
    this.outputHandlers.delete(conversationId);
    this.messageBuffers.delete(conversationId);
    this.contentBlockIds.delete(conversationId);
    this.pendingPermissions.delete(conversationId);

    return { success: true };
  }

  /**
   * List all active chats
   */
  listChats(projectPath = null) {
    const chats = [];

    for (const [id, info] of this.processes) {
      if (!projectPath || info.projectPath === projectPath) {
        chats.push({
          id,
          conversationId: id,
          tool: info.tool,
          topic: info.topic,
          model: info.model,
          mode: info.mode,
          projectPath: info.projectPath,
          status: info.status,
          createdAt: info.createdAt,
          pid: info.pid,
        });
      }
    }

    return chats;
  }

  /**
   * Get chat info
   */
  getChat(conversationId) {
    return this.processes.get(conversationId);
  }

  /**
   * Get buffered messages for a conversation
   */
  getBufferedMessages(conversationId) {
    return this.messageBuffers.get(conversationId) || [];
  }

  /**
   * Check if a conversation exists
   */
  hasChat(conversationId) {
    return this.processes.has(conversationId);
  }

  /**
   * Check if a mode switch is needed for a conversation
   */
  needsModeSwitch(conversationId, newMode) {
    const chatInfo = this.processes.get(conversationId);
    if (!chatInfo) {
      return false;
    }

    // Check if the requested mode is different from the current mode
    return chatInfo.mode !== newMode;
  }

  /**
   * Switch the mode of a running chat session
   * This kills the current process and restarts it with the new permission mode
   */
  async switchMode(conversationId, newMode) {
    const chatInfo = this.processes.get(conversationId);
    if (!chatInfo) {
      throw new Error(`Chat not found: ${conversationId}`);
    }

    console.log(`[ChatProcessManager] Switching mode for ${conversationId} from ${chatInfo.mode} to ${newMode}`);

    // Store current state
    const oldMode = chatInfo.mode;
    const wasRunning = chatInfo.process && chatInfo.status === 'running';

    // Kill the current process if running
    if (chatInfo.process) {
      console.log(`[ChatProcessManager] Killing current process for mode switch`);
      chatInfo.process.kill('SIGTERM');
      chatInfo.process = null;
    }

    // Update mode and rebuild CLI args
    chatInfo.mode = newMode;
    chatInfo.args = this.buildCLIArgs(chatInfo.tool, {
      model: chatInfo.model,
      mode: newMode,
      sessionId: chatInfo.sessionId,
      projectPath: chatInfo.projectPath,
    });

    // Notify handlers about the mode switch
    this.notifyHandlers(conversationId, {
      id: `mode-switch-${Date.now()}`,
      type: 'system',
      conversationId,
      content: `Mode switched from ${oldMode} to ${newMode}`,
      timestamp: Date.now(),
    });

    // If the process was running, restart it
    if (wasRunning) {
      console.log(`[ChatProcessManager] Restarting process with new mode: ${newMode}`);
      chatInfo.status = 'created';

      // Attach will spawn a new process
      try {
        await this.attachChat(conversationId, 'system');
        console.log(`[ChatProcessManager] Successfully restarted chat with mode: ${newMode}`);
      } catch (error) {
        console.error(`[ChatProcessManager] Failed to restart chat after mode switch:`, error);
        throw new Error(`Failed to restart chat with new mode: ${error.message}`);
      }
    }

    return { success: true, oldMode, newMode };
  }

  /**
   * Check if a mode switch is needed for a conversation
   */
  needsModeSwitch(conversationId, newMode) {
    const chatInfo = this.processes.get(conversationId);
    if (!chatInfo) {
      return false;
    }

    // Check if the requested mode is different from the current mode
    return chatInfo.mode !== newMode;
  }

  /**
   * Switch the mode of a running chat session
   * This kills the current process and restarts it with the new permission mode
   */
  async switchMode(conversationId, newMode) {
    const chatInfo = this.processes.get(conversationId);
    if (!chatInfo) {
      throw new Error(`Chat not found: ${conversationId}`);
    }

    console.log(`[ChatProcessManager] Switching mode for ${conversationId} from ${chatInfo.mode} to ${newMode}`);

    // Store current state
    const oldMode = chatInfo.mode;
    const wasRunning = chatInfo.process && chatInfo.status === 'running';

    // Kill the current process if running
    if (chatInfo.process) {
      console.log(`[ChatProcessManager] Killing current process for mode switch`);
      chatInfo.process.kill('SIGTERM');
      chatInfo.process = null;
    }

    // Update mode and rebuild CLI args
    chatInfo.mode = newMode;
    chatInfo.args = this.buildCLIArgs(chatInfo.tool, {
      model: chatInfo.model,
      mode: newMode,
      sessionId: chatInfo.sessionId,
      projectPath: chatInfo.projectPath,
    });

    // Notify handlers about the mode switch
    this.notifyHandlers(conversationId, {
      id: `mode-switch-${Date.now()}`,
      type: 'system',
      conversationId,
      content: `Mode switched from ${oldMode} to ${newMode}`,
      timestamp: Date.now(),
    });

    // If the process was running, restart it
    if (wasRunning) {
      console.log(`[ChatProcessManager] Restarting process with new mode: ${newMode}`);
      chatInfo.status = 'created';

      // Attach will spawn a new process
      try {
        await this.attachChat(conversationId, 'system');
        console.log(`[ChatProcessManager] Successfully restarted chat with mode: ${newMode}`);
      } catch (error) {
        console.error(`[ChatProcessManager] Failed to restart chat after mode switch:`, error);
        throw new Error(`Failed to restart chat with new mode: ${error.message}`);
      }
    }

    return { success: true, oldMode, newMode };
  }

  /**
   * Load persisted conversations on startup
   * Restores conversation metadata into this.processes so they can be re-attached
   */
  async loadPersistedConversations() {
    try {
      const conversations = await this.persistenceStore.getAllConversations();
      console.log(`[ChatProcessManager] Loading ${conversations.length} persisted conversations`);

      for (const conv of conversations) {
        // Don't load ended conversations
        if (conv.status === 'ended') {
          continue;
        }

        // Mark running conversations as suspended (they're not actually running after restart)
        if (conv.status === 'running' || conv.status === 'created') {
          await this.persistenceStore.updateConversationStatus(conv.id, 'suspended');
          conv.status = 'suspended';
        }

        // Restore conversation into the in-memory processes Map so it can be re-attached
        try {
          const adapter = getCLIAdapter(conv.tool);
          const cliPath = adapter ? adapter.getExecutable() : null;

          if (cliPath) {
            const args = this.buildCLIArgs(conv.tool, {
              model: conv.model,
              mode: conv.mode,
              sessionId: conv.sessionId,
              projectPath: conv.projectPath,
            });

            const chatInfo = {
              id: conv.id,
              tool: conv.tool,
              cliPath,
              args,
              projectPath: conv.projectPath,
              topic: conv.topic,
              model: conv.model,
              mode: conv.mode,
              sessionId: conv.sessionId,
              initialPrompt: null,
              createdAt: conv.createdAt,
              process: null,
              status: conv.status,
              // Mark as in replay phase so we don't duplicate consolidated messages
              // when the CLI replays previous turns via --resume
              replayPhase: !!conv.sessionId,
            };

            this.processes.set(conv.id, chatInfo);
            this.outputHandlers.set(conv.id, new Set());
            this.messageBuffers.set(conv.id, []);
            this.contentBlockIds.set(conv.id, new Map());
            this.pendingPermissions.set(conv.id, new Map());

            console.log(`[ChatProcessManager] Restored conversation ${conv.id} (${conv.tool}, status: ${conv.status}, sessionId: ${conv.sessionId || 'none'})`);
          } else {
            console.warn(`[ChatProcessManager] Cannot restore ${conv.id}: CLI not found for tool ${conv.tool}`);
          }
        } catch (restoreErr) {
          console.error(`[ChatProcessManager] Failed to restore conversation ${conv.id}:`, restoreErr);
        }
      }

      console.log(`[ChatProcessManager] Restored ${this.processes.size} conversations into memory`);
    } catch (err) {
      console.error('[ChatProcessManager] Failed to load persisted conversations:', err);
    }
  }

  /**
   * Cleanup all processes
   */
  async cleanup() {
    console.log('[ChatProcessManager] Cleaning up all chat processes');

    // Suspend all active chats in persistence store
    await this.persistenceStore.suspendAllActiveChats().catch(err => {
      console.error('[ChatProcessManager] Failed to suspend active chats:', err);
    });

    for (const [id, info] of this.processes) {
      if (info.process) {
        info.process.kill('SIGTERM');
      }
    }

    this.processes.clear();
    this.outputHandlers.clear();
    this.messageBuffers.clear();
    this.pendingPermissions.clear();

    // Stop auto-cleanup timer
    this.persistenceStore.stopAutoCleanup();

    // Close database connection
    this.persistenceStore.close();
  }
}

// Export singleton instance
export const chatProcessManager = new ChatProcessManager();
export { ChatProcessManager };
