import SwiftUI

struct GitCommitSheet: View {
    let project: Project
    let stagedFiles: [GitFileChange]
    let onCommit: () -> Void
    
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) private var dismiss
    
    @State private var commitMessage = ""
    @State private var isCommitting = false
    @State private var errorMessage: String?
    
    private var api: APIService? {
        guard let serverUrl = authManager.serverUrl,
              let token = authManager.token else { return nil }
        return APIService(serverUrl: serverUrl, token: token)
    }
    
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Commit message", text: $commitMessage, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Message")
                } footer: {
                    Text("Describe your changes briefly")
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
                    .disabled(commitMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isCommitting)
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
            _ = try await api.gitCommit(projectId: project.id, message: commitMessage.trimmingCharacters(in: .whitespacesAndNewlines))
            onCommit()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isCommitting = false
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
