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
    let resolvedPath: String?
}

struct FileContent: Codable {
    let path: String
    let content: String
    let size: Int
    let modified: String
    let `extension`: String
    let isBinary: Bool?
    let mimeType: String?
    
    /// Whether this file is a binary file
    var isBinaryFile: Bool {
        isBinary ?? false
    }
    
    /// Whether this file is an image
    var isImage: Bool {
        let ext = `extension`.lowercased()
        let imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "tif", "heic", "heif", "svg"]
        return imageExtensions.contains(ext) || (mimeType?.hasPrefix("image/") ?? false)
    }
    
    /// Whether this file is a video
    var isVideo: Bool {
        let ext = `extension`.lowercased()
        let videoExtensions = ["mp4", "mov", "m4v", "avi", "webm", "mkv", "wmv", "flv"]
        return videoExtensions.contains(ext) || (mimeType?.hasPrefix("video/") ?? false)
    }
    
    /// Whether this file is audio
    var isAudio: Bool {
        let ext = `extension`.lowercased()
        let audioExtensions = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "wma"]
        return audioExtensions.contains(ext) || (mimeType?.hasPrefix("audio/") ?? false)
    }
    
    /// Whether this file is a PDF
    var isPDF: Bool {
        let ext = `extension`.lowercased()
        return ext == "pdf" || mimeType == "application/pdf"
    }
    
    /// Whether this file is a non-media binary file (archives, executables, etc.)
    var isBinaryNonMedia: Bool {
        isBinaryFile && !isImage && !isVideo && !isAudio && !isPDF
    }
    
    /// Decode base64 content to Data (for binary files)
    var binaryData: Data? {
        guard isBinaryFile else { return nil }
        return Data(base64Encoded: content)
    }
    
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

struct CreateFolderRequest: Codable {
    let dirPath: String
}

struct CreateFolderResponse: Codable {
    let success: Bool
    let path: String
}

struct DeleteFileResponse: Codable {
    let success: Bool
    let deleted: String
}

struct RenameFileRequest: Codable {
    let oldPath: String
    let newName: String
}

struct RenameFileResponse: Codable {
    let success: Bool
    let oldPath: String
    let newPath: String
}

struct MoveFileRequest: Codable {
    let sourcePath: String
    let destinationPath: String
}

struct MoveFileResponse: Codable {
    let success: Bool
    let sourcePath: String
    let destinationPath: String
}

// MARK: - File Upload

/// Represents a file to be uploaded
struct UploadFile {
    let filename: String
    let data: Data
    let mimeType: String
    
    init(filename: String, data: Data, mimeType: String? = nil) {
        self.filename = filename
        self.data = data
        self.mimeType = mimeType ?? UploadFile.detectMimeType(filename: filename)
    }
    
    /// Detect MIME type from filename extension
    static func detectMimeType(filename: String) -> String {
        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        // Text files
        case "txt": return "text/plain"
        case "html", "htm": return "text/html"
        case "css": return "text/css"
        case "js": return "application/javascript"
        case "json": return "application/json"
        case "xml": return "application/xml"
        case "csv": return "text/csv"
        case "md": return "text/markdown"
        
        // Source code
        case "swift": return "text/x-swift"
        case "py": return "text/x-python"
        case "rb": return "text/x-ruby"
        case "java": return "text/x-java"
        case "kt": return "text/x-kotlin"
        case "go": return "text/x-go"
        case "rs": return "text/x-rust"
        case "ts", "tsx": return "text/typescript"
        case "jsx": return "text/jsx"
        case "c", "h": return "text/x-c"
        case "cpp", "hpp", "cc": return "text/x-c++"
        case "cs": return "text/x-csharp"
        case "php": return "text/x-php"
        case "sh", "bash": return "text/x-shellscript"
        case "yml", "yaml": return "text/yaml"
        
        // Images
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        
        // Documents
        case "pdf": return "application/pdf"
        case "doc": return "application/msword"
        case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        case "xls": return "application/vnd.ms-excel"
        case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        case "ppt": return "application/vnd.ms-powerpoint"
        case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        
        // Archives
        case "zip": return "application/zip"
        case "tar": return "application/x-tar"
        case "gz": return "application/gzip"
        case "rar": return "application/vnd.rar"
        case "7z": return "application/x-7z-compressed"
        
        // Media
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        case "mp4": return "video/mp4"
        case "mov": return "video/quicktime"
        case "avi": return "video/x-msvideo"
        case "webm": return "video/webm"
        
        default: return "application/octet-stream"
        }
    }
}

/// Response from file upload
struct UploadFilesResponse: Codable {
    let success: Bool
    let uploaded: [UploadedFileInfo]
    let errors: [UploadError]?
    let totalUploaded: Int
    let totalFailed: Int
}

struct UploadedFileInfo: Codable {
    let name: String
    let path: String
    let size: Int
    let mimeType: String
}

struct UploadError: Codable {
    let name: String
    let error: String
}
