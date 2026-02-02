# Chat Redesign: Mobile-First AI CLI Wrapper

This document outlines the architectural redesign to transform the mobile app into a native iOS wrapper around AI CLI tools (Claude Code, Cursor Agent, Gemini CLI, etc.).

## Goals

1. **Mobile-only chats** - Only care about conversations initiated from the mobile app
2. **CLI wrapper** - Use whatever AI CLI tools are available on the server
3. **Full CLI functionality** - All features of the CLIs work through the iOS UI
4. **Native experience** - Sleek iOS-native interface for AI coding workflows

---

## Current State (What's Already Working)

| Component | Status | Notes |
|-----------|--------|-------|
| `MobileChatStore` | ✅ Ready | Already tracks only mobile-initiated conversations |
| `CLIAdapter` | ✅ Ready | Adapter pattern for `cursor-agent`, `claude`, `gemini` |
| `PTYManager` | ✅ Ready | Full PTY/terminal support |
| Conversations route | ✅ Ready | Already filters to only `source: 'mobile'` chats |
| iOS NewChatSheet | ✅ Ready | Tool picker for different CLI tools |

---

## Key Architectural Changes

### 1. On-Demand PTY Sessions with CLI-Native Persistence

**Key insight**: Most AI CLIs already have built-in session persistence:
- `claude --session-id <id>` → stores in `~/.claude/sessions/`
- `cursor-agent --resume <id>` → has its own session storage
- `gemini --session-id <id>` → similar pattern

**Current approach (problematic):**
```javascript
// Messages spawn a new CLI process per request with --print mode
const agent = spawn('claude', ['--print', message]);
```

**Problems:**
- Loses interactive features (prompts, confirmations)
- No real-time tool execution visibility
- Can't approve/reject file changes
- Process dies after each message

**New approach - On-Demand PTY with Session Resume:**
```javascript
// CLISessionManager handles lazy PTY lifecycle
class CLISessionManager {
  async getOrCreateSession(conversationId, tool, workspacePath) {
    // Check if PTY already running for this conversation
    let session = this.activeSessions.get(conversationId);
    
    if (!session || !session.isAlive()) {
      // Spawn new PTY with session resume flag
      const adapter = getCLIAdapter(tool);
      session = ptyManager.spawnTerminal({
        shell: adapter.getExecutable(),
        args: adapter.buildInteractiveArgs({
          sessionId: conversationId,  // CLI uses this to restore history
          workspacePath
        }),
        cwd: workspacePath
      });
      
      this.activeSessions.set(conversationId, session);
      this.startInactivityTimer(conversationId);
    }
    
    return session;
  }
  
  // Kill PTY after inactivity, session state preserved by CLI
  startInactivityTimer(conversationId, timeoutMs = 60000) {
    // Reset timer on each interaction
    // After timeout: kill PTY, CLI's session files remain intact
  }
}
```

**Session Lifecycle:**
```
User sends message
        │
        ▼
┌───────────────────────────┐
│ PTY running for this      │──No──▶ Spawn PTY with --session-id
│ conversation?             │        (CLI auto-loads history)
└───────────────────────────┘                │
        │ Yes                                │
        ▼                                    ▼
┌─────────────────────────────────────────────────┐
│              Active PTY Session                 │
│  • Stream output to iOS via WebSocket           │
│  • Accept user input                            │
│  • Handle approval requests                     │
└─────────────────────────────────────────────────┘
        │
        ▼ (60s inactivity OR app backgrounds)
┌───────────────────────────┐
│ Kill PTY process          │
│ CLI's session files stay  │──▶ Ready to resume anytime
│ on disk                   │
└───────────────────────────┘
```

**Benefits:**
- **Resource efficient** - No idle PTY processes consuming memory
- **Scalable** - Server can handle many users without resource explosion
- **Resilient** - CLI tools handle their own persistence
- **Fast resume** - CLI reloads context from its session files
- **Full interactivity** - When active, full PTY capabilities

### Storage Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    STORAGE LAYERS                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ CLI Native Storage (Primary - Source of Truth)      │   │
│  │ ~/.claude/sessions/<session-id>/                    │   │
│  │ ~/.cursor-agent/sessions/<session-id>/              │   │
│  │                                                     │   │
│  │ • Full conversation history                         │   │
│  │ • Tool call results                                 │   │
│  │ • File edit history                                 │   │
│  │ • Context window state                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ MobileChatStore (Server - Index + Cache)            │   │
│  │ server/.napp-trapp-data/mobile-chats.json           │   │
│  │                                                     │   │
│  │ • Session ID ↔ Conversation mapping                 │   │
│  │ • Project/workspace associations                    │   │
│  │ • Tool used (claude/cursor-agent/gemini)            │   │
│  │ • Message cache for quick loading                   │   │
│  │ • Timestamps, metadata                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ iOS Local Storage (Client - Offline + Fast UI)      │   │
│  │ CoreData / UserDefaults / Files                     │   │
│  │                                                     │   │
│  │ • Cached messages for instant display               │   │
│  │ • Offline conversation viewing                      │   │
│  │ • Pending messages (queued while offline)           │   │
│  │ • UI state (scroll position, drafts)                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Data Flow:**
1. **New conversation** → Generate UUID, create in MobileChatStore, spawn PTY with that session ID
2. **Send message** → Ensure PTY running, write to PTY, stream response, cache in MobileChatStore + iOS
3. **Resume conversation** → Spawn PTY with existing session ID, CLI loads its history automatically
4. **View offline** → Display from iOS cache, show "offline" indicator
5. **Inactivity** → Kill PTY, session data remains in CLI storage

---

### 2. Enhanced CLI Adapter Interface

Extend the adapter pattern to support interactive mode and output parsing:

```javascript
class CLIAdapter {
  // Existing methods...
  buildCreateChatArgs(options) { }
  buildSendMessageArgs(options) { }
  getExecutable() { }
  parseCreateChatOutput(output) { }
  isAvailable() { }
  getDisplayName() { }
  getInstallInstructions() { }
  
  // NEW: Build args for interactive mode
  buildInteractiveArgs({ chatId, workspacePath, model, mode }) { }
  
  // NEW: Parse streaming output for UI rendering
  parseStreamChunk(chunk) { 
    return { 
      type,      // 'text' | 'tool_start' | 'tool_output' | 'approval' | 'error'
      content,   // Raw content
      toolCall,  // Parsed tool call info
      progress   // Progress indicator data
    };
  }
  
  // NEW: Detect when CLI is awaiting input
  isAwaitingInput(output) { }
  
  // NEW: Get supported capabilities
  getCapabilities() {
    return {
      streaming: true,
      toolUse: true,
      fileEditing: true,
      mcpSupport: false,
      sessionResume: true,
      multiTurn: true
    };
  }
  
  // NEW: Format user input for the CLI
  formatUserInput(message, options) { }
}
```

---

### 3. Unified WebSocket Protocol for Real-Time Streaming

Replace SSE with WebSocket for bidirectional communication:

**Client → Server:**
```json
{
  "type": "message",
  "conversationId": "uuid",
  "content": "fix the bug in auth.js"
}

{
  "type": "approval",
  "conversationId": "uuid",
  "toolCallId": "tc_123",
  "approved": true
}

{
  "type": "cancel",
  "conversationId": "uuid"
}
```

**Server → Client:**
```json
{
  "type": "text_delta",
  "content": "I'll look at the auth.js file..."
}

{
  "type": "tool_start",
  "toolCallId": "tc_123",
  "tool": "read_file",
  "args": { "path": "src/auth.js" }
}

{
  "type": "tool_output",
  "toolCallId": "tc_123",
  "content": "... file contents ..."
}

{
  "type": "approval_request",
  "toolCallId": "tc_456",
  "action": "edit_file",
  "path": "src/auth.js",
  "diff": "- const token = null;\n+ const token = getToken();"
}

{
  "type": "complete",
  "success": true
}
```

---

### 4. iOS Native UI Components for CLI Features

```
┌─────────────────────────────────────────────────────────┐
│  ← Back     my-project     Claude Code  ▼               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ 👤 Fix the authentication bug in auth.js           ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ 🤖 I'll analyze the auth.js file to find the bug.  ││
│  │                                                     ││
│  │  ┌─ 📄 Reading file ─────────────────────────────┐ ││
│  │  │ src/auth.js                                   │ ││
│  │  │ Lines 1-67 • 2.3 KB                          │ ││
│  │  └───────────────────────────────────────────────┘ ││
│  │                                                     ││
│  │ I found the issue. The token is never initialized. ││
│  │                                                     ││
│  │  ┌─ ✏️ Edit Proposed ────────────────────────────┐ ││
│  │  │ src/auth.js:45                               │ ││
│  │  │                                              │ ││
│  │  │ - const token = null;                        │ ││
│  │  │ + const token = getToken();                  │ ││
│  │  │                                              │ ││
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐     │ ││
│  │  │  │ Approve  │ │  Reject  │ │   Edit   │     │ ││
│  │  │  └──────────┘ └──────────┘ └──────────┘     │ ││
│  │  └───────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
├─────────────────────────────────────────────────────────┤
│  💬 Type a message...                        📎  🎤  ➤ │
└─────────────────────────────────────────────────────────┘
```

**UI Components Needed:**

1. **Tool Call Card** - Collapsible panel showing tool execution
2. **Diff Viewer** - Side-by-side or unified diff display
3. **Approval Buttons** - Approve/Reject/Edit actions
4. **Progress Indicator** - For long-running operations
5. **File Preview** - Quick look at referenced files
6. **Error Display** - Styled error messages from CLI
7. **Code Block** - Syntax-highlighted code snippets

---

### 5. New Data Models

#### Server-side (Node.js)

```javascript
// Conversation metadata (stored in MobileChatStore)
// Note: conversation.id IS the CLI session ID - no separate ptySessionId needed
{
  id: "uuid",               // Also used as CLI --session-id
  tool: "claude",           // CLI tool being used
  projectPath: "/path/to/project",
  workspaceId: "workspace-hash",
  createdAt: timestamp,
  updatedAt: timestamp,
  messageCount: 15,
  
  // Cached for quick list display (full history in CLI's storage)
  lastMessage: {
    role: "assistant",
    preview: "I've updated the auth.js file...",
    timestamp: timestamp
  }
}

// Message with rich content blocks
{
  id: "uuid",
  role: "user" | "assistant",
  content: [
    { type: "text", text: "Fix the bug" },
    { type: "tool_use", id: "tc_1", name: "read_file", input: {...} },
    { type: "tool_result", tool_use_id: "tc_1", content: "..." },
    { type: "approval_request", id: "ar_1", action: "edit", diff: "..." }
  ],
  timestamp: timestamp,
  status: "streaming" | "complete" | "error"
}
```

#### iOS Client (Swift)

```swift
struct Conversation: Identifiable, Codable {
    let id: UUID              // Also serves as CLI session ID
    let tool: CLITool
    let projectId: String
    let projectPath: String
    var isSessionActive: Bool // Is PTY currently running on server?
    var messages: [Message]   // Cached messages for offline/fast display
    let createdAt: Date
    var updatedAt: Date
}

enum CLITool: String, Codable, CaseIterable {
    case claude = "claude"
    case cursorAgent = "cursor-agent"
    case gemini = "gemini"
}

// Note: No SessionStatus enum needed - sessions are stateless from our perspective
// The CLI handles its own session state; we just track isSessionActive (is PTY running?)

struct Message: Identifiable, Codable {
    let id: UUID
    let role: MessageRole
    var content: [ContentBlock]
    let timestamp: Date
    var status: MessageStatus
}

enum ContentBlock: Codable {
    case text(String)
    case toolUse(ToolCall)
    case toolResult(ToolResult)
    case codeBlock(language: String, code: String)
    case diff(DiffBlock)
    case approvalRequest(ApprovalRequest)
    case error(ErrorBlock)
}

struct ToolCall: Codable {
    let id: String
    let name: String
    let input: [String: AnyCodable]
    var status: ToolStatus  // running | complete | error
}

struct ApprovalRequest: Codable {
    let id: String
    let action: String      // edit_file | delete_file | run_command
    let path: String?
    let diff: String?
    let command: String?
    var response: ApprovalResponse?
}

enum ApprovalResponse: String, Codable {
    case approved
    case rejected
    case edited
}
```

---

## Implementation Phases

### Phase 1: On-Demand PTY Sessions (Foundation)

**New file: `server/src/utils/CLISessionManager.js`**
```javascript
class CLISessionManager {
  constructor(ptyManager, inactivityTimeoutMs = 60000) {
    this.ptyManager = ptyManager;
    this.activeSessions = new Map();  // conversationId -> { pty, timer, tool }
    this.inactivityTimeout = inactivityTimeoutMs;
  }

  // Get existing or spawn new PTY for conversation
  async getOrCreate(conversationId, tool, workspacePath) { }
  
  // Send input to conversation's PTY
  async sendInput(conversationId, input) { }
  
  // Attach output handler (for WebSocket streaming)
  attachOutputHandler(conversationId, handler) { }
  
  // Manually terminate (user closes conversation)
  async terminate(conversationId) { }
  
  // Reset inactivity timer (called on each interaction)
  private resetTimer(conversationId) { }
  
  // Handle inactivity timeout
  private async onInactivityTimeout(conversationId) { }
  
  // Check if session is active
  isActive(conversationId) { }
  
  // Get all active session IDs
  getActiveSessions() { }
}
```

**Server changes:**
- [ ] Create `CLISessionManager` class with on-demand PTY lifecycle
- [ ] Modify `conversations.js` POST message to use CLISessionManager
- [ ] Add WebSocket handlers for PTY I/O relay
- [ ] Implement inactivity timeout (configurable, default 60s)
- [ ] Add session status endpoint (`GET /conversations/:id/session-status`)

**Files to create:**
- `server/src/utils/CLISessionManager.js`

**Files to modify:**
- `server/src/routes/conversations.js`
- `server/src/websocket/index.js`
- `server/src/utils/MobileChatStore.js`

### Phase 2: CLI-Specific Output Parsing

**Server changes:**
- [ ] Enhance `ClaudeAdapter` to parse Claude Code's JSON streaming format
- [ ] Enhance `CursorAgentAdapter` for cursor-agent output
- [ ] Add `GeminiAdapter` output parsing
- [ ] Implement `parseStreamChunk()` for each adapter
- [ ] Normalize output to common `ContentBlock` types

**Files to modify:**
- `server/src/utils/CLIAdapter.js`

### Phase 3: iOS Interactive UI

**iOS changes:**
- [ ] Update `Conversation` and `Message` models
- [ ] Create `ContentBlockView` for rendering different block types
- [ ] Create `ToolCallView` - collapsible tool execution panel
- [ ] Create `DiffView` - file change visualization
- [ ] Create `ApprovalView` - approve/reject/edit buttons
- [ ] Update WebSocket handling for new message types
- [ ] Implement approval/rejection message sending

**Files to create/modify:**
- `ios-client/.../Models/Conversation.swift`
- `ios-client/.../Models/ContentBlock.swift`
- `ios-client/.../Views/Chat/ContentBlockView.swift`
- `ios-client/.../Views/Chat/ToolCallView.swift`
- `ios-client/.../Views/Chat/DiffView.swift`
- `ios-client/.../Views/Chat/ApprovalView.swift`

### Phase 4: Session Management

**Server + iOS changes:**
- [ ] Background session persistence (server keeps PTY alive)
- [ ] Session resume across app launches
- [ ] Multiple concurrent sessions per project
- [ ] Session timeout and cleanup
- [ ] Session status indicators in UI

---

## What Gets Removed

| Component | Reason |
|-----------|--------|
| `CursorChatReader` | No longer reading Cursor IDE's databases |
| `CursorChatWriter` | Not writing to Cursor IDE storage |
| Cursor-specific workspace lookups | Use project paths directly |
| Read-only conversation concept | Everything is mobile-native |
| Fork functionality | No Cursor IDE chats to fork |
| Cursor IDE sync logic | Mobile-only architecture |

---

## New CLI Tools to Support

The architecture should make it easy to add new CLI tools:

| Tool | Status | Notes |
|------|--------|-------|
| Claude Code | ✅ Adapter exists | Needs interactive mode |
| Cursor Agent | ✅ Adapter exists | Needs interactive mode |
| Gemini CLI | ⚠️ Partial | Needs verification of actual CLI flags |
| Aider | 🔜 Planned | Popular open-source AI coding tool |
| Codex CLI | 🔜 Planned | OpenAI's coding assistant |
| Continue | 🔜 Planned | Open-source AI code assistant |

---

## Benefits of This Redesign

1. **Full CLI Power** - All features of claude code, cursor-agent, etc. work on mobile
2. **Real-time Interactivity** - Approve/reject changes, answer prompts, see progress
3. **Tool Agnostic** - Easy to add new CLI tools via adapter pattern
4. **Offline-Capable** - Sessions persist locally, sync when connected
5. **Native Experience** - iOS UI patterns optimized for AI coding workflows
6. **No Cursor IDE Dependency** - Works with any project, not just Cursor workspaces

## Benefits of On-Demand PTY Approach

| Aspect | Always-On PTY | On-Demand PTY (Proposed) |
|--------|---------------|--------------------------|
| **Memory usage** | O(n) where n = total conversations | O(active) where active << total |
| **Server scalability** | Limited by RAM | Much higher capacity |
| **Session persistence** | Must implement ourselves | CLI tools handle it natively |
| **Resume after crash** | Lost unless we checkpoint | CLI session files survive |
| **Cold start latency** | None | ~500ms to spawn PTY |
| **Complexity** | Simpler per-session | Slightly more lifecycle code |

**Why this works:**
- Claude Code, Cursor Agent, etc. are designed for session resume
- They store full conversation context in their own format
- We just need to track the session ID and spawn with `--resume`/`--session-id`
- The 500ms cold start is negligible compared to AI response time

---

## Open Questions

1. **Inactivity timeout** - How long before killing idle PTY? (Proposed: 60s default, configurable)
2. **Multiple tools per project** - Should a project support conversations with different CLI tools?
3. **Tool switching** - Can you switch CLI tools mid-conversation? (Probably no - different session formats)
4. **CLI authentication** - How do CLI tools authenticate? (They use their own config: `~/.claude/`, env vars, etc.)
5. **Max concurrent PTYs** - Server-wide limit? (Proposed: 10-20 concurrent, configurable)
6. **Session cleanup** - How long to keep CLI session files? (Proposed: follow CLI defaults + MobileChatStore retention)
7. **Offline queue** - Should iOS queue messages when server unreachable? Send on reconnect?
8. **Session recovery** - What if CLI session file is corrupted/deleted? Start fresh or error?

---

## Next Steps

1. Review this plan and provide feedback
2. Decide on implementation priority
3. Start with Phase 1 (PTY-based sessions) as foundation
4. Iterate based on testing and feedback
