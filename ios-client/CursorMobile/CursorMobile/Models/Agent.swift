import Foundation
import SwiftUI

// MARK: - Agent (ACP Support)

/// Represents an AI agent CLI that can be used for chat
/// Based on Agent Client Protocol (ACP) - a standardization for communication between code editors and AI agents
struct Agent: Identifiable, Codable, Hashable {
    let id: String              // e.g., "claude", "cursor-agent", "gemini"
    let displayName: String     // e.g., "Claude Code"
    let available: Bool         // Is CLI installed on server?
    let installInstructions: String?
    let capabilities: AgentCapabilities?

    var icon: String {
        switch id {
        case "claude": return "sparkles"
        case "cursor-agent": return "cursorarrow.rays"
        case "gemini": return "star.fill"
        default: return "cpu"
        }
    }

    var color: Color {
        switch id {
        case "claude": return .purple
        case "cursor-agent": return .blue
        case "gemini": return .orange
        default: return .gray
        }
    }

    /// Create from ChatTool enum for backwards compatibility
    static func from(tool: ChatTool, available: Bool = true) -> Agent {
        Agent(
            id: tool.rawValue,
            displayName: tool.displayName,
            available: available,
            installInstructions: nil,
            capabilities: AgentCapabilities(
                streaming: true,
                sessionResume: tool == .claude,
                toolUse: true,
                fileEditing: true,
                interactiveMode: true
            )
        )
    }
}

// MARK: - Agent Capabilities

/// Capabilities of an agent CLI
struct AgentCapabilities: Codable, Hashable {
    let streaming: Bool
    let sessionResume: Bool
    let toolUse: Bool
    let fileEditing: Bool
    let interactiveMode: Bool
}

// MARK: - API Response Types

/// Response from GET /api/conversations/tools/availability
struct AgentsResponse: Codable {
    let tools: [String: AgentInfo]
}

struct AgentInfo: Codable {
    let available: Bool
    let displayName: String
    let installInstructions: String?
}

// MARK: - Custom Agent (User-configurable)

/// A custom agent configured by the user
struct CustomAgent: Identifiable, Codable, Hashable {
    let id: String
    var name: String
    var cliPath: String        // e.g., "/usr/local/bin/my-agent"
    var cliArgs: [String]      // Additional arguments
    var supportsStreaming: Bool
    var supportsToolUse: Bool

    init(id: String = UUID().uuidString, name: String, cliPath: String, cliArgs: [String] = [], supportsStreaming: Bool = true, supportsToolUse: Bool = true) {
        self.id = id
        self.name = name
        self.cliPath = cliPath
        self.cliArgs = cliArgs
        self.supportsStreaming = supportsStreaming
        self.supportsToolUse = supportsToolUse
    }

    func toAgent() -> Agent {
        Agent(
            id: id,
            displayName: name,
            available: true, // Will be validated on server
            installInstructions: nil,
            capabilities: AgentCapabilities(
                streaming: supportsStreaming,
                sessionResume: false,
                toolUse: supportsToolUse,
                fileEditing: supportsToolUse,
                interactiveMode: true
            )
        )
    }
}
