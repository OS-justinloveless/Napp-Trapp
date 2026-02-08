import Foundation
import SwiftUI

// MARK: - Content Block Types

/// Types of content blocks that can be received from the CLI output parser
enum ContentBlockType: String, Codable, CaseIterable {
    case text = "text"
    case thinking = "thinking"
    case toolUseStart = "tool_use_start"
    case toolUseResult = "tool_use_result"
    case fileRead = "file_read"
    case fileEdit = "file_edit"
    case commandRun = "command_run"
    case commandOutput = "command_output"
    case approvalRequest = "approval_request"
    case inputRequest = "input_request"
    case error = "error"
    case progress = "progress"
    case codeBlock = "code_block"
    case raw = "raw"
    case sessionStart = "session_start"
    case sessionEnd = "session_end"
    case usage = "usage"
    
    /// Icon for this block type
    var icon: String {
        switch self {
        case .text: return "text.alignleft"
        case .thinking: return "brain"
        case .toolUseStart: return "wrench.and.screwdriver"
        case .toolUseResult: return "checkmark.circle"
        case .fileRead: return "doc.text"
        case .fileEdit: return "pencil"
        case .commandRun: return "terminal"
        case .commandOutput: return "text.append"
        case .approvalRequest: return "hand.raised"
        case .inputRequest: return "keyboard"
        case .error: return "exclamationmark.triangle"
        case .progress: return "arrow.triangle.2.circlepath"
        case .codeBlock: return "chevron.left.forwardslash.chevron.right"
        case .raw: return "text.quote"
        case .sessionStart: return "play.circle"
        case .sessionEnd: return "stop.circle"
        case .usage: return "chart.bar"
        }
    }
    
    /// Color for this block type
    var color: Color {
        switch self {
        case .text: return .primary
        case .thinking: return .purple
        case .toolUseStart: return .blue
        case .toolUseResult: return .green
        case .fileRead: return .cyan
        case .fileEdit: return .orange
        case .commandRun: return .indigo
        case .commandOutput: return .secondary
        case .approvalRequest: return .yellow
        case .inputRequest: return .mint
        case .error: return .red
        case .progress: return .blue
        case .codeBlock: return .secondary
        case .raw: return .secondary
        case .sessionStart: return .green
        case .sessionEnd: return .gray
        case .usage: return .purple
        }
    }
}

// MARK: - Chat Content Block

/// A parsed content block from CLI output
struct ChatContentBlock: Codable, Identifiable, Hashable {
    let id: String
    let type: ContentBlockType
    let timestamp: Double
    
    // Common fields
    var content: String?
    var isPartial: Bool?
    
    // Tool use fields
    var toolId: String?
    var toolName: String?
    var input: [String: AnyCodableValue]?
    var isError: Bool?
    
    // File operation fields
    var path: String?
    var diff: String?
    
    // Command fields
    var command: String?
    var exitCode: Int?
    
    // Approval/input request fields
    var action: String?
    var prompt: String?
    var options: [String]?
    
    // Code block fields
    var language: String?
    var code: String?
    
    // Error fields
    var message: String?
    var errorCode: String?
    
    // Session fields
    var model: String?
    var role: String?
    var reason: String?
    var suspended: Bool?
    
    // Usage fields
    var inputTokens: Int?
    var outputTokens: Int?
    
    // Progress fields
    var isSuccess: Bool?
    var isMode: Bool?
    
    enum CodingKeys: String, CodingKey {
        case id, type, timestamp, content, isPartial
        case toolId, toolName, input, isError
        case path, diff
        case command, exitCode
        case action, prompt, options
        case language, code
        case message, errorCode
        case model, role, reason, suspended
        case inputTokens, outputTokens
        case isSuccess, isMode
    }

    // MARK: - Initializers

    init(
        id: String,
        type: ContentBlockType,
        timestamp: Double,
        content: String? = nil,
        isPartial: Bool? = nil,
        toolId: String? = nil,
        toolName: String? = nil,
        input: [String: AnyCodableValue]? = nil,
        isError: Bool? = nil,
        path: String? = nil,
        diff: String? = nil,
        command: String? = nil,
        exitCode: Int? = nil,
        action: String? = nil,
        prompt: String? = nil,
        options: [String]? = nil,
        language: String? = nil,
        code: String? = nil,
        message: String? = nil,
        errorCode: String? = nil,
        model: String? = nil,
        role: String? = nil,
        reason: String? = nil,
        suspended: Bool? = nil,
        inputTokens: Int? = nil,
        outputTokens: Int? = nil,
        isSuccess: Bool? = nil,
        isMode: Bool? = nil
    ) {
        self.id = id
        self.type = type
        self.timestamp = timestamp
        self.content = content
        self.isPartial = isPartial
        self.toolId = toolId
        self.toolName = toolName
        self.input = input
        self.isError = isError
        self.path = path
        self.diff = diff
        self.command = command
        self.exitCode = exitCode
        self.action = action
        self.prompt = prompt
        self.options = options
        self.language = language
        self.code = code
        self.message = message
        self.errorCode = errorCode
        self.model = model
        self.role = role
        self.reason = reason
        self.suspended = suspended
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.isSuccess = isSuccess
        self.isMode = isMode
    }
    
    // MARK: - Convenience Properties
    
    /// Display text for this block
    var displayText: String {
        switch type {
        case .text, .thinking, .raw:
            return content ?? ""
        case .toolUseStart:
            return "Using tool: \(toolName ?? "unknown")"
        case .toolUseResult:
            return content ?? "Tool completed"
        case .fileRead:
            return "Reading: \(path ?? "file")"
        case .fileEdit:
            return "Editing: \(path ?? "file")"
        case .commandRun:
            return "$ \(command ?? "")"
        case .commandOutput:
            return content ?? ""
        case .approvalRequest:
            return prompt ?? "Awaiting approval"
        case .inputRequest:
            return prompt ?? "Awaiting input"
        case .error:
            return message ?? content ?? "Error"
        case .progress:
            return message ?? content ?? "Processing..."
        case .codeBlock:
            return code ?? ""
        case .sessionStart:
            return "Session started"
        case .sessionEnd:
            return suspended == true ? "Session suspended" : "Session ended"
        case .usage:
            return "Tokens: \(inputTokens ?? 0) in / \(outputTokens ?? 0) out"
        }
    }
    
    /// Whether this block should be displayed inline (vs as a card)
    var isInline: Bool {
        switch type {
        case .text, .thinking, .raw, .progress:
            return true
        default:
            return false
        }
    }
    
    /// Whether this block is interactive (has buttons)
    var isInteractive: Bool {
        switch type {
        case .approvalRequest, .inputRequest:
            return true
        default:
            return false
        }
    }
    
    /// Whether this block represents an error
    var isErrorBlock: Bool {
        type == .error || (isError == true)
    }

    /// Create a copy with isPartial set to false (completed)
    func withCompleted(_ completed: Bool) -> ChatContentBlock {
        ChatContentBlock(
            id: id,
            type: type,
            timestamp: timestamp,
            content: content,
            isPartial: !completed,
            toolId: toolId,
            toolName: toolName,
            input: input,
            isError: isError,
            path: path,
            diff: diff,
            command: command,
            exitCode: exitCode,
            action: action,
            prompt: prompt,
            options: options,
            language: language,
            code: code,
            message: message,
            errorCode: errorCode,
            model: model,
            role: role,
            reason: reason,
            suspended: suspended,
            inputTokens: inputTokens,
            outputTokens: outputTokens,
            isSuccess: isSuccess,
            isMode: isMode
        )
    }
    
    /// Tool display info for tool_use blocks
    var toolDisplayInfo: (icon: String, name: String, description: String) {
        guard let toolName = toolName else {
            return ("wrench", "Tool", "Running tool")
        }

        // Try to get input from the input dict, or parse it from content JSON
        var inputDict = input ?? [:]
        if inputDict.isEmpty, let contentStr = content, !contentStr.isEmpty {
            // Try parsing as complete JSON first
            if let data = contentStr.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                // Convert JSON dict to AnyCodableValue dict
                for (key, value) in json {
                    if let stringValue = value as? String {
                        inputDict[key] = AnyCodableValue.string(stringValue)
                    } else if let intValue = value as? Int {
                        inputDict[key] = AnyCodableValue.int(intValue)
                    } else if let boolValue = value as? Bool {
                        inputDict[key] = AnyCodableValue.bool(boolValue)
                    }
                }
            } else {
                // Try to extract values from partial JSON using regex with capture groups
                // Extract "command": "value" pattern
                if let extracted = extractJSONStringValue(from: contentStr, forKey: "command") {
                    inputDict["command"] = AnyCodableValue.string(extracted)
                }
                // Extract "pattern": "value" pattern
                if let extracted = extractJSONStringValue(from: contentStr, forKey: "pattern") {
                    inputDict["pattern"] = AnyCodableValue.string(extracted)
                }
                // Extract "path": "value" pattern
                if let extracted = extractJSONStringValue(from: contentStr, forKey: "path") {
                    inputDict["path"] = AnyCodableValue.string(extracted)
                }
                // Extract "file_path": "value" pattern
                if let extracted = extractJSONStringValue(from: contentStr, forKey: "file_path") {
                    inputDict["path"] = AnyCodableValue.string(extracted)
                }
            }
        }
        
        switch toolName.lowercased() {
        case "read", "read_file":
            let filePath = inputDict["path"]?.stringValue ?? path ?? ""
            let fileName = (filePath as NSString).lastPathComponent
            return ("doc.text", "Read File", fileName.isEmpty ? "Reading file" : fileName)
            
        case "write", "write_file":
            let filePath = inputDict["path"]?.stringValue ?? path ?? ""
            let fileName = (filePath as NSString).lastPathComponent
            return ("pencil", "Write File", fileName.isEmpty ? "Writing file" : fileName)
            
        case "edit", "str_replace", "strreplace":
            let filePath = inputDict["path"]?.stringValue ?? path ?? ""
            let fileName = (filePath as NSString).lastPathComponent
            return ("pencil.line", "Edit File", fileName.isEmpty ? "Editing file" : fileName)
            
        case "shell", "bash", "execute":
            let cmd = inputDict["command"]?.stringValue ?? command ?? ""
            let shortCmd = cmd.count > 40 ? String(cmd.prefix(40)) + "..." : cmd
            return ("terminal", "Run Command", shortCmd.isEmpty ? "Running command" : shortCmd)
            
        case "grep", "search":
            let pattern = inputDict["pattern"]?.stringValue ?? ""
            return ("magnifyingglass", "Search", pattern.isEmpty ? "Searching" : "Searching: \(pattern)")
            
        case "glob", "find_files":
            let pattern = inputDict["pattern"]?.stringValue ?? inputDict["glob_pattern"]?.stringValue ?? ""
            return ("folder", "Find Files", pattern.isEmpty ? "Finding files" : pattern)
            
        case "ls", "list_directory":
            let dir = inputDict["path"]?.stringValue ?? inputDict["target_directory"]?.stringValue ?? ""
            let dirName = (dir as NSString).lastPathComponent
            return ("folder", "List Directory", dirName.isEmpty ? "Listing directory" : dirName)
            
        default:
            return ("wrench.and.screwdriver", toolName, "Running \(toolName)")
        }
    }

    /// Extract a string value from partial JSON for a given key
    /// Handles incomplete JSON like {"command": "ls -la" without closing brace
    private func extractJSONStringValue(from json: String, forKey key: String) -> String? {
        // Pattern: "key": "value" or "key":"value"
        // We need to find the key, then extract the value after the colon and quotes
        let pattern = "\"\(key)\"\\s*:\\s*\"([^\"]*)"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []),
              let match = regex.firstMatch(in: json, options: [], range: NSRange(json.startIndex..., in: json)),
              match.numberOfRanges >= 2,
              let valueRange = Range(match.range(at: 1), in: json) else {
            return nil
        }
        let value = String(json[valueRange])
        return value.isEmpty ? nil : value
    }

    // MARK: - Hashable
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
    
    static func == (lhs: ChatContentBlock, rhs: ChatContentBlock) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Content Blocks Response

/// Response from WebSocket chatContentBlocks message
struct ContentBlocksMessage: Codable {
    let type: String
    let conversationId: String
    let blocks: [ChatContentBlock]
    let isBuffer: Bool?
}

// MARK: - Chat Session Events

/// Chat session status event
struct ChatSessionEvent: Codable {
    let type: String
    let conversationId: String
    let reason: String?
    let tool: String?
    let isNew: Bool?
    let workspacePath: String?
    let message: String?
    let messageId: String?
}

// MARK: - Parsed Message

/// A message composed of content blocks (used for rendering)
struct ParsedMessage: Identifiable {
    let id: String
    let role: MessageRole
    var blocks: [ChatContentBlock]
    let timestamp: Date
    var isStreaming: Bool
    
    enum MessageRole: String {
        case user
        case assistant
        case system
    }
    
    /// All text content concatenated
    var textContent: String {
        blocks
            .filter { $0.type == .text || $0.type == .raw }
            .compactMap { $0.content }
            .joined()
    }
    
    /// Whether this message has any tool calls
    var hasToolCalls: Bool {
        blocks.contains { $0.type == .toolUseStart || $0.type == .toolUseResult }
    }
    
    /// Whether this message has any errors
    var hasErrors: Bool {
        blocks.contains { $0.isErrorBlock }
    }
    
    /// Whether this message is awaiting user action
    var isAwaitingAction: Bool {
        blocks.contains { $0.isInteractive }
    }
}

// MARK: - Diff Parsing (Chat-specific types to avoid conflicts with GitDiffSheet)

/// Parsed diff hunk for chat content blocks
struct ChatDiffHunk: Identifiable {
    let id = UUID()
    let oldStart: Int
    let oldCount: Int
    let newStart: Int
    let newCount: Int
    let lines: [ChatDiffLine]
}

/// A line in a diff for chat content blocks
struct ChatDiffLine: Identifiable {
    let id = UUID()
    let type: ChatDiffLineType
    let content: String
    
    enum ChatDiffLineType {
        case add
        case remove
        case context
    }
    
    var color: Color {
        switch type {
        case .add: return .green
        case .remove: return .red
        case .context: return .secondary
        }
    }
    
    var prefix: String {
        switch type {
        case .add: return "+"
        case .remove: return "-"
        case .context: return " "
        }
    }
}

/// Parsed diff result for chat content blocks
struct ChatParsedDiff {
    let filePath: String?
    let hunks: [ChatDiffHunk]
    
    /// Parse a unified diff string
    static func parse(_ diffText: String) -> ChatParsedDiff {
        var filePath: String?
        var hunks: [ChatDiffHunk] = []
        var currentHunk: (oldStart: Int, oldCount: Int, newStart: Int, newCount: Int, lines: [ChatDiffLine])?
        
        let lines = diffText.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        
        for line in lines {
            if line.hasPrefix("--- ") {
                filePath = String(line.dropFirst(4)).replacingOccurrences(of: "a/", with: "")
            } else if line.hasPrefix("+++ ") {
                filePath = String(line.dropFirst(4)).replacingOccurrences(of: "b/", with: "")
            } else if line.hasPrefix("@@") {
                // Save previous hunk
                if let hunk = currentHunk {
                    hunks.append(ChatDiffHunk(
                        oldStart: hunk.oldStart,
                        oldCount: hunk.oldCount,
                        newStart: hunk.newStart,
                        newCount: hunk.newCount,
                        lines: hunk.lines
                    ))
                }
                
                // Parse hunk header: @@ -start,count +start,count @@
                let pattern = #"@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@"#
                if let regex = try? NSRegularExpression(pattern: pattern),
                   let match = regex.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) {
                    let oldStart = Int((line as NSString).substring(with: match.range(at: 1))) ?? 0
                    let oldCount = Int((line as NSString).substring(with: match.range(at: 2))) ?? 1
                    let newStart = Int((line as NSString).substring(with: match.range(at: 3))) ?? 0
                    let newCount = Int((line as NSString).substring(with: match.range(at: 4))) ?? 1
                    currentHunk = (oldStart, oldCount, newStart, newCount, [])
                }
            } else if currentHunk != nil {
                if line.hasPrefix("+") && !line.hasPrefix("+++") {
                    currentHunk?.lines.append(ChatDiffLine(type: .add, content: String(line.dropFirst())))
                } else if line.hasPrefix("-") && !line.hasPrefix("---") {
                    currentHunk?.lines.append(ChatDiffLine(type: .remove, content: String(line.dropFirst())))
                } else if line.hasPrefix(" ") {
                    currentHunk?.lines.append(ChatDiffLine(type: .context, content: String(line.dropFirst())))
                }
            }
        }
        
        // Save last hunk
        if let hunk = currentHunk {
            hunks.append(ChatDiffHunk(
                oldStart: hunk.oldStart,
                oldCount: hunk.oldCount,
                newStart: hunk.newStart,
                newCount: hunk.newCount,
                lines: hunk.lines
            ))
        }
        
        return ChatParsedDiff(filePath: filePath, hunks: hunks)
    }
}
