import Foundation

struct Conversation: Codable, Identifiable, Hashable {
    let id: String
    let projectName: String
    let path: String
    let lastModified: Date?
    
    enum CodingKeys: String, CodingKey {
        case id, projectName, path, lastModified
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        projectName = try container.decode(String.self, forKey: .projectName)
        path = try container.decode(String.self, forKey: .path)
        
        if let dateString = try container.decodeIfPresent(String.self, forKey: .lastModified) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: dateString) {
                lastModified = date
            } else {
                formatter.formatOptions = [.withInternetDateTime]
                lastModified = formatter.date(from: dateString)
            }
        } else {
            lastModified = nil
        }
    }
    
    init(id: String, projectName: String, path: String, lastModified: Date?) {
        self.id = id
        self.projectName = projectName
        self.path = path
        self.lastModified = lastModified
    }
}

struct ConversationsResponse: Codable {
    let conversations: [Conversation]
}

struct ConversationDetail: Codable {
    let conversation: ConversationInfo
    
    struct ConversationInfo: Codable {
        let id: String
        let path: String
        let lastModified: String
        let workspace: WorkspaceInfo?
    }
    
    struct WorkspaceInfo: Codable {
        let folder: String?
    }
}

struct ConversationMessage: Codable, Identifiable {
    let id: String?
    let role: String?
    let content: String?
    let timestamp: String?
    
    var messageId: String {
        id ?? UUID().uuidString
    }
    
    var isAssistant: Bool {
        role?.lowercased() == "assistant"
    }
}

struct MessagesResponse: Codable {
    let messages: [ConversationMessage]
}
