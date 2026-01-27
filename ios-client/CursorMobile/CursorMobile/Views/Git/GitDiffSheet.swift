import SwiftUI

struct GitDiffSheet: View {
    let project: Project
    let file: GitFileChange
    let staged: Bool
    
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) private var dismiss
    
    @State private var diffContent = ""
    @State private var diffLines: [DiffLine] = []
    @State private var isLoading = true
    @State private var hasStartedLoading = false  // Prevent duplicate loads
    @State private var errorMessage: String?
    @State private var isTruncated = false
    @State private var loadTask: Task<Void, Never>?
    
    private var api: APIService? {
        guard let serverUrl = authManager.serverUrl,
              let token = authManager.token else { return nil }
        return APIService(serverUrl: serverUrl, token: token)
    }
    
    var body: some View {
        NavigationStack {
            contentView
                .navigationTitle(file.path.components(separatedBy: "/").last ?? file.path)
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
                            Text(file.path.components(separatedBy: "/").last ?? file.path)
                                .font(.headline)
                            Text(staged ? "Staged" : "Unstaged")
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
                await loadDiff()
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
            Text("\(line.number)")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 40, alignment: .trailing)
                .padding(.trailing, 8)
            
            // Line content
            Text(line.content.isEmpty ? " " : line.content)
                .textSelection(.enabled)
                .padding(.vertical, 2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 8)
        .background(line.backgroundColor)
    }
    
    // MARK: - Actions
    
    @MainActor
    private func loadDiff() async {
        guard let api = api else { 
            isLoading = false
            errorMessage = "Not connected to server"
            return 
        }
        
        isLoading = true
        errorMessage = nil
        
        do {
            let result = try await api.gitDiffFull(projectId: project.id, file: file.path, staged: staged)
            
            // Check if task was cancelled
            guard !Task.isCancelled else { return }
            
            diffContent = result.diff
            isTruncated = result.truncated
            
            // Parse lines in background to avoid blocking UI
            let content = result.diff
            let parsedLines = await Task.detached(priority: .userInitiated) {
                let lines = content.components(separatedBy: "\n")
                return lines.enumerated().map { index, line in
                    DiffLine(number: index + 1, content: line)
                }
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
}

// MARK: - DiffLine Model

struct DiffLine: Identifiable {
    let id: Int
    let number: Int
    let content: String
    let backgroundColor: Color
    
    init(number: Int, content: String) {
        self.id = number
        self.number = number
        self.content = content
        
        // Pre-compute background color
        if content.hasPrefix("+") && !content.hasPrefix("+++") {
            self.backgroundColor = Color.green.opacity(0.2)
        } else if content.hasPrefix("-") && !content.hasPrefix("---") {
            self.backgroundColor = Color.red.opacity(0.2)
        } else if content.hasPrefix("@@") {
            self.backgroundColor = Color.blue.opacity(0.15)
        } else if content.hasPrefix("diff ") || content.hasPrefix("index ") || content.hasPrefix("---") || content.hasPrefix("+++") {
            self.backgroundColor = Color(.systemGray5)
        } else {
            self.backgroundColor = .clear
        }
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
