# Napp Trapp API - Bruno Collection

This Bruno collection provides comprehensive API documentation and debugging tools for the Napp Trapp server.

## Getting Started

### 1. Install Bruno

Download Bruno from [usebruno.com](https://www.usebruno.com/) or install via Homebrew:

```bash
brew install bruno
```

### 2. Open the Collection

1. Open Bruno
2. Click "Open Collection"
3. Navigate to this `bruno-collection` folder
4. Select the folder to import

### 3. Configure Environment

1. Click on the environment dropdown (top-right)
2. Select "local" environment
3. Click "Configure" to edit variables:
   - `baseUrl`: Server URL (default: `http://localhost:3847`)
   - `authToken`: Your authentication token (find in server startup output)
   - `projectId`: Base64-encoded project path
   - `projectPath`: Absolute path to your project

### 4. Get Your Auth Token

When the server starts, it displays the auth token:

```
╔═══════════════════════════════════════════════════════════════════╗
║   Token: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx                     ║
╚═══════════════════════════════════════════════════════════════════╝
```

Copy this token and paste it into the `authToken` environment variable.

## Collection Structure

### API Folders

Complete documentation for all API endpoints:

| Folder | Description |
|--------|-------------|
| **Auth** | Authentication, health check, QR code |
| **Projects** | List, create, open projects |
| **Files** | Read, write, list, rename, move files |
| **Conversations** | AI chat sessions (Claude, cursor-agent, etc.) |
| **Terminals** | PTY and tmux terminal management |
| **Git** | Status, staging, commits, branches, push/pull |
| **System** | System info, iOS build, models, restart |
| **Suggestions** | Autocomplete suggestions for @ and / |
| **Logs** | Server logs and debugging |

### Workflow Folders

Step-by-step guides for common tasks:

| Workflow | Description |
|----------|-------------|
| **File-Operations** | List → Read → Edit → Verify files |
| **Chat-Workflows** | Check tools → Create chat → Send prompts |
| **Git-Workflows** | Status → Diff → Stage → Commit → Push |
| **Terminal-Workflows** | Create → Use → Cleanup terminals |
| **Project-Setup** | Create → Open → Explore → Start AI chat |

## Quick Start Examples

### Check Server Health

```
GET /health
```

No authentication required. Returns server status.

### List Projects

```
GET /api/projects
Authorization: Bearer {token}
```

### Create AI Chat

```
POST /api/conversations
{
  "projectPath": "/path/to/project",
  "tool": "claude",
  "topic": "my-task",
  "mode": "agent"
}
```

### Read a File

```
GET /api/files/read?filePath=/path/to/file.js
```

## WebSocket Connection

For real-time terminal output, connect to WebSocket:

```
ws://localhost:3847/ws?token=YOUR_TOKEN
```

### Attach to Terminal

```json
{
  "type": "terminal:attach",
  "terminalId": "tmux-mobile-project:1"
}
```

### Send Terminal Input

```json
{
  "type": "terminal:input",
  "terminalId": "tmux-mobile-project:1",
  "data": "ls -la\n"
}
```

## Tips

### Getting projectId

The `projectId` is a Base64-encoded project path. You can get it from:

1. The `GET /api/projects` response
2. Manually encoding: `echo -n "/path/to/project" | base64`

### Terminal ID Formats

- PTY terminals: `pty-1`, `pty-2`, etc.
- Tmux terminals: `tmux-{sessionName}:{windowIndex}`
- Cursor IDE: `cursor-1`, `cursor-2`, etc.

### AI Tools

Available tools for chat sessions:
- `claude` - Claude CLI (Anthropic)
- `cursor-agent` - Cursor Agent
- `aider` - Aider
- `gemini` - Gemini CLI

Check availability with `GET /api/conversations/tools/availability`

## Troubleshooting

### 401 Unauthorized

- Verify your auth token is correct
- Check that `authToken` is set in the environment
- Ensure the server is running

### Connection Refused

- Verify the server is running on port 3847
- Check `baseUrl` in environment settings

### Project Not Found

- Verify the project path exists
- Ensure `projectId` is properly Base64-encoded

## License

Part of the Napp Trapp project.
