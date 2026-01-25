# Cursor Mobile Access

Control Cursor IDE on your laptop from your mobile phone. This app provides a local server that runs on your laptop and a mobile-friendly web interface accessible from your phone.

## Features

- **One-Scan Connection**: Just scan the QR code with your phone camera - opens the app and connects automatically!
- **Project Management**: Browse, open, and create new Cursor projects
- **File Browser**: Navigate your file system and view/edit files
- **Code Viewer**: Syntax-highlighted code viewing with edit capabilities
- **Real-time Updates**: WebSocket connection for live file change notifications
- **Conversation History**: View your Cursor AI chat workspace sessions
- **System Info**: Monitor your laptop's status and Cursor IDE state
- **Security**: Token-based authentication to protect your data

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Your Phone    │◄───────►│   Your Laptop   │
│  (Web Browser)  │  WiFi   │    (Server)     │
└─────────────────┘         └─────────────────┘
                                    │
                                    ▼
                            ┌─────────────────┐
                            │   Cursor IDE    │
                            └─────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### 2. Build the Client

```bash
cd client
npm run build
```

### 3. Start the Server

```bash
cd ../server
npm start
```

You'll see a QR code in your terminal:
```
╔═══════════════════════════════════════════════════════════════════╗
║              Cursor Mobile Access Server                           ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                    ║
║   Scan this QR code with your phone camera to connect:            ║
║                                                                    ║
║       ▄▄▄▄▄▄▄  ▄    ▄ ▄▄▄▄▄▄▄                                     ║
║       █ ▄▄▄ █ ▀█▄█▀▄  █ ▄▄▄ █                                     ║
║       █ ███ █ ▀▀ ▄▀▄▄ █ ███ █                                     ║
║       ▀▀▀▀▀▀▀ █ █▀▄▀█ ▀▀▀▀▀▀▀                                     ║
║        ...                                                         ║
║                                                                    ║
╠═══════════════════════════════════════════════════════════════════╣
║   Just point your phone camera at the QR code above!              ║
║   It will open the app and connect automatically.                 ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 4. Connect from Your Phone

**Scan QR Code (Recommended)**
1. Point your phone's camera at the QR code in the terminal
2. Tap the notification/link that appears
3. The app opens and connects automatically - done!

**Manual Entry (Fallback)**
1. Make sure your phone is on the same WiFi network as your laptop
2. Open your phone's browser
3. Navigate to `http://<your-laptop-ip>:3847`
4. Enter the auth token shown in the server output
5. Start controlling Cursor!

## Finding Your Laptop's IP Address

**macOS:**
```bash
ipconfig getifaddr en0
```

**Linux:**
```bash
hostname -I | awk '{print $1}'
```

**Windows:**
```bash
ipconfig | findstr /i "IPv4"
```

Or check the Settings page in the app after connecting - it shows all network interfaces.

## Configuration

Create a `.env` file in the server directory:

```env
# Port to run the server on (default: 3847)
PORT=3847

# Set a custom auth token (otherwise one is generated)
AUTH_TOKEN=your-custom-token-here
```

## Development

### Run in Development Mode

Start the server with auto-reload:
```bash
cd server
npm run dev
```

Start the client dev server (with hot reload):
```bash
cd client
npm run dev
```

The client dev server runs on port 5173 and proxies API requests to the server on port 3847.

## Project Structure

```
cursor-mobile-access/
├── server/
│   ├── src/
│   │   ├── index.js              # Main server entry point
│   │   ├── auth/
│   │   │   └── AuthManager.js    # Token authentication
│   │   ├── routes/
│   │   │   ├── index.js          # Route setup
│   │   │   ├── projects.js       # Project management API
│   │   │   ├── files.js          # File operations API
│   │   │   ├── conversations.js  # Chat history API
│   │   │   └── system.js         # System info API
│   │   ├── utils/
│   │   │   └── CursorWorkspace.js # Cursor integration
│   │   └── websocket/
│   │       └── index.js          # Real-time updates
│   └── package.json
│
├── client/
│   ├── src/
│   │   ├── main.jsx              # App entry point
│   │   ├── App.jsx               # Main app component
│   │   ├── context/
│   │   │   ├── AuthContext.jsx   # Authentication state
│   │   │   └── WebSocketContext.jsx # Real-time connection
│   │   ├── components/
│   │   │   └── Layout.jsx        # App layout
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx     # Authentication
│   │   │   ├── ProjectsPage.jsx  # Project list
│   │   │   ├── ProjectDetailPage.jsx # Project details
│   │   │   ├── FileBrowserPage.jsx # File navigation
│   │   │   ├── FileViewerPage.jsx # Code viewer/editor
│   │   │   ├── ConversationsPage.jsx # Chat history
│   │   │   └── SettingsPage.jsx  # App settings
│   │   └── styles/
│   │       └── global.css        # Global styles
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
└── README.md
```

## API Reference

### Authentication

All API endpoints (except `/health`) require the `Authorization` header:
```
Authorization: Bearer <your-token>
```

### Endpoints

#### Projects
- `GET /api/projects` - List recent Cursor projects
- `GET /api/projects/:id` - Get project details
- `GET /api/projects/:id/tree` - Get project file tree
- `POST /api/projects` - Create new project
- `POST /api/projects/:id/open` - Open project in Cursor

#### Files
- `GET /api/files/read?filePath=...` - Read file content
- `POST /api/files/write` - Write file content
- `GET /api/files/list?dirPath=...` - List directory contents
- `POST /api/files/create` - Create new file
- `DELETE /api/files/delete?filePath=...` - Delete file

#### Conversations
- `GET /api/conversations` - List workspace sessions
- `GET /api/conversations/:id` - Get conversation details
- `GET /api/conversations/:id/messages` - Get messages

#### System
- `GET /api/system/info` - Get system information
- `GET /api/system/network` - Get network interfaces
- `GET /api/system/cursor-status` - Check if Cursor is running
- `POST /api/system/open-cursor` - Open path in Cursor
- `POST /api/system/exec` - Execute terminal command

### WebSocket

Connect to `ws://<server>:3847` and authenticate:
```json
{ "type": "auth", "token": "your-token" }
```

Watch for file changes:
```json
{ "type": "watch", "path": "/path/to/project" }
```

Receive change notifications:
```json
{
  "type": "fileChange",
  "event": "change",
  "path": "/path/to/file.js",
  "relativePath": "file.js",
  "timestamp": 1700000000000
}
```

## Security Notes

- The server only listens on your local network
- All API requests require authentication
- Dangerous terminal commands are blocked
- Tokens are stored securely in browser localStorage
- Consider using HTTPS in production environments

## Troubleshooting

### Can't connect from phone
1. Ensure both devices are on the same WiFi network
2. Check that no firewall is blocking port 3847
3. Try using the IP address from Settings > Network

### Projects not showing
- Cursor stores project history in different locations depending on your OS
- The app scans common Cursor storage paths automatically
- Recently opened projects in Cursor should appear

### File changes not detected
- Make sure WebSocket is connected (check Settings page)
- Large files or many rapid changes might be throttled

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT License - feel free to use this project for personal or commercial purposes.
