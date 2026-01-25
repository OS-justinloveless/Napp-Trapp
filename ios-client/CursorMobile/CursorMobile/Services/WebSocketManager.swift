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
        isConnected = false
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
}
