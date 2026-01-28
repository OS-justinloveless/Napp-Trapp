import Foundation
import Combine

struct FileChangeEvent: Identifiable {
    let id = UUID()
    let event: String
    let path: String
    let relativePath: String
    let timestamp: Date
}

@MainActor
class WebSocketManager: ObservableObject {
    @Published var isConnected = false
    @Published var fileChanges: [FileChangeEvent] = []
    @Published var lastMessage: [String: Any]?
    
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession?
    private var serverUrl: String?
    private var token: String?
    private var reconnectTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    
    private let maxFileChanges = 50
    
    // Terminal support
    private var terminalOutputHandlers: [String: (String) -> Void] = [:]
    private var terminalErrorHandlers: [String: (String) -> Void] = [:]
    private var terminalCreatedHandler: ((Terminal) -> Void)?
    private var terminalClosedHandler: ((String) -> Void)?
    
    func connect(serverUrl: String, token: String) {
        self.serverUrl = serverUrl
        self.token = token
        
        establishConnection()
    }
    
    func disconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        
        // Invalidate session to release resources
        session?.invalidateAndCancel()
        session = nil
        
        // Clear terminal handlers to release any captured references
        terminalOutputHandlers.removeAll()
        terminalErrorHandlers.removeAll()
        
        isConnected = false
    }
    
    deinit {
        // Note: This is a @MainActor class, so deinit runs on main actor
        // Cancel any pending tasks
        reconnectTask?.cancel()
        receiveTask?.cancel()
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        session?.invalidateAndCancel()
        print("[WebSocketManager] deinit called")
    }
    
    private func establishConnection() {
        guard let serverUrl = serverUrl, let token = token else { return }
        
        // Convert http(s) to ws(s)
        let wsUrl = serverUrl
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")
        
        guard let url = URL(string: wsUrl) else {
            print("Invalid WebSocket URL: \(wsUrl)")
            return
        }
        
        let session = URLSession(configuration: .default)
        self.session = session
        
        let task = session.webSocketTask(with: url)
        self.webSocketTask = task
        
        task.resume()
        
        // Send authentication
        let authMessage: [String: Any] = ["type": "auth", "token": token]
        if let data = try? JSONSerialization.data(withJSONObject: authMessage),
           let jsonString = String(data: data, encoding: .utf8) {
            task.send(.string(jsonString)) { [weak self] error in
                if let error = error {
                    print("WebSocket auth send error: \(error)")
                    Task { @MainActor in
                        self?.scheduleReconnect()
                    }
                }
            }
        }
        
        // Start receiving messages
        receiveTask = Task { [weak self] in
            await self?.receiveMessages()
        }
    }
    
    private func receiveMessages() async {
        guard let task = webSocketTask else { return }
        
        while !Task.isCancelled {
            do {
                let message = try await task.receive()
                
                switch message {
                case .string(let text):
                    await handleMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        await handleMessage(text)
                    }
                @unknown default:
                    break
                }
            } catch {
                print("WebSocket receive error: \(error)")
                await MainActor.run {
                    isConnected = false
                    scheduleReconnect()
                }
                break
            }
        }
    }
    
    private func handleMessage(_ text: String) async {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        
        await MainActor.run {
            lastMessage = json
            
            guard let type = json["type"] as? String else { return }
            
            switch type {
            case "auth":
                if let success = json["success"] as? Bool, success {
                    isConnected = true
                    print("WebSocket authenticated")
                } else {
                    print("WebSocket auth failed")
                    disconnect()
                }
                
            case "fileChange":
                let event = FileChangeEvent(
                    event: json["event"] as? String ?? "change",
                    path: json["path"] as? String ?? "",
                    relativePath: json["relativePath"] as? String ?? "",
                    timestamp: Date()
                )
                
                fileChanges.insert(event, at: 0)
                if fileChanges.count > maxFileChanges {
                    fileChanges = Array(fileChanges.prefix(maxFileChanges))
                }
                
            case "terminalAttached":
                if let terminalId = json["terminalId"] as? String {
                    print("WebSocket: Terminal attached - \(terminalId)")
                }
                
            case "terminalData":
                if let terminalId = json["terminalId"] as? String,
                   let data = json["data"] as? String,
                   let handler = terminalOutputHandlers[terminalId] {
                    handler(data)
                }
                
            case "terminalError":
                let message = json["message"] as? String ?? "Unknown error"
                if let terminalId = json["terminalId"] as? String,
                   let handler = terminalErrorHandlers[terminalId] {
                    handler(message)
                } else {
                    // General terminal error (e.g., from creation failure)
                    print("WebSocket: Terminal error - \(message)")
                }
                
            case "terminalCreated":
                print("WebSocket: Received terminalCreated message")
                if let terminalDict = json["terminal"] as? [String: Any] {
                    print("WebSocket: Parsing terminal dict: \(terminalDict)")
                    let terminal = Terminal(
                        id: terminalDict["id"] as? String ?? "",
                        name: terminalDict["name"] as? String ?? "Terminal",
                        cwd: terminalDict["cwd"] as? String ?? "",
                        pid: terminalDict["pid"] as? Int ?? 0,
                        active: terminalDict["active"] as? Bool ?? true,
                        exitCode: terminalDict["exitCode"] as? Int,
                        source: terminalDict["source"] as? String ?? "mobile-pty",
                        lastCommand: terminalDict["lastCommand"] as? String,
                        activeCommand: terminalDict["activeCommand"] as? String,
                        shell: terminalDict["shell"] as? String ?? "/bin/zsh",
                        projectPath: terminalDict["projectPath"] as? String,
                        createdAt: terminalDict["createdAt"] as? Double ?? Date().timeIntervalSince1970 * 1000,
                        cols: terminalDict["cols"] as? Int ?? 80,
                        rows: terminalDict["rows"] as? Int ?? 24,
                        exitSignal: terminalDict["exitSignal"] as? String,
                        exitedAt: terminalDict["exitedAt"] as? Double,
                        isHistory: false
                    )
                    print("WebSocket: Calling terminalCreatedHandler for \(terminal.id)")
                    terminalCreatedHandler?(terminal)
                    print("WebSocket: Terminal created - \(terminal.id)")
                } else {
                    print("WebSocket: Failed to parse terminal dict from terminalCreated")
                }
                
            case "terminalClosed":
                if let terminalId = json["terminalId"] as? String {
                    terminalClosedHandler?(terminalId)
                    print("WebSocket: Terminal closed - \(terminalId)")
                }
                
            default:
                break
            }
        }
    }
    
    private func scheduleReconnect() {
        guard reconnectTask == nil else { return }
        
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds
            
            guard !Task.isCancelled else { return }
            
            await MainActor.run {
                self?.reconnectTask = nil
                self?.establishConnection()
            }
        }
    }
    
    func send(_ message: [String: Any]) {
        guard let task = webSocketTask,
              let data = try? JSONSerialization.data(withJSONObject: message),
              let jsonString = String(data: data, encoding: .utf8) else {
            return
        }
        
        task.send(.string(jsonString)) { error in
            if let error = error {
                print("WebSocket send error: \(error)")
            }
        }
    }
    
    func watchPath(_ path: String) {
        send(["type": "watch", "path": path])
    }
    
    func unwatchPath(_ path: String) {
        send(["type": "unwatch", "path": path])
    }
    
    // MARK: - Terminal Methods
    
    /// Create a new PTY terminal
    func createTerminal(cwd: String? = nil, cols: Int = 80, rows: Int = 24, onCreated: @escaping (Terminal) -> Void) {
        terminalCreatedHandler = onCreated
        var message: [String: Any] = [
            "type": "terminalCreate",
            "cols": cols,
            "rows": rows
        ]
        if let cwd = cwd {
            message["cwd"] = cwd
        }
        send(message)
        print("WebSocket: Creating new terminal")
    }
    
    /// Set handler for terminal closed events
    func setTerminalClosedHandler(_ handler: @escaping (String) -> Void) {
        terminalClosedHandler = handler
    }
    
    func attachTerminal(_ terminalId: String, projectPath: String? = nil, onData: @escaping (String) -> Void, onError: @escaping (String) -> Void = { _ in }) {
        terminalOutputHandlers[terminalId] = onData
        terminalErrorHandlers[terminalId] = onError
        var message: [String: Any] = ["type": "terminalAttach", "terminalId": terminalId]
        if let projectPath = projectPath {
            message["projectPath"] = projectPath
        }
        send(message)
        print("WebSocket: Attaching to terminal \(terminalId)")
    }
    
    func detachTerminal(_ terminalId: String) {
        terminalOutputHandlers.removeValue(forKey: terminalId)
        terminalErrorHandlers.removeValue(forKey: terminalId)
        send(["type": "terminalDetach", "terminalId": terminalId])
        print("WebSocket: Detaching from terminal \(terminalId)")
    }
    
    func sendTerminalInput(_ terminalId: String, data: String) {
        send([
            "type": "terminalInput",
            "terminalId": terminalId,
            "data": data
        ])
    }
    
    func resizeTerminal(_ terminalId: String, cols: Int, rows: Int) {
        send([
            "type": "terminalResize",
            "terminalId": terminalId,
            "cols": cols,
            "rows": rows
        ])
    }
    
    /// Kill a PTY terminal
    func killTerminal(_ terminalId: String) {
        send([
            "type": "terminalKill",
            "terminalId": terminalId
        ])
        print("WebSocket: Killing terminal \(terminalId)")
    }
}
