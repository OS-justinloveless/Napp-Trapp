import SwiftUI

struct GitCommitSheet: View {
    let project: Project
    let stagedFiles: [GitFileChange]
    let repoPath: String?  // nil for root repo, relative path for sub-repos
    let onCommit: () -> Void
    
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) private var dismiss
    
    @State private var commitMessage = ""
    @State private var isCommitting = false
    @State private var isGenerating = false
    @State private var errorMessage: String?
    
    private var api: APIService? {
        guard let serverUrl = authManager.serverUrl,
              let token = authManager.token else { return nil }
        return APIService(serverUrl: serverUrl, token: token)
    }
    
    // Convenience init for backward compatibility (root repo)
    init(project: Project, stagedFiles: [GitFileChange], onCommit: @escaping () -> Void) {
        self.project = project
        self.stagedFiles = stagedFiles
        self.repoPath = nil
        self.onCommit = onCommit
    }
    
    // Full init with repoPath
    init(project: Project, stagedFiles: [GitFileChange], repoPath: String?, onCommit: @escaping () -> Void) {
        self.project = project
        self.stagedFiles = stagedFiles
        self.repoPath = repoPath
        self.onCommit = onCommit
    }
    
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Commit message", text: $commitMessage, axis: .vertical)
                        .lineLimit(3...6)
                        .disabled(isGenerating)
                    
                    // AI Generate button
                    Button {
                        Task { await generateCommitMessage() }
                    } label: {
                        HStack {
                            if isGenerating {
                                ProgressView()
                                    .scaleEffect(0.8)
                                Text("Generating...")
                                    .foregroundStyle(.secondary)
                            } else {
                                Image(systemName: "sparkles")
                                    .foregroundStyle(.purple)
                                Text("Generate with AI")
                                    .foregroundStyle(.purple)
                            }
                            Spacer()
                        }
                    }
                    .disabled(isGenerating || stagedFiles.isEmpty)
                } header: {
                    Text("Message")
                } footer: {
                    Text("Describe your changes briefly, or use AI to generate a message based on your staged changes")
                }
                
                Section {
                    ForEach(stagedFiles) { file in
                        HStack {
                            Image(systemName: file.statusIcon)
                                .foregroundStyle(statusColor(for: file))
                                .frame(width: 24)
                            
                            Text(file.path)
                                .font(.system(.body, design: .monospaced))
                                .lineLimit(1)
                            
                            Spacer()
                            
                            Text(file.statusDisplay)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text("Files to Commit (\(stagedFiles.count))")
                }
                
                if let error = errorMessage {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Commit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await commit() }
                    } label: {
                        if isCommitting {
                            ProgressView()
                        } else {
                            Text("Commit")
                        }
                    }
                    .disabled(commitMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isCommitting || isGenerating)
                }
            }
        }
    }
    
    private func statusColor(for file: GitFileChange) -> Color {
        switch file.status {
        case "modified": return .orange
        case "added": return .green
        case "deleted": return .red
        case "renamed", "copied": return .blue
        case "unmerged": return .yellow
        default: return .gray
        }
    }
    
    private func commit() async {
        guard let api = api else { return }
        
        isCommitting = true
        errorMessage = nil
        
        do {
            _ = try await api.gitCommit(projectId: project.id, message: commitMessage.trimmingCharacters(in: .whitespacesAndNewlines), repoPath: repoPath)
            onCommit()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isCommitting = false
    }
    
    private func generateCommitMessage() async {
        guard let api = api else { return }
        
        isGenerating = true
        errorMessage = nil
        
        do {
            let message = try await api.generateCommitMessage(projectId: project.id, repoPath: repoPath)
            commitMessage = message
        } catch {
            errorMessage = "Failed to generate: \(error.localizedDescription)"
        }
        
        isGenerating = false
    }
}

#Preview {
    GitCommitSheet(
        project: Project(
            id: "test",
            name: "Test Project",
            path: "/test"
        ),
        stagedFiles: [
            GitFileChange(path: "src/App.tsx", status: "modified", oldPath: nil),
            GitFileChange(path: "package.json", status: "modified", oldPath: nil)
        ],
        onCommit: {}
    )
    .environmentObject(AuthManager())
}
