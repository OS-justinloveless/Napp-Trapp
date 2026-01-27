import Foundation

// MARK: - Git Status

/// Represents the current git status of a repository
struct GitStatus: Codable {
    let branch: String
    let ahead: Int
    let behind: Int
    let staged: [GitFileChange]
    let unstaged: [GitFileChange]
    let untracked: [String]
    
    /// Whether there are any changes (staged, unstaged, or untracked)
    var hasChanges: Bool {
        !staged.isEmpty || !unstaged.isEmpty || !untracked.isEmpty
    }
    
    /// Total number of changed files
    var totalChanges: Int {
        staged.count + unstaged.count + untracked.count
    }
}

/// Represents a changed file in git
struct GitFileChange: Codable, Identifiable, Hashable {
    let path: String
    let status: String  // "modified", "added", "deleted", "renamed", "copied", "unmerged"
    let oldPath: String?  // For renames/copies
    
    var id: String { path }
    
    /// Human-readable status
    var statusDisplay: String {
        switch status {
        case "modified": return "Modified"
        case "added": return "Added"
        case "deleted": return "Deleted"
        case "renamed": return "Renamed"
        case "copied": return "Copied"
        case "unmerged": return "Conflict"
        default: return status.capitalized
        }
    }
    
    /// SF Symbol for this status
    var statusIcon: String {
        switch status {
        case "modified": return "pencil"
        case "added": return "plus"
        case "deleted": return "minus"
        case "renamed": return "arrow.right"
        case "copied": return "doc.on.doc"
        case "unmerged": return "exclamationmark.triangle"
        default: return "questionmark"
        }
    }
    
    /// Color for this status
    var statusColorName: String {
        switch status {
        case "modified": return "orange"
        case "added": return "green"
        case "deleted": return "red"
        case "renamed": return "blue"
        case "copied": return "blue"
        case "unmerged": return "yellow"
        default: return "gray"
        }
    }
}

// MARK: - Git Branches

/// Represents a git branch
struct GitBranch: Codable, Identifiable, Hashable {
    let name: String
    let isRemote: Bool
    let isCurrent: Bool
    
    var id: String { name }
    
    /// Display name without remote prefix
    var displayName: String {
        if name.hasPrefix("origin/") {
            return String(name.dropFirst(7))
        }
        return name
    }
}

struct GitBranchesResponse: Codable {
    let branches: [GitBranch]
}

// MARK: - Git Diff

struct GitDiffResponse: Codable {
    let diff: String
    let truncated: Bool?
    let totalLines: Int?
    
    var isTruncated: Bool {
        truncated ?? false
    }
}

// MARK: - Git Commits

struct GitCommit: Codable, Identifiable, Hashable {
    let hash: String
    let shortHash: String
    let author: GitAuthor
    let timestamp: Int
    let subject: String
    
    var id: String { hash }
    
    var date: Date {
        Date(timeIntervalSince1970: TimeInterval(timestamp) / 1000)
    }
}

struct GitAuthor: Codable, Hashable {
    let name: String
    let email: String
}

struct GitLogResponse: Codable {
    let commits: [GitCommit]
}

// MARK: - Git Remotes

struct GitRemote: Codable, Identifiable, Hashable {
    let name: String
    let fetchUrl: String?
    let pushUrl: String?
    
    var id: String { name }
}

struct GitRemotesResponse: Codable {
    let remotes: [GitRemote]
}

// MARK: - API Request Types

struct GitStageRequest: Codable {
    let files: [String]
}

struct GitCommitRequest: Codable {
    let message: String
    let files: [String]?
}

struct GitPushPullRequest: Codable {
    let remote: String?
    let branch: String?
}

struct GitCheckoutRequest: Codable {
    let branch: String
}

struct GitCreateBranchRequest: Codable {
    let name: String
    let checkout: Bool?
}

struct GitFetchRequest: Codable {
    let remote: String?
}

// MARK: - API Response Types

struct GitOperationResponse: Codable {
    let success: Bool
    let output: String?
    let message: String?
    let hash: String?
    let branch: String?
}
