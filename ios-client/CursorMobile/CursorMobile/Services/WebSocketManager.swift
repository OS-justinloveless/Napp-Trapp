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
    
    // Chat session support
    private var chatContentBlockHandlers: [String: ([ChatContentBlock]) -> Void] = [:]
    private var chatRawDataHandlers: [String: (String) -> Void] = [:]
    private var chatSessionEventHandlers: [String: (ChatSessionEvent) -> Void] = [:]
    private var chatErrorHandlers: [String: (String) -> Void] = [:]
    
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
        
        // Clear chat handlers
        chatContentBlockHandlers.removeAll()
        chatRawDataHandlers.removeAll()
        chatSessionEventHandlers.removeAll()
        chatErrorHandlers.removeAll()
        
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
                        pid: terminalDict["pid"] as? Int,
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
                        isHistory: false,
                        attached: terminalDict["attached"] as? Bool,
                        windowCount: terminalDict["windowCount"] as? Int,
                        projectName: terminalDict["projectName"] as? String
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
                
            // MARK: - Chat Session Messages
                
            case "chatAttached":
                if let conversationId = json["conversationId"] as? String {
                    let event = ChatSessionEvent(
                        type: "chatAttached",
                        conversationId: conversationId,
                        reason: nil,
                        tool: json["tool"] as? String,
                        isNew: json["isNew"] as? Bool,
                        workspacePath: json["workspacePath"] as? String,
                        message: json["message"] as? String,
                        messageId: nil
                    )
                    chatSessionEventHandlers[conversationId]?(event)
                    print("WebSocket: Chat attached - \(conversationId)")
                }
                
            case "chatContentBlocks":
                if let conversationId = json["conversationId"] as? String,
                   let blocksData = json["blocks"] as? [[String: Any]] {
                    // Parse content blocks
                    do {
                        let jsonData = try JSONSerialization.data(withJSONObject: blocksData)
                        let blocks = try JSONDecoder().decode([ChatContentBlock].self, from: jsonData)
                        chatContentBlockHandlers[conversationId]?(blocks)
                    } catch {
                        print("WebSocket: Failed to parse content blocks - \(error)")
                    }
                }
                
            case "chatData":
                if let conversationId = json["conversationId"] as? String,
                   let data = json["data"] as? String {
                    print("WebSocket: Received chatData for \(conversationId): \(data.count) chars")
                    if let handler = chatRawDataHandlers[conversationId] {
                        handler(data)
                    } else {
                        print("WebSocket: No handler registered for chatData \(conversationId)")
                    }
                }

            case "chatEvent":
                // New structured event from ChatProcessManager
                if let conversationId = json["conversationId"] as? String,
                   let eventData = json["event"] as? [String: Any] {
                    print("WebSocket: Received chatEvent for \(conversationId): \(eventData["type"] ?? "unknown")")
                    // Parse the event into a ChatContentBlock
                    do {
                        let jsonData = try JSONSerialization.data(withJSONObject: eventData)
                        let block = try JSONDecoder().decode(ChatContentBlock.self, from: jsonData)
                        chatContentBlockHandlers[conversationId]?([block])
                    } catch {
                        print("WebSocket: Failed to parse chatEvent - \(error)")
                        // If parsing as block fails, try sending as raw content
                        if let content = eventData["content"] as? String {
                            chatRawDataHandlers[conversationId]?(content)
                        }
                    }
                }

            case "chatHistory":
                // Buffered messages sent on reconnect
                if let conversationId = json["conversationId"] as? String,
                   let messagesData = json["messages"] as? [[String: Any]] {
                    print("WebSocket: Received chatHistory for \(conversationId): \(messagesData.count) messages")
                    // Parse and send each message as content blocks
                    for messageData in messagesData {
                        do {
                            let jsonData = try JSONSerialization.data(withJSONObject: messageData)
                            let block = try JSONDecoder().decode(ChatContentBlock.self, from: jsonData)
                            chatContentBlockHandlers[conversationId]?([block])
                        } catch {
                            print("WebSocket: Failed to parse history message - \(error)")
                        }
                    }
                }
                
            case "chatMessageSent":
                if let conversationId = json["conversationId"] as? String {
                    let event = ChatSessionEvent(
                        type: "chatMessageSent",
                        conversationId: conversationId,
                        reason: nil,
                        tool: nil,
                        isNew: nil,
                        workspacePath: nil,
                        message: nil,
                        messageId: json["messageId"] as? String
                    )
                    chatSessionEventHandlers[conversationId]?(event)
                }
                
            case "chatSessionSuspended":
                if let conversationId = json["conversationId"] as? String {
                    let event = ChatSessionEvent(
                        type: "chatSessionSuspended",
                        conversationId: conversationId,
                        reason: json["reason"] as? String,
                        tool: nil,
                        isNew: nil,
                        workspacePath: nil,
                        message: nil,
                        messageId: nil
                    )
                    chatSessionEventHandlers[conversationId]?(event)
                    print("WebSocket: Chat session suspended - \(conversationId)")
                }
                
            case "chatSessionEnded":
                if let conversationId = json["conversationId"] as? String {
                    let event = ChatSessionEvent(
                        type: "chatSessionEnded",
                        conversationId: conversationId,
                        reason: json["reason"] as? String,
                        tool: nil,
                        isNew: nil,
                        workspacePath: nil,
                        message: nil,
                        messageId: nil
                    )
                    chatSessionEventHandlers[conversationId]?(event)
                    print("WebSocket: Chat session ended - \(conversationId)")
                }
                
            case "chatCancelled":
                if let conversationId = json["conversationId"] as? String {
                    let event = ChatSessionEvent(
                        type: "chatCancelled",
                        conversationId: conversationId,
                        reason: nil,
                        tool: nil,
                        isNew: nil,
                        workspacePath: nil,
                        message: json["message"] as? String,
                        messageId: nil
                    )
                    chatSessionEventHandlers[conversationId]?(event)
                }
                
            case "chatError":
                if let conversationId = json["conversationId"] as? String,
                   let message = json["message"] as? String {
                    chatErrorHandlers[conversationId]?(message)
                    print("WebSocket: Chat error - \(message)")
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
    func createTerminal(cwd: String? = nil, cols: Int = 80, rows: Int = 24, type: String = "pty", projectPath: String? = nil, onCreated: @escaping (Terminal) -> Void) {
        terminalCreatedHandler = onCreated
        var message: [String: Any] = [
            "type": "terminalCreate",
            "cols": cols,
            "rows": rows,
            "terminalType": type  // "pty" or "tmux"
        ]
        if let cwd = cwd {
            message["cwd"] = cwd
        }
        if let projectPath = projectPath {
            message["projectPath"] = projectPath
        }
        send(message)
        print("WebSocket: Creating new \(type) terminal")
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
    
    // MARK: - Chat Session Methods
    
    /// Attach to a chat conversation's CLI session
    /// - Parameters:
    ///   - conversationId: The conversation ID
    ///   - workspaceId: Optional workspace ID for project context
    ///   - onContentBlocks: Handler for parsed content blocks
    ///   - onRawData: Handler for raw terminal output (optional)
    ///   - onSessionEvent: Handler for session events (attached, suspended, ended)
    ///   - onError: Handler for errors
    func attachChat(
        _ conversationId: String,
        workspaceId: String? = nil,
        onContentBlocks: @escaping ([ChatContentBlock]) -> Void,
        onRawData: ((String) -> Void)? = nil,
        onSessionEvent: @escaping (ChatSessionEvent) -> Void,
        onError: @escaping (String) -> Void
    ) {
        chatContentBlockHandlers[conversationId] = onContentBlocks
        chatRawDataHandlers[conversationId] = onRawData ?? { _ in }
        chatSessionEventHandlers[conversationId] = onSessionEvent
        chatErrorHandlers[conversationId] = onError
        
        var message: [String: Any] = [
            "type": "chatAttach",
            "conversationId": conversationId
        ]
        if let workspaceId = workspaceId {
            message["workspaceId"] = workspaceId
        }
        print("WebSocket: Sending chatAttach message: \(message)")
        send(message)
        print("WebSocket: Attaching to chat \(conversationId)")
    }
    
    /// Detach from a chat conversation
    func detachChat(_ conversationId: String) {
        chatContentBlockHandlers.removeValue(forKey: conversationId)
        chatRawDataHandlers.removeValue(forKey: conversationId)
        chatSessionEventHandlers.removeValue(forKey: conversationId)
        chatErrorHandlers.removeValue(forKey: conversationId)
        
        send([
            "type": "chatDetach",
            "conversationId": conversationId
        ])
        print("WebSocket: Detaching from chat \(conversationId)")
    }
    
    /// Send a message to a chat conversation
    func sendChatMessage(_ conversationId: String, content: String, workspaceId: String? = nil, mode: String? = nil) {
        var message: [String: Any] = [
            "type": "chatMessage",
            "conversationId": conversationId,
            "content": content
        ]
        if let workspaceId = workspaceId {
            message["workspaceId"] = workspaceId
        }
        if let mode = mode {
            message["mode"] = mode
        }
        print("WebSocket: Sending chatMessage: \(message)")
        send(message)
        print("WebSocket: Sent chat message to \(conversationId)")
    }
    
    /// Cancel/interrupt a chat session (sends Ctrl+C)
    func cancelChat(_ conversationId: String) {
        send([
            "type": "chatCancel",
            "conversationId": conversationId
        ])
        print("WebSocket: Cancelling chat \(conversationId)")
    }
    
    /// Send approval response to a chat session
    func sendChatApproval(_ conversationId: String, blockId: String, approved: Bool) {
        // Send as proper chatApproval message type so the server routes it through
        // handleChatApproval -> ChatProcessManager.sendApproval() which writes the
        // correct JSON permission response to the CLI stdin.
        send([
            "type": "chatApproval",
            "conversationId": conversationId,
            "blockId": blockId,
            "approved": approved
        ])
        print("WebSocket: Sending chatApproval (\(approved)) for block \(blockId) in \(conversationId)")
    }
    
    /// Send raw input to a chat session
    func sendChatInput(_ conversationId: String, input: String) {
        send([
            "type": "chatMessage",
            "conversationId": conversationId,
            "content": input
        ])
    }
}
