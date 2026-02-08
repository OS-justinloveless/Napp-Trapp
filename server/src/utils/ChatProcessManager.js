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
    this.conversationCounter = 0;

    // Max messages to buffer per conversation
    this.maxBufferSize = 100;

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
   * Transform Claude CLI JSON event to our ContentBlock format
   */
  transformCLIEvent(conversationId, cliEvent) {
    const id = `${cliEvent.type || 'event'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();

    // Handle different Claude CLI event types
    switch (cliEvent.type) {
      case 'assistant':
        // Complete assistant message - filter out since we already stream via content_block_delta
        // This is sent at the end with the full content, but we've already displayed it
        return null;

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
        // Tool use event
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

      // Human/user messages - check if this is a tool result
      case 'human':
      case 'user':
        // Check if this contains tool results (nested in message.content)
        const messageContent = cliEvent.message?.content || cliEvent.content;
        if (messageContent && Array.isArray(messageContent)) {
          for (const item of messageContent) {
            if (item.type === 'tool_result') {
              console.log(`[ChatProcessManager] FOUND TOOL RESULT:`, item.tool_use_id, `content length: ${item.content?.length || 0}`);
              return {
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
        // Filter out regular user messages (replay of user input)
        return null;

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

    // Save complete (non-partial) messages to persistence store
    if (!message.isPartial) {
      this.persistenceStore.saveMessage(conversationId, message).catch(err => {
        console.error(`[ChatProcessManager] Failed to save message to persistence:`, err);
      });
    }
  }

  /**
   * Notify all handlers for a conversation
   */
  notifyHandlers(conversationId, event) {
    const handlers = this.outputHandlers.get(conversationId);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[ChatProcessManager] Handler error:`, err);
        }
      }
    }
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
   * Send a message to the chat
   */
  async sendMessage(conversationId, content) {
    const chatInfo = this.processes.get(conversationId);
    if (!chatInfo) {
      throw new Error(`Chat not found: ${conversationId}`);
    }

    if (!chatInfo.process || chatInfo.status !== 'running') {
      throw new Error(`Chat process not running: ${conversationId}`);
    }

    console.log(`[ChatProcessManager] Sending message to ${conversationId}: ${content.substring(0, 50)}...`);

    // For stream-json input format, send JSON object with message wrapper
    // Claude CLI expects: {"type": "user", "message": {"role": "user", "content": [...]}}
    const inputMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: content }]
      }
    });

    chatInfo.process.stdin.write(inputMessage + '\n');

    // Buffer the user message so it appears in chat history on reconnect
    this.bufferMessage(conversationId, {
      id: `user-${Date.now()}`,
      type: 'text',
      role: 'user',
      conversationId,
      content: content,
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
   * This restores conversation metadata but doesn't restart processes
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
        }

        console.log(`[ChatProcessManager] Loaded conversation ${conv.id} (${conv.tool}, status: ${conv.status})`);
      }
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
  }
}

// Export singleton instance
export const chatProcessManager = new ChatProcessManager();
export { ChatProcessManager };
