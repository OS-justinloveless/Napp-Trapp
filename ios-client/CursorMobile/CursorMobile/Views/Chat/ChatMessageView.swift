import SwiftUI

/// Message bubble with user/assistant differentiation
struct ChatMessageView: View {
    let message: ParsedMessage
    let allConversationBlocks: [ChatContentBlock]  // All blocks across all messages for result matching
    let projectPath: String
    var respondedApprovalIds: Set<String> = []
    var onApproval: ((String, Bool) -> Void)?
    var onInput: ((String, String) -> Void)?
    var onFileReference: ((String, Int?) -> Void)?

    /// Groups consecutive approval request blocks together
    private var blockGroups: [(blocks: [ChatContentBlock], isBatchApproval: Bool)] {
        var groups: [(blocks: [ChatContentBlock], isBatchApproval: Bool)] = []
        var currentApprovalBatch: [ChatContentBlock] = []

        for block in message.blocks {
            // Skip toolUseResult blocks - they're shown inside their toolUseStart
            if block.type == .toolUseResult {
                continue
            }

            if block.type == .approvalRequest {
                // Add to current batch
                currentApprovalBatch.append(block)
            } else {
                // If we have accumulated approval requests, add them as a batch
                if !currentApprovalBatch.isEmpty {
                    let shouldBatch = currentApprovalBatch.count > 1
                    groups.append((blocks: currentApprovalBatch, isBatchApproval: shouldBatch))
                    currentApprovalBatch = []
                }
                // Add this non-approval block as a single-item group
                groups.append((blocks: [block], isBatchApproval: false))
            }
        }

        // Don't forget any remaining approval requests
        if !currentApprovalBatch.isEmpty {
            let shouldBatch = currentApprovalBatch.count > 1
            groups.append((blocks: currentApprovalBatch, isBatchApproval: shouldBatch))
        }

        return groups
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if message.role == .assistant {
                // Assistant avatar
                assistantAvatar
            }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 8) {
                ForEach(Array(blockGroups.enumerated()), id: \.offset) { index, group in
                    if group.isBatchApproval {
                        // Render batch approval view
                        let hasResponded = group.blocks.allSatisfy { respondedApprovalIds.contains($0.id) }
                        BatchApprovalView(
                            approvalBlocks: group.blocks,
                            hasResponded: hasResponded,
                            onBatchApproval: { approved in
                                // Send approval for each block in the batch
                                for block in group.blocks {
                                    onApproval?(block.id, approved)
                                }
                            }
                        )
                        .id("batch-\(index)")
                    } else {
                        // Render individual blocks normally
                        ForEach(group.blocks) { block in
                            ContentBlockView(
                                block: block,
                                allBlocks: message.blocks,
                                allConversationBlocks: allConversationBlocks,
                                projectPath: projectPath,
                                respondedApprovalIds: respondedApprovalIds,
                                onApproval: onApproval,
                                onInput: onInput,
                                onFileReference: onFileReference
                            )
                            // Force view update when block content or status changes
                            .id("\(block.id)-\(block.content?.hashValue ?? 0)-\(block.isPartial ?? true)")
                        }
                    }
                }

                // Streaming indicator
                if message.isStreaming {
                    HStack(spacing: 4) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Thinking...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)

            if message.role == .user {
                // User avatar
                userAvatar
            }
        }
    }

    private var assistantAvatar: some View {
        Image(systemName: "sparkles")
            .font(.title3)
            .foregroundColor(.purple)
            .frame(width: 32, height: 32)
            .background(Color.purple.opacity(0.1))
            .clipShape(Circle())
    }

    private var userAvatar: some View {
        Image(systemName: "person.fill")
            .font(.caption)
            .foregroundColor(.white)
            .frame(width: 32, height: 32)
            .background(Color.accentColor)
            .clipShape(Circle())
    }
}

// MARK: - Content Block View

/// Renders a single content block based on its type
struct ContentBlockView: View {
    let block: ChatContentBlock
    let allBlocks: [ChatContentBlock]
    let allConversationBlocks: [ChatContentBlock]  // All blocks across all messages
    let projectPath: String
    var respondedApprovalIds: Set<String> = []
    var onApproval: ((String, Bool) -> Void)?
    var onInput: ((String, String) -> Void)?
    var onFileReference: ((String, Int?) -> Void)?

    /// Find the result block for a tool use start block
    private var resultBlock: ChatContentBlock? {
        guard block.type == .toolUseStart else { return nil }
        // Match by toolId first, then by block id
        let toolId = block.toolId ?? block.id
        // Search in all conversation blocks (across all messages)
        return allConversationBlocks.first { resultBlock in
            resultBlock.type == .toolUseResult &&
            (resultBlock.toolId == toolId || resultBlock.toolId == block.id)
        }
    }

    var body: some View {
        switch block.type {
        case .text, .raw:
            textBlockView

        case .thinking:
            thinkingBlockView

        case .toolUseStart, .toolUseResult:
            ToolCallBlockView(block: block, resultBlock: resultBlock, projectPath: projectPath)

        case .fileRead, .fileEdit:
            fileBlockView

        case .commandRun, .commandOutput:
            commandBlockView

        case .approvalRequest:
            approvalBlockView

        case .inputRequest:
            inputBlockView

        case .error:
            errorBlockView

        case .codeBlock:
            codeBlockView

        case .progress:
            progressBlockView

        case .sessionStart, .sessionEnd:
            sessionBlockView

        case .usage:
            usageBlockView
        }
    }

    // MARK: - Block Views

    private var textBlockView: some View {
        ChatMarkdownView(content: block.content ?? "")
            .padding(12)
            .background(Color(.systemGray6))
            .cornerRadius(16)
    }

    private var thinkingBlockView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "brain")
                    .foregroundColor(.purple)
                Text("Thinking")
                    .font(.caption.weight(.medium))
                    .foregroundColor(.purple)
            }

            if let content = block.content, !content.isEmpty {
                Text(content)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .italic()
            }
        }
        .padding(12)
        .background(Color.purple.opacity(0.1))
        .cornerRadius(12)
    }

    private var fileBlockView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: block.type == .fileRead ? "doc.text" : "pencil")
                    .foregroundColor(block.type == .fileRead ? .cyan : .orange)

                VStack(alignment: .leading, spacing: 2) {
                    Text(block.type == .fileRead ? "Read File" : "Edit File")
                        .font(.caption.weight(.medium))

                    if let path = block.path {
                        Button {
                            onFileReference?(path, nil)
                        } label: {
                            Text(path)
                                .font(.caption.monospaced())
                                .foregroundColor(.accentColor)
                                .lineLimit(1)
                        }
                    }
                }
            }

            if let diff = block.diff, !diff.isEmpty {
                DiffView(diff: diff)
            }
        }
        .padding(12)
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }

    private var commandBlockView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "terminal")
                    .foregroundColor(.indigo)

                if let command = block.command {
                    Text("$ \(command)")
                        .font(.caption.monospaced())
                        .lineLimit(2)
                }
            }

            if let content = block.content, !content.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(content)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .frame(maxHeight: 100)
            }

            if let exitCode = block.exitCode {
                HStack(spacing: 4) {
                    Image(systemName: exitCode == 0 ? "checkmark.circle" : "xmark.circle")
                        .foregroundColor(exitCode == 0 ? .green : .red)
                    Text("Exit code: \(exitCode)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(12)
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }

    private var approvalBlockView: some View {
        let hasResponded = respondedApprovalIds.contains(block.id)

        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "hand.raised")
                    .foregroundColor(.yellow)

                Text(block.prompt ?? "Approval Required")
                    .font(.body)
            }

            if let toolName = block.toolName {
                HStack(spacing: 4) {
                    Image(systemName: "wrench.and.screwdriver")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text("Tool: \(toolName)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            if hasResponded {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                    Text("Response sent")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            } else {
                HStack(spacing: 12) {
                    Button {
                        onApproval?(block.id, true)
                    } label: {
                        HStack {
                            Image(systemName: "checkmark")
                            Text("Approve")
                        }
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.green)
                        .cornerRadius(8)
                    }

                    Button {
                        onApproval?(block.id, false)
                    } label: {
                        HStack {
                            Image(systemName: "xmark")
                            Text("Reject")
                        }
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.red)
                        .cornerRadius(8)
                    }
                }
            }
        }
        .padding(12)
        .background(Color.yellow.opacity(0.1))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.yellow.opacity(0.3), lineWidth: 1)
        )
    }

    private var inputBlockView: some View {
        InputRequestView(
            block: block,
            onSubmit: { input in
                onInput?(block.id, input)
            }
        )
    }

    private var errorBlockView: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.red)

            Text(block.message ?? block.content ?? "Error")
                .font(.body)
                .foregroundColor(.red)
        }
        .padding(12)
        .background(Color.red.opacity(0.1))
        .cornerRadius(12)
    }

    private var codeBlockView: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let language = block.language, !language.isEmpty {
                Text(language.uppercased())
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                Text(block.code ?? block.content ?? "")
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(8)
    }

    private var progressBlockView: some View {
        HStack(spacing: 8) {
            if block.isSuccess == true {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
            } else {
                ProgressView()
                    .controlSize(.small)
            }

            Text(block.message ?? block.content ?? "Processing...")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var sessionBlockView: some View {
        HStack(spacing: 8) {
            Image(systemName: block.type == .sessionStart ? "play.circle" : "stop.circle")
                .foregroundColor(block.type == .sessionStart ? .green : .gray)

            Text(block.type == .sessionStart ? "Session started" : "Session ended")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private var usageBlockView: some View {
        HStack(spacing: 12) {
            Image(systemName: "chart.bar")
                .foregroundColor(.purple)

            if let input = block.inputTokens, let output = block.outputTokens {
                Text("\(input) in / \(output) out tokens")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(Color(.systemGray6))
        .cornerRadius(8)
    }
}

// MARK: - Input Request View

struct InputRequestView: View {
    let block: ChatContentBlock
    let onSubmit: (String) -> Void

    @State private var inputText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "keyboard")
                    .foregroundColor(.mint)

                Text(block.prompt ?? "Input Required")
                    .font(.body)
            }

            HStack {
                TextField("Enter response...", text: $inputText)
                    .textFieldStyle(.roundedBorder)

                Button {
                    onSubmit(inputText)
                    inputText = ""
                } label: {
                    Image(systemName: "arrow.right.circle.fill")
                        .font(.title2)
                        .foregroundColor(.accentColor)
                }
                .disabled(inputText.isEmpty)
            }
        }
        .padding(12)
        .background(Color.mint.opacity(0.1))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.mint.opacity(0.3), lineWidth: 1)
        )
    }
}

// MARK: - Diff View

struct DiffView: View {
    let diff: String

    var body: some View {
        let lines = diff.components(separatedBy: .newlines).prefix(10)

        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                HStack(spacing: 4) {
                    Text(linePrefix(for: line))
                        .font(.caption.monospaced())
                        .foregroundColor(lineColor(for: line))
                        .frame(width: 12)

                    Text(lineContent(for: line))
                        .font(.caption.monospaced())
                        .foregroundColor(lineColor(for: line))
                }
            }

            if diff.components(separatedBy: .newlines).count > 10 {
                Text("... and more")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(6)
    }

    private func linePrefix(for line: String) -> String {
        if line.hasPrefix("+") && !line.hasPrefix("+++") { return "+" }
        if line.hasPrefix("-") && !line.hasPrefix("---") { return "-" }
        return " "
    }

    private func lineContent(for line: String) -> String {
        if (line.hasPrefix("+") && !line.hasPrefix("+++")) ||
           (line.hasPrefix("-") && !line.hasPrefix("---")) {
            return String(line.dropFirst())
        }
        return line
    }

    private func lineColor(for line: String) -> Color {
        if line.hasPrefix("+") && !line.hasPrefix("+++") { return .green }
        if line.hasPrefix("-") && !line.hasPrefix("---") { return .red }
        return .secondary
    }
}

#Preview {
    ScrollView {
        VStack(spacing: 16) {
            ChatMessageView(
                message: ParsedMessage(
                    id: "1",
                    role: .user,
                    blocks: [
                        ChatContentBlock(
                            id: "b1",
                            type: .text,
                            timestamp: Date().timeIntervalSince1970,
                            content: "Hello, can you help me?"
                        )
                    ],
                    timestamp: Date(),
                    isStreaming: false
                ),
                allConversationBlocks: [],
                projectPath: "/test"
            )

            ChatMessageView(
                message: ParsedMessage(
                    id: "2",
                    role: .assistant,
                    blocks: [
                        ChatContentBlock(
                            id: "b2",
                            type: .text,
                            timestamp: Date().timeIntervalSince1970,
                            content: "Of course! I'd be happy to help. What would you like to know?"
                        )
                    ],
                    timestamp: Date(),
                    isStreaming: false
                ),
                allConversationBlocks: [],
                projectPath: "/test"
            )
        }
        .padding()
    }
}
