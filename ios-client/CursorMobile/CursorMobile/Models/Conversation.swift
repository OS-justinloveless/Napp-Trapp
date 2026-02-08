import Foundation
import SwiftUI

// MARK: - Chat Tools

/// AI CLI tool that created/manages this chat window
enum ChatTool: String, CaseIterable, Identifiable, Codable {
    case cursorAgent = "cursor-agent"
    case claude = "claude"
    case gemini = "gemini"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .cursorAgent: return "Cursor Agent"
        case .claude: return "Claude Code"
        case .gemini: return "Google Gemini"
        }
    }

    var icon: String {
        switch self {
        case .cursorAgent: return "arrow.up.forward.circle.fill"
        case .claude: return "sparkles"
        case .gemini: return "star.fill"
        }
    }

    var color: Color {
        switch self {
        case .cursorAgent: return .blue
        case .claude: return .purple
        case .gemini: return .orange
        }
    }
}

// MARK: - Chat Mode

/// Chat execution mode (hardcoded - fixed CLI options)
enum ChatMode: String, CaseIterable, Identifiable, Codable {
    case agent = "agent"
    case plan = "plan"
    case ask = "ask"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .agent: return "Agent"
        case .plan: return "Plan"
        case .ask: return "Ask"
        }
    }

    var description: String {
        switch self {
        case .agent: return "Full agent with file editing"
        case .plan: return "Read-only planning mode"
        case .ask: return "Q&A style explanations"
        }
    }
}

// MARK: - Permission Mode

/// Permission mode for chat actions (maps to Claude CLI --permission-mode)
enum PermissionMode: String, CaseIterable, Identifiable, Codable {
    case defaultMode = "default"
    case acceptEdits = "acceptEdits"
    case bypassPermissions = "bypassPermissions"
    case dontAsk = "dontAsk"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .defaultMode: return "Default"
        case .acceptEdits: return "Accept Edits"
        case .bypassPermissions: return "Accept All (YOLO)"
        case .dontAsk: return "Don't Ask"
        }
    }

    var description: String {
        switch self {
        case .defaultMode: return "Prompt for file edits and commands, auto-approve reads"
        case .acceptEdits: return "Auto-approve file edits, still ask for commands"
        case .bypassPermissions: return "Auto-approve all actions (use with caution)"
        case .dontAsk: return "Never prompt, deny unapproved actions"
        }
    }

    var icon: String {
        switch self {
        case .defaultMode: return "hand.raised"
        case .acceptEdits: return "pencil"
        case .bypassPermissions: return "bolt.fill"
        case .dontAsk: return "hand.raised.slash"
        }
    }

    var color: Color {
        switch self {
        case .defaultMode: return .blue
        case .acceptEdits: return .green
        case .bypassPermissions: return .orange
        case .dontAsk: return .red
        }
    }
}

// MARK: - Chat Window (Tmux-based)

/// Represents a tmux chat window running an AI CLI
/// This is the primary chat model - chats are now simply tmux windows
struct ChatWindow: Identifiable, Codable, Hashable {
    let id: String
    let windowName: String?
    let tool: String
    let sessionName: String?
    let windowIndex: Int?
    let projectPath: String
    let active: Bool?
    
    // Optional fields that may or may not be present
    let terminalId: String?
    let topic: String?
    let title: String?
    let timestamp: Double?
    let createdAt: Double?
    let status: String?
    
    var toolEnum: ChatTool? {
        ChatTool(rawValue: tool)
    }
    
    /// Whether the chat is currently active/running
    var isActive: Bool {
        if let active = active { return active }
        if let status = status {
            return status == "running" || status == "created"
        }
        return false
    }
    
    var displayTitle: String {
        if let topic = topic, !topic.isEmpty {
            return topic
        }
        if let title = title, !title.isEmpty {
            return title
        }
        return windowName ?? "Chat"
    }
    
    /// Tool icon for display
    var toolIcon: String {
        switch tool.lowercased() {
        case "claude": return "brain"
        case "cursor-agent": return "cursorarrow.rays"
        case "gemini": return "sparkles"
        default: return "terminal"
        }
    }
    
    /// Get the terminal ID (falls back to id if terminalId not set)
    var effectiveTerminalId: String {
        terminalId ?? id
    }
}

/// Response from GET /api/conversations - lists tmux chat windows
struct ChatsResponse: Codable {
    let chats: [ChatWindow]
    let total: Int?
}

/// Response from POST /api/conversations - creates a chat session
struct ChatWindowResponse: Codable {
    let success: Bool
    let conversationId: String
    let tool: String
    let topic: String
    let model: String?
    let mode: String
    let projectPath: String
    let projectName: String?
    let status: String?

    // Legacy aliases for compatibility
    let terminalId: String?
    let chatId: String?
    let windowName: String?
    let sessionName: String?
    let windowIndex: Int?

    /// The effective conversation ID (handles legacy responses)
    var effectiveId: String {
        conversationId
    }
}

// MARK: - AI Models

/// Response from GET /api/system/models
struct ModelsResponse: Codable {
    let models: [AIModel]
    let cached: Bool?
}

/// AI model available for chat (fetched from server)
struct AIModel: Codable, Identifiable, Hashable {
    let id: String      // e.g., "sonnet-4.5"
    let name: String    // e.g., "Claude 4.5 Sonnet"
    let isDefault: Bool
    let isCurrent: Bool
}

// MARK: - Legacy Types (Deprecated)
// These types are kept for backwards compatibility but are no longer used
// for the primary chat functionality. Chats are now tmux windows.

@available(*, deprecated, message: "Use ChatWindow instead - chats are now tmux windows")
struct Conversation: Codable, Identifiable, Hashable {
    let id: String
    let type: String
    let title: String
    let timestamp: Double
    let messageCount: Int
    let workspaceId: String
    let source: String
    let projectName: String?
    let workspaceFolder: String?
    let isProjectChat: Bool?
    let tool: ChatTool?
    let isReadOnly: Bool?
    let readOnlyReason: String?
    let canFork: Bool?
    
    var displayName: String {
        projectName ?? "Global"
    }
    
    var lastModified: Date {
        Date(timeIntervalSince1970: timestamp / 1000.0)
    }
}

@available(*, deprecated, message: "No longer used - chats are now tmux windows")
struct ConversationsResponse: Codable {
    let conversations: [Conversation]
}

struct ConversationDetail: Codable {
    let conversation: Conversation
}

// MARK: - Helper Types (Still used by various components)

/// Helper for handling dynamic JSON values
enum AnyCodableValue: Codable, Hashable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([AnyCodableValue])
    case dictionary([String: AnyCodableValue])
    case null
    
    var stringValue: String? {
        switch self {
        case .string(let s): return s
        case .int(let i): return String(i)
        case .double(let d): return String(d)
        case .bool(let b): return String(b)
        default: return nil
        }
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        
        if container.decodeNil() {
            self = .null
        } else if let bool = try? container.decode(Bool.self) {
            self = .bool(bool)
        } else if let int = try? container.decode(Int.self) {
            self = .int(int)
        } else if let double = try? container.decode(Double.self) {
            self = .double(double)
        } else if let string = try? container.decode(String.self) {
            self = .string(string)
        } else if let array = try? container.decode([AnyCodableValue].self) {
            self = .array(array)
        } else if let dict = try? container.decode([String: AnyCodableValue].self) {
            self = .dictionary(dict)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported type")
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let s): try container.encode(s)
        case .int(let i): try container.encode(i)
        case .double(let d): try container.encode(d)
        case .bool(let b): try container.encode(b)
        case .array(let a): try container.encode(a)
        case .dictionary(let d): try container.encode(d)
        case .null: try container.encodeNil()
        }
    }
}

/// Tool call representation (used for logging and display)
struct ToolCall: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    var input: [String: AnyCodableValue]?
    var status: ToolCallStatus
    var result: String?
    
    enum ToolCallStatus: String, Codable {
        case running
        case complete
        case error
    }
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
    
    static func == (lhs: ToolCall, rhs: ToolCall) -> Bool {
        lhs.id == rhs.id
    }
}

/// Message attachment model (used for file uploads)
struct MessageAttachment: Codable, Identifiable, Hashable {
    let id: String
    let type: AttachmentType
    let filename: String
    let mimeType: String
    let size: Int?
    let data: String?
    let url: String?
    let thumbnailData: String?
    
    enum AttachmentType: String, Codable {
        case image
        case video
        case document
        case file
    }
    
    var isVideo: Bool { type == .video }
    var isImage: Bool { type == .image }
    var displayName: String { filename }
}

/// Conversation message model (legacy - for viewing old conversations)
struct ConversationMessage: Codable, Identifiable {
    let id: String?
    let type: String?
    let text: String?
    let timestamp: Double?
    let modelType: String?
    let codeBlocks: [CodeBlock]?
    let selections: [String]?
    let relevantFiles: [String]?
    var toolCalls: [ToolCall]?
    var attachments: [MessageAttachment]?
    
    var messageId: String { id ?? UUID().uuidString }
    var isAssistant: Bool { type?.lowercased() == "assistant" }
    var content: String? { text }
    var role: String? { type }
    
    struct CodeBlock: Codable, Hashable {
        let type: String?
        let language: String?
        let content: String?
        let diffId: String?
    }
}

struct MessagesResponse: Codable {
    let messages: [ConversationMessage]
}

struct ForkConversationResponse: Codable {
    let success: Bool
    let originalConversationId: String
    let newConversationId: String
    let conversation: Conversation
    let messagesCopied: Int
}

// MARK: - Media Selection Types (used by ImagePicker)

import UIKit

/// Model for a selected image
struct SelectedImage: Identifiable, Equatable {
    let id = UUID()
    let image: UIImage
    
    func toBase64(compressionQuality: CGFloat = 0.7) -> String? {
        guard let data = image.jpegData(compressionQuality: compressionQuality) else {
            return nil
        }
        return data.base64EncodedString()
    }
    
    func thumbnail(maxSize: CGFloat = 150) -> UIImage {
        let size = image.size
        let scale = min(maxSize / size.width, maxSize / size.height)
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
    
    var estimatedSize: Int {
        guard let data = image.jpegData(compressionQuality: 0.7) else { return 0 }
        return data.count
    }
    
    static func == (lhs: SelectedImage, rhs: SelectedImage) -> Bool {
        lhs.id == rhs.id
    }
}

/// Model for a selected video
struct SelectedVideo: Identifiable, Equatable {
    let id = UUID()
    let data: Data
    let thumbnail: UIImage?
    let duration: Double?
    let mimeType: String
    
    func toBase64() -> String { data.base64EncodedString() }
    var size: Int { data.count }
    
    func thumbnailBase64(compressionQuality: CGFloat = 0.5) -> String? {
        guard let thumbnail = thumbnail,
              let data = thumbnail.jpegData(compressionQuality: compressionQuality) else {
            return nil
        }
        return data.base64EncodedString()
    }
    
    static func == (lhs: SelectedVideo, rhs: SelectedVideo) -> Bool {
        lhs.id == rhs.id
    }
}

/// Model for selected media (image or video)
enum SelectedMedia: Identifiable, Equatable {
    case image(SelectedImage)
    case video(SelectedVideo)
    
    var id: UUID {
        switch self {
        case .image(let img): return img.id
        case .video(let vid): return vid.id
        }
    }
    
    var isVideo: Bool {
        if case .video = self { return true }
        return false
    }
    
    var thumbnail: UIImage? {
        switch self {
        case .image(let img): return img.thumbnail()
        case .video(let vid): return vid.thumbnail
        }
    }
    
    static func == (lhs: SelectedMedia, rhs: SelectedMedia) -> Bool {
        lhs.id == rhs.id
    }
}
