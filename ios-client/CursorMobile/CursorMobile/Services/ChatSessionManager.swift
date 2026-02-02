import Foundation
import Combine

// MARK: - Session State

/// Session state enum matching server-side state
enum ChatSessionState: String, Codable {
    case active = "active"
    case suspended = "suspended"
    case ended = "ended"
}

/// Session information returned from the server
struct SessionInfo: Codable, Identifiable {
    let conversationId: String
    let isActive: Bool
    let sessionState: ChatSessionState?
    let tool: String?
    let suspendReason: String?
    let lastSessionAt: Double?
    let canResume: Bool?
    let message: String?
    let workspacePath: String?
    let model: String?
    let mode: String?
    let uptime: Double?
    let createdAt: Double?
    
    var id: String { conversationId }
    
    var displayState: String {
        if isActive { return "Active" }
        switch sessionState {
        case .suspended: return "Suspended"
        case .ended: return "Ended"
        default: return "Unknown"
        }
    }
    
    var stateColor: String {
        if isActive { return "green" }
        switch sessionState {
        case .suspended: return "orange"
        case .ended: return "gray"
        default: return "secondary"
        }
    }
}

/// Session configuration from server
struct SessionConfig: Codable {
    let inactivityTimeoutMs: Int
    let maxConcurrentSessions: Int
    let autoResumeEnabled: Bool
    
    static let `default` = SessionConfig(
        inactivityTimeoutMs: 60000,
        maxConcurrentSessions: 20,
        autoResumeEnabled: true
    )
    
    var inactivityTimeoutSeconds: Int {
        inactivityTimeoutMs / 1000
    }
}

// MARK: - Session Manager

/// Manages chat session state and provides session-related functionality
class ChatSessionManager: ObservableObject {
    static let shared = ChatSessionManager()
    
    // Published state
    @Published var resumableSessions: [Conversation] = []
    @Published var recentSessions: [Conversation] = []
    @Published var sessionConfig: SessionConfig = .default
    @Published var isLoading = false
    @Published var error: String?
    
    // UserDefaults keys for local persistence
    private let lastActiveConversationKey = "lastActiveConversationId"
    private let sessionCacheKey = "cachedSessionInfo"
    
    private var cancellables = Set<AnyCancellable>()
    
    private init() {
        // Load cached data on init
        loadCachedState()
    }
    
    // MARK: - Local State Persistence
    
    /// Get the last active conversation ID (for auto-resume on launch)
    var lastActiveConversationId: String? {
        get { UserDefaults.standard.string(forKey: lastActiveConversationKey) }
        set { UserDefaults.standard.set(newValue, forKey: lastActiveConversationKey) }
    }
    
    /// Save the currently active conversation for resume
    func setActiveConversation(_ conversationId: String?) {
        lastActiveConversationId = conversationId
    }
    
    /// Clear the active conversation (e.g., when user explicitly closes)
    func clearActiveConversation() {
        lastActiveConversationId = nil
    }
    
    /// Load cached session state from UserDefaults
    private func loadCachedState() {
        // Try to load cached session config
        if let data = UserDefaults.standard.data(forKey: sessionCacheKey),
           let cached = try? JSONDecoder().decode(SessionConfig.self, from: data) {
            sessionConfig = cached
        }
    }
    
    /// Cache session config locally
    private func cacheSessionConfig(_ config: SessionConfig) {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: sessionCacheKey)
        }
    }
    
    // MARK: - Server API Calls
    
    /// Fetch resumable sessions from the server
    func fetchResumableSessions(baseURL: String, token: String) async {
        await MainActor.run { isLoading = true }
        
        do {
            guard let url = URL(string: "\(baseURL)/api/conversations/sessions/resumable") else {
                throw URLError(.badURL)
            }
            
            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }
            
            // Parse response - expecting { sessions: [Conversation], count: Int }
            let decoded = try JSONDecoder().decode(ResumableSessionsResponse.self, from: data)
            
            await MainActor.run {
                self.resumableSessions = decoded.sessions
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
        }
    }
    
    /// Fetch recent sessions from the server
    func fetchRecentSessions(baseURL: String, token: String, hours: Int = 24) async {
        await MainActor.run { isLoading = true }
        
        do {
            guard let url = URL(string: "\(baseURL)/api/conversations/sessions/recent?hours=\(hours)") else {
                throw URLError(.badURL)
            }
            
            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }
            
            let decoded = try JSONDecoder().decode(RecentSessionsResponse.self, from: data)
            
            await MainActor.run {
                self.recentSessions = decoded.sessions
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
        }
    }
    
    /// Fetch session configuration from the server
    func fetchSessionConfig(baseURL: String, token: String) async {
        do {
            guard let url = URL(string: "\(baseURL)/api/conversations/sessions/config") else {
                throw URLError(.badURL)
            }
            
            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }
            
            let decoded = try JSONDecoder().decode(SessionConfigResponse.self, from: data)
            
            await MainActor.run {
                self.sessionConfig = decoded.config
                self.cacheSessionConfig(decoded.config)
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
            }
        }
    }
    
    /// Update session configuration on the server
    func updateSessionConfig(
        baseURL: String,
        token: String,
        inactivityTimeoutMs: Int? = nil,
        maxConcurrentSessions: Int? = nil,
        autoResumeEnabled: Bool? = nil
    ) async throws -> SessionConfig {
        guard let url = URL(string: "\(baseURL)/api/conversations/sessions/config") else {
            throw URLError(.badURL)
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        var body: [String: Any] = [:]
        if let timeout = inactivityTimeoutMs { body["inactivityTimeoutMs"] = timeout }
        if let max = maxConcurrentSessions { body["maxConcurrentSessions"] = max }
        if let autoResume = autoResumeEnabled { body["autoResumeEnabled"] = autoResume }
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        
        let decoded = try JSONDecoder().decode(UpdateConfigResponse.self, from: data)
        
        await MainActor.run {
            self.sessionConfig = decoded.config
            self.cacheSessionConfig(decoded.config)
        }
        
        return decoded.config
    }
    
    /// Get session status for a specific conversation
    func getSessionStatus(conversationId: String, baseURL: String, token: String) async throws -> SessionInfo {
        guard let url = URL(string: "\(baseURL)/api/conversations/\(conversationId)/session") else {
            throw URLError(.badURL)
        }
        
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        
        if httpResponse.statusCode == 404 {
            throw NSError(domain: "SessionError", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "Conversation not found"
            ])
        }
        
        guard httpResponse.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        
        return try JSONDecoder().decode(SessionInfo.self, from: data)
    }
    
    /// Terminate a session on the server
    func terminateSession(conversationId: String, baseURL: String, token: String) async throws {
        guard let url = URL(string: "\(baseURL)/api/conversations/\(conversationId)/session") else {
            throw URLError(.badURL)
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        let (_, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        
        // Refresh resumable sessions
        await fetchResumableSessions(baseURL: baseURL, token: token)
    }
}

// MARK: - Response Types

private struct ResumableSessionsResponse: Codable {
    let sessions: [Conversation]
    let count: Int
}

private struct RecentSessionsResponse: Codable {
    let sessions: [Conversation]
    let count: Int
    let hoursBack: Int
}

private struct SessionConfigResponse: Codable {
    let config: SessionConfig
}

private struct UpdateConfigResponse: Codable {
    let success: Bool
    let config: SessionConfig
}
