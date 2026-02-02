import SwiftUI

// MARK: - Content Block View

/// Renders a single content block from CLI output
struct ChatContentBlockView: View {
    let block: ChatContentBlock
    var onApproval: ((String, Bool) -> Void)?
    var onInput: ((String, String) -> Void)?
    
    var body: some View {
        switch block.type {
        case .text:
            TextBlockView(block: block)
            
        case .thinking:
            ThinkingBlockView(block: block)
            
        case .toolUseStart:
            ToolUseStartView(block: block)
            
        case .toolUseResult:
            ToolUseResultView(block: block)
            
        case .fileRead:
            FileReadView(block: block)
            
        case .fileEdit:
            FileEditView(block: block)
            
        case .commandRun:
            CommandRunView(block: block)
            
        case .commandOutput:
            CommandOutputView(block: block)
            
        case .approvalRequest:
            ApprovalRequestView(block: block, onApproval: onApproval)
            
        case .inputRequest:
            InputRequestView(block: block, onInput: onInput)
            
        case .error:
            ErrorBlockView(block: block)
            
        case .progress:
            ProgressBlockView(block: block)
            
        case .codeBlock:
            ChatCodeBlockView(block: block)
            
        case .raw:
            RawBlockView(block: block)
            
        case .sessionStart:
            SessionStartView(block: block)
            
        case .sessionEnd:
            SessionEndView(block: block)
            
        case .usage:
            UsageBlockView(block: block)
        }
    }
}

// MARK: - Text Block

struct TextBlockView: View {
    let block: ChatContentBlock
    
    var body: some View {
        if let content = block.content, !content.isEmpty {
            Text(content)
                .font(.body)
                .foregroundColor(.primary)
                .textSelection(.enabled)
        }
    }
}

// MARK: - Thinking Block

struct ThinkingBlockView: View {
    let block: ChatContentBlock
    @State private var isAnimating = false
    
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "brain")
                .foregroundColor(.purple)
                .rotationEffect(.degrees(isAnimating ? 360 : 0))
                .animation(.linear(duration: 2).repeatForever(autoreverses: false), value: isAnimating)
            
            Text(block.content ?? "Thinking...")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .italic()
        }
        .padding(.vertical, 4)
        .onAppear {
            isAnimating = true
        }
    }
}

// MARK: - Tool Use Start

struct ToolUseStartView: View {
    let block: ChatContentBlock
    @State private var isExpanded = false
    
    var body: some View {
        let info = block.toolDisplayInfo
        
        DisclosureGroup(isExpanded: $isExpanded) {
            if let input = block.input, !input.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(input.keys.sorted()), id: \.self) { key in
                        HStack(alignment: .top) {
                            Text("\(key):")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .frame(width: 80, alignment: .leading)
                            
                            Text(input[key]?.stringValue ?? "-")
                                .font(.caption.monospaced())
                                .foregroundColor(.primary)
                                .textSelection(.enabled)
                        }
                    }
                }
                .padding(8)
                .background(Color(.systemGray6))
                .cornerRadius(6)
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: info.icon)
                    .foregroundColor(.blue)
                    .frame(width: 20)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(info.name)
                        .font(.subheadline.weight(.medium))
                    Text(info.description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                
                Spacer()
                
                ProgressView()
                    .scaleEffect(0.7)
            }
        }
        .padding(10)
        .background(Color(.systemGray6))
        .cornerRadius(8)
    }
}

// MARK: - Tool Use Result

struct ToolUseResultView: View {
    let block: ChatContentBlock
    @State private var isExpanded = false
    
    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            if let content = block.content, !content.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(content)
                        .font(.caption.monospaced())
                        .foregroundColor(.primary)
                        .textSelection(.enabled)
                }
                .frame(maxHeight: 200)
                .padding(8)
                .background(Color(.systemGray6))
                .cornerRadius(6)
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: block.isError == true ? "xmark.circle.fill" : "checkmark.circle.fill")
                    .foregroundColor(block.isError == true ? .red : .green)
                    .frame(width: 20)
                
                Text(block.isError == true ? "Tool failed" : "Tool completed")
                    .font(.subheadline.weight(.medium))
                
                Spacer()
            }
        }
        .padding(10)
        .background(Color(.systemGray6))
        .cornerRadius(8)
    }
}

// MARK: - File Read View

struct FileReadView: View {
    let block: ChatContentBlock
    
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.text")
                .foregroundColor(.cyan)
                .frame(width: 20)
            
            VStack(alignment: .leading, spacing: 2) {
                Text("Read File")
                    .font(.subheadline.weight(.medium))
                if let path = block.path {
                    Text(path)
                        .font(.caption.monospaced())
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }
            
            Spacer()
            
            Image(systemName: "checkmark")
                .foregroundColor(.green)
                .font(.caption)
        }
        .padding(10)
        .background(Color(.systemGray6))
        .cornerRadius(8)
    }
}

// MARK: - File Edit View

struct FileEditView: View {
    let block: ChatContentBlock
    @State private var isExpanded = false
    
    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            if let diff = block.diff {
                ChatDiffView(diffText: diff)
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "pencil")
                    .foregroundColor(.orange)
                    .frame(width: 20)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text("Edit File")
                        .font(.subheadline.weight(.medium))
                    if let path = block.path {
                        Text(path)
                            .font(.caption.monospaced())
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                }
                
                Spacer()
            }
        }
        .padding(10)
        .background(Color(.systemGray6))
        .cornerRadius(8)
    }
}

// MARK: - Command Run View

struct CommandRunView: View {
    let block: ChatContentBlock
    
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "terminal")
                .foregroundColor(.indigo)
                .frame(width: 20)
            
            Text("$ \(block.command ?? "")")
                .font(.subheadline.monospaced())
                .foregroundColor(.primary)
                .lineLimit(2)
            
            Spacer()
        }
        .padding(10)
        .background(Color(.black.opacity(0.8)))
        .foregroundColor(.green)
        .cornerRadius(8)
    }
}

// MARK: - Command Output View

struct CommandOutputView: View {
    let block: ChatContentBlock
    
    var body: some View {
        if let content = block.content, !content.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                Text(content)
                    .font(.caption.monospaced())
                    .foregroundColor(.white)
            }
            .padding(8)
            .frame(maxHeight: 150)
            .background(Color.black.opacity(0.8))
            .cornerRadius(6)
        }
    }
}

// MARK: - Approval Request View

struct ApprovalRequestView: View {
    let block: ChatContentBlock
    var onApproval: ((String, Bool) -> Void)?
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "hand.raised.fill")
                    .foregroundColor(.yellow)
                
                Text("Approval Required")
                    .font(.subheadline.weight(.semibold))
            }
            
            if let prompt = block.prompt {
                Text(prompt)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            
            HStack(spacing: 12) {
                Button {
                    onApproval?(block.id, true)
                } label: {
                    Label("Approve", systemImage: "checkmark")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                
                Button {
                    onApproval?(block.id, false)
                } label: {
                    Label("Reject", systemImage: "xmark")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.red)
            }
        }
        .padding(12)
        .background(Color.yellow.opacity(0.1))
        .cornerRadius(10)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.yellow.opacity(0.3), lineWidth: 1)
        )
    }
}

// MARK: - Input Request View

struct InputRequestView: View {
    let block: ChatContentBlock
    var onInput: ((String, String) -> Void)?
    @State private var inputText = ""
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "keyboard")
                    .foregroundColor(.mint)
                
                Text("Input Required")
                    .font(.subheadline.weight(.semibold))
            }
            
            if let prompt = block.prompt {
                Text(prompt)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            
            HStack {
                TextField("Enter response...", text: $inputText)
                    .textFieldStyle(.roundedBorder)
                
                Button {
                    onInput?(block.id, inputText)
                    inputText = ""
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .disabled(inputText.isEmpty)
            }
        }
        .padding(12)
        .background(Color.mint.opacity(0.1))
        .cornerRadius(10)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.mint.opacity(0.3), lineWidth: 1)
        )
    }
}

// MARK: - Error Block View

struct ErrorBlockView: View {
    let block: ChatContentBlock
    
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.red)
            
            Text(block.message ?? block.content ?? "Error")
                .font(.subheadline)
                .foregroundColor(.red)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.red.opacity(0.1))
        .cornerRadius(8)
    }
}

// MARK: - Progress Block View

struct ProgressBlockView: View {
    let block: ChatContentBlock
    
    var body: some View {
        HStack(spacing: 8) {
            if block.isSuccess == true {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
            } else {
                ProgressView()
                    .scaleEffect(0.7)
            }
            
            Text(block.message ?? block.content ?? "Processing...")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Code Block View

struct ChatCodeBlockView: View {
    let block: ChatContentBlock
    @State private var isCopied = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Text(block.language ?? "code")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Spacer()
                
                Button {
                    UIPasteboard.general.string = block.code ?? ""
                    isCopied = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        isCopied = false
                    }
                } label: {
                    Image(systemName: isCopied ? "checkmark" : "doc.on.doc")
                        .font(.caption)
                }
                .foregroundColor(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color(.systemGray5))
            
            // Code
            ScrollView(.horizontal, showsIndicators: false) {
                Text(block.code ?? "")
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(10)
            }
            .background(Color(.systemGray6))
        }
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(.systemGray4), lineWidth: 1)
        )
    }
}

// MARK: - Raw Block View

struct RawBlockView: View {
    let block: ChatContentBlock
    
    var body: some View {
        if let content = block.content, !content.isEmpty {
            Text(content)
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(.secondary)
                .textSelection(.enabled)
        }
    }
}

// MARK: - Session Start View

struct SessionStartView: View {
    let block: ChatContentBlock
    
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "play.circle.fill")
                .foregroundColor(.green)
            
            Text("Session started")
                .font(.caption)
                .foregroundColor(.secondary)
            
            if let model = block.model {
                Text("(\(model))")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Session End View

struct SessionEndView: View {
    let block: ChatContentBlock
    
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: block.suspended == true ? "pause.circle.fill" : "stop.circle.fill")
                .foregroundColor(block.suspended == true ? .orange : .gray)
            
            Text(block.suspended == true ? "Session suspended (inactivity)" : "Session ended")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Usage Block View

struct UsageBlockView: View {
    let block: ChatContentBlock
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "chart.bar.fill")
                .foregroundColor(.purple)
            
            HStack(spacing: 8) {
                Label("\(block.inputTokens ?? 0)", systemImage: "arrow.down")
                    .font(.caption)
                
                Label("\(block.outputTokens ?? 0)", systemImage: "arrow.up")
                    .font(.caption)
            }
            .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Diff View

struct ChatDiffView: View {
    let diffText: String
    
    var body: some View {
        let parsed = ChatParsedDiff.parse(diffText)
        
        VStack(alignment: .leading, spacing: 8) {
            ForEach(parsed.hunks) { hunk in
                VStack(alignment: .leading, spacing: 0) {
                    // Hunk header
                    Text("@@ -\(hunk.oldStart),\(hunk.oldCount) +\(hunk.newStart),\(hunk.newCount) @@")
                        .font(.caption.monospaced())
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color(.systemGray5))
                    
                    // Lines
                    ForEach(hunk.lines) { line in
                        HStack(spacing: 0) {
                            Text(line.prefix)
                                .font(.system(.caption, design: .monospaced))
                                .frame(width: 16)
                                .foregroundColor(line.color)
                            
                            Text(line.content)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundColor(line.color)
                            
                            Spacer()
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 1)
                        .background(
                            line.type == .add ? Color.green.opacity(0.1) :
                            line.type == .remove ? Color.red.opacity(0.1) :
                            Color.clear
                        )
                    }
                }
            }
        }
        .cornerRadius(6)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color(.systemGray4), lineWidth: 1)
        )
    }
}

// MARK: - Preview

#Preview {
    ScrollView {
        VStack(spacing: 16) {
            ChatContentBlockView(block: ChatContentBlock(
                id: "1",
                type: .text,
                timestamp: Date().timeIntervalSince1970 * 1000,
                content: "I'll help you fix that bug in the authentication module."
            ))
            
            ChatContentBlockView(block: ChatContentBlock(
                id: "2",
                type: .toolUseStart,
                timestamp: Date().timeIntervalSince1970 * 1000,
                toolId: "tc_001",
                toolName: "Read",
                input: ["path": .string("src/auth.js")]
            ))
            
            ChatContentBlockView(block: ChatContentBlock(
                id: "3",
                type: .fileRead,
                timestamp: Date().timeIntervalSince1970 * 1000,
                path: "src/auth.js"
            ))
            
            ChatContentBlockView(block: ChatContentBlock(
                id: "4",
                type: .approvalRequest,
                timestamp: Date().timeIntervalSince1970 * 1000,
                action: "file_edit",
                prompt: "Do you want to edit src/auth.js?"
            ))
            
            ChatContentBlockView(block: ChatContentBlock(
                id: "5",
                type: .error,
                timestamp: Date().timeIntervalSince1970 * 1000,
                message: "Failed to read file: permission denied"
            ))
        }
        .padding()
    }
}
