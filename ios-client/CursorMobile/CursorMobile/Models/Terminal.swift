import Foundation

/// Terminal source types
enum TerminalSource: String, Codable {
    case cursorIDE = "cursor-ide"
    case mobilePTY = "mobile-pty"
    case tmux = "tmux"
    
    var displayName: String {
        switch self {
        case .cursorIDE: return "Cursor IDE"
        case .mobilePTY: return "Mobile PTY"
        case .tmux: return "tmux"
        }
    }
    
    var isInputSupported: Bool {
        switch self {
        case .cursorIDE: return false
        case .mobilePTY, .tmux: return true
        }
    }
}

/// Represents a terminal session (Cursor IDE, PTY, or tmux)
struct Terminal: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let cwd: String
    let pid: Int?  // Optional because tmux sessions may not have a pid when detached
    let active: Bool
    let exitCode: Int?
    let source: String?  // "cursor-ide", "mobile-pty", or "tmux"
    let lastCommand: String?
    let activeCommand: String?
    
    // Optional fields that may not always be present
    let shell: String?
    let projectPath: String?
    let createdAt: Double?
    let cols: Int?
    let rows: Int?
    let exitSignal: String?
    let exitedAt: Double?
    let isHistory: Bool?
    
    // Tmux-specific fields
    let attached: Bool?
    let windowCount: Int?
    let projectName: String?
    
    /// Parsed source type
    var sourceType: TerminalSource {
        guard let source = source else { return .cursorIDE }
        return TerminalSource(rawValue: source) ?? .cursorIDE
    }
    
    /// Whether this is a tmux session
    var isTmux: Bool {
        return sourceType == .tmux
    }
    
    /// Whether input is supported for this terminal
    var supportsInput: Bool {
        return sourceType.isInputSupported
    }
    
    var statusText: String {
        if isTmux {
            if attached == true {
                return "Attached"
            }
            return "Detached (persistent)"
        }
        
        if active {
            if let cmd = activeCommand, !cmd.isEmpty {
                // Show just the command name, not the full command
                let cmdName = cmd.components(separatedBy: " ").first ?? cmd
                return "Running: \(cmdName)"
            }
            return "Running"
        } else if let exitCode = exitCode {
            return "Exited (\(exitCode))"
        } else {
            return "Idle"
        }
    }
    
    var createdDate: Date? {
        guard let createdAt = createdAt else { return nil }
        return Date(timeIntervalSince1970: createdAt / 1000)
    }
    
    var exitedDate: Date? {
        guard let exitedAt = exitedAt else { return nil }
        return Date(timeIntervalSince1970: exitedAt / 1000)
    }
}

// MARK: - API Response Types

struct TerminalsResponse: Codable {
    let terminals: [Terminal]
    let count: Int
    let source: String?
    let message: String?
}

struct TerminalResponse: Codable {
    let terminal: Terminal
}

/// Response for GET /api/terminals/:id with content
struct TerminalDetailResponse: Codable {
    let terminal: Terminal
    let content: String?
}

/// Response for GET /api/terminals/:id/content
struct TerminalContentResponse: Codable {
    let id: String
    let content: String
    let metadata: TerminalMetadata?
}

struct TerminalMetadata: Codable {
    let pid: String?
    let cwd: String?
    let last_command: String?
    let last_exit_code: String?
    let active_command: String?
}

// MARK: - API Request Types

struct TerminalInputRequest: Codable {
    let data: String
    let projectPath: String
}

struct TerminalActionResponse: Codable {
    let success: Bool
}
