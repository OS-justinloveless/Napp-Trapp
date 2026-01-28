import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(Int)
    case unauthorized
    case notFound
    case decodingError(Error)
    case networkError(Error)
    case streamingError(String)
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL"
        case .invalidResponse:
            return "Invalid server response"
        case .httpError(let code):
            return "Server error (HTTP \(code))"
        case .unauthorized:
            return "Invalid authentication token"
        case .notFound:
            return "Resource not found"
        case .decodingError(let error):
            return "Data parsing error: \(error.localizedDescription)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .streamingError(let message):
            return "Streaming error: \(message)"
        }
    }
}

/// Events received during message streaming
enum MessageStreamEvent {
    case connected
    case text(String)
    case toolCall(ToolCall)
    case toolResult(toolId: String, content: String?, isError: Bool)
    case complete(success: Bool)
    case error(String)
}

class APIService {
    private let serverUrl: String
    private let token: String
    private let session: URLSession
    private let decoder: JSONDecoder
    
    init(serverUrl: String, token: String) {
        self.serverUrl = serverUrl
        self.token = token
        
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)
        
        self.decoder = JSONDecoder()
    }
    
    private func makeRequest(
        endpoint: String,
        method: String = "GET",
        body: Data? = nil,
        queryItems: [URLQueryItem]? = nil
    ) async throws -> Data {
        var components = URLComponents(string: "\(serverUrl)\(endpoint)")
        components?.queryItems = queryItems
        
        guard let url = components?.url else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        if let body = body {
            request.httpBody = body
        }
        
        do {
            let (data, response) = try await session.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            
            switch httpResponse.statusCode {
            case 200...299:
                return data
            case 401:
                throw APIError.unauthorized
            case 404:
                throw APIError.notFound
            default:
                throw APIError.httpError(httpResponse.statusCode)
            }
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }
    
    // MARK: - System
    
    func getSystemInfo() async throws -> SystemInfo {
        let data = try await makeRequest(endpoint: "/api/system/info")
        do {
            return try decoder.decode(SystemInfo.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func getNetworkInfo() async throws -> [NetworkInterface] {
        let data = try await makeRequest(endpoint: "/api/system/network")
        do {
            let response = try decoder.decode(NetworkResponse.self, from: data)
            return response.addresses
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func getCursorStatus() async throws -> CursorStatus {
        let data = try await makeRequest(endpoint: "/api/system/cursor-status")
        do {
            return try decoder.decode(CursorStatus.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func openInCursor(path: String) async throws -> OpenCursorResponse {
        let body = try JSONEncoder().encode(OpenCursorRequest(path: path))
        let data = try await makeRequest(endpoint: "/api/system/open-cursor", method: "POST", body: body)
        do {
            return try decoder.decode(OpenCursorResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func executeCommand(command: String, cwd: String? = nil) async throws -> ExecResponse {
        let body = try JSONEncoder().encode(ExecRequest(command: command, cwd: cwd))
        let data = try await makeRequest(endpoint: "/api/system/exec", method: "POST", body: body)
        do {
            return try decoder.decode(ExecResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Build and run iOS app via Xcode on simulator or physical device
    func buildAndRuniOSApp(
        configuration: String = "Debug",
        deviceName: String = "iPhone 16",
        deviceId: String? = nil,
        isPhysicalDevice: Bool = false,
        clean: Bool = false
    ) async throws -> iOSBuildResponse {
        // Use longer timeout for build operations
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 300 // 5 minutes
        config.timeoutIntervalForResource = 360 // 6 minutes
        let longTimeoutSession = URLSession(configuration: config)
        
        guard let url = URL(string: "\(serverUrl)/api/system/ios-build-run") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body = iOSBuildRequest(
            configuration: configuration,
            deviceName: deviceName,
            deviceId: deviceId,
            isPhysicalDevice: isPhysicalDevice,
            clean: clean
        )
        request.httpBody = try JSONEncoder().encode(body)
        
        do {
            let (data, response) = try await longTimeoutSession.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            
            switch httpResponse.statusCode {
            case 200...299:
                return try decoder.decode(iOSBuildResponse.self, from: data)
            case 401:
                throw APIError.unauthorized
            case 404:
                throw APIError.notFound
            default:
                // Try to decode error response
                if let errorResponse = try? decoder.decode(iOSBuildResponse.self, from: data) {
                    throw APIError.streamingError(errorResponse.error ?? "Build failed")
                }
                throw APIError.httpError(httpResponse.statusCode)
            }
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }
    
    /// Get list of available iOS devices (simulators and physical devices)
    func getIOSDevices() async throws -> [iOSDevice] {
        let data = try await makeRequest(endpoint: "/api/system/ios-devices")
        do {
            let response = try decoder.decode(iOSDevicesResponse.self, from: data)
            return response.devices
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Get list of available iOS simulators (legacy, for backward compatibility)
    func getIOSSimulators() async throws -> [iOSSimulator] {
        let data = try await makeRequest(endpoint: "/api/system/ios-simulators")
        do {
            let response = try decoder.decode(iOSSimulatorsResponse.self, from: data)
            return response.simulators
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    // MARK: - Projects
    
    func getProjects() async throws -> [Project] {
        let data = try await makeRequest(endpoint: "/api/projects")
        
        // Debug: Print raw JSON response
        if let jsonString = String(data: data, encoding: .utf8) {
            print("DEBUG [getProjects] Raw response (first 2000 chars): \(String(jsonString.prefix(2000)))")
        }
        
        do {
            let response = try decoder.decode(ProjectsResponse.self, from: data)
            print("DEBUG [getProjects] Decoded successfully, count: \(response.projects.count)")
            return response.projects
        } catch {
            print("DEBUG [getProjects] Decoding failed: \(error)")
            throw APIError.decodingError(error)
        }
    }
    
    func getProject(id: String) async throws -> Project {
        let data = try await makeRequest(endpoint: "/api/projects/\(id)")
        
        // Debug: Print raw JSON response
        if let jsonString = String(data: data, encoding: .utf8) {
            print("DEBUG [getProject] Raw response: \(jsonString)")
        }
        
        do {
            let response = try decoder.decode(ProjectResponse.self, from: data)
            print("DEBUG [getProject] Decoded successfully: \(response.project.name)")
            return response.project
        } catch {
            print("DEBUG [getProject] Decoding failed: \(error)")
            throw APIError.decodingError(error)
        }
    }
    
    func getProjectTree(id: String, depth: Int = 3) async throws -> [FileTreeItem] {
        let queryItems = [URLQueryItem(name: "depth", value: String(depth))]
        let data = try await makeRequest(endpoint: "/api/projects/\(id)/tree", queryItems: queryItems)
        
        // Debug: Print raw JSON response
        if let jsonString = String(data: data, encoding: .utf8) {
            print("DEBUG [getProjectTree] Raw response (first 2000 chars): \(String(jsonString.prefix(2000)))")
        }
        
        do {
            let response = try decoder.decode(ProjectTree.self, from: data)
            print("DEBUG [getProjectTree] Decoded successfully, tree count: \(response.tree?.count ?? 0)")
            return response.tree ?? []
        } catch {
            print("DEBUG [getProjectTree] Decoding failed: \(error)")
            if let decodingError = error as? DecodingError {
                switch decodingError {
                case .keyNotFound(let key, let context):
                    print("DEBUG [getProjectTree] Key not found: \(key.stringValue), path: \(context.codingPath.map { $0.stringValue })")
                case .typeMismatch(let type, let context):
                    print("DEBUG [getProjectTree] Type mismatch: expected \(type), path: \(context.codingPath.map { $0.stringValue })")
                case .valueNotFound(let type, let context):
                    print("DEBUG [getProjectTree] Value not found: \(type), path: \(context.codingPath.map { $0.stringValue })")
                case .dataCorrupted(let context):
                    print("DEBUG [getProjectTree] Data corrupted: \(context.debugDescription)")
                @unknown default:
                    print("DEBUG [getProjectTree] Unknown decoding error")
                }
            }
            throw APIError.decodingError(error)
        }
    }
    
    func createProject(name: String, path: String? = nil, template: String? = nil) async throws -> CreateProjectResponse {
        let body = try JSONEncoder().encode(CreateProjectRequest(name: name, path: path, template: template))
        let data = try await makeRequest(endpoint: "/api/projects", method: "POST", body: body)
        do {
            return try decoder.decode(CreateProjectResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func openProject(id: String) async throws {
        _ = try await makeRequest(endpoint: "/api/projects/\(id)/open", method: "POST")
    }
    
    func getProjectConversations(projectId: String) async throws -> [Conversation] {
        let data = try await makeRequest(endpoint: "/api/projects/\(projectId)/conversations")
        
        // Debug: Print raw JSON response
        if let jsonString = String(data: data, encoding: .utf8) {
            print("DEBUG [getProjectConversations] Raw response (first 2000 chars): \(String(jsonString.prefix(2000)))")
        }
        
        do {
            let response = try decoder.decode(ConversationsResponse.self, from: data)
            print("DEBUG [getProjectConversations] Decoded successfully, count: \(response.conversations.count)")
            return response.conversations
        } catch {
            print("DEBUG [getProjectConversations] Decoding failed: \(error)")
            throw APIError.decodingError(error)
        }
    }
    
    // MARK: - Files
    
    func listDirectory(path: String) async throws -> [FileItem] {
        let queryItems = [URLQueryItem(name: "dirPath", value: path)]
        let data = try await makeRequest(endpoint: "/api/files/list", queryItems: queryItems)
        do {
            let response = try decoder.decode(DirectoryListResponse.self, from: data)
            return response.items
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func readFile(path: String) async throws -> FileContent {
        let queryItems = [URLQueryItem(name: "filePath", value: path)]
        let data = try await makeRequest(endpoint: "/api/files/read", queryItems: queryItems)
        do {
            return try decoder.decode(FileContent.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func writeFile(path: String, content: String) async throws -> WriteFileResponse {
        let body = try JSONEncoder().encode(WriteFileRequest(filePath: path, content: content))
        let data = try await makeRequest(endpoint: "/api/files/write", method: "POST", body: body)
        do {
            return try decoder.decode(WriteFileResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func createFile(path: String, content: String? = nil) async throws -> CreateFileResponse {
        let body = try JSONEncoder().encode(CreateFileRequest(filePath: path, content: content))
        let data = try await makeRequest(endpoint: "/api/files/create", method: "POST", body: body)
        do {
            return try decoder.decode(CreateFileResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func deleteFile(path: String) async throws -> DeleteFileResponse {
        let queryItems = [URLQueryItem(name: "filePath", value: path)]
        let data = try await makeRequest(endpoint: "/api/files/delete", method: "DELETE", queryItems: queryItems)
        do {
            return try decoder.decode(DeleteFileResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func renameFile(oldPath: String, newName: String) async throws -> RenameFileResponse {
        let body = try JSONEncoder().encode(RenameFileRequest(oldPath: oldPath, newName: newName))
        let data = try await makeRequest(endpoint: "/api/files/rename", method: "POST", body: body)
        do {
            return try decoder.decode(RenameFileResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func moveFile(sourcePath: String, destinationPath: String) async throws -> MoveFileResponse {
        let body = try JSONEncoder().encode(MoveFileRequest(sourcePath: sourcePath, destinationPath: destinationPath))
        let data = try await makeRequest(endpoint: "/api/files/move", method: "POST", body: body)
        do {
            return try decoder.decode(MoveFileResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    // MARK: - Conversations
    
    func getConversations() async throws -> [Conversation] {
        let data = try await makeRequest(endpoint: "/api/conversations")
        
        // Debug: Print raw JSON response
        if let jsonString = String(data: data, encoding: .utf8) {
            print("DEBUG [getConversations] Raw response (first 2000 chars): \(String(jsonString.prefix(2000)))")
        }
        
        do {
            let response = try decoder.decode(ConversationsResponse.self, from: data)
            print("DEBUG [getConversations] Decoded successfully, count: \(response.conversations.count)")
            return response.conversations
        } catch {
            print("DEBUG [getConversations] Decoding failed: \(error)")
            if let decodingError = error as? DecodingError {
                switch decodingError {
                case .keyNotFound(let key, let context):
                    print("DEBUG [getConversations] Key not found: \(key.stringValue), path: \(context.codingPath.map { $0.stringValue })")
                case .typeMismatch(let type, let context):
                    print("DEBUG [getConversations] Type mismatch: expected \(type), path: \(context.codingPath.map { $0.stringValue })")
                case .valueNotFound(let type, let context):
                    print("DEBUG [getConversations] Value not found: \(type), path: \(context.codingPath.map { $0.stringValue })")
                case .dataCorrupted(let context):
                    print("DEBUG [getConversations] Data corrupted: \(context.debugDescription)")
                @unknown default:
                    print("DEBUG [getConversations] Unknown decoding error")
                }
            }
            throw APIError.decodingError(error)
        }
    }
    
    func getConversation(id: String) async throws -> ConversationDetail {
        let data = try await makeRequest(endpoint: "/api/conversations/\(id)")
        do {
            return try decoder.decode(ConversationDetail.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Send a message to continue a conversation, receiving streaming response via callback
    /// This function uses URLSessionDataTask with a delegate for proper SSE handling
    /// The function returns when the stream completes or errors
    func sendMessage(
        conversationId: String,
        message: String,
        workspaceId: String?,
        attachments: [MessageAttachment]? = nil,
        onEvent: @escaping (MessageStreamEvent) -> Void
    ) async throws {
        guard let url = URL(string: "\(serverUrl)/api/conversations/\(conversationId)/messages") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        // Disable caching for streaming
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        
        // Build request body
        var bodyDict: [String: Any] = ["message": message]
        if let workspaceId = workspaceId {
            bodyDict["workspaceId"] = workspaceId
        }
        if let attachments = attachments, !attachments.isEmpty {
            // Convert attachments to encodable format
            let attachmentsData = try JSONEncoder().encode(attachments)
            if let attachmentsArray = try? JSONSerialization.jsonObject(with: attachmentsData) {
                bodyDict["attachments"] = attachmentsArray
            }
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: bodyDict)
        
        print("[APIService] Starting streaming request to \(url)")
        
        // Use a delegate-based approach for proper SSE handling
        // Session holder keeps session/task alive during streaming, then releases them
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            // Create session holder to manage lifecycle
            let sessionHolder = SSESessionHolder()
            
            let delegate = SSEStreamDelegate(
                onEvent: onEvent,
                parseEvent: parseSSEEvent,
                onComplete: { [sessionHolder] error in
                    // Capture sessionHolder to ensure it lives until completion
                    // Invalidate it now that we're done
                    sessionHolder.invalidate()
                    
                    if let error = error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume()
                    }
                },
                sessionHolder: sessionHolder
            )
            
            // Create session with delegate
            // URLSession retains its delegate, delegate holds sessionHolder
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 300
            config.timeoutIntervalForResource = 600
            config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            
            let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
            sessionHolder.session = session
            
            let task = session.dataTask(with: request)
            sessionHolder.task = task
            task.resume()
            
            print("[APIService] Started URLSessionDataTask")
        }
        
        print("[APIService] Stream completed")
    }
    
    /// Helper to convert Any to AnyCodableValue for tool call inputs
    private func convertToAnyCodableValue(_ value: Any) -> AnyCodableValue {
        if value is NSNull {
            return .null
        } else if let str = value as? String {
            return .string(str)
        } else if let num = value as? NSNumber {
            // Check if it's actually a boolean
            if CFGetTypeID(num) == CFBooleanGetTypeID() {
                return .bool(num.boolValue)
            } else if floor(num.doubleValue) == num.doubleValue {
                return .int(num.intValue)
            } else {
                return .double(num.doubleValue)
            }
        } else if let arr = value as? [Any] {
            return .array(arr.map { convertToAnyCodableValue($0) })
        } else if let dict = value as? [String: Any] {
            return .dictionary(dict.mapValues { convertToAnyCodableValue($0) })
        }
        return .null
    }
    
    private func parseSSEEvent(_ dataStr: String) -> MessageStreamEvent? {
        guard let data = dataStr.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let eventType = json["type"] as? String else {
            print("[APIService] Failed to parse SSE data: \(dataStr.prefix(100))")
            return nil
        }
        
        switch eventType {
        case "connected":
            return .connected
            
        case "assistant":
            // cursor-agent sends: {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."},{"type":"tool_use",...}]}}
            if let message = json["message"] as? [String: Any],
               let content = message["content"] as? [[String: Any]] {
                // Process all content items and return the first relevant one
                // Note: In a real implementation, you might want to return multiple events
                for contentItem in content {
                    guard let itemType = contentItem["type"] as? String else { continue }
                    
                    if itemType == "text", let text = contentItem["text"] as? String, !text.isEmpty {
                        return .text(text)
                    }
                    
                    if itemType == "tool_use",
                       let toolId = contentItem["id"] as? String,
                       let toolName = contentItem["name"] as? String {
                        // Parse the input as AnyCodableValue dictionary
                        var inputDict: [String: AnyCodableValue]? = nil
                        if let inputRaw = contentItem["input"] as? [String: Any] {
                            inputDict = inputRaw.mapValues { convertToAnyCodableValue($0) }
                        }
                        
                        let toolCall = ToolCall(
                            id: toolId,
                            name: toolName,
                            input: inputDict,
                            status: .running,
                            result: nil
                        )
                        return .toolCall(toolCall)
                    }
                    
                    if itemType == "tool_result",
                       let toolUseId = contentItem["tool_use_id"] as? String {
                        let isError = contentItem["is_error"] as? Bool ?? false
                        let resultContent = contentItem["content"] as? String
                        return .toolResult(toolId: toolUseId, content: resultContent, isError: isError)
                    }
                }
            }
            return nil
            
        case "text":
            // Fallback for simple text messages
            if let content = json["content"] as? String {
                return .text(content)
            }
            return nil
            
        case "complete":
            let success = json["success"] as? Bool ?? false
            return .complete(success: success)
            
        case "error":
            let errorContent = json["content"] as? String ?? "Unknown error"
            return .error(errorContent)
            
        case "stderr":
            // Log stderr but don't interrupt the stream
            if let content = json["content"] as? String {
                print("[APIService] cursor-agent stderr: \(content)")
            }
            return nil
            
        case "system":
            // System events are informational
            return nil
            
        default:
            // Unknown event type, ignore
            print("[APIService] Unknown SSE event type: \(eventType)")
            return nil
        }
    }
    
    // MARK: - Messages with Pagination
    
    func getConversationMessages(id: String, limit: Int? = nil, offset: Int? = nil) async throws -> [ConversationMessage] {
        var queryItems: [URLQueryItem] = []
        if let limit = limit {
            queryItems.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        if let offset = offset {
            queryItems.append(URLQueryItem(name: "offset", value: String(offset)))
        }
        
        let data = try await makeRequest(
            endpoint: "/api/conversations/\(id)/messages",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
        do {
            let response = try decoder.decode(MessagesResponse.self, from: data)
            return response.messages
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Create a new conversation, optionally within a specific project/workspace
    /// - Parameter workspaceId: The workspace/project ID to create the conversation in. Use nil or "global" for global conversations.
    /// - Returns: The ID of the newly created conversation
    func createConversation(workspaceId: String? = nil) async throws -> String {
        var bodyDict: [String: Any] = [:]
        if let workspaceId = workspaceId, workspaceId != "global" {
            bodyDict["workspaceId"] = workspaceId
        }
        
        let body = try JSONSerialization.data(withJSONObject: bodyDict)
        let data = try await makeRequest(endpoint: "/api/conversations", method: "POST", body: body)
        
        do {
            let response = try decoder.decode(CreateConversationResponse.self, from: data)
            return response.chatId
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Fork a read-only Cursor IDE conversation to create an editable mobile copy
    /// - Parameters:
    ///   - id: The ID of the conversation to fork
    ///   - workspaceId: Optional workspace ID for the forked conversation (defaults to original's workspace)
    /// - Returns: The fork response containing the new conversation
    func forkConversation(id: String, workspaceId: String? = nil) async throws -> ForkConversationResponse {
        var bodyDict: [String: Any] = [:]
        if let workspaceId = workspaceId, workspaceId != "global" {
            bodyDict["workspaceId"] = workspaceId
        }
        
        let body = try JSONSerialization.data(withJSONObject: bodyDict)
        let data = try await makeRequest(endpoint: "/api/conversations/\(id)/fork", method: "POST", body: body)
        
        do {
            return try decoder.decode(ForkConversationResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    // MARK: - Cursor IDE Terminals
    
    /// Get list of Cursor IDE terminals for a project
    func getTerminals(projectPath: String? = nil) async throws -> [Terminal] {
        var queryItems: [URLQueryItem]? = nil
        if let projectPath = projectPath {
            queryItems = [URLQueryItem(name: "projectPath", value: projectPath)]
        }
        
        let data = try await makeRequest(endpoint: "/api/terminals", queryItems: queryItems)
        
        do {
            let response = try decoder.decode(TerminalsResponse.self, from: data)
            return response.terminals
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Get a Cursor IDE terminal with its metadata and optionally content
    func getTerminal(id: String, projectPath: String, includeContent: Bool = true) async throws -> TerminalDetailResponse {
        let queryItems = [
            URLQueryItem(name: "projectPath", value: projectPath),
            URLQueryItem(name: "includeContent", value: includeContent ? "true" : "false")
        ]
        let data = try await makeRequest(endpoint: "/api/terminals/\(id)", queryItems: queryItems)
        
        do {
            return try decoder.decode(TerminalDetailResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Get terminal output content
    func getTerminalContent(id: String, projectPath: String, tailLines: Int? = nil) async throws -> TerminalContentResponse {
        var queryItems = [URLQueryItem(name: "projectPath", value: projectPath)]
        if let tail = tailLines {
            queryItems.append(URLQueryItem(name: "tail", value: String(tail)))
        }
        
        let data = try await makeRequest(endpoint: "/api/terminals/\(id)/content", queryItems: queryItems)
        
        do {
            return try decoder.decode(TerminalContentResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Send input to a Cursor IDE terminal
    func sendTerminalInput(id: String, data inputData: String, projectPath: String) async throws {
        let request = TerminalInputRequest(data: inputData, projectPath: projectPath)
        let body = try JSONEncoder().encode(request)
        _ = try await makeRequest(endpoint: "/api/terminals/\(id)/input", method: "POST", body: body)
    }
    
    // MARK: - Git Operations
    
    /// Scan project for all git repositories (including sub-repos)
    func scanGitRepositories(projectId: String, maxDepth: Int? = nil) async throws -> [GitRepository] {
        var queryItems: [URLQueryItem] = []
        if let maxDepth = maxDepth {
            queryItems.append(URLQueryItem(name: "maxDepth", value: String(maxDepth)))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/scan-repos", queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            let response = try decoder.decode(GitRepositoriesResponse.self, from: data)
            return response.repositories
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Get git status for a project or sub-repository
    func getGitStatus(projectId: String, repoPath: String? = nil) async throws -> GitStatus {
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/status", queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            return try decoder.decode(GitStatus.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Get git branches for a project or sub-repository
    func getGitBranches(projectId: String, repoPath: String? = nil) async throws -> [GitBranch] {
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/branches", queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            let response = try decoder.decode(GitBranchesResponse.self, from: data)
            return response.branches
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Stage files
    func gitStage(projectId: String, files: [String], repoPath: String? = nil) async throws -> GitOperationResponse {
        print("[APIService] gitStage called - projectId: \(projectId), files: \(files), repoPath: \(repoPath ?? "nil")")
        let request = GitStageRequest(files: files)
        let body = try JSONEncoder().encode(request)
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        print("[APIService] gitStage request body: \(String(data: body, encoding: .utf8) ?? "nil")")
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/stage", method: "POST", body: body, queryItems: queryItems.isEmpty ? nil : queryItems)
        print("[APIService] gitStage response: \(String(data: data, encoding: .utf8) ?? "nil")")
        do {
            return try decoder.decode(GitOperationResponse.self, from: data)
        } catch {
            print("[APIService] gitStage decode error: \(error)")
            throw APIError.decodingError(error)
        }
    }
    
    /// Unstage files
    func gitUnstage(projectId: String, files: [String], repoPath: String? = nil) async throws -> GitOperationResponse {
        let request = GitStageRequest(files: files)
        let body = try JSONEncoder().encode(request)
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/unstage", method: "POST", body: body, queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            return try decoder.decode(GitOperationResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Discard changes
    func gitDiscard(projectId: String, files: [String], repoPath: String? = nil) async throws -> GitOperationResponse {
        let request = GitStageRequest(files: files)
        let body = try JSONEncoder().encode(request)
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/discard", method: "POST", body: body, queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            return try decoder.decode(GitOperationResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Create a commit
    func gitCommit(projectId: String, message: String, files: [String]? = nil, repoPath: String? = nil) async throws -> GitOperationResponse {
        let request = GitCommitRequest(message: message, files: files)
        let body = try JSONEncoder().encode(request)
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/commit", method: "POST", body: body, queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            return try decoder.decode(GitOperationResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Push to remote
    func gitPush(projectId: String, remote: String? = nil, branch: String? = nil, repoPath: String? = nil) async throws -> GitOperationResponse {
        let request = GitPushPullRequest(remote: remote, branch: branch)
        let body = try JSONEncoder().encode(request)
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/push", method: "POST", body: body, queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            return try decoder.decode(GitOperationResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Pull from remote
    func gitPull(projectId: String, remote: String? = nil, branch: String? = nil, repoPath: String? = nil) async throws -> GitOperationResponse {
        let request = GitPushPullRequest(remote: remote, branch: branch)
        let body = try JSONEncoder().encode(request)
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/pull", method: "POST", body: body, queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            return try decoder.decode(GitOperationResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Checkout a branch
    func gitCheckout(projectId: String, branch: String, repoPath: String? = nil) async throws -> GitOperationResponse {
        let request = GitCheckoutRequest(branch: branch)
        let body = try JSONEncoder().encode(request)
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/checkout", method: "POST", body: body, queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            return try decoder.decode(GitOperationResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Create a new branch
    func gitCreateBranch(projectId: String, name: String, checkout: Bool = true, repoPath: String? = nil) async throws -> GitOperationResponse {
        let request = GitCreateBranchRequest(name: name, checkout: checkout)
        let body = try JSONEncoder().encode(request)
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/branch", method: "POST", body: body, queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            return try decoder.decode(GitOperationResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Get diff for a file (returns just the diff string for backward compatibility)
    func gitDiff(projectId: String, file: String, staged: Bool = false, repoPath: String? = nil) async throws -> String {
        let result = try await gitDiffFull(projectId: projectId, file: file, staged: staged, repoPath: repoPath)
        return result.diff
    }
    
    /// Get diff for a file with full response including truncation info
    func gitDiffFull(projectId: String, file: String, staged: Bool = false, repoPath: String? = nil) async throws -> (diff: String, truncated: Bool, totalLines: Int) {
        var queryItems = [URLQueryItem(name: "file", value: file)]
        if staged {
            queryItems.append(URLQueryItem(name: "staged", value: "true"))
        }
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/diff", queryItems: queryItems)
        do {
            let response = try decoder.decode(GitDiffResponse.self, from: data)
            return (
                diff: response.diff,
                truncated: response.isTruncated,
                totalLines: response.totalLines ?? 0
            )
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Fetch from remote
    func gitFetch(projectId: String, remote: String? = nil, repoPath: String? = nil) async throws -> GitOperationResponse {
        let request = GitFetchRequest(remote: remote)
        let body = try JSONEncoder().encode(request)
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/fetch", method: "POST", body: body, queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            return try decoder.decode(GitOperationResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Clean (delete) untracked files
    func gitClean(projectId: String, files: [String], repoPath: String? = nil) async throws -> GitOperationResponse {
        let request = GitStageRequest(files: files)
        let body = try JSONEncoder().encode(request)
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/clean", method: "POST", body: body, queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            return try decoder.decode(GitOperationResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Get list of remotes
    func getGitRemotes(projectId: String, repoPath: String? = nil) async throws -> [GitRemote] {
        var queryItems: [URLQueryItem] = []
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/remotes", queryItems: queryItems.isEmpty ? nil : queryItems)
        do {
            let response = try decoder.decode(GitRemotesResponse.self, from: data)
            return response.remotes
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Get recent commits
    func gitLog(projectId: String, limit: Int = 10, repoPath: String? = nil) async throws -> [GitCommit] {
        var queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        if let repoPath = repoPath, repoPath != "." {
            queryItems.append(URLQueryItem(name: "repoPath", value: repoPath))
        }
        let data = try await makeRequest(endpoint: "/api/git/\(projectId)/log", queryItems: queryItems)
        do {
            let response = try decoder.decode(GitLogResponse.self, from: data)
            return response.commits
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    /// Generate a commit message using AI based on staged changes
    func generateCommitMessage(projectId: String, repoPath: String? = nil) async throws -> String {
        // Use a longer timeout for AI generation
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 120
        let longTimeoutSession = URLSession(configuration: config)
        
        var urlString = "\(serverUrl)/api/git/\(projectId)/generate-commit-message"
        if let repoPath = repoPath, repoPath != "." {
            let encodedRepoPath = repoPath.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? repoPath
            urlString += "?repoPath=\(encodedRepoPath)"
        }
        
        guard let url = URL(string: urlString) else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = "{}".data(using: .utf8)
        
        do {
            let (data, response) = try await longTimeoutSession.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            
            switch httpResponse.statusCode {
            case 200...299:
                let result = try decoder.decode(GenerateCommitMessageResponse.self, from: data)
                return result.message
            case 401:
                throw APIError.unauthorized
            case 404:
                throw APIError.notFound
            default:
                throw APIError.httpError(httpResponse.statusCode)
            }
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }
}

// MARK: - SSE Session Holder

/// Holds references to the URLSession and task during streaming
/// This breaks retain cycles by being a separate object that can be explicitly released
private class SSESessionHolder {
    var session: URLSession?
    var task: URLSessionDataTask?
    
    func invalidate() {
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
    }
    
    deinit {
        print("[SSESessionHolder] deinit called")
        invalidate()
    }
}

// MARK: - SSE Stream Delegate

/// URLSession delegate that handles Server-Sent Events (SSE) streaming
/// This keeps the connection alive and processes data as it arrives
private class SSEStreamDelegate: NSObject, URLSessionDataDelegate {
    // Store callbacks as optionals so we can nil them out on cleanup
    private var onEvent: ((MessageStreamEvent) -> Void)?
    private var parseEvent: ((String) -> MessageStreamEvent?)?
    private var onComplete: ((Error?) -> Void)?
    
    private var buffer = ""
    private var hasCompleted = false
    private var receivedResponse = false
    
    // Session holder keeps session alive without creating delegate -> session -> delegate cycle
    // The holder is also captured by onComplete closure to ensure it lives long enough
    private var sessionHolder: SSESessionHolder?
    
    init(
        onEvent: @escaping (MessageStreamEvent) -> Void,
        parseEvent: @escaping (String) -> MessageStreamEvent?,
        onComplete: @escaping (Error?) -> Void,
        sessionHolder: SSESessionHolder
    ) {
        self.onEvent = onEvent
        self.parseEvent = parseEvent
        self.onComplete = onComplete
        self.sessionHolder = sessionHolder
        super.init()
    }
    
    // Called when we receive a response (headers)
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        print("[SSEDelegate] Received response")
        
        guard let httpResponse = response as? HTTPURLResponse else {
            print("[SSEDelegate] Invalid response type")
            completionHandler(.cancel)
            completeWithError(APIError.invalidResponse)
            return
        }
        
        print("[SSEDelegate] HTTP status: \(httpResponse.statusCode)")
        
        guard (200...299).contains(httpResponse.statusCode) else {
            let error: APIError
            switch httpResponse.statusCode {
            case 401:
                error = .unauthorized
            case 404:
                error = .notFound
            default:
                error = .httpError(httpResponse.statusCode)
            }
            completionHandler(.cancel)
            completeWithError(error)
            return
        }
        
        receivedResponse = true
        // Allow the data to flow - this is critical for streaming!
        completionHandler(.allow)
    }
    
    // Called when we receive data chunks
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let chunk = String(data: data, encoding: .utf8) else {
            print("[SSEDelegate] Failed to decode data chunk")
            return
        }
        
        print("[SSEDelegate] Received chunk (\(data.count) bytes): \(chunk.prefix(100))")
        
        buffer += chunk
        processBuffer()
    }
    
    // Called when the task completes (success or error)
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        print("[SSEDelegate] Task completed, error: \(String(describing: error))")
        
        // Process any remaining data in buffer
        if !buffer.isEmpty {
            processBuffer()
        }
        
        if let error = error {
            completeWithError(error)
        } else {
            completeWithError(nil)
        }
    }
    
    private func processBuffer() {
        // SSE format: "data: {json}\n\n"
        // Split on double newlines to get complete events
        let events = buffer.components(separatedBy: "\n\n")
        
        // Keep the last incomplete event in the buffer
        if events.count > 1 {
            buffer = events.last ?? ""
            
            // Process all complete events
            for i in 0..<(events.count - 1) {
                let eventStr = events[i]
                processEventString(eventStr)
            }
        }
    }
    
    private func processEventString(_ eventStr: String) {
        let lines = eventStr.components(separatedBy: "\n")
        
        for line in lines {
            if line.hasPrefix("data: ") {
                let dataStr = String(line.dropFirst(6))
                print("[SSEDelegate] Processing event data: \(dataStr.prefix(100))")
                
                if let event = parseEvent?(dataStr) {
                    onEvent?(event)
                    
                    // Check if this is a terminal event
                    if case .complete(let success) = event {
                        print("[SSEDelegate] Got complete event, success: \(success)")
                        // Don't complete here - wait for URLSession to finish
                    }
                    if case .error(let msg) = event {
                        print("[SSEDelegate] Got error event: \(msg)")
                    }
                }
            }
        }
    }
    
    private func completeWithError(_ error: Error?) {
        guard !hasCompleted else { return }
        hasCompleted = true
        
        print("[SSEDelegate] Completing with error: \(String(describing: error))")
        
        // Store completion handler before cleanup
        let completion = onComplete
        
        // Clean up references to break retain cycles
        cleanup()
        
        // Call completion
        completion?(error)
    }
    
    /// Clean up all references to break retain cycles
    private func cleanup() {
        // Invalidate session holder (cancels task and session)
        sessionHolder?.invalidate()
        sessionHolder = nil
        
        // Nil out closures to release captured references
        onEvent = nil
        parseEvent = nil
        onComplete = nil
        
        // Clear buffer
        buffer = ""
    }
    
    deinit {
        print("[SSEDelegate] deinit called")
        // Ensure cleanup happens
        if !hasCompleted {
            cleanup()
        }
    }
}
