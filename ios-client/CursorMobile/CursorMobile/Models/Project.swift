import Foundation

struct Project: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let path: String
    let lastOpened: Date?
    
    enum CodingKeys: String, CodingKey {
        case id, name, path, lastOpened
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        path = try container.decode(String.self, forKey: .path)
        
        // Handle date parsing - API returns ISO8601 string
        if let dateString = try container.decodeIfPresent(String.self, forKey: .lastOpened) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: dateString) {
                lastOpened = date
            } else {
                // Try without fractional seconds
                formatter.formatOptions = [.withInternetDateTime]
                lastOpened = formatter.date(from: dateString)
            }
        } else {
            lastOpened = nil
        }
    }
    
    init(id: String, name: String, path: String, lastOpened: Date? = nil) {
        self.id = id
        self.name = name
        self.path = path
        self.lastOpened = lastOpened
    }
}

struct ProjectsResponse: Codable {
    let projects: [Project]
}

struct ProjectResponse: Codable {
    let project: Project
}

struct ProjectTree: Codable {
    let tree: [FileTreeItem]
}

struct FileTreeItem: Codable, Identifiable, Hashable {
    let name: String
    let path: String
    let isDirectory: Bool
    let children: [FileTreeItem]?
    
    var id: String { path }
}

struct CreateProjectRequest: Codable {
    let name: String
    let path: String?
    let template: String?
}

struct CreateProjectResponse: Codable {
    let success: Bool
    let project: NewProject?
    
    struct NewProject: Codable {
        let name: String
        let path: String
        let createdAt: String
    }
}
