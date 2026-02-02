import Foundation

// MARK: - Chat View Style

/// Controls which chat UI design to use
enum ChatViewStyle: String, CaseIterable, Identifiable, Codable {
    case classic = "classic"       // Traditional chat bubble design
    case terminal = "terminal"     // CLI terminal-like output with parsed content blocks
    
    var id: String { rawValue }
    
    var displayName: String {
        switch self {
        case .classic: return "Classic"
        case .terminal: return "Terminal"
        }
    }
    
    var description: String {
        switch self {
        case .classic: return "Traditional chat bubble design"
        case .terminal: return "CLI-style output with tool calls and diffs"
        }
    }
    
    var icon: String {
        switch self {
        case .classic: return "bubble.left.and.bubble.right"
        case .terminal: return "terminal"
        }
    }
}

// MARK: - Permission Mode

/// Controls how the agent handles tool approvals
enum PermissionMode: String, CaseIterable, Identifiable, Codable {
    case yesAll = "yesall"       // Auto-approve all tool calls
    case autoAccept = "auto"    // Auto-accept for common operations
    case bypassOnly = "bypass"  // Only auto-accept for safe operations (reads, searches)
    
    var id: String { rawValue }
    
    var displayName: String {
        switch self {
        case .yesAll: return "Yes to All"
        case .autoAccept: return "Auto Accept"
        case .bypassOnly: return "Ask for Edits"
        }
    }
    
    var description: String {
        switch self {
        case .yesAll: return "Automatically approve all agent actions"
        case .autoAccept: return "Auto-approve most actions, confirm destructive ones"
        case .bypassOnly: return "Only auto-approve reads and searches"
        }
    }
    
    var icon: String {
        switch self {
        case .yesAll: return "checkmark.shield.fill"
        case .autoAccept: return "checkmark.shield"
        case .bypassOnly: return "shield"
        }
    }
}

// MARK: - Chat Settings Manager

/// Manages persistent default settings for chat conversations
class ChatSettingsManager: ObservableObject {
    static let shared = ChatSettingsManager()
    
    // MARK: - UserDefaults Keys
    
    private enum Keys {
        static let defaultModelId = "chatDefaultModelId"
        static let defaultMode = "chatDefaultMode"
        static let defaultPermissionMode = "chatDefaultPermissionMode"
        static let chatViewStyle = "chatViewStyle"
    }
    
    // MARK: - Published Properties
    
    /// Default model ID for new chats (nil means use system/current default)
    @Published var defaultModelId: String? {
        didSet {
            if let modelId = defaultModelId {
                UserDefaults.standard.set(modelId, forKey: Keys.defaultModelId)
            } else {
                UserDefaults.standard.removeObject(forKey: Keys.defaultModelId)
            }
        }
    }
    
    /// Default chat mode for new chats
    @Published var defaultMode: ChatMode {
        didSet {
            UserDefaults.standard.set(defaultMode.rawValue, forKey: Keys.defaultMode)
        }
    }
    
    /// Default permission mode for tool approvals
    @Published var defaultPermissionMode: PermissionMode {
        didSet {
            UserDefaults.standard.set(defaultPermissionMode.rawValue, forKey: Keys.defaultPermissionMode)
        }
    }
    
    /// Chat view style (classic bubbles vs terminal-style output)
    @Published var chatViewStyle: ChatViewStyle {
        didSet {
            UserDefaults.standard.set(chatViewStyle.rawValue, forKey: Keys.chatViewStyle)
        }
    }
    
    // MARK: - Cached Models
    
    /// Cached available models for settings display
    @Published var cachedModels: [AIModel] = []
    @Published var isLoadingModels: Bool = false
    
    // MARK: - Initialization
    
    private init() {
        // Load default model ID
        self.defaultModelId = UserDefaults.standard.string(forKey: Keys.defaultModelId)
        
        // Load default mode
        if let modeRaw = UserDefaults.standard.string(forKey: Keys.defaultMode),
           let mode = ChatMode(rawValue: modeRaw) {
            self.defaultMode = mode
        } else {
            self.defaultMode = .agent
        }
        
        // Load default permission mode
        if let permissionRaw = UserDefaults.standard.string(forKey: Keys.defaultPermissionMode),
           let permission = PermissionMode(rawValue: permissionRaw) {
            self.defaultPermissionMode = permission
        } else {
            self.defaultPermissionMode = .yesAll
        }
        
        // Load chat view style
        if let styleRaw = UserDefaults.standard.string(forKey: Keys.chatViewStyle),
           let style = ChatViewStyle(rawValue: styleRaw) {
            self.chatViewStyle = style
        } else {
            self.chatViewStyle = .classic
        }
    }
    
    // MARK: - Model Management
    
    /// Fetch available models and cache them for settings display
    func fetchModels(using api: APIService) async {
        await MainActor.run {
            isLoadingModels = true
        }
        
        do {
            let models = try await api.getAvailableModels()
            await MainActor.run {
                self.cachedModels = models
                self.isLoadingModels = false
            }
        } catch {
            print("[ChatSettingsManager] Failed to fetch models: \(error)")
            await MainActor.run {
                self.isLoadingModels = false
            }
        }
    }
    
    /// Get the display name for the current default model
    var defaultModelDisplayName: String {
        if let modelId = defaultModelId,
           let model = cachedModels.first(where: { $0.id == modelId }) {
            return model.name
        }
        return "System Default"
    }
    
    /// Get the model object for the default model
    var defaultModel: AIModel? {
        guard let modelId = defaultModelId else { return nil }
        return cachedModels.first { $0.id == modelId }
    }
    
    // MARK: - Reset
    
    /// Reset all settings to defaults
    func resetToDefaults() {
        defaultModelId = nil
        defaultMode = .agent
        defaultPermissionMode = .yesAll
        chatViewStyle = .classic
    }
}
