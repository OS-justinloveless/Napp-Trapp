import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(Int)
    case unauthorized
    case notFound
    case decodingError(Error)
    case networkError(Error)
    
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
        }
    }
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
    
    // MARK: - Projects
    
    func getProjects() async throws -> [Project] {
        let data = try await makeRequest(endpoint: "/api/projects")
        do {
            let response = try decoder.decode(ProjectsResponse.self, from: data)
            return response.projects
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func getProject(id: String) async throws -> Project {
        let data = try await makeRequest(endpoint: "/api/projects/\(id)")
        do {
            let response = try decoder.decode(ProjectResponse.self, from: data)
            return response.project
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func getProjectTree(id: String, depth: Int = 3) async throws -> [FileTreeItem] {
        let queryItems = [URLQueryItem(name: "depth", value: String(depth))]
        let data = try await makeRequest(endpoint: "/api/projects/\(id)/tree", queryItems: queryItems)
        do {
            let response = try decoder.decode(ProjectTree.self, from: data)
            return response.tree
        } catch {
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
    
    // MARK: - Conversations
    
    func getConversations() async throws -> [Conversation] {
        let data = try await makeRequest(endpoint: "/api/conversations")
        do {
            let response = try decoder.decode(ConversationsResponse.self, from: data)
            return response.conversations
        } catch {
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
    
    func getConversationMessages(id: String) async throws -> [ConversationMessage] {
        let data = try await makeRequest(endpoint: "/api/conversations/\(id)/messages")
        do {
            let response = try decoder.decode(MessagesResponse.self, from: data)
            return response.messages
        } catch {
            throw APIError.decodingError(error)
        }
    }
}
