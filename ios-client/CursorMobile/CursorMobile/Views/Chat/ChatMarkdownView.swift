import SwiftUI

/// Markdown renderer for chat content
struct ChatMarkdownView: View {
    let content: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(parseBlocks().enumerated()), id: \.offset) { _, block in
                renderBlock(block)
            }
        }
    }

    // MARK: - Block Types

    private enum MarkdownBlock {
        case text(String)
        case code(language: String?, code: String)
    }

    // MARK: - Parsing

    private func parseBlocks() -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var remaining = content
        var currentText = ""

        while !remaining.isEmpty {
            // Check for code block (```)
            if remaining.hasPrefix("```") {
                // Flush current text
                if !currentText.isEmpty {
                    blocks.append(.text(currentText))
                    currentText = ""
                }

                // Find end of code block
                let afterOpening = remaining.dropFirst(3)
                if let endIndex = afterOpening.range(of: "```") {
                    let codeContent = String(afterOpening[..<endIndex.lowerBound])
                    let lines = codeContent.components(separatedBy: .newlines)
                    let language = lines.first?.trimmingCharacters(in: .whitespacesAndNewlines)
                    let code = lines.dropFirst().joined(separator: "\n")

                    blocks.append(.code(
                        language: (language?.isEmpty ?? true) ? nil : language,
                        code: code
                    ))

                    remaining = String(afterOpening[endIndex.upperBound...])
                } else {
                    // No closing ```, treat as text
                    currentText += String(remaining.prefix(3))
                    remaining = String(remaining.dropFirst(3))
                }
            }
            else {
                // Add character to current text (including inline code backticks)
                currentText += String(remaining.prefix(1))
                remaining = String(remaining.dropFirst())
            }
        }

        // Flush remaining text
        if !currentText.isEmpty {
            blocks.append(.text(currentText))
        }

        return blocks
    }

    // MARK: - Rendering

    @ViewBuilder
    private func renderBlock(_ block: MarkdownBlock) -> some View {
        switch block {
        case .text(let text):
            // Split text by newlines and render each line separately with markdown
            // This ensures newlines are properly respected while still supporting inline markdown
            let lines = text.components(separatedBy: "\n")

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                    // Use full markdown parsing (handles inline code, bold, italic, etc.)
                    if let attributed = try? AttributedString(
                        markdown: line,
                        options: .init(
                            allowsExtendedAttributes: true,
                            interpretedSyntax: .full,
                            failurePolicy: .returnPartiallyParsedIfPossible
                        )
                    ) {
                        Text(attributed)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text(line)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

        case .code(let language, let code):
            codeBlockView(language: language, code: code)
        }
    }

    private func codeBlockView(language: String?, code: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let language = language, !language.isEmpty {
                Text(language.uppercased())
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
            }
        }
        .background(Color(.secondarySystemBackground))
        .cornerRadius(8)
    }

    // MARK: - Inline Markdown

    private func renderInlineMarkdown(_ text: String) -> Text {
        // Try to use AttributedString for inline markdown
        if let attributed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return Text(attributed)
        }
        return Text(text)
    }
}

// MARK: - File Reference Parsing

struct FileReference: Identifiable {
    let id = UUID()
    let path: String
    let line: Int?
}

/// Parse file references like "src/file.ts:45" from text
func parseFileReferences(in text: String) -> [FileReference] {
    // Pattern matches: /path/to/file.ext:123, src/file.ts:45, ./relative.js
    let pattern = #"(?:^|[\s\`\"\'])([\.\/]?[\w\-\.\/]+\.[a-zA-Z]{1,10})(?::(\d+))?"#

    var refs: [FileReference] = []

    guard let regex = try? NSRegularExpression(pattern: pattern) else {
        return refs
    }

    let range = NSRange(text.startIndex..., in: text)
    let matches = regex.matches(in: text, range: range)

    for match in matches {
        if let pathRange = Range(match.range(at: 1), in: text) {
            let path = String(text[pathRange])

            var line: Int? = nil
            if match.numberOfRanges > 2,
               let lineRange = Range(match.range(at: 2), in: text) {
                line = Int(text[lineRange])
            }

            refs.append(FileReference(path: path, line: line))
        }
    }

    return refs
}

#Preview {
    ScrollView {
        ChatMarkdownView(content: """
        This is some **bold** and *italic* text.

        Here's some code:

        ```swift
        func hello() {
            print("Hello, World!")
        }
        ```

        And here's `inline code` in a sentence.

        - List item 1
        - List item 2
        - List item 3
        """)
        .padding()
    }
}
