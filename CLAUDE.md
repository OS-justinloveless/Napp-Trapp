# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Napp Trapp (formerly Mobile-cursor) is a mobile-first IDE controller that allows you to control Cursor IDE from your phone. The project consists of:

- **Server** (Node.js/Express): Backend server that manages projects, files, Git operations, AI chat sessions, and terminals
- **Web Client** (React/Vite): Browser-based mobile interface
- **iOS Client** (SwiftUI): Native iOS app
- **Android Client** (Kotlin/Jetpack Compose): Native Android app

## Key Architecture

### Server Architecture (Node.js)

The server uses a manager-based architecture where specialized managers handle different domains:

**Core Managers** (`server/src/utils/`):
- `ChatProcessManager.js` - Manages AI CLI processes (Claude, Cursor Agent, Gemini) with structured JSON streaming
- `ChatPersistenceStore.js` - Persists chat conversations and messages across server restarts
- `GitManager.js` - Handles all Git operations (status, diff, log, commit, etc.)
- `TmuxManager.js` - Manages tmux sessions for terminal multiplexing
- `PTYManager.js` - Manages pseudo-terminal (PTY) processes for interactive shells
- `ProjectManager.js` - Discovers and manages Cursor projects
- `LogManager.js` - Centralized logging system
- `CLIAdapter.js` - Adapts different AI CLI tools (Claude, Cursor Agent, Gemini) to a unified interface
- `SuggestionsReader.js` - Reads inline suggestions from Cursor's proprietary database

**API Routes** (`server/src/routes/`):
- `conversations.js` - AI chat session endpoints
- `projects.js` - Project management and file tree operations
- `files.js` - File read/write/create/delete operations
- `git.js` - Git operations (status, diff, log, commit, branch management)
- `system.js` - System info, network interfaces, Cursor status
- `terminals.js` - Terminal creation and management (PTY and tmux)
- `suggestions.js` - Read inline suggestions from Cursor's database
- `logs.js` - Server log streaming

**WebSocket** (`server/src/websocket/index.js`):
- File change watching using `chokidar`
- Terminal output streaming (PTY and tmux)
- Chat message streaming
- Real-time event broadcasting

**Authentication** (`server/src/auth/AuthManager.js`):
- Token-based authentication
- Persistent token storage in `.napp-trapp-data/auth.json`

### Client Architecture

**Web Client** (`client/src/`):
- React app using React Router for navigation
- Context-based state management (AuthContext, WebSocketContext)
- Pages for projects, files, conversations, settings
- Vite for development and building

**iOS Client** (`ios-client/CursorMobile/`):
- SwiftUI-based native app
- Models, Services, and Views organized by feature
- Built using Makefile commands

**Android Client** (`android-client/app/`):
- Kotlin with Jetpack Compose
- Follows MVVM architecture pattern
- Built using Gradle

### Chat System Architecture

The chat system uses a unique architecture that bridges mobile clients to AI CLI tools:

1. **ChatProcessManager** spawns AI CLI processes with `--output-format stream-json` flag
2. CLI outputs structured JSON events (text blocks, tool use, thinking, etc.)
3. Manager parses JSON and broadcasts clean content blocks to clients
4. **ChatPersistenceStore** persists all messages to survive server restarts
5. Sessions can be resumed using stored `sessionId`

Supported AI tools:
- `claude` - Claude CLI agent (primary)
- `cursor-agent` - Cursor's CLI agent
- `gemini` - Google Gemini CLI

## Development Commands

### Server

```bash
# Start server (production)
cd server && npm start

# Development mode with auto-reload
cd server && npm run dev

# Build bundled client into server
cd server && npm run build:client
```

**IMPORTANT**: Never start or stop the server automatically. Only the user should control server lifecycle. See `.cursor/rules/server-management.mdc`.

### Web Client

```bash
# Development server (port 5173, proxies to server:3847)
cd client && npm run dev

# Build for production
cd client && npm run build

# Preview production build
cd client && npm run preview
```

### iOS Client

```bash
# Build for simulator
cd ios-client && make build

# Build and run on simulator
cd ios-client && make run

# Run on already-booted simulator (faster)
cd ios-client && make run-fast

# Debug: build, reinstall, and screenshot
cd ios-client && make debug

# Take screenshot of simulator
cd ios-client && make screenshot

# Stream app logs
cd ios-client && make logs

# Reinstall app (preserves data)
cd ios-client && make reinstall

# Clean reinstall (removes data)
cd ios-client && make clean-reinstall

# List available simulators
cd ios-client && make list-simulators

# Clean build artifacts
cd ios-client && make clean
```

**CRITICAL iOS Build Rule**: After modifying any Swift file, you **must** rebuild the iOS app to verify compilation succeeds. Run `cd ios-client && make build` and fix any compilation errors before considering the task complete. See `.cursor/rules/ios-build-verification.mdc`.

### Adding New Files to Xcode Project

**CRITICAL**: When creating new Swift files, they must be added to the Xcode project file manually. The Xcode GUI methods (Add Files, Drag & Drop) often don't work reliably.

**Working Method: Edit project.pbxproj directly**

1. Create your new Swift file in the appropriate directory (e.g., `ios-client/CursorMobile/CursorMobile/Services/NewService.swift`)

2. Open `ios-client/CursorMobile/CursorMobile.xcodeproj/project.pbxproj` in a text editor

3. Find an existing similar file reference and copy its pattern. Look for:
   ```
   /* ExistingFile.swift in Sources */ = {isa = PBXBuildFile; fileRef = XXXXXXXX /* ExistingFile.swift */; };
   ```

4. Generate a unique 24-character hex ID (use `uuidgen | tr -d '-' | cut -c1-24`)

5. Add your file in THREE sections:
   - **PBXBuildFile section**: Links file to build phase
   - **PBXFileReference section**: Defines the file
   - **PBXGroup section**: Adds to folder structure
   - **PBXSourcesBuildPhase section**: Includes in compilation

6. Save and verify with `cd ios-client && make build`

**Verification**
- Build succeeds without "No such file" errors
- File appears in Xcode Project Navigator after reopening
- No duplicate symbol errors

**Common Issues**
- "No such file" error → File reference path is wrong or file not added to PBXSourcesBuildPhase
- "Duplicate symbol" error → File added twice in project.pbxproj
- Xcode shows file in red → Path in PBXFileReference doesn't match actual file location

### Android Client

```bash
# Build debug APK
cd android-client && ./gradlew assembleDebug

# Build and install on device/emulator
cd android-client && ./gradlew installDebug

# Clean build
cd android-client && ./gradlew clean
```

### Running from CLI (npx)

```bash
# Run directly without installation
npx napptrapp

# With custom port
npx napptrapp --port 8080

# With custom auth token
npx napptrapp --token mytoken
```

### Docker

```bash
# Run with Docker
docker run -p 3847:3847 justinlovelessx/napptrapp

# With docker-compose
docker-compose up

# With persistent data
docker run -p 3847:3847 -v napptrapp-data:/data justinlovelessx/napptrapp
```

## Testing and Debugging

### iOS Simulator Debugging

Use the debug script for comprehensive iOS debugging:

```bash
# Check simulator status
cd ios-client && ./scripts/debug.sh status

# Take screenshot
cd ios-client && ./scripts/debug.sh screenshot

# Stream logs (30 seconds)
cd ios-client && ./scripts/debug.sh logs stream 30

# Capture logs to file
cd ios-client && ./scripts/debug.sh logs capture 60

# Check crash logs
cd ios-client && ./scripts/debug.sh crash-logs

# Get app container info
cd ios-client && ./scripts/debug.sh app-info

# Relaunch app
cd ios-client && ./scripts/debug.sh launch

# Test deep link
cd ios-client && ./scripts/debug.sh openurl "cursormobile://project/123"
```

Screenshots and logs are saved to `ios-client/debug-output/`.

See `.cursor/rules/ios-simulator-debugging.mdc` for complete debugging workflow.

## Important Technical Details

### Data Persistence

- Server data stored in `.napp-trapp-data/` (or `~/.napptrapp` when running via CLI)
- Chat conversations persist across server restarts
- Auth token persists in `auth.json`
- Cursor's inline suggestions stored in SQLite database at `~/Library/Application Support/Cursor/User/workspaceStorage/*/state.vscdb`

### AI Chat Process Management

The `ChatProcessManager` uses direct process spawning (not tmux) for AI CLI tools:
- Spawns with `--output-format stream-json` for structured output
- Parses JSON events: `text`, `tool_use_start`, `tool_use_result`, `thinking`, `error`
- Maintains conversation state for resume capability
- Handles permission requests and denials
- Buffers messages (default 100 per conversation)

### Git Operations

The `GitManager` uses `execFile` (not shell commands) for security:
- No shell injection vulnerabilities
- All paths properly escaped
- Handles quoted paths from git output
- 10MB buffer for large diffs
- 30-second timeout (configurable)

### Terminal Management

Two terminal systems:
1. **PTY (node-pty)** - Simple interactive shells
2. **Tmux** - Full terminal multiplexing with session persistence

Both support:
- WebSocket streaming to clients
- Multiple concurrent sessions
- Input/output handling
- Resize events

### File Watching

Uses `chokidar` for file system watching:
- Real-time file change notifications
- Debounced events
- WebSocket broadcast to subscribed clients

## API Endpoints

All endpoints require `Authorization: Bearer <token>` header (except `/health`).

**Projects**: `/api/projects`, `/api/projects/:id`, `/api/projects/:id/tree`

**Files**: `/api/files/read`, `/api/files/write`, `/api/files/list`, `/api/files/create`, `/api/files/delete`

**Conversations**: `/api/conversations`, `/api/conversations/:id`, `/api/conversations/:id/messages`

**Git**: `/api/git/:projectId/status`, `/api/git/:projectId/diff`, `/api/git/:projectId/log`, `/api/git/:projectId/commit`

**System**: `/api/system/info`, `/api/system/network`, `/api/system/cursor-status`, `/api/system/exec`

**Terminals**: `/api/terminals/create`, `/api/terminals/:id/resize`, `/api/terminals/:id/destroy`

**WebSocket**: `ws://<server>:3847` - File watching, terminal streaming, chat streaming

## Configuration

Environment variables (`.env` in `server/`):
- `PORT` - Server port (default: 3847)
- `AUTH_TOKEN` - Custom auth token (otherwise generated)
- `NAPPTRAPP_DATA_DIR` - Data directory location
- `CHAT_RETENTION_DAYS` - Chat retention period (default: 30)
- `CHAT_MAX_CONVERSATIONS` - Max stored conversations (default: 100)

## Prerequisites

**For Mobile Chat Feature**:
```bash
# Install cursor-agent CLI
curl https://cursor.com/install -fsS | bash

# Authenticate
cursor-agent login
```

**For iOS Development**:
- Xcode with iOS SDK
- iOS Simulator
- Command Line Tools installed

**For Android Development**:
- Android Studio or Android SDK
- Java 17+
- Gradle

## Project Structure Notes

- Server code is ES modules (uses `import`, not `require`)
- Client uses Vite for fast dev server with HMR
- iOS uses Xcode project (not workspace)
- Android uses Gradle with Kotlin DSL
- All managers use singleton or factory patterns
- Authentication required for all API endpoints except health check
- WebSocket requires auth message after connection

## Security Considerations

- Token-based authentication for all requests
- Shell command injection prevention via `execFile`
- Dangerous terminal commands blocked
- File operations restricted to accessible paths
- WebSocket requires authentication
- No ANSI escape code injection in chat output (uses structured JSON)
