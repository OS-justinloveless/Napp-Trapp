import SwiftUI

/// Expandable tool call UI showing parsed properties and result
struct ToolCallBlockView: View {
    let block: ChatContentBlock
    let resultBlock: ChatContentBlock?
    let projectPath: String

    @State private var isExpanded = false

    // MARK: - Parsed Tool Input

    /// Parse the content JSON to extract tool input parameters
    private var parsedInput: [String: String] {
        var result: [String: String] = [:]

        // First try the input dict on the block
        if let input = block.input {
            for (key, value) in input {
                if let str = value.stringValue {
                    result[key] = str
                }
            }
        }

        // Then try parsing content JSON
        if result.isEmpty, let content = block.content, !content.isEmpty {
            if let data = content.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                for (key, value) in json {
                    if let str = value as? String {
                        result[key] = str
                    } else if let num = value as? NSNumber {
                        result[key] = num.stringValue
                    }
                }
            }
        }

        return result
    }

    /// Whether there's content to show when expanded
    private var hasExpandableContent: Bool {
        !parsedInput.isEmpty || resultBlock != nil
    }

    /// The result content to display
    private var resultContent: String? {
        resultBlock?.content
    }

    /// Whether the result indicates an error
    private var isResultError: Bool {
        resultBlock?.isError == true
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Tappable header
            Button {
                if hasExpandableContent {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                }
            } label: {
                headerView
            }
            .buttonStyle(.plain)

            // Expanded content
            if isExpanded {
                expandedContentView
            }
        }
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(.systemGray4), lineWidth: 1)
        )
    }

    // MARK: - Header

    private var headerView: some View {
        HStack(spacing: 8) {
            Image(systemName: block.toolDisplayInfo.icon)
                .foregroundColor(block.type.color)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text(block.toolDisplayInfo.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(.primary)

                Text(block.toolDisplayInfo.description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            // Status indicator
            statusIndicator

            // Expand chevron
            if hasExpandableContent {
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(10)
        .background(Color(.systemGray6))
    }

    private var statusIndicator: some View {
        Group {
            if isResultError {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.red)
            } else if block.isError == true {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.red)
            } else if resultBlock != nil || block.isPartial == false {
                // Show completed when we have a result or streaming is done
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
            } else {
                ProgressView()
                    .controlSize(.small)
            }
        }
    }

    // MARK: - Expanded Content

    private var expandedContentView: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Tool Input Parameters
            if !parsedInput.isEmpty {
                inputParametersSection
            }

            // Tool Result
            if let result = resultContent {
                resultSection(content: result)
            }
        }
        .padding(12)
        .background(Color(.systemGray6).opacity(0.5))
    }

    private var inputParametersSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Input")
                .font(.caption.weight(.semibold))
                .foregroundColor(.secondary)

            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(parsedInput.keys.sorted()), id: \.self) { key in
                    if let value = parsedInput[key] {
                        parameterRow(key: key, value: value)
                    }
                }
            }
        }
    }

    private func parameterRow(key: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(formatKeyName(key))
                .font(.caption2.weight(.medium))
                .foregroundColor(.secondary)

            if value.count > 100 || value.contains("\n") {
                // Long or multiline value - show in scrollable area
                ScrollView {
                    Text(value)
                        .font(.caption.monospaced())
                        .foregroundColor(.primary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 100)
                .padding(8)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(6)
            } else {
                // Short value - show inline
                Text(value)
                    .font(.caption.monospaced())
                    .foregroundColor(.primary)
                    .textSelection(.enabled)
            }
        }
    }

    private func resultSection(content: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Result")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.secondary)

                Spacer()

                if isResultError {
                    Label("Error", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption2)
                        .foregroundColor(.red)
                }
            }

            ScrollView {
                Text(content)
                    .font(.caption.monospaced())
                    .foregroundColor(isResultError ? .red : .primary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 300)
            .padding(8)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(6)
        }
    }

    // MARK: - Helpers

    /// Convert snake_case or camelCase to Title Case
    private func formatKeyName(_ key: String) -> String {
        // Handle snake_case
        var result = key.replacingOccurrences(of: "_", with: " ")

        // Handle camelCase by inserting spaces before capitals
        var output = ""
        for (index, char) in result.enumerated() {
            if char.isUppercase && index > 0 {
                output.append(" ")
            }
            output.append(char)
        }

        return output.capitalized
    }
}

#Preview {
    ScrollView {
        VStack(spacing: 16) {
            // Tool in progress
            ToolCallBlockView(
                block: ChatContentBlock(
                    id: "1",
                    type: .toolUseStart,
                    timestamp: Date().timeIntervalSince1970,
                    content: "{\"command\": \"ls -la\", \"description\": \"List files\"}",
                    isPartial: true,
                    toolName: "Bash"
                ),
                resultBlock: nil,
                projectPath: "/test"
            )

            // Completed tool with result
            ToolCallBlockView(
                block: ChatContentBlock(
                    id: "2",
                    type: .toolUseStart,
                    timestamp: Date().timeIntervalSince1970,
                    content: "{\"command\": \"ls -la\", \"description\": \"List files in current directory\"}",
                    isPartial: false,
                    toolName: "Bash"
                ),
                resultBlock: ChatContentBlock(
                    id: "2-result",
                    type: .toolUseResult,
                    timestamp: Date().timeIntervalSince1970,
                    content: "total 64\ndrwxr-xr-x  12 user  staff   384 Feb  7 08:00 .\ndrwxr-xr-x   5 user  staff   160 Feb  6 12:00 ..\n-rw-r--r--   1 user  staff  1234 Feb  7 08:00 README.md\n-rw-r--r--   1 user  staff   567 Feb  7 07:30 package.json",
                    toolId: "2"
                ),
                projectPath: "/test"
            )

            // Read file tool
            ToolCallBlockView(
                block: ChatContentBlock(
                    id: "3",
                    type: .toolUseStart,
                    timestamp: Date().timeIntervalSince1970,
                    content: "{\"file_path\": \"/Users/test/project/src/main.swift\"}",
                    isPartial: false,
                    toolName: "Read"
                ),
                resultBlock: ChatContentBlock(
                    id: "3-result",
                    type: .toolUseResult,
                    timestamp: Date().timeIntervalSince1970,
                    content: "import Foundation\n\nfunc main() {\n    print(\"Hello, World!\")\n}\n\nmain()",
                    toolId: "3"
                ),
                projectPath: "/test"
            )

            // Error result
            ToolCallBlockView(
                block: ChatContentBlock(
                    id: "4",
                    type: .toolUseStart,
                    timestamp: Date().timeIntervalSince1970,
                    content: "{\"file_path\": \"/nonexistent/file.txt\"}",
                    isPartial: false,
                    toolName: "Read"
                ),
                resultBlock: ChatContentBlock(
                    id: "4-result",
                    type: .toolUseResult,
                    timestamp: Date().timeIntervalSince1970,
                    content: "Error: File not found at path /nonexistent/file.txt",
                    toolId: "4",
                    isError: true
                ),
                projectPath: "/test"
            )
        }
        .padding()
    }
}
