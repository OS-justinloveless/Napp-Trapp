import Foundation
import UIKit

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
    
    // Read-only conversation fields
    let isReadOnly: Bool?
    let readOnlyReason: String?
    let canFork: Bool?
    
    enum CodingKeys: String, CodingKey {
        case id, type, title, timestamp, messageCount, workspaceId, source, projectName, workspaceFolder, isProjectChat
        case isReadOnly, readOnlyReason, canFork
    }
    
    var displayName: String {
        projectName ?? "Global"
    }
    
    var lastModified: Date {
        Date(timeIntervalSince1970: timestamp / 1000.0)
    }
    
    /// Whether this chat is specific to the current project or a global chat
    var isGlobalChat: Bool {
        !(isProjectChat ?? true)
    }
    
    /// Whether this conversation is read-only (created in Cursor IDE)
    var isReadOnlyConversation: Bool {
        isReadOnly ?? (source != "mobile")
    }
    
    /// Whether this conversation can be forked to create an editable copy
    var canForkConversation: Bool {
        canFork ?? (isReadOnlyConversation && messageCount > 0)
    }
}

struct ConversationsResponse: Codable {
    let conversations: [Conversation]
}

struct ConversationDetail: Codable {
    let conversation: Conversation
}

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
    
    var messageId: String {
        id ?? UUID().uuidString
    }
    
    var isAssistant: Bool {
        type?.lowercased() == "assistant"
    }
    
    var content: String? {
        text
    }
    
    var role: String? {
        type
    }
    
    /// Returns true if the message has no displayable content
    var isEmpty: Bool {
        let hasText = !(text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        let hasToolCalls = !(toolCalls?.isEmpty ?? true)
        let hasCodeBlocks = !(codeBlocks?.isEmpty ?? true)
        return !hasText && !hasToolCalls && !hasCodeBlocks
    }
    
    struct CodeBlock: Codable, Hashable {
        let type: String?
        let language: String?
        let content: String?
        let diffId: String?
    }
}

struct MessageAttachment: Codable, Identifiable, Hashable {
    let id: String
    let type: AttachmentType
    let filename: String
    let mimeType: String
    let size: Int?
    let data: String? // Base64 encoded data
    let url: String? // URL if stored on server
    let thumbnailData: String? // Base64 encoded thumbnail for images
    
    enum AttachmentType: String, Codable {
        case image
        case document
        case file
    }
    
    var displayName: String {
        filename
    }
    
    var isImage: Bool {
        type == .image
    }
}

/// Model for a selected image
struct SelectedImage: Identifiable, Equatable {
    let id = UUID()
    let image: UIImage
    
    /// Convert to base64 encoded string
    func toBase64(compressionQuality: CGFloat = 0.7) -> String? {
        guard let data = image.jpegData(compressionQuality: compressionQuality) else {
            return nil
        }
        return data.base64EncodedString()
    }
    
    /// Create thumbnail
    func thumbnail(maxSize: CGFloat = 150) -> UIImage {
        let size = image.size
        let scale = min(maxSize / size.width, maxSize / size.height)
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
    
    /// Get file size estimate in bytes
    var estimatedSize: Int {
        guard let data = image.jpegData(compressionQuality: 0.7) else {
            return 0
        }
        return data.count
    }
    
    static func == (lhs: SelectedImage, rhs: SelectedImage) -> Bool {
        lhs.id == rhs.id
    }
}

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
    
    // Tool display information
    var displayInfo: (icon: String, displayName: String, description: String) {
        let inputDict = input ?? [:]
        
        switch name {
        case "Read":
            let path = inputDict["path"]?.stringValue ?? ""
            let fileName = (path as NSString).lastPathComponent
            return ("📄", "Read File", fileName.isEmpty ? "Reading file" : "Reading \(fileName)")
        case "Write":
            let path = inputDict["path"]?.stringValue ?? ""
            let fileName = (path as NSString).lastPathComponent
            return ("✏️", "Write File", fileName.isEmpty ? "Writing file" : "Writing to \(fileName)")
        case "Edit", "StrReplace":
            let path = inputDict["path"]?.stringValue ?? ""
            let fileName = (path as NSString).lastPathComponent
            return ("🔧", "Edit File", fileName.isEmpty ? "Editing file" : "Editing \(fileName)")
        case "Shell", "Bash":
            let command = inputDict["command"]?.stringValue ?? ""
            let shortCommand = command.count > 40 ? String(command.prefix(40)) + "..." : command
            return ("💻", "Run Command", shortCommand.isEmpty ? "Running command" : "$ \(shortCommand)")
        case "Grep":
            let pattern = inputDict["pattern"]?.stringValue ?? ""
            let shortPattern = pattern.count > 30 ? String(pattern.prefix(30)) + "..." : pattern
            return ("🔍", "Search", shortPattern.isEmpty ? "Searching" : "Searching for \"\(shortPattern)\"")
        case "Glob":
            let pattern = inputDict["pattern"]?.stringValue ?? inputDict["glob_pattern"]?.stringValue ?? ""
            return ("📂", "Find Files", pattern.isEmpty ? "Finding files" : "Finding \(pattern)")
        case "LS":
            let path = inputDict["path"]?.stringValue ?? inputDict["target_directory"]?.stringValue ?? ""
            let dirName = (path as NSString).lastPathComponent
            return ("📁", "List Directory", dirName.isEmpty ? "Listing directory" : "Listing \(dirName)")
        case "SemanticSearch":
            let query = inputDict["query"]?.stringValue ?? ""
            let shortQuery = query.count > 35 ? String(query.prefix(35)) + "..." : query
            return ("🧠", "Semantic Search", shortQuery.isEmpty ? "Semantic search" : "Searching: \"\(shortQuery)\"")
        case "WebSearch":
            let query = inputDict["query"]?.stringValue ?? inputDict["search_term"]?.stringValue ?? ""
            let shortQuery = query.count > 35 ? String(query.prefix(35)) + "..." : query
            return ("🌐", "Web Search", shortQuery.isEmpty ? "Web search" : "Searching: \"\(shortQuery)\"")
        case "WebFetch":
            let urlString = inputDict["url"]?.stringValue ?? ""
            if let url = URL(string: urlString), let host = url.host {
                return ("🌍", "Fetch URL", "Fetching \(host)")
            }
            return ("🌍", "Fetch URL", "Fetching URL")
        case "Task":
            let description = inputDict["description"]?.stringValue ?? ""
            return ("🤖", "Run Task", description.isEmpty ? "Running subtask" : description)
        case "TodoWrite":
            return ("✅", "Update Todos", "Updating task list")
        case "Delete":
            let path = inputDict["path"]?.stringValue ?? ""
            let fileName = (path as NSString).lastPathComponent
            return ("🗑️", "Delete File", fileName.isEmpty ? "Deleting file" : "Deleting \(fileName)")
        default:
            return ("🔧", name, "Running tool")
        }
    }
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
    
    static func == (lhs: ToolCall, rhs: ToolCall) -> Bool {
        lhs.id == rhs.id
    }
}

// Helper for handling dynamic JSON values in tool call inputs
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

struct MessagesResponse: Codable {
    let messages: [ConversationMessage]
}

struct CreateConversationResponse: Codable {
    let chatId: String
    let success: Bool
}

struct ForkConversationResponse: Codable {
    let success: Bool
    let originalConversationId: String
    let newConversationId: String
    let conversation: Conversation
    let messagesCopied: Int
}
