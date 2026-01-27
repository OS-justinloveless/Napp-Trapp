import Foundation

struct FileItem: Codable, Identifiable, Hashable {
    let name: String
    let path: String
    let isDirectory: Bool
    let size: Int
    let modified: Date?
    
    var id: String { path }
    
    var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(size))
    }
    
    var fileExtension: String {
        (name as NSString).pathExtension.lowercased()
    }
    
    var icon: String {
        if isDirectory {
            return "folder.fill"
        }
        
        switch fileExtension {
        case "swift":
            return "swift"
        case "js", "jsx", "ts", "tsx":
            return "chevron.left.forwardslash.chevron.right"
        case "py":
            return "chevron.left.forwardslash.chevron.right"
        case "json":
            return "curlybraces"
        case "md", "txt":
            return "doc.text.fill"
        case "html", "css":
            return "globe"
        case "png", "jpg", "jpeg", "gif", "svg":
            return "photo.fill"
        case "pdf":
            return "doc.richtext.fill"
        default:
            return "doc.fill"
        }
    }
    
    enum CodingKeys: String, CodingKey {
        case name, path, isDirectory, size, modified
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        path = try container.decode(String.self, forKey: .path)
        isDirectory = try container.decode(Bool.self, forKey: .isDirectory)
        size = try container.decode(Int.self, forKey: .size)
        
        if let dateString = try container.decodeIfPresent(String.self, forKey: .modified) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: dateString) {
                modified = date
            } else {
                formatter.formatOptions = [.withInternetDateTime]
                modified = formatter.date(from: dateString)
            }
        } else {
            modified = nil
        }
    }
    
    init(name: String, path: String, isDirectory: Bool, size: Int, modified: Date?) {
        self.name = name
        self.path = path
        self.isDirectory = isDirectory
        self.size = size
        self.modified = modified
    }
}

struct DirectoryListResponse: Codable {
    let items: [FileItem]
}

struct FileContent: Codable {
    let path: String
    let content: String
    let size: Int
    let modified: String
    let `extension`: String
    
    var language: String {
        switch `extension`.lowercased() {
        case "swift":
            return "swift"
        case "js":
            return "javascript"
        case "jsx":
            return "jsx"
        case "ts":
            return "typescript"
        case "tsx":
            return "tsx"
        case "py":
            return "python"
        case "rb":
            return "ruby"
        case "go":
            return "go"
        case "rs":
            return "rust"
        case "java":
            return "java"
        case "kt":
            return "kotlin"
        case "json":
            return "json"
        case "yaml", "yml":
            return "yaml"
        case "xml":
            return "xml"
        case "html":
            return "html"
        case "css":
            return "css"
        case "scss", "sass":
            return "scss"
        case "md":
            return "markdown"
        case "sql":
            return "sql"
        case "sh", "bash":
            return "bash"
        default:
            return "plaintext"
        }
    }
}

struct WriteFileRequest: Codable {
    let filePath: String
    let content: String
}

struct WriteFileResponse: Codable {
    let success: Bool
    let path: String
    let diff: String?
}

struct CreateFileRequest: Codable {
    let filePath: String
    let content: String?
}

struct CreateFileResponse: Codable {
    let success: Bool
    let path: String
}

struct DeleteFileResponse: Codable {
    let success: Bool
    let deleted: String
}
