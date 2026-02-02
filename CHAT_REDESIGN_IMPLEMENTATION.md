# Chat Redesign Implementation

## Context

The goal is to redesign the mobile app's chat feature to:
1. Only care about chats initiated on mobile (not Cursor IDE sync)
2. Act as a wrapper around AI CLI tools available on the server (Claude Code, Cursor Agent, Gemini CLI, etc.)
3. Provide full CLI functionality through a native iOS UI

The key architectural insight is that CLI tools like `claude` and `cursor-agent` already have built-in session persistence. By using the conversation ID as the CLI's session ID, we can:
- Spawn PTY sessions on-demand (only when user is actively chatting)
- Kill PTY after inactivity to save resources
- Resume seamlessly because the CLI loads its own session history

See `CHAT_REDESIGN.md` for the full design document.

---

## Progress

### Phase 1: On-Demand PTY Sessions ✅ COMPLETE

| Task | Status | Details |
|------|--------|---------|
| Create `CLISessionManager.js` | ✅ Done | New class managing on-demand PTY lifecycle |
| Update `CLIAdapter.js` | ✅ Done | Added `buildInteractiveArgs()` for each adapter |
| Update `PTYManager.js` | ✅ Done | Added `args` parameter for CLI commands |
| Update `conversations.js` | ✅ Done | Added session status endpoints |
| Update `websocket/index.js` | ✅ Done | Added chat session WebSocket handlers |
| Syntax verification | ✅ Done | All files pass `node --check` |

### Phase 2: CLI-Specific Output Parsing ✅ COMPLETE

| Task | Status | Details |
|------|--------|---------|
| Create `OutputParser.js` | ✅ Done | ContentBlock types, StreamParser class |
| ClaudeAdapter parsing | ✅ Done | JSON event parsing, text line detection |
| CursorAgentAdapter parsing | ✅ Done | JSON event parsing, text line detection |
| GeminiAdapter parsing | ✅ Done | JSON event parsing, text line detection |
| CLISessionManager integration | ✅ Done | Uses StreamParser, sends parsed blocks |
| WebSocket structured output | ✅ Done | Sends `chatContentBlocks` with parsed data |
| Syntax verification | ✅ Done | All files pass `node --check` |

### Phase 3: iOS Interactive UI ✅ COMPLETE

| Task | Status | Details |
|------|--------|---------|
| Create `ChatContentBlock` model | ✅ Done | `Models/ContentBlock.swift` with all block types |
| Create `ChatSessionEvent` model | ✅ Done | WebSocket event types for session management |
| Create `ParsedMessage` model | ✅ Done | Message composed of content blocks |
| Create `ContentBlockView.swift` | ✅ Done | SwiftUI views for each block type |
| Create `ChatSessionView.swift` | ✅ Done | WebSocket-based chat view |
| Update `WebSocketManager.swift` | ✅ Done | Added chat session handlers |
| Add files to Xcode project | ✅ Done | Added to project.pbxproj |
| Fix naming conflicts | ✅ Done | Renamed to `ChatContentBlock`, `ChatDiffLine`, `ChatDiffHunk`, `ChatParsedDiff`, `ChatCodeBlockView` |
| iOS build verification | ✅ Done | Build succeeds |

### Phase 4: Session Management ✅ COMPLETE

| Task | Status | Details |
|------|--------|---------|
| Background session persistence | ✅ Done | Session state stored in MobileChatStore |
| Session resume across app launches | ✅ Done | `ChatSessionManager.swift` handles local persistence |
| Multiple concurrent sessions | ✅ Done | Configurable via `maxConcurrentSessions` |
| Session timeout and cleanup | ✅ Done | Configurable inactivity timeout with REST API |
| Session state endpoints | ✅ Done | Resumable/recent sessions, config endpoints |
| iOS ChatSessionManager | ✅ Done | Swift service for session state management |

---

## Files Created/Modified

### New Files - Server

| File | Purpose |
|------|---------|
| `server/src/utils/CLISessionManager.js` | Manages on-demand PTY sessions for CLI tools |
| `server/src/utils/OutputParser.js` | ContentBlock types, StreamParser for parsing CLI output |

### New Files - iOS

| File | Purpose |
|------|---------|
| `ios-client/.../Models/ContentBlock.swift` | Swift models for `ChatContentBlock`, `ParsedMessage`, `ChatSessionEvent`, `ChatParsedDiff` |
| `ios-client/.../Views/Chat/ContentBlockView.swift` | SwiftUI views for rendering each block type (text, tool calls, diffs, approvals, etc.) |
| `ios-client/.../Views/Chat/ChatSessionView.swift` | Main interactive chat view that connects to WebSocket and renders content blocks |
| `ios-client/.../Services/ChatSessionManager.swift` | Session state management and persistence across app launches |

### Modified Files - Server

| File | Changes |
|------|---------|
| `server/src/utils/CLIAdapter.js` | Added `buildInteractiveArgs()`, `getCapabilities()`, and parsing methods (`getParseStrategy()`, `parseJsonEvent()`, `parseTextLine()`, `detectApprovalRequest()`) |
| `server/src/utils/PTYManager.js` | Added `args` parameter to `spawnTerminal()` |
| `server/src/routes/conversations.js` | Added session status endpoints, Phase 4 session management endpoints |
| `server/src/websocket/index.js` | Added chat session WebSocket handlers, sends structured content blocks |
| `server/src/utils/CLISessionManager.js` | Integrated StreamParser, outputs parsed content blocks, Phase 4 config/resume support |
| `server/src/utils/MobileChatStore.js` | Added session state tracking (`sessionState`, `lastSessionAt`, `suspendReason`), session config persistence |

### Modified Files - iOS

| File | Changes |
|------|---------|
| `ios-client/.../Services/WebSocketManager.swift` | Added chat session handlers: `attachChat()`, `detachChat()`, `sendChatMessage()`, `cancelChat()`, `sendChatApproval()`, `sendChatInput()` |
| `ios-client/.../CursorMobile.xcodeproj/project.pbxproj` | Added new Swift files to build targets and file groups |

---

## New REST Endpoints

### Session Management (Phase 1)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/conversations/sessions/stats` | GET | Get CLI session manager statistics |
| `/api/conversations/:id/session` | GET | Get session status for a conversation |
| `/api/conversations/:id/session` | DELETE | Terminate a session (preserves CLI history) |

### Session Management (Phase 4)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/conversations/sessions/resumable` | GET | Get all suspended sessions that can be resumed |
| `/api/conversations/sessions/recent` | GET | Get recently used sessions (last 24h by default) |
| `/api/conversations/sessions/config` | GET | Get session configuration |
| `/api/conversations/sessions/config` | PUT | Update session configuration |

---

## New WebSocket Message Types

### Client → Server

| Type | Purpose | Payload |
|------|---------|---------|
| `chatAttach` | Attach to conversation, creates PTY if needed | `{ conversationId, workspaceId? }` |
| `chatDetach` | Detach from output stream | `{ conversationId }` |
| `chatMessage` | Send message to CLI | `{ conversationId, content, workspaceId? }` |
| `chatCancel` | Send Ctrl+C interrupt | `{ conversationId }` |

### Server → Client

| Type | Purpose | Payload |
|------|---------|---------|
| `chatAttached` | Confirm attachment | `{ conversationId, tool, isNew, workspacePath }` |
| `chatContentBlocks` | Parsed content blocks (Phase 2) | `{ conversationId, blocks[], isBuffer }` |
| `chatData` | Raw CLI output stream (fallback) | `{ conversationId, data, isBuffer }` |
| `chatMessageSent` | Confirm message sent | `{ conversationId, messageId }` |
| `chatSessionSuspended` | Session suspended due to inactivity | `{ conversationId, reason }` |
| `chatSessionEnded` | Session terminated | `{ conversationId, reason }` |
| `chatCancelled` | Interrupt sent | `{ conversationId }` |
| `chatError` | Error occurred | `{ conversationId?, message }` |

---

## Content Block Types (Phase 2)

The server parses CLI output into structured content blocks. Each block has:

```javascript
{
  type: 'text',           // Block type
  id: 'block-xxx-yyy',    // Unique ID
  timestamp: 1234567890,  // Unix timestamp
  // ... type-specific fields
}
```

### Available Block Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `text` | Plain text from assistant | `content`, `isPartial` |
| `thinking` | Processing/thinking indicator | `content` |
| `tool_use_start` | Tool/function call started | `toolId`, `toolName`, `input` |
| `tool_use_result` | Tool completed with result | `toolId`, `content`, `isError` |
| `file_read` | File read operation | `path` |
| `file_edit` | File edit with diff | `path`, `diff` |
| `command_run` | Shell command execution | `command` |
| `command_output` | Command output | `content`, `exitCode` |
| `approval_request` | Waiting for user approval | `action`, `prompt`, `options` |
| `input_request` | Waiting for user input | `type`, `prompt` |
| `error` | Error message | `message`, `code` |
| `progress` | Status/progress update | `message`, `isSuccess` |
| `code_block` | Syntax highlighted code | `language`, `code` |
| `raw` | Unparsed terminal output | `content` |
| `session_start` | Session started | `model`, `role` |
| `session_end` | Session ended | `reason`, `suspended` |
| `usage` | Token usage info | `inputTokens`, `outputTokens` |

---

## Session State Management (Phase 4)

### Session States

| State | Description |
|-------|-------------|
| `active` | PTY is running, user is actively chatting |
| `suspended` | PTY killed due to inactivity, can be resumed |
| `ended` | Session terminated by user or system |

### Session Configuration

| Option | Default | Range | Description |
|--------|---------|-------|-------------|
| `inactivityTimeoutMs` | 60000 (60s) | 10s - 1hr | Time before idle PTY is killed |
| `maxConcurrentSessions` | 20 | 1 - 50 | Server-wide limit on active PTYs |
| `autoResumeEnabled` | true | - | Whether to auto-resume on attach |

### iOS Session Persistence

The iOS `ChatSessionManager` provides:
- Last active conversation tracking for auto-resume
- Local caching of session configuration
- API methods for fetching resumable/recent sessions
- Session status checking and termination

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        iOS Client                                │
├─────────────────────────────────────────────────────────────────┤
│  1. Create conversation via REST API                            │
│  2. Connect WebSocket, send "chatAttach"                        │
│  3. Receive "chatAttached" confirmation                         │
│  4. Send messages via "chatMessage"                             │
│  5. Receive streaming output via "chatContentBlocks"            │
│  6. On app close: ChatSessionManager saves active conversation  │
│  7. On app launch: ChatSessionManager can auto-resume           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Server                                   │
├─────────────────────────────────────────────────────────────────┤
│  CLISessionManager                                               │
│  ├── On chatAttach: getOrCreate(conversationId, tool, path)     │
│  │   └── Spawns PTY with: claude --resume --session-id <id>     │
│  │   └── Updates session state to 'active' in MobileChatStore  │
│  ├── On chatMessage: sendInput(conversationId, content)         │
│  │   └── Writes to PTY stdin                                    │
│  ├── PTY output → parsed → streamed to all attached clients     │
│  └── After inactivity: kills PTY, marks 'suspended' in store   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CLI Tool (PTY)                              │
├─────────────────────────────────────────────────────────────────┤
│  claude --resume --session-id <conversationId> --workspace /... │
│  ├── Loads session history from ~/.claude/sessions/<id>/        │
│  ├── Processes user input                                       │
│  ├── Streams output (tool calls, text, etc.)                    │
│  └── Persists session state automatically                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Configuration

The CLISessionManager has configurable options that can be changed via REST API:

| Option | Default | API Endpoint | Description |
|--------|---------|--------------|-------------|
| Inactivity Timeout | 60 seconds | PUT /sessions/config | Time before idle PTY is killed |
| Max Concurrent Sessions | 20 | PUT /sessions/config | Server-wide limit on active PTYs |
| Auto Resume | true | PUT /sessions/config | Auto-resume suspended sessions |
| Output Buffer Size | 32 KB | - | Per-session buffer for late-joining clients |

---

## Testing

To test the implementation:

1. **Start the server** (user must do this manually per project rules)
2. **Create a conversation** via REST:
   ```bash
   curl -X POST http://localhost:3000/api/conversations \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <token>" \
     -d '{"workspaceId": "global", "tool": "claude"}'
   ```
3. **Connect WebSocket** and send:
   ```json
   {"type": "auth", "token": "<token>"}
   {"type": "chatAttach", "conversationId": "<id>"}
   {"type": "chatMessage", "conversationId": "<id>", "content": "Hello!"}
   ```
4. **Observe `chatContentBlocks` messages** streaming back with parsed content
5. **Test session management**:
   ```bash
   # Get resumable sessions
   curl http://localhost:3000/api/conversations/sessions/resumable \
     -H "Authorization: Bearer <token>"
   
   # Get session config
   curl http://localhost:3000/api/conversations/sessions/config \
     -H "Authorization: Bearer <token>"
   
   # Update inactivity timeout to 5 minutes
   curl -X PUT http://localhost:3000/api/conversations/sessions/config \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <token>" \
     -d '{"inactivityTimeoutMs": 300000}'
   ```

---

## Next Steps

All phases are now complete. Recommended follow-up tasks:

1. **Wire up navigation** - Integrate `ChatSessionView` into the existing conversation flow in the iOS app
2. **Add resumable sessions UI** - Show a "Resume" section in the conversations list using `ChatSessionManager.resumableSessions`
3. **Test end-to-end** - Verify full flow: iOS → server → CLI → parsed output → iOS UI
4. **Add settings UI** - Allow users to configure session timeout and other options via the iOS Settings screen
5. **Performance testing** - Test with multiple concurrent sessions and heavy CLI output
