import SwiftUI

struct GitBranchSheet: View {
    let project: Project
    let currentBranch: String
    let onBranchChange: () -> Void
    
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) private var dismiss
    
    @State private var branches: [GitBranch] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showNewBranchAlert = false
    @State private var newBranchName = ""
    @State private var isCreatingBranch = false
    @State private var isCheckingOut = false
    @State private var searchText = ""
    
    private var api: APIService? {
        guard let serverUrl = authManager.serverUrl,
              let token = authManager.token else { return nil }
        return APIService(serverUrl: serverUrl, token: token)
    }
    
    private var filteredBranches: [GitBranch] {
        if searchText.isEmpty {
            return branches
        }
        return branches.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }
    
    private var localBranches: [GitBranch] {
        filteredBranches.filter { !$0.isRemote }
    }
    
    private var remoteBranches: [GitBranch] {
        filteredBranches.filter { $0.isRemote }
    }
    
    var body: some View {
        NavigationStack {
            Group {
                if isLoading && branches.isEmpty {
                    ProgressView("Loading branches...")
                } else if let error = errorMessage, branches.isEmpty {
                    ContentUnavailableView {
                        Label("Error", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") {
                            Task { await loadBranches() }
                        }
                    }
                } else {
                    branchList
                }
            }
            .navigationTitle("Branches")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showNewBranchAlert = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search branches")
            .alert("New Branch", isPresented: $showNewBranchAlert) {
                TextField("Branch name", text: $newBranchName)
                Button("Cancel", role: .cancel) {
                    newBranchName = ""
                }
                Button("Create") {
                    Task { await createBranch() }
                }
                .disabled(newBranchName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: {
                Text("Enter a name for the new branch")
            }
            .task {
                await loadBranches()
            }
        }
    }
    
    @ViewBuilder
    private var branchList: some View {
        List {
            // Current branch
            Section {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text(currentBranch)
                        .fontWeight(.medium)
                    Spacer()
                    Text("Current")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Current Branch")
            }
            
            // Local branches
            if !localBranches.isEmpty {
                Section {
                    ForEach(localBranches) { branch in
                        branchRow(branch)
                    }
                } header: {
                    Text("Local Branches")
                }
            }
            
            // Remote branches
            if !remoteBranches.isEmpty {
                Section {
                    ForEach(remoteBranches) { branch in
                        branchRow(branch)
                    }
                } header: {
                    Text("Remote Branches")
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if isCheckingOut {
                ZStack {
                    Color.black.opacity(0.3)
                        .ignoresSafeArea()
                    ProgressView("Switching branch...")
                        .padding()
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }
    
    @ViewBuilder
    private func branchRow(_ branch: GitBranch) -> some View {
        Button {
            if !branch.isCurrent {
                Task { await checkout(branch.name) }
            }
        } label: {
            HStack {
                Image(systemName: branch.isRemote ? "cloud" : "arrow.triangle.branch")
                    .foregroundStyle(branch.isRemote ? .blue : .primary)
                    .frame(width: 24)
                
                VStack(alignment: .leading) {
                    Text(branch.displayName)
                        .foregroundStyle(.primary)
                    if branch.isRemote {
                        Text(branch.name)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                
                Spacer()
                
                if branch.isCurrent {
                    Image(systemName: "checkmark")
                        .foregroundStyle(.green)
                }
            }
        }
        .disabled(branch.isCurrent)
    }
    
    // MARK: - Actions
    
    private func loadBranches() async {
        guard let api = api else { return }
        
        isLoading = true
        errorMessage = nil
        
        do {
            branches = try await api.getGitBranches(projectId: project.id)
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    private func checkout(_ branch: String) async {
        guard let api = api else { return }
        
        isCheckingOut = true
        
        do {
            _ = try await api.gitCheckout(projectId: project.id, branch: branch)
            onBranchChange()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isCheckingOut = false
    }
    
    private func createBranch() async {
        guard let api = api else { return }
        
        let name = newBranchName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        
        isCreatingBranch = true
        
        do {
            _ = try await api.gitCreateBranch(projectId: project.id, name: name, checkout: true)
            newBranchName = ""
            onBranchChange()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isCreatingBranch = false
    }
}

#Preview {
    GitBranchSheet(
        project: Project(
            id: "test",
            name: "Test Project",
            path: "/test"
        ),
        currentBranch: "main",
        onBranchChange: {}
    )
    .environmentObject(AuthManager())
}
