import SwiftUI

struct GitDiffSheet: View {
    let project: Project
    let file: GitFileChange?
    let staged: Bool
    let repoPath: String?  // nil for root repo, relative path for sub-repos
    
    /// For untracked (new) files, we only need the file path
    let untrackedFilePath: String?
    
    /// For viewing a diff from a specific commit
    let commitHash: String?
    /// Display-only file path when viewing commit diffs (no GitFileChange needed)
    let commitFilePath: String?
    
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) private var dismiss
    
    @State private var diffContent = ""
    @State private var diffLines: [DiffLine] = []
    @State private var isLoading = true
    @State private var hasStartedLoading = false  // Prevent duplicate loads
    @State private var errorMessage: String?
    @State private var isTruncated = false
    @State private var loadTask: Task<Void, Never>?
    
    /// Convenience initializer for tracked files (backward compatibility)
    init(project: Project, file: GitFileChange, staged: Bool) {
        self.project = project
        self.file = file
        self.staged = staged
        self.repoPath = nil
        self.untrackedFilePath = nil
        self.commitHash = nil
        self.commitFilePath = nil
    }
    
    /// Initializer for tracked files with repoPath
    init(project: Project, file: GitFileChange, staged: Bool, repoPath: String?) {
        self.project = project
        self.file = file
        self.staged = staged
        self.repoPath = repoPath
        self.untrackedFilePath = nil
        self.commitHash = nil
        self.commitFilePath = nil
    }
    
    /// Initializer for untracked (new) files - shows all content as added (backward compatibility)
    init(project: Project, untrackedFilePath: String) {
        self.project = project
        self.file = nil
        self.staged = false
        self.repoPath = nil
        self.untrackedFilePath = untrackedFilePath
        self.commitHash = nil
        self.commitFilePath = nil
    }
    
    /// Initializer for untracked (new) files with repoPath
    init(project: Project, untrackedFilePath: String, repoPath: String?) {
        self.project = project
        self.file = nil
        self.staged = false
        self.repoPath = repoPath
        self.untrackedFilePath = untrackedFilePath
        self.commitHash = nil
        self.commitFilePath = nil
    }
    
    /// Initializer for viewing a file diff from a specific commit
    init(project: Project, commitFilePath: String, commitHash: String, repoPath: String?) {
        self.project = project
        self.file = nil
        self.staged = false
        self.repoPath = repoPath
        self.untrackedFilePath = nil
        self.commitHash = commitHash
        self.commitFilePath = commitFilePath
    }
    
    /// The display file name
    private var displayFileName: String {
        if let file = file {
            return file.path.components(separatedBy: "/").last ?? file.path
        } else if let path = untrackedFilePath {
            return path.components(separatedBy: "/").last ?? path
        } else if let path = commitFilePath {
            return path.components(separatedBy: "/").last ?? path
        }
        return "Unknown"
    }
    
    /// Whether this is a new/untracked file
    private var isNewFile: Bool {
        untrackedFilePath != nil
    }
    
    /// Whether this is a commit-based diff
    private var isCommitDiff: Bool {
        commitHash != nil
    }
    
    /// Subtitle for the toolbar
    private var diffSubtitle: String {
        if isCommitDiff, let hash = commitHash {
            return "Commit \(String(hash.prefix(7)))"
        } else if isNewFile {
            return "New File"
        } else {
            return staged ? "Staged" : "Unstaged"
        }
    }
    
    private var api: APIService? {
        guard let serverUrl = authManager.serverUrl,
              let token = authManager.token else { return nil }
        return APIService(serverUrl: serverUrl, token: token)
    }
    
    var body: some View {
        NavigationStack {
            contentView
                .navigationTitle(displayFileName)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") {
                            loadTask?.cancel()
                            dismiss()
                        }
                    }
                    
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 0) {
                            Text(displayFileName)
                                .font(.headline)
                            Text(diffSubtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
        }
        .onAppear {
            // Use onAppear to ensure loading starts immediately when sheet appears
            guard !hasStartedLoading else { return }
            hasStartedLoading = true
            loadTask = Task {
                if isCommitDiff {
                    await loadCommitDiff()
                } else if isNewFile {
                    await loadNewFileDiff()
                } else {
                    await loadDiff()
                }
            }
        }
        .onDisappear {
            loadTask?.cancel()
        }
    }
    
    @ViewBuilder
    private var contentView: some View {
        if isLoading {
            VStack(spacing: 16) {
                ProgressView()
                    .scaleEffect(1.2)
                Text("Loading diff...")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemGroupedBackground))
        } else if let error = errorMessage {
            ContentUnavailableView {
                Label("Error", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") {
                    loadTask = Task { await loadDiff() }
                }
            }
        } else if diffLines.isEmpty {
            ContentUnavailableView {
                Label("No Changes", systemImage: "doc.text")
            } description: {
                Text("No diff available for this file")
            }
        } else {
            diffView
        }
    }
    
    @ViewBuilder
    private var diffView: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if isTruncated {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text("Diff truncated for performance. Showing first 2000 lines.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.1))
                }
                
                ForEach(diffLines) { line in
                    diffLineView(line)
                }
            }
            .font(.system(.caption, design: .monospaced))
        }
        .background(Color(.systemGroupedBackground))
    }
    
    @ViewBuilder
    private func diffLineView(_ line: DiffLine) -> some View {
        HStack(alignment: .top, spacing: 0) {
            // Line number
            Text(line.displayLineNumber)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 40, alignment: .trailing)
                .padding(.trailing, 4)
            
            // Change indicator (+/-)
            Text(lineIndicator(for: line.lineType))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(indicatorColor(for: line.lineType))
                .frame(width: 16, alignment: .center)
            
            // Line content
            Text(line.content.isEmpty ? " " : line.content)
                .textSelection(.enabled)
                .padding(.vertical, 2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 8)
        .background(line.backgroundColor)
    }
    
    private func lineIndicator(for type: DiffLineType) -> String {
        switch type {
        case .added: return "+"
        case .removed: return "-"
        case .context, .hunkHeader: return " "
        }
    }
    
    private func indicatorColor(for type: DiffLineType) -> Color {
        switch type {
        case .added: return .green
        case .removed: return .red
        case .context, .hunkHeader: return .secondary
        }
    }
    
    // MARK: - Actions
    
    @MainActor
    private func loadDiff() async {
        guard let api = api, let file = file else { 
            isLoading = false
            errorMessage = "Not connected to server"
            return 
        }
        
        isLoading = true
        errorMessage = nil
        
        do {
            let result = try await api.gitDiffFull(projectId: project.id, file: file.path, staged: staged, repoPath: repoPath)
            
            // Check if task was cancelled
            guard !Task.isCancelled else { return }
            
            diffContent = result.diff
            isTruncated = result.truncated
            
            // Parse lines in background to avoid blocking UI
            let content = result.diff
            let parsedLines = await Task.detached(priority: .userInitiated) {
                parseDiffContent(content)
            }.value
            
            // Check if task was cancelled before updating UI
            guard !Task.isCancelled else { return }
            
            diffLines = parsedLines
            isLoading = false
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }
    
    /// Loads a diff for a file in a specific commit
    @MainActor
    private func loadCommitDiff() async {
        guard let api = api, let hash = commitHash else {
            isLoading = false
            errorMessage = "Not connected to server"
            return
        }
        
        let filePath = commitFilePath ?? file?.path
        guard let filePath = filePath else {
            isLoading = false
            errorMessage = "No file path"
            return
        }
        
        isLoading = true
        errorMessage = nil
        
        do {
            let result = try await api.gitDiffFull(projectId: project.id, file: filePath, commitHash: hash, repoPath: repoPath)
            
            guard !Task.isCancelled else { return }
            
            diffContent = result.diff
            isTruncated = result.truncated
            
            let content = result.diff
            let parsedLines = await Task.detached(priority: .userInitiated) {
                parseDiffContent(content)
            }.value
            
            guard !Task.isCancelled else { return }
            
            diffLines = parsedLines
            isLoading = false
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }
    
    /// Loads an untracked (new) file and displays all lines as added
    @MainActor
    private func loadNewFileDiff() async {
        guard let api = api, let filePath = untrackedFilePath else {
            isLoading = false
            errorMessage = "Not connected to server"
            return
        }
        
        isLoading = true
        errorMessage = nil
        
        do {
            // Construct the full file path, including repoPath if present
            var fullPath = project.path
            if let repoPath = repoPath, repoPath != "." {
                fullPath = "\(fullPath)/\(repoPath)"
            }
            fullPath = "\(fullPath)/\(filePath)"
            let fileContent = try await api.readFile(path: fullPath)
            
            // Check if task was cancelled
            guard !Task.isCancelled else { return }
            
            // Parse lines in background - all lines are "added" for new files
            let content = fileContent.content
            let parsedLines = await Task.detached(priority: .userInitiated) {
                parseNewFileContent(content)
            }.value
            
            // Check truncation for large files
            if parsedLines.count > 2000 {
                isTruncated = true
                diffLines = Array(parsedLines.prefix(2000))
            } else {
                isTruncated = false
                diffLines = parsedLines
            }
            
            // Check if task was cancelled before updating UI
            guard !Task.isCancelled else { return }
            
            isLoading = false
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }
}

// MARK: - Diff Parsing

/// Parses content for a new (untracked) file - all lines are shown as added
private func parseNewFileContent(_ content: String) -> [DiffLine] {
    let lines = content.components(separatedBy: "\n")
    var result: [DiffLine] = []
    
    for (index, line) in lines.enumerated() {
        let lineNum = index + 1
        result.append(DiffLine(
            id: lineNum,
            oldLineNumber: nil,
            newLineNumber: lineNum,
            content: line,
            lineType: .added
        ))
    }
    
    return result
}

/// Parses diff content, skipping front matter and extracting actual file line numbers
private func parseDiffContent(_ content: String) -> [DiffLine] {
    let lines = content.components(separatedBy: "\n")
    var result: [DiffLine] = []
    var oldLineNum = 0
    var newLineNum = 0
    var lineId = 0
    
    for line in lines {
        // Skip diff front matter
        if line.hasPrefix("diff ") || line.hasPrefix("index ") ||
           line.hasPrefix("--- ") || line.hasPrefix("+++ ") ||
           line.hasPrefix("new file mode") || line.hasPrefix("deleted file mode") ||
           line.hasPrefix("similarity index") || line.hasPrefix("rename from") ||
           line.hasPrefix("rename to") || line.hasPrefix("old mode") ||
           line.hasPrefix("new mode") || line.hasPrefix("Binary files") {
            continue
        }
        
        // Parse hunk header to get line numbers: @@ -oldStart,oldCount +newStart,newCount @@
        if line.hasPrefix("@@") {
            if let range = parseHunkHeader(line) {
                oldLineNum = range.oldStart
                newLineNum = range.newStart
            }
            // Add the hunk header as a separator with context info
            lineId += 1
            result.append(DiffLine(
                id: lineId,
                oldLineNumber: nil,
                newLineNumber: nil,
                content: line,
                lineType: .hunkHeader
            ))
            continue
        }
        
        lineId += 1
        
        if line.hasPrefix("+") {
            // Added line - show new line number
            result.append(DiffLine(
                id: lineId,
                oldLineNumber: nil,
                newLineNumber: newLineNum,
                content: String(line.dropFirst()),
                lineType: .added
            ))
            newLineNum += 1
        } else if line.hasPrefix("-") {
            // Removed line - show old line number
            result.append(DiffLine(
                id: lineId,
                oldLineNumber: oldLineNum,
                newLineNumber: nil,
                content: String(line.dropFirst()),
                lineType: .removed
            ))
            oldLineNum += 1
        } else if line.hasPrefix(" ") || (!line.isEmpty && result.count > 0) {
            // Context line - show both line numbers (we'll display new line number)
            let displayContent = line.hasPrefix(" ") ? String(line.dropFirst()) : line
            result.append(DiffLine(
                id: lineId,
                oldLineNumber: oldLineNum,
                newLineNumber: newLineNum,
                content: displayContent,
                lineType: .context
            ))
            oldLineNum += 1
            newLineNum += 1
        }
    }
    
    return result
}

/// Parses a hunk header like "@@ -118,7 +118,7 @@ optional context" to extract line numbers
private func parseHunkHeader(_ header: String) -> (oldStart: Int, newStart: Int)? {
    // Match pattern: @@ -oldStart,oldCount +newStart,newCount @@
    // Note: count can be omitted if it's 1 (e.g., @@ -5 +5 @@)
    let pattern = #"@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@"#
    
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let match = regex.firstMatch(in: header, range: NSRange(header.startIndex..., in: header)) else {
        return nil
    }
    
    guard let oldRange = Range(match.range(at: 1), in: header),
          let newRange = Range(match.range(at: 2), in: header),
          let oldStart = Int(header[oldRange]),
          let newStart = Int(header[newRange]) else {
        return nil
    }
    
    return (oldStart, newStart)
}

// MARK: - DiffLine Model

enum DiffLineType {
    case context
    case added
    case removed
    case hunkHeader
    
    var backgroundColor: Color {
        switch self {
        case .context:
            return .clear
        case .added:
            return Color.green.opacity(0.2)
        case .removed:
            return Color.red.opacity(0.2)
        case .hunkHeader:
            return Color.blue.opacity(0.15)
        }
    }
}

struct DiffLine: Identifiable {
    let id: Int
    let oldLineNumber: Int?
    let newLineNumber: Int?
    let content: String
    let lineType: DiffLineType
    
    var backgroundColor: Color {
        lineType.backgroundColor
    }
    
    /// Returns the display line number (prefers new line number for context, otherwise shows whichever is available)
    var displayLineNumber: String {
        if lineType == .hunkHeader {
            return "..."
        }
        if let newNum = newLineNumber {
            return "\(newNum)"
        }
        if let oldNum = oldLineNumber {
            return "\(oldNum)"
        }
        return ""
    }
}

#Preview {
    GitDiffSheet(
        project: Project(
            id: "test",
            name: "Test Project",
            path: "/test"
        ),
        file: GitFileChange(path: "src/App.tsx", status: "modified", oldPath: nil),
        staged: false
    )
    .environmentObject(AuthManager())
}
