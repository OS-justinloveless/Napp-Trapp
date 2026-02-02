import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { ContentBlockType, createContentBlock, isDiffContent, parseDiff, extractCodeBlocks } from './OutputParser.js';

/**
 * Base CLI Adapter - Abstract interface for AI CLI tools
 *
 * Provides a unified interface for interacting with different AI CLI tools:
 * - cursor-agent: Native Cursor CLI with built-in session management
 * - claude: Claude Code CLI (claude or claude-code)
 * - gemini: Google Gemini CLI
 *
 * Each adapter implements tool-specific command construction and output parsing.
 */
export class CLIAdapter {
  /**
   * Build arguments for creating a new chat session
   * @param {Object} options - Creation options
   * @param {string} options.workspacePath - Path to workspace directory
   * @returns {Array|Object} Command arguments or {needsGeneratedId: true}
   */
  buildCreateChatArgs(options) {
    throw new Error('buildCreateChatArgs must be implemented by subclass');
  }

  /**
   * Build arguments for sending a message to an existing chat (non-interactive)
   * @param {Object} options - Message options
   * @param {string} options.chatId - Chat/session ID
   * @param {string} options.message - Message text
   * @param {string} options.workspacePath - Path to workspace directory
   * @param {string} options.model - Model to use (optional)
   * @param {string} options.mode - Chat mode (agent|plan|ask)
   * @returns {Array} Command arguments
   */
  buildSendMessageArgs(options) {
    throw new Error('buildSendMessageArgs must be implemented by subclass');
  }

  /**
   * Build arguments for interactive mode (PTY session)
   * Used when spawning a persistent PTY for the CLI.
   * 
   * @param {Object} options - Session options
   * @param {string} options.sessionId - Session/conversation ID for resume
   * @param {string} options.workspacePath - Path to workspace directory
   * @param {string} options.model - Model to use (optional)
   * @param {string} options.mode - Chat mode (agent|plan|ask)
   * @returns {Array} Command arguments (without executable)
   */
  buildInteractiveArgs(options) {
    throw new Error('buildInteractiveArgs must be implemented by subclass');
  }

  /**
   * Get the CLI executable name
   * @returns {string} Executable name (e.g., 'cursor-agent', 'claude')
   */
  getExecutable() {
    throw new Error('getExecutable must be implemented by subclass');
  }

  /**
   * Parse CLI output from chat creation command
   * @param {string} output - stdout from CLI
   * @returns {string} Chat/session ID
   */
  parseCreateChatOutput(output) {
    throw new Error('parseCreateChatOutput must be implemented by subclass');
  }

  /**
   * Check if this CLI tool is installed and available
   * @returns {Promise<boolean>} True if CLI is available
   */
  async isAvailable() {
    try {
      const executable = this.getExecutable();
      const whichResult = execSync(`which ${executable}`, { stdio: 'pipe' }).toString().trim();
      // Cache the resolved path for later use
      this._resolvedPath = whichResult;
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get the resolved executable path (after isAvailable was called)
   * Falls back to command name if path wasn't resolved
   * @returns {string} Full path to executable or command name
   */
  getResolvedExecutable() {
    if (this._resolvedPath) {
      return this._resolvedPath;
    }
    // Try to resolve now
    try {
      const executable = this.getExecutable();
      this._resolvedPath = execSync(`which ${executable}`, { stdio: 'pipe' }).toString().trim();
      return this._resolvedPath;
    } catch (e) {
      // Return command name as fallback
      return this.getExecutable();
    }
  }

  /**
   * Get display name for this tool
   * @returns {string} Human-readable tool name
   */
  getDisplayName() {
    throw new Error('getDisplayName must be implemented by subclass');
  }

  /**
   * Get installation instructions for this tool
   * @returns {string} Instructions for installing the CLI
   */
  getInstallInstructions() {
    throw new Error('getInstallInstructions must be implemented by subclass');
  }

  /**
   * Get capabilities of this CLI tool
   * @returns {Object} Capability flags
   */
  getCapabilities() {
    return {
      streaming: true,
      sessionResume: true,
      toolUse: true,
      fileEditing: true,
      interactiveMode: true
    };
  }

  // ============ Output Parsing Methods ============

  /**
   * Get the parsing strategy for this CLI's output
   * @returns {string} 'json-lines' | 'json-stream' | 'ansi-text'
   */
  getParseStrategy() {
    return 'ansi-text'; // Default: parse as ANSI terminal output
  }

  /**
   * Parse a JSON event from the CLI's structured output
   * Override in subclasses for tool-specific parsing.
   * 
   * @param {Object} json - Parsed JSON object
   * @returns {Object|Array|null} ContentBlock(s) or null to skip
   */
  parseJsonEvent(json) {
    // Default: wrap as raw content
    return createContentBlock(ContentBlockType.RAW, {
      content: JSON.stringify(json)
    });
  }

  /**
   * Parse a text line from terminal output
   * Override in subclasses for tool-specific parsing.
   * 
   * @param {string} stripped - ANSI-stripped text
   * @param {string} original - Original text with ANSI codes
   * @returns {Object|null} ContentBlock or null to skip
   */
  parseTextLine(stripped, original = stripped) {
    // Default: emit as text
    return createContentBlock(ContentBlockType.TEXT, {
      content: stripped
    });
  }

  /**
   * Detect if the CLI is waiting for user input
   * @param {string} output - Recent output text
   * @returns {Object|null} Input request info or null
   */
  detectInputRequest(output) {
    // Common patterns for input prompts
    if (output.includes('(y/n)') || output.includes('[Y/n]') || output.includes('[y/N]')) {
      return { type: 'confirmation', prompt: output };
    }
    if (output.includes('?') && output.trim().endsWith(':')) {
      return { type: 'question', prompt: output };
    }
    return null;
  }

  /**
   * Detect if the CLI is showing an approval request
   * @param {string} output - Recent output text
   * @returns {Object|null} Approval request info or null
   */
  detectApprovalRequest(output) {
    return null; // Override in subclasses
  }
}

/**
 * Cursor Agent CLI Adapter
 *
 * Uses the cursor-agent CLI which provides native session management.
 * Supports:
 * - create-chat command for new sessions
 * - --resume flag for continuing sessions
 * - --workspace flag for workspace context
 * - --model flag for model selection
 * - --mode flag for agent/plan/ask modes
 */
export class CursorAgentAdapter extends CLIAdapter {
  buildCreateChatArgs({ workspacePath }) {
    const args = ['create-chat'];
    if (workspacePath) {
      args.push('--workspace', workspacePath);
    }
    return args;
  }

  buildSendMessageArgs({ chatId, message, workspacePath, model, mode }) {
    const args = [
      '--resume', chatId,
      '-p',
      '-f', // Force flag for headless mode file edits
      '--output-format', 'stream-json'
    ];

    // Insert flags before the message
    if (workspacePath) {
      args.splice(2, 0, '--workspace', workspacePath);
    }
    if (model) {
      args.splice(2, 0, '--model', model);
    }
    if (mode && mode !== 'agent') {
      args.splice(2, 0, '--mode', mode);
    }

    // Message goes at the end
    args.push(message);
    return args;
  }

  buildInteractiveArgs({ sessionId, workspacePath, model, mode }) {
    // For interactive mode, we use --resume to continue an existing session
    // or start a new one with the given session ID
    const args = ['--resume', sessionId];

    if (workspacePath) {
      args.push('--workspace', workspacePath);
    }
    if (model) {
      args.push('--model', model);
    }
    if (mode && mode !== 'agent') {
      args.push('--mode', mode);
    }

    // No -p flag for interactive mode - we want the full REPL experience
    // No --output-format since we're in a PTY
    return args;
  }

  getExecutable() {
    return 'cursor-agent';
  }

  parseCreateChatOutput(output) {
    // cursor-agent returns the chat ID directly
    return output.trim();
  }

  getDisplayName() {
    return 'Cursor Agent';
  }

  getInstallInstructions() {
    return 'Install cursor-agent: curl https://cursor.com/install -fsS | bash';
  }

  // ============ Output Parsing ============

  getParseStrategy() {
    // cursor-agent uses JSON lines in --output-format stream-json mode
    // In interactive PTY mode, it uses ANSI text
    return 'ansi-text';
  }

  parseJsonEvent(json) {
    const blocks = [];
    
    // cursor-agent JSON event types (similar to Claude but may vary)
    switch (json.type) {
      case 'assistant':
        if (json.message?.content) {
          for (const item of json.message.content) {
            if (item.type === 'text' && item.text) {
              blocks.push(createContentBlock(ContentBlockType.TEXT, {
                content: item.text
              }));
            } else if (item.type === 'tool_use') {
              blocks.push(createContentBlock(ContentBlockType.TOOL_USE_START, {
                toolId: item.id,
                toolName: item.name,
                input: item.input
              }));
            } else if (item.type === 'tool_result') {
              blocks.push(createContentBlock(ContentBlockType.TOOL_USE_RESULT, {
                toolId: item.tool_use_id,
                content: item.content,
                isError: item.is_error || false
              }));
            }
          }
        }
        break;
        
      case 'text':
        blocks.push(createContentBlock(ContentBlockType.TEXT, {
          content: json.content || json.text
        }));
        break;
        
      case 'tool_call':
        blocks.push(createContentBlock(ContentBlockType.TOOL_USE_START, {
          toolId: json.id,
          toolName: json.name,
          input: json.arguments || json.input
        }));
        break;
        
      case 'tool_result':
        blocks.push(createContentBlock(ContentBlockType.TOOL_USE_RESULT, {
          toolId: json.tool_call_id || json.id,
          content: json.content,
          isError: json.is_error || false
        }));
        break;
        
      case 'complete':
        blocks.push(createContentBlock(ContentBlockType.SESSION_END, {
          success: json.success,
          reason: json.reason
        }));
        break;
        
      case 'error':
        blocks.push(createContentBlock(ContentBlockType.ERROR, {
          message: json.message || json.error,
          code: json.code
        }));
        break;
        
      case 'stderr':
        blocks.push(createContentBlock(ContentBlockType.ERROR, {
          message: json.content,
          isStderr: true
        }));
        break;
        
      default:
        blocks.push(createContentBlock(ContentBlockType.RAW, {
          content: JSON.stringify(json)
        }));
    }
    
    return blocks.length > 0 ? blocks : null;
  }

  parseTextLine(stripped, original = stripped) {
    // Detect cursor-agent specific patterns
    
    // Progress indicators
    if (stripped.startsWith('→') || stripped.startsWith('●')) {
      return createContentBlock(ContentBlockType.PROGRESS, {
        message: stripped.replace(/^[→●]\s*/, '').trim()
      });
    }
    
    // Tool use indicators
    if (stripped.startsWith('🔧') || stripped.includes('Using tool:')) {
      const match = stripped.match(/(?:Using tool:|🔧)\s*(\w+)/);
      return createContentBlock(ContentBlockType.TOOL_USE_START, {
        toolName: match ? match[1] : 'unknown'
      });
    }
    
    // File operations
    if (stripped.includes('Reading:') || stripped.includes('📖')) {
      const match = stripped.match(/(?:Reading:|📖)\s*(.+)/);
      return createContentBlock(ContentBlockType.FILE_READ, {
        path: match ? match[1].trim() : stripped
      });
    }
    
    if (stripped.includes('Writing:') || stripped.includes('✏️')) {
      const match = stripped.match(/(?:Writing:|✏️)\s*(.+)/);
      return createContentBlock(ContentBlockType.FILE_EDIT, {
        path: match ? match[1].trim() : stripped
      });
    }
    
    // Command execution
    if (stripped.startsWith('$') || stripped.includes('Running:')) {
      const match = stripped.match(/(?:\$|Running:)\s*(.+)/);
      return createContentBlock(ContentBlockType.COMMAND_RUN, {
        command: match ? match[1].trim() : stripped
      });
    }
    
    // Mode indicators
    if (stripped.includes('Mode:') || stripped.includes('agent mode') || stripped.includes('plan mode')) {
      return createContentBlock(ContentBlockType.PROGRESS, {
        message: stripped,
        isMode: true
      });
    }
    
    // Thinking
    if (stripped.includes('Thinking') || stripped.match(/^\.\.\./)) {
      return createContentBlock(ContentBlockType.THINKING, {
        content: stripped
      });
    }
    
    // Error messages
    if (stripped.toLowerCase().includes('error:') || stripped.startsWith('❌')) {
      return createContentBlock(ContentBlockType.ERROR, {
        message: stripped.replace(/^❌\s*/, '').replace(/^error:\s*/i, '')
      });
    }
    
    // Success messages
    if (stripped.startsWith('✓') || stripped.startsWith('✅')) {
      return createContentBlock(ContentBlockType.PROGRESS, {
        message: stripped,
        isSuccess: true
      });
    }
    
    // Diff content
    if (isDiffContent(stripped)) {
      return createContentBlock(ContentBlockType.CODE_BLOCK, {
        language: 'diff',
        code: original
      });
    }
    
    // Default: regular text
    return createContentBlock(ContentBlockType.TEXT, {
      content: stripped
    });
  }

  detectApprovalRequest(output) {
    // cursor-agent approval patterns
    if (output.includes('(y/n)') || output.includes('Confirm')) {
      const isFileEdit = output.includes('edit') || output.includes('write') || output.includes('modify');
      const isCommand = output.includes('run') || output.includes('execute');
      
      return {
        type: isFileEdit ? 'file_edit' : isCommand ? 'command' : 'generic',
        prompt: output,
        options: ['y', 'n']
      };
    }
    return null;
  }
}

/**
 * Claude Code CLI Adapter
 *
 * Uses the Claude Code CLI (claude or claude-code).
 * Key differences from cursor-agent:
 * - No explicit create-chat command (generates UUID instead)
 * - Uses --session-id flag for session management
 * - Uses --permission-mode plan instead of --mode plan
 */
export class ClaudeAdapter extends CLIAdapter {
  constructor() {
    super();
    // Try to detect which variant is installed (claude vs claude-code)
    this._executable = null;
  }

  buildCreateChatArgs({ workspacePath }) {
    // Claude CLI doesn't have explicit create command
    // Return marker that we need to generate a session ID
    return { needsGeneratedId: true };
  }

  buildSendMessageArgs({ chatId, message, workspacePath, model, mode }) {
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--session-id', chatId
    ];

    if (workspacePath) {
      args.push('--workspace', workspacePath);
    }
    if (model) {
      args.push('--model', model);
    }
    if (mode === 'plan') {
      args.push('--permission-mode', 'plan');
    }

    // Message goes at the end
    args.push(message);
    return args;
  }

  buildInteractiveArgs({ sessionId, workspacePath, model, mode }) {
    // For interactive mode, use --resume to continue session
    // Claude Code uses --resume for interactive session continuation
    const args = ['--resume', '--session-id', sessionId];

    if (workspacePath) {
      args.push('--workspace', workspacePath);
    }
    if (model) {
      args.push('--model', model);
    }
    if (mode === 'plan') {
      args.push('--permission-mode', 'plan');
    }

    // No --print flag for interactive mode
    return args;
  }

  getExecutable() {
    // Cache the detected executable
    if (this._executable) {
      return this._executable;
    }

    // Try both variants
    try {
      execSync('which claude', { stdio: 'pipe' });
      this._executable = 'claude';
      return 'claude';
    } catch (e) {
      try {
        execSync('which claude-code', { stdio: 'pipe' });
        this._executable = 'claude-code';
        return 'claude-code';
      } catch (e2) {
        // Default to 'claude' for error messages
        this._executable = 'claude';
        return 'claude';
      }
    }
  }

  parseCreateChatOutput(output) {
    // Session ID is generated externally, this shouldn't be called
    return output.trim();
  }

  getDisplayName() {
    return 'Claude Code';
  }

  getInstallInstructions() {
    return 'Install Claude Code CLI: https://github.com/anthropics/claude-code';
  }

  // ============ Output Parsing ============

  getParseStrategy() {
    // Claude Code uses JSON lines in --output-format stream-json mode
    // In interactive PTY mode, it uses ANSI text
    return 'ansi-text';
  }

  parseJsonEvent(json) {
    const blocks = [];
    
    // Handle different Claude Code event types
    switch (json.type) {
      case 'assistant':
        // Assistant message with content blocks
        if (json.message?.content) {
          for (const item of json.message.content) {
            if (item.type === 'text' && item.text) {
              blocks.push(createContentBlock(ContentBlockType.TEXT, {
                content: item.text
              }));
            } else if (item.type === 'tool_use') {
              blocks.push(createContentBlock(ContentBlockType.TOOL_USE_START, {
                toolId: item.id,
                toolName: item.name,
                input: item.input
              }));
            } else if (item.type === 'tool_result') {
              blocks.push(createContentBlock(ContentBlockType.TOOL_USE_RESULT, {
                toolId: item.tool_use_id,
                content: item.content,
                isError: item.is_error || false
              }));
            }
          }
        }
        break;
        
      case 'content_block_start':
        if (json.content_block?.type === 'tool_use') {
          blocks.push(createContentBlock(ContentBlockType.TOOL_USE_START, {
            toolId: json.content_block.id,
            toolName: json.content_block.name,
            input: {}
          }));
        }
        break;
        
      case 'content_block_delta':
        if (json.delta?.type === 'text_delta') {
          blocks.push(createContentBlock(ContentBlockType.TEXT, {
            content: json.delta.text,
            isPartial: true
          }));
        } else if (json.delta?.type === 'input_json_delta') {
          // Tool input being streamed - accumulate
          blocks.push(createContentBlock(ContentBlockType.PROGRESS, {
            message: 'Tool input streaming...',
            toolId: json.index
          }));
        }
        break;
        
      case 'content_block_stop':
        // Content block completed
        break;
        
      case 'message_start':
        blocks.push(createContentBlock(ContentBlockType.SESSION_START, {
          model: json.message?.model,
          role: json.message?.role
        }));
        break;
        
      case 'message_delta':
        if (json.usage) {
          blocks.push(createContentBlock(ContentBlockType.USAGE, {
            inputTokens: json.usage.input_tokens,
            outputTokens: json.usage.output_tokens
          }));
        }
        break;
        
      case 'message_stop':
        blocks.push(createContentBlock(ContentBlockType.SESSION_END, {
          reason: json.stop_reason
        }));
        break;
        
      case 'error':
        blocks.push(createContentBlock(ContentBlockType.ERROR, {
          message: json.error?.message || 'Unknown error',
          code: json.error?.code
        }));
        break;
        
      default:
        // Unknown event type, pass through as raw
        blocks.push(createContentBlock(ContentBlockType.RAW, {
          content: JSON.stringify(json)
        }));
    }
    
    return blocks.length > 0 ? blocks : null;
  }

  parseTextLine(stripped, original = stripped) {
    // Detect Claude-specific patterns
    
    // Tool execution patterns
    if (stripped.startsWith('⚡')) {
      return createContentBlock(ContentBlockType.PROGRESS, {
        message: stripped.replace('⚡', '').trim()
      });
    }
    
    // File operations
    if (stripped.includes('Reading file:') || stripped.includes('Read ')) {
      const match = stripped.match(/(?:Reading file:|Read)\s*(.+)/);
      return createContentBlock(ContentBlockType.FILE_READ, {
        path: match ? match[1].trim() : stripped
      });
    }
    
    if (stripped.includes('Writing to') || stripped.includes('Wrote ')) {
      const match = stripped.match(/(?:Writing to|Wrote)\s*(.+)/);
      return createContentBlock(ContentBlockType.FILE_EDIT, {
        path: match ? match[1].trim() : stripped
      });
    }
    
    // Command execution
    if (stripped.startsWith('$') || stripped.startsWith('>')) {
      return createContentBlock(ContentBlockType.COMMAND_RUN, {
        command: stripped.slice(1).trim()
      });
    }
    
    // Approval prompts
    if (stripped.includes('Allow?') || stripped.includes('Approve?')) {
      return createContentBlock(ContentBlockType.APPROVAL_REQUEST, {
        action: 'generic',
        prompt: stripped
      });
    }
    
    // Diff content
    if (isDiffContent(stripped)) {
      return createContentBlock(ContentBlockType.CODE_BLOCK, {
        language: 'diff',
        code: original
      });
    }
    
    // Thinking indicator
    if (stripped.includes('Thinking') || stripped.includes('...')) {
      return createContentBlock(ContentBlockType.THINKING, {
        content: stripped
      });
    }
    
    // Default: regular text
    return createContentBlock(ContentBlockType.TEXT, {
      content: stripped
    });
  }

  detectApprovalRequest(output) {
    // Claude Code approval patterns
    if (output.includes('Do you want to') || output.includes('Allow')) {
      const isFileEdit = output.includes('write') || output.includes('edit') || output.includes('modify');
      const isCommand = output.includes('run') || output.includes('execute') || output.includes('command');
      
      return {
        type: isFileEdit ? 'file_edit' : isCommand ? 'command' : 'generic',
        prompt: output,
        options: ['y', 'n']
      };
    }
    return null;
  }
}

/**
 * Google Gemini CLI Adapter
 *
 * Uses the gemini CLI tool.
 * Note: The exact CLI flags should be verified against actual Gemini CLI documentation.
 * This implementation assumes a similar structure to other AI CLIs.
 */
export class GeminiAdapter extends CLIAdapter {
  buildCreateChatArgs({ workspacePath }) {
    // Gemini CLI may not have explicit create command
    // Return marker that we need to generate a session ID
    return { needsGeneratedId: true };
  }

  buildSendMessageArgs({ chatId, message, workspacePath, model, mode }) {
    const args = ['--prompt', message];

    if (workspacePath) {
      args.push('--workspace', workspacePath);
    }
    if (model) {
      args.push('--model', model);
    }
    if (chatId) {
      args.push('--session-id', chatId);
    }

    return args;
  }

  buildInteractiveArgs({ sessionId, workspacePath, model, mode }) {
    // For interactive mode, launch without --prompt to enter REPL
    const args = [];

    if (sessionId) {
      args.push('--session-id', sessionId);
    }
    if (workspacePath) {
      args.push('--workspace', workspacePath);
    }
    if (model) {
      args.push('--model', model);
    }

    return args;
  }

  getExecutable() {
    return 'gemini';
  }

  parseCreateChatOutput(output) {
    // Session ID is generated externally, this shouldn't be called
    return output.trim();
  }

  getDisplayName() {
    return 'Google Gemini';
  }

  getInstallInstructions() {
    return 'Install Gemini CLI: Check Google AI documentation for installation instructions';
  }

  // ============ Output Parsing ============

  getParseStrategy() {
    // Gemini CLI output format (may vary based on actual CLI)
    return 'ansi-text';
  }

  parseJsonEvent(json) {
    const blocks = [];
    
    // Gemini-specific JSON parsing (structure may vary)
    if (json.text || json.content) {
      blocks.push(createContentBlock(ContentBlockType.TEXT, {
        content: json.text || json.content
      }));
    }
    
    if (json.functionCall || json.tool_call) {
      const call = json.functionCall || json.tool_call;
      blocks.push(createContentBlock(ContentBlockType.TOOL_USE_START, {
        toolId: call.id,
        toolName: call.name,
        input: call.args || call.arguments
      }));
    }
    
    if (json.functionResponse || json.tool_result) {
      const result = json.functionResponse || json.tool_result;
      blocks.push(createContentBlock(ContentBlockType.TOOL_USE_RESULT, {
        toolId: result.id,
        content: result.response || result.content,
        isError: result.error || false
      }));
    }
    
    if (json.error) {
      blocks.push(createContentBlock(ContentBlockType.ERROR, {
        message: json.error.message || json.error,
        code: json.error.code
      }));
    }
    
    if (blocks.length === 0) {
      blocks.push(createContentBlock(ContentBlockType.RAW, {
        content: JSON.stringify(json)
      }));
    }
    
    return blocks;
  }

  parseTextLine(stripped, original = stripped) {
    // Gemini-specific patterns (may vary based on actual CLI)
    
    // Thinking/processing
    if (stripped.includes('Thinking') || stripped.includes('Processing')) {
      return createContentBlock(ContentBlockType.THINKING, {
        content: stripped
      });
    }
    
    // Function/tool calls
    if (stripped.includes('Calling function:') || stripped.includes('🔧')) {
      const match = stripped.match(/(?:Calling function:|🔧)\s*(\w+)/);
      return createContentBlock(ContentBlockType.TOOL_USE_START, {
        toolName: match ? match[1] : 'unknown'
      });
    }
    
    // File operations
    if (stripped.includes('Reading file') || stripped.includes('📄')) {
      const match = stripped.match(/(?:Reading file|📄)[:\s]*(.+)/);
      return createContentBlock(ContentBlockType.FILE_READ, {
        path: match ? match[1].trim() : stripped
      });
    }
    
    if (stripped.includes('Writing file') || stripped.includes('💾')) {
      const match = stripped.match(/(?:Writing file|💾)[:\s]*(.+)/);
      return createContentBlock(ContentBlockType.FILE_EDIT, {
        path: match ? match[1].trim() : stripped
      });
    }
    
    // Command execution
    if (stripped.startsWith('$') || stripped.includes('Executing:')) {
      const match = stripped.match(/(?:\$|Executing:)\s*(.+)/);
      return createContentBlock(ContentBlockType.COMMAND_RUN, {
        command: match ? match[1].trim() : stripped
      });
    }
    
    // Error messages
    if (stripped.toLowerCase().includes('error') && stripped.includes(':')) {
      return createContentBlock(ContentBlockType.ERROR, {
        message: stripped
      });
    }
    
    // Diff content
    if (isDiffContent(stripped)) {
      return createContentBlock(ContentBlockType.CODE_BLOCK, {
        language: 'diff',
        code: original
      });
    }
    
    // Default: regular text
    return createContentBlock(ContentBlockType.TEXT, {
      content: stripped
    });
  }

  detectApprovalRequest(output) {
    // Gemini approval patterns
    if (output.includes('(y/n)') || output.includes('Confirm?')) {
      return {
        type: 'generic',
        prompt: output,
        options: ['y', 'n']
      };
    }
    return null;
  }
}

/**
 * Factory function to get the appropriate CLI adapter
 * @param {string} tool - Tool name ('cursor-agent', 'claude', 'gemini')
 * @returns {CLIAdapter} Adapter instance for the specified tool
 */
export function getCLIAdapter(tool) {
  switch (tool) {
    case 'cursor-agent':
      return new CursorAgentAdapter();
    case 'claude':
      return new ClaudeAdapter();
    case 'gemini':
      return new GeminiAdapter();
    default:
      throw new Error(`Unknown tool: ${tool}. Valid tools: cursor-agent, claude, gemini`);
  }
}

/**
 * Get list of all supported tools
 * @returns {Array<string>} Array of tool names
 */
export function getSupportedTools() {
  return ['cursor-agent', 'claude', 'gemini'];
}

/**
 * Check availability of all CLI tools
 * @returns {Promise<Object>} Map of tool names to availability status
 */
export async function checkAllToolsAvailability() {
  const tools = getSupportedTools();
  const availability = {};

  for (const tool of tools) {
    try {
      const adapter = getCLIAdapter(tool);
      availability[tool] = {
        available: await adapter.isAvailable(),
        displayName: adapter.getDisplayName(),
        installInstructions: adapter.getInstallInstructions()
      };
    } catch (error) {
      availability[tool] = {
        available: false,
        displayName: tool,
        installInstructions: 'Unknown tool',
        error: error.message
      };
    }
  }

  return availability;
}
