/**
 * OutputParser - Parses CLI output streams into structured content blocks
 * 
 * This module provides:
 * 1. ContentBlock types - Normalized representation of CLI output
 * 2. StreamParser - Handles incremental parsing of PTY output
 * 3. Tool-specific parsing logic delegated to CLIAdapter subclasses
 */

/**
 * Content Block Types
 * 
 * These represent the normalized output from any AI CLI tool.
 * The iOS client renders these as native UI components.
 */
export const ContentBlockType = {
  // Text content from the assistant
  TEXT: 'text',
  
  // Assistant is thinking/processing
  THINKING: 'thinking',
  
  // Tool/function call started
  TOOL_USE_START: 'tool_use_start',
  
  // Tool/function call completed with result
  TOOL_USE_RESULT: 'tool_use_result',
  
  // File read operation
  FILE_READ: 'file_read',
  
  // File edit/write operation (with diff)
  FILE_EDIT: 'file_edit',
  
  // Command execution
  COMMAND_RUN: 'command_run',
  
  // Command output
  COMMAND_OUTPUT: 'command_output',
  
  // Approval request (for file edits, commands, etc.)
  APPROVAL_REQUEST: 'approval_request',
  
  // User input prompt
  INPUT_REQUEST: 'input_request',
  
  // Error message
  ERROR: 'error',
  
  // Progress/status update
  PROGRESS: 'progress',
  
  // Code block (syntax highlighted)
  CODE_BLOCK: 'code_block',
  
  // Raw terminal output (fallback)
  RAW: 'raw',
  
  // Session control events
  SESSION_START: 'session_start',
  SESSION_END: 'session_end',
  
  // Cost/usage information
  USAGE: 'usage'
};

/**
 * Create a content block with standard structure
 */
export function createContentBlock(type, data = {}) {
  return {
    type,
    id: data.id || `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...data
  };
}

/**
 * StreamParser - Handles incremental parsing of PTY output
 * 
 * CLI tools output data in chunks that may split across:
 * - JSON object boundaries
 * - ANSI escape sequences
 * - Line boundaries
 * 
 * This parser buffers input and emits complete content blocks.
 */
export class StreamParser {
  constructor(adapter) {
    this.adapter = adapter;
    this.buffer = '';
    this.lineBuffer = '';
    this.pendingBlocks = [];
    this.currentToolCall = null;
    this.inJsonStream = false;
    this.jsonDepth = 0;
    this.jsonBuffer = '';
  }
  
  /**
   * Process incoming data chunk
   * @param {string} data - Raw PTY output
   * @returns {Array} Array of ContentBlock objects
   */
  parse(data) {
    const blocks = [];
    this.buffer += data;
    
    // Delegate to adapter's parsing strategy
    const parseStrategy = this.adapter.getParseStrategy();
    
    switch (parseStrategy) {
      case 'json-lines':
        blocks.push(...this.parseJsonLines());
        break;
      case 'json-stream':
        blocks.push(...this.parseJsonStream());
        break;
      case 'ansi-text':
        blocks.push(...this.parseAnsiText());
        break;
      default:
        blocks.push(...this.parseRaw());
    }
    
    return blocks;
  }
  
  /**
   * Parse newline-delimited JSON (each line is a complete JSON object)
   */
  parseJsonLines() {
    const blocks = [];
    const lines = this.buffer.split('\n');
    
    // Keep incomplete last line in buffer
    this.buffer = lines.pop() || '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      try {
        const json = JSON.parse(trimmed);
        const parsed = this.adapter.parseJsonEvent(json);
        if (parsed) {
          blocks.push(...(Array.isArray(parsed) ? parsed : [parsed]));
        }
      } catch (e) {
        // Not JSON, treat as text
        const textBlock = this.adapter.parseTextLine(trimmed);
        if (textBlock) {
          blocks.push(textBlock);
        }
      }
    }
    
    return blocks;
  }
  
  /**
   * Parse streaming JSON (objects may span multiple chunks)
   */
  parseJsonStream() {
    const blocks = [];
    
    for (let i = 0; i < this.buffer.length; i++) {
      const char = this.buffer[i];
      
      if (char === '{') {
        if (this.jsonDepth === 0) {
          // Start of new JSON object
          this.jsonBuffer = '';
        }
        this.jsonDepth++;
        this.jsonBuffer += char;
      } else if (char === '}') {
        this.jsonBuffer += char;
        this.jsonDepth--;
        
        if (this.jsonDepth === 0 && this.jsonBuffer) {
          // Complete JSON object
          try {
            const json = JSON.parse(this.jsonBuffer);
            const parsed = this.adapter.parseJsonEvent(json);
            if (parsed) {
              blocks.push(...(Array.isArray(parsed) ? parsed : [parsed]));
            }
          } catch (e) {
            // Invalid JSON, emit as raw
            blocks.push(createContentBlock(ContentBlockType.RAW, {
              content: this.jsonBuffer
            }));
          }
          this.jsonBuffer = '';
        }
      } else if (this.jsonDepth > 0) {
        this.jsonBuffer += char;
      } else {
        // Text outside JSON
        this.lineBuffer += char;
        
        if (char === '\n') {
          const trimmed = this.lineBuffer.trim();
          if (trimmed) {
            const textBlock = this.adapter.parseTextLine(trimmed);
            if (textBlock) {
              blocks.push(textBlock);
            }
          }
          this.lineBuffer = '';
        }
      }
    }
    
    // Clear processed buffer, keep incomplete JSON
    this.buffer = '';
    
    return blocks;
  }
  
  /**
   * Parse ANSI-formatted terminal output
   */
  parseAnsiText() {
    const blocks = [];
    const lines = this.buffer.split('\n');
    
    // Keep incomplete last line in buffer
    this.buffer = lines.pop() || '';
    
    for (const line of lines) {
      // Strip ANSI codes for content extraction
      const stripped = this.stripAnsi(line);
      const trimmed = stripped.trim();
      
      if (!trimmed) continue;
      
      // Let adapter parse the line
      const parsed = this.adapter.parseTextLine(trimmed, line);
      if (parsed) {
        blocks.push(parsed);
      }
    }
    
    return blocks;
  }
  
  /**
   * Fallback: emit raw content
   */
  parseRaw() {
    if (!this.buffer) return [];
    
    const content = this.buffer;
    this.buffer = '';
    
    return [createContentBlock(ContentBlockType.RAW, { content })];
  }
  
  /**
   * Strip ANSI escape codes from text
   */
  stripAnsi(text) {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
               .replace(/\x1b\][^\x07]*\x07/g, '')  // OSC sequences
               .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, ''); // Other sequences
  }
  
  /**
   * Flush any remaining buffered content
   */
  flush() {
    const blocks = [];
    
    if (this.buffer.trim()) {
      blocks.push(createContentBlock(ContentBlockType.RAW, {
        content: this.buffer
      }));
      this.buffer = '';
    }
    
    if (this.lineBuffer.trim()) {
      blocks.push(createContentBlock(ContentBlockType.RAW, {
        content: this.lineBuffer
      }));
      this.lineBuffer = '';
    }
    
    if (this.jsonBuffer.trim()) {
      blocks.push(createContentBlock(ContentBlockType.RAW, {
        content: this.jsonBuffer
      }));
      this.jsonBuffer = '';
    }
    
    return blocks;
  }
  
  /**
   * Reset parser state
   */
  reset() {
    this.buffer = '';
    this.lineBuffer = '';
    this.jsonBuffer = '';
    this.jsonDepth = 0;
    this.currentToolCall = null;
    this.pendingBlocks = [];
  }
}

/**
 * Utility: Detect if text looks like a diff
 */
export function isDiffContent(text) {
  return text.includes('@@') || 
         (text.includes('---') && text.includes('+++')) ||
         /^[-+] /.test(text);
}

/**
 * Utility: Parse a unified diff into structured format
 */
export function parseDiff(diffText) {
  const lines = diffText.split('\n');
  const hunks = [];
  let currentHunk = null;
  let filePath = null;
  
  for (const line of lines) {
    if (line.startsWith('--- ')) {
      // Old file
      filePath = line.slice(4).replace(/^a\//, '');
    } else if (line.startsWith('+++ ')) {
      // New file (prefer this)
      filePath = line.slice(4).replace(/^b\//, '');
    } else if (line.startsWith('@@')) {
      // Hunk header
      const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1], 10),
          oldCount: parseInt(match[2] || '1', 10),
          newStart: parseInt(match[3], 10),
          newCount: parseInt(match[4] || '1', 10),
          lines: []
        };
        hunks.push(currentHunk);
      }
    } else if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', content: line.slice(1) });
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'remove', content: line.slice(1) });
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({ type: 'context', content: line.slice(1) });
      }
    }
  }
  
  return { filePath, hunks };
}

/**
 * Utility: Extract code blocks from markdown-style text
 */
export function extractCodeBlocks(text) {
  const blocks = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  
  while ((match = codeBlockRegex.exec(text)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      code: match[2].trim()
    });
  }
  
  return blocks;
}
