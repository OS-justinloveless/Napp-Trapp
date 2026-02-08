import Foundation
import SwiftUI
import Combine

/// ObservableObject for managing chat state, API calls, and WebSocket coordination
@MainActor
class ChatManager: ObservableObject {
    // MARK: - Published Properties

    /// List of chat windows for the current project
    @Published var chats: [ChatWindow] = []

    /// Available agents from the server
    @Published var agents: [Agent] = []

    /// Built-in agents (always present)
    @Published var builtInAgents: [Agent] = []

    /// Available AI models
    @Published var models: [AIModel] = []

    /// Tool availability status
    @Published var toolAvailability: [ChatTool: Bool] = [:]

    /// Loading states
    @Published var isLoadingChats = false
    @Published var isLoadingAgents = false
    @Published var isLoadingModels = false

    /// Error state
    @Published var error: String?

    // MARK: - Dependencies

    private var apiService: APIService?
    private weak var webSocketManager: WebSocketManager?

    /// Pending initial messages keyed by conversation ID (consumed once on attach)
    private var pendingInitialMessages: [String: String] = [:]

    // MARK: - Initialization

    init() {
        // Initialize built-in agents
        builtInAgents = ChatTool.allCases.map { Agent.from(tool: $0, available: false) }
    }

    /// Configure with dependencies
    func configure(apiService: APIService?, webSocketManager: WebSocketManager?) {
        self.apiService = apiService
        self.webSocketManager = webSocketManager
    }

    // MARK: - Agent Discovery

    /// Fetch available agents from the server
    func fetchAgents() async {
        guard let api = apiService else { return }

        isLoadingAgents = true
        error = nil

        do {
            let availability = try await api.getToolAvailability()
            self.toolAvailability = availability

            // Update built-in agents with availability
            self.builtInAgents = ChatTool.allCases.map { tool in
                Agent.from(tool: tool, available: availability[tool] ?? false)
            }

            // Set agents to built-in agents (can extend with custom agents later)
            self.agents = builtInAgents
        } catch {
            self.error = "Failed to fetch agents: \(error.localizedDescription)"
            print("[ChatManager] Error fetching agents: \(error)")
        }

        isLoadingAgents = false
    }

    // MARK: - Model Discovery

    /// Fetch available models from the server
    func fetchModels() async {
        guard let api = apiService else { return }

        isLoadingModels = true

        do {
            self.models = try await api.getAvailableModels()
        } catch {
            print("[ChatManager] Error fetching models: \(error)")
        }

        isLoadingModels = false
    }

    // MARK: - Chat Management

    /// Fetch chats for a project
    func fetchChats(projectPath: String) async {
        guard let api = apiService else { return }

        isLoadingChats = true
        error = nil

        do {
            self.chats = try await api.getChats(projectPath: projectPath)
        } catch {
            self.error = "Failed to fetch chats: \(error.localizedDescription)"
            print("[ChatManager] Error fetching chats: \(error)")
        }

        isLoadingChats = false
    }

    /// Create a new chat window
    func createChat(
        projectId: String,
        projectPath: String,
        tool: String = "claude",
        topic: String? = nil,
        model: String? = nil,
        mode: ChatMode = .agent,
        permissionMode: PermissionMode = .defaultMode,
        initialPrompt: String? = nil
    ) async throws -> ChatWindow {
        guard let api = apiService else {
            throw APIError.invalidURL
        }

        let response = try await api.createChatWindow(
            projectId: projectId,
            projectPath: projectPath,
            tool: tool,
            topic: topic,
            model: model,
            mode: mode,
            permissionMode: permissionMode,
            initialPrompt: initialPrompt
        )

        // Create ChatWindow from response
        let windowName = response.windowName ?? "chat-\(response.tool)"
        let sessionName = response.sessionName ?? ""
        let windowIndex = response.windowIndex ?? 0

        let chatWindow = ChatWindow(
            id: response.conversationId,
            windowName: windowName,
            tool: response.tool,
            sessionName: sessionName,
            windowIndex: windowIndex,
            projectPath: response.projectPath,
            active: true,
            terminalId: response.conversationId,
            topic: response.topic,
            title: response.topic,
            timestamp: Date().timeIntervalSince1970 * 1000,
            createdAt: nil,
            status: response.status
        )

        // Refresh chats list
        await fetchChats(projectPath: projectPath)

        return chatWindow
    }

    /// Delete a chat window
    func deleteChat(terminalId: String, projectPath: String) async throws {
        guard let api = apiService else {
            throw APIError.invalidURL
        }

        try await api.deleteChatWindow(terminalId: terminalId)

        // Refresh chats list
        await fetchChats(projectPath: projectPath)
    }

    /// Fork/clone a chat with full history
    func forkChat(_ terminalId: String, projectPath: String) async throws -> ChatWindow {
        guard let api = apiService else {
            throw APIError.invalidURL
        }

        let response = try await api.forkChatWindow(terminalId: terminalId)

        // Create ChatWindow from response
        let chatId = response.conversationId
        let windowName = response.windowName ?? "chat-\(response.tool)"
        let sessionName = response.sessionName ?? ""
        let windowIndex = response.windowIndex ?? 0

        let chatWindow = ChatWindow(
            id: chatId,
            windowName: windowName,
            tool: response.tool,
            sessionName: sessionName,
            windowIndex: windowIndex,
            projectPath: projectPath,
            active: true,
            terminalId: chatId,
            topic: response.topic,
            title: response.topic,
            timestamp: Date().timeIntervalSince1970 * 1000,
            createdAt: nil,
            status: response.status
        )

        // Refresh chats list
        await fetchChats(projectPath: projectPath)

        return chatWindow
    }

    // MARK: - WebSocket Chat Operations

    /// Attach to a chat session for real-time updates
    func attachChat(
        _ conversationId: String,
        workspaceId: String? = nil,
        onContentBlocks: @escaping ([ChatContentBlock]) -> Void,
        onRawData: ((String) -> Void)? = nil,
        onSessionEvent: @escaping (ChatSessionEvent) -> Void,
        onError: @escaping (String) -> Void
    ) {
        webSocketManager?.attachChat(
            conversationId,
            workspaceId: workspaceId,
            onContentBlocks: onContentBlocks,
            onRawData: onRawData,
            onSessionEvent: onSessionEvent,
            onError: onError
        )
    }

    /// Detach from a chat session
    func detachChat(_ conversationId: String) {
        webSocketManager?.detachChat(conversationId)
    }

    /// Send a message to a chat
    func sendMessage(_ conversationId: String, content: String, workspaceId: String? = nil, mode: String? = nil) {
        webSocketManager?.sendChatMessage(conversationId, content: content, workspaceId: workspaceId, mode: mode)
    }

    /// Cancel/interrupt a chat session
    func cancelChat(_ conversationId: String) {
        webSocketManager?.cancelChat(conversationId)
    }

    /// Send approval response
    func sendApproval(_ conversationId: String, blockId: String, approved: Bool) {
        webSocketManager?.sendChatApproval(conversationId, blockId: blockId, approved: approved)
    }

    /// Send raw input
    func sendInput(_ conversationId: String, input: String) {
        webSocketManager?.sendChatInput(conversationId, input: input)
    }

    // MARK: - Helpers

    /// Get the default agent (first available, or Claude)
    var defaultAgent: Agent? {
        agents.first(where: { $0.available }) ?? agents.first(where: { $0.id == "claude" })
    }

    /// Get the default model
    var defaultModel: AIModel? {
        models.first(where: { $0.isDefault }) ?? models.first
    }

    /// Get agent by ID
    func agent(for id: String) -> Agent? {
        agents.first(where: { $0.id == id })
    }

    /// Get model by ID
    func model(for id: String) -> AIModel? {
        models.first(where: { $0.id == id })
    }

    // MARK: - Initial Messages

    /// Store a pending initial message for a conversation (to be shown locally on attach)
    func setPendingInitialMessage(_ message: String, for conversationId: String) {
        pendingInitialMessages[conversationId] = message
    }

    /// Consume and return the pending initial message for a conversation (returns nil if none)
    func consumePendingInitialMessage(for conversationId: String) -> String? {
        pendingInitialMessages.removeValue(forKey: conversationId)
    }

    // MARK: - Suggestions

    /// Fetch autocomplete suggestions
    func getSuggestions(projectId: String, type: String?, query: String?) async throws -> [Suggestion] {
        guard let api = apiService else {
            return []
        }
        return try await api.getSuggestions(projectId: projectId, type: type, query: query)
    }
}
