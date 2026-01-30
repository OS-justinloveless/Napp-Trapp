import SwiftUI

/// A view that renders markdown content as a formatted preview
struct MarkdownPreviewView: View {
    let content: String
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(Array(parseBlocks().enumerated()), id: \.offset) { _, block in
                    renderBlock(block)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    
    // MARK: - Block Types
    
    private enum MarkdownBlock {
        case heading(level: Int, text: String)
        case paragraph(text: String)
        case codeBlock(language: String?, code: String)
        case bulletList(items: [String])
        case numberedList(items: [String])
        case blockquote(text: String)
        case horizontalRule
        case empty
    }
    
    // MARK: - Parsing
    
    private func parseBlocks() -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        let lines = content.components(separatedBy: .newlines)
        var i = 0
        
        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            
            // Empty line
            if trimmed.isEmpty {
                i += 1
                continue
            }
            
            // Horizontal rule
            if trimmed.allSatisfy({ $0 == "-" || $0 == "*" || $0 == "_" }) && trimmed.count >= 3 {
                blocks.append(.horizontalRule)
                i += 1
                continue
            }
            
            // Code block
            if trimmed.hasPrefix("```") {
                let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var codeLines: [String] = []
                i += 1
                while i < lines.count && !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    codeLines.append(lines[i])
                    i += 1
                }
                blocks.append(.codeBlock(language: language.isEmpty ? nil : language, code: codeLines.joined(separator: "\n")))
                i += 1
                continue
            }
            
            // Heading
            if trimmed.hasPrefix("#") {
                let level = trimmed.prefix(while: { $0 == "#" }).count
                if level <= 6 {
                    let text = String(trimmed.dropFirst(level)).trimmingCharacters(in: .whitespaces)
                    blocks.append(.heading(level: level, text: text))
                    i += 1
                    continue
                }
            }
            
            // Blockquote
            if trimmed.hasPrefix(">") {
                var quoteLines: [String] = []
                while i < lines.count {
                    let quoteLine = lines[i].trimmingCharacters(in: .whitespaces)
                    if quoteLine.hasPrefix(">") {
                        quoteLines.append(String(quoteLine.dropFirst()).trimmingCharacters(in: .whitespaces))
                        i += 1
                    } else if quoteLine.isEmpty {
                        break
                    } else {
                        break
                    }
                }
                blocks.append(.blockquote(text: quoteLines.joined(separator: " ")))
                continue
            }
            
            // Bullet list
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") {
                var items: [String] = []
                while i < lines.count {
                    let listLine = lines[i].trimmingCharacters(in: .whitespaces)
                    if listLine.hasPrefix("- ") || listLine.hasPrefix("* ") || listLine.hasPrefix("+ ") {
                        items.append(String(listLine.dropFirst(2)))
                        i += 1
                    } else if listLine.isEmpty {
                        break
                    } else {
                        break
                    }
                }
                blocks.append(.bulletList(items: items))
                continue
            }
            
            // Numbered list
            if trimmed.firstMatch(of: /^\d+\.\s/) != nil {
                var items: [String] = []
                while i < lines.count {
                    let listLine = lines[i].trimmingCharacters(in: .whitespaces)
                    if let numMatch = listLine.firstMatch(of: /^\d+\.\s/) {
                        items.append(String(listLine[numMatch.range.upperBound...]))
                        i += 1
                    } else if listLine.isEmpty {
                        break
                    } else {
                        break
                    }
                }
                blocks.append(.numberedList(items: items))
                continue
            }
            
            // Paragraph (collect consecutive non-empty lines)
            var paragraphLines: [String] = []
            while i < lines.count {
                let paraLine = lines[i]
                let paraTrimmed = paraLine.trimmingCharacters(in: .whitespaces)
                if paraTrimmed.isEmpty || paraTrimmed.hasPrefix("#") || paraTrimmed.hasPrefix("```") ||
                   paraTrimmed.hasPrefix(">") || paraTrimmed.hasPrefix("- ") || paraTrimmed.hasPrefix("* ") {
                    break
                }
                paragraphLines.append(paraTrimmed)
                i += 1
            }
            if !paragraphLines.isEmpty {
                blocks.append(.paragraph(text: paragraphLines.joined(separator: " ")))
            }
        }
        
        return blocks
    }
    
    // MARK: - Rendering
    
    @ViewBuilder
    private func renderBlock(_ block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            headingView(level: level, text: text)
            
        case .paragraph(let text):
            renderInlineMarkdown(text)
                .fixedSize(horizontal: false, vertical: true)
            
        case .codeBlock(let language, let code):
            codeBlockView(language: language, code: code)
            
        case .bulletList(let items):
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 8) {
                        Text("•")
                            .foregroundColor(.secondary)
                        renderInlineMarkdown(item)
                    }
                }
            }
            
        case .numberedList(let items):
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .top, spacing: 8) {
                        Text("\(index + 1).")
                            .foregroundColor(.secondary)
                            .frame(minWidth: 20, alignment: .trailing)
                        renderInlineMarkdown(item)
                    }
                }
            }
            
        case .blockquote(let text):
            HStack(spacing: 12) {
                Rectangle()
                    .fill(Color.accentColor.opacity(0.5))
                    .frame(width: 4)
                renderInlineMarkdown(text)
                    .foregroundColor(.secondary)
                    .italic()
            }
            .padding(.vertical, 4)
            
        case .horizontalRule:
            Divider()
                .padding(.vertical, 8)
            
        case .empty:
            EmptyView()
        }
    }
    
    @ViewBuilder
    private func headingView(level: Int, text: String) -> some View {
        let font: Font = {
            switch level {
            case 1: return .largeTitle.bold()
            case 2: return .title.bold()
            case 3: return .title2.bold()
            case 4: return .title3.bold()
            case 5: return .headline
            default: return .subheadline.bold()
            }
        }()
        
        VStack(alignment: .leading, spacing: 4) {
            Text(text)
                .font(font)
            if level <= 2 {
                Divider()
            }
        }
        .padding(.top, level == 1 ? 8 : 4)
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
        if let attributed = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            return Text(attributed)
        }
        return Text(text)
    }
}

#Preview {
    MarkdownPreviewView(content: """
    # Heading 1
    
    This is a paragraph with **bold** and *italic* text.
    
    ## Heading 2
    
    - Bullet item 1
    - Bullet item 2
    - Bullet item 3
    
    ### Code Example
    
    ```swift
    func hello() {
        print("Hello, World!")
    }
    ```
    
    > This is a blockquote
    
    1. First item
    2. Second item
    3. Third item
    
    ---
    
    That's all folks!
    """)
}
