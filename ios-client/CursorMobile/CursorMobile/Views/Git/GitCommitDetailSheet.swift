import SwiftUI

struct GitCommitDetailSheet: View {
    let project: Project
    let commit: GitCommit
    let repoPath: String?
    let onOperationComplete: () -> Void
    
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) private var dismiss
    
    @State private var detail: GitCommitDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?
    
    // Operation states
    @State private var isPerformingOperation = false
    @State private var operationError: String?
    @State private var operationSuccess: String?
    
    // Diff sheet state
    @State private var selectedDiffFile: GitCommitFile?
    
    // Dialog states
    @State private var showBranchDialog = false
    @State private var newBranchName = ""
    @State private var showTagDialog = false
    @State private var newTagName = ""
    @State private var newTagMessage = ""
    @State private var showResetConfirmation = false
    @State private var selectedResetMode = "mixed"
    @State private var showRevertConfirmation = false
    @State private var showCheckoutConfirmation = false
    @State private var showCherryPickConfirmation = false
    
    private var api: APIService? {
        guard let serverUrl = authManager.serverUrl,
              let token = authManager.token else { return nil }
        return APIService(serverUrl: serverUrl, token: token)
    }
    
    var body: some View {
        NavigationStack {
            List {
                // Commit info section
                commitInfoSection
                
                // Full message section (if body exists)
                if let detail = detail, let body = detail.body, !body.isEmpty {
                    Section("Message") {
                        Text(body)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.primary)
                            .textSelection(.enabled)
                    }
                }
                
                // Changed files section
                if let detail = detail, let files = detail.files, !files.isEmpty {
                    changedFilesSection(files: files, detail: detail)
                }
                
                // Actions section
                actionsSection
                
                // Operation feedback
                if let success = operationSuccess {
                    Section {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            Text(success)
                                .foregroundStyle(.green)
                        }
                    }
                }
                
                if let error = operationError {
                    Section {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                            Text(error)
                                .foregroundStyle(.red)
                                .font(.caption)
                        }
                    }
                }
            }
            .navigationTitle("Commit Detail")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task {
            await loadDetail()
        }
        .alert("Create Branch", isPresented: $showBranchDialog) {
            TextField("Branch name", text: $newBranchName)
            Button("Create") {
                Task { await createBranch() }
            }
            Button("Cancel", role: .cancel) {
                newBranchName = ""
            }
        } message: {
            Text("Create a new branch from commit \(commit.shortHash)")
        }
        .alert("Create Tag", isPresented: $showTagDialog) {
            TextField("Tag name", text: $newTagName)
            TextField("Message (optional)", text: $newTagMessage)
            Button("Create") {
                Task { await createTag() }
            }
            Button("Cancel", role: .cancel) {
                newTagName = ""
                newTagMessage = ""
            }
        } message: {
            Text("Create a tag on commit \(commit.shortHash)")
        }
        .confirmationDialog("Reset to \(commit.shortHash)", isPresented: $showResetConfirmation, titleVisibility: .visible) {
            Button("Soft Reset") {
                selectedResetMode = "soft"
                Task { await resetToCommit() }
            }
            Button("Mixed Reset") {
                selectedResetMode = "mixed"
                Task { await resetToCommit() }
            }
            Button("Hard Reset", role: .destructive) {
                selectedResetMode = "hard"
                Task { await resetToCommit() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Soft: keep changes staged\nMixed: keep changes unstaged\nHard: discard all changes (DANGEROUS)")
        }
        .confirmationDialog("Revert \(commit.shortHash)?", isPresented: $showRevertConfirmation, titleVisibility: .visible) {
            Button("Revert") {
                Task { await revertCommit() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will create a new commit that undoes the changes from \(commit.shortHash).")
        }
        .confirmationDialog("Checkout \(commit.shortHash)?", isPresented: $showCheckoutConfirmation, titleVisibility: .visible) {
            Button("Checkout (Detached HEAD)") {
                Task { await checkoutDetached() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You will be in a detached HEAD state. Any new commits will be lost unless you create a branch.")
        }
        .confirmationDialog("Cherry-pick \(commit.shortHash)?", isPresented: $showCherryPickConfirmation, titleVisibility: .visible) {
            Button("Cherry-pick") {
                Task { await cherryPick() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Apply the changes from this commit to your current branch.")
        }
        .sheet(item: $selectedDiffFile) { file in
            GitDiffSheet(
                project: project,
                commitFilePath: file.path,
                commitHash: commit.hash,
                repoPath: repoPath
            )
        }
    }
    
    // MARK: - Commit Info Section
    
    @ViewBuilder
    private var commitInfoSection: some View {
        Section {
            // Subject
            VStack(alignment: .leading, spacing: 8) {
                Text(commit.subject)
                    .font(.headline)
                    .textSelection(.enabled)
                
                // Ref badges
                let allRefs = buildRefBadges()
                if !allRefs.isEmpty {
                    FlowLayout(spacing: 4) {
                        ForEach(allRefs, id: \.name) { badge in
                            RefBadge(name: badge.name, type: badge.type)
                        }
                    }
                }
            }
            .padding(.vertical, 4)
            
            // Hash (copyable)
            HStack {
                Image(systemName: "number")
                    .foregroundStyle(.secondary)
                    .frame(width: 24)
                VStack(alignment: .leading) {
                    Text("Hash")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(commit.hash)
                        .font(.system(size: 12, design: .monospaced))
                        .textSelection(.enabled)
                }
                Spacer()
                Button {
                    UIPasteboard.general.string = commit.hash
                    operationSuccess = "Hash copied"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        if operationSuccess == "Hash copied" {
                            operationSuccess = nil
                        }
                    }
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.caption)
                }
                .buttonStyle(.borderless)
            }
            
            // Author
            HStack {
                Image(systemName: "person")
                    .foregroundStyle(.secondary)
                    .frame(width: 24)
                VStack(alignment: .leading) {
                    Text("Author")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(commit.author.name)
                    Text(commit.author.email)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            
            // Date
            HStack {
                Image(systemName: "calendar")
                    .foregroundStyle(.secondary)
                    .frame(width: 24)
                VStack(alignment: .leading) {
                    Text("Date")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(commit.date.formatted(date: .long, time: .shortened))
                    Text(commit.relativeDate)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            
            // Parents
            if let parents = commit.parents, !parents.isEmpty {
                HStack(alignment: .top) {
                    Image(systemName: commit.isMerge ? "arrow.triangle.merge" : "arrow.up")
                        .foregroundStyle(.secondary)
                        .frame(width: 24)
                    VStack(alignment: .leading) {
                        Text(commit.isMerge ? "Parents (Merge)" : "Parent")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        ForEach(parents, id: \.self) { parent in
                            Text(String(parent.prefix(7)))
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.blue)
                        }
                    }
                }
            }
        } header: {
            if isLoading {
                HStack {
                    Text("Commit")
                    Spacer()
                    ProgressView()
                        .scaleEffect(0.7)
                }
            } else {
                Text("Commit")
            }
        }
    }
    
    // MARK: - Changed Files Section
    
    @ViewBuilder
    private func changedFilesSection(files: [GitCommitFile], detail: GitCommitDetail) -> some View {
        Section {
            // Stats summary
            HStack {
                Text("\(files.count) file\(files.count == 1 ? "" : "s") changed")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                HStack(spacing: 8) {
                    Text("+\(detail.totalAdditions)")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.green)
                    Text("-\(detail.totalDeletions)")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.red)
                }
            }
            
            // File list
            ForEach(files) { file in
                Button {
                    selectedDiffFile = file
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: file.statusIcon)
                            .foregroundStyle(Color(file.statusColor))
                            .frame(width: 20)
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text(file.fileName)
                                .font(.subheadline)
                                .foregroundStyle(.primary)
                            if let dir = file.directory {
                                Text(dir)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            if let oldPath = file.oldPath {
                                Text("from: \(oldPath)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .italic()
                            }
                        }
                        
                        Spacer()
                        
                        HStack(spacing: 4) {
                            if file.additions > 0 {
                                Text("+\(file.additions)")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(.green)
                            }
                            if file.deletions > 0 {
                                Text("-\(file.deletions)")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(.red)
                            }
                        }
                        
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text("Changed Files")
        }
    }
    
    // MARK: - Actions Section
    
    @ViewBuilder
    private var actionsSection: some View {
        Section("Actions") {
            // Checkout detached
            Button {
                showCheckoutConfirmation = true
            } label: {
                Label("Checkout (Detached HEAD)", systemImage: "arrow.uturn.left")
            }
            .disabled(isPerformingOperation)
            
            // Create branch from commit
            Button {
                newBranchName = ""
                showBranchDialog = true
            } label: {
                Label("Create Branch Here...", systemImage: "arrow.triangle.branch")
            }
            .disabled(isPerformingOperation)
            
            // Cherry-pick
            Button {
                showCherryPickConfirmation = true
            } label: {
                Label("Cherry-pick", systemImage: "cherry")
            }
            .disabled(isPerformingOperation)
            
            // Revert
            Button {
                showRevertConfirmation = true
            } label: {
                Label("Revert", systemImage: "arrow.uturn.backward")
            }
            .disabled(isPerformingOperation)
            
            // Create tag
            Button {
                newTagName = ""
                newTagMessage = ""
                showTagDialog = true
            } label: {
                Label("Create Tag...", systemImage: "tag")
            }
            .disabled(isPerformingOperation)
            
            // Reset
            Button(role: .destructive) {
                showResetConfirmation = true
            } label: {
                Label("Reset to Here...", systemImage: "exclamationmark.arrow.circlepath")
            }
            .disabled(isPerformingOperation)
            
            if isPerformingOperation {
                HStack {
                    Spacer()
                    ProgressView()
                        .scaleEffect(0.8)
                    Text("Working...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
            }
        }
    }
    
    // MARK: - Helpers
    
    private func buildRefBadges() -> [(name: String, type: RefBadge.RefType)] {
        var badges: [(name: String, type: RefBadge.RefType)] = []
        
        if commit.isHEAD {
            badges.append((name: "HEAD", type: .head))
        }
        
        for ref in commit.branchRefs {
            let cleanRef = ref.replacingOccurrences(of: "HEAD -> ", with: "")
            if cleanRef != "HEAD" {
                badges.append((name: cleanRef, type: .branch))
            }
        }
        
        for tag in commit.tagRefs {
            badges.append((name: tag, type: .tag))
        }
        
        return badges
    }
    
    // MARK: - Data Loading
    
    private func loadDetail() async {
        guard let api = api else { return }
        
        isLoading = true
        errorMessage = nil
        
        do {
            detail = try await api.gitCommitDetail(projectId: project.id, hash: commit.hash, repoPath: repoPath)
        } catch {
            print("[GitCommitDetailSheet] loadDetail error: \(error)")
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    // MARK: - Actions
    
    private func checkoutDetached() async {
        guard let api = api else { return }
        isPerformingOperation = true
        operationError = nil
        operationSuccess = nil
        
        do {
            _ = try await api.gitCheckoutDetached(projectId: project.id, hash: commit.hash, repoPath: repoPath)
            operationSuccess = "Checked out \(commit.shortHash) (detached HEAD)"
            onOperationComplete()
        } catch {
            operationError = "Checkout failed: \(error.localizedDescription)"
        }
        
        isPerformingOperation = false
    }
    
    private func createBranch() async {
        guard let api = api, !newBranchName.isEmpty else { return }
        isPerformingOperation = true
        operationError = nil
        operationSuccess = nil
        
        do {
            _ = try await api.gitCreateBranchFrom(projectId: project.id, name: newBranchName, startPoint: commit.hash, checkout: true, repoPath: repoPath)
            operationSuccess = "Created branch '\(newBranchName)' from \(commit.shortHash)"
            newBranchName = ""
            onOperationComplete()
        } catch {
            operationError = "Create branch failed: \(error.localizedDescription)"
        }
        
        isPerformingOperation = false
    }
    
    private func cherryPick() async {
        guard let api = api else { return }
        isPerformingOperation = true
        operationError = nil
        operationSuccess = nil
        
        do {
            _ = try await api.gitCherryPick(projectId: project.id, hash: commit.hash, repoPath: repoPath)
            operationSuccess = "Cherry-picked \(commit.shortHash)"
            onOperationComplete()
        } catch {
            operationError = "Cherry-pick failed: \(error.localizedDescription)"
        }
        
        isPerformingOperation = false
    }
    
    private func revertCommit() async {
        guard let api = api else { return }
        isPerformingOperation = true
        operationError = nil
        operationSuccess = nil
        
        do {
            _ = try await api.gitRevertCommit(projectId: project.id, hash: commit.hash, repoPath: repoPath)
            operationSuccess = "Reverted \(commit.shortHash)"
            onOperationComplete()
        } catch {
            operationError = "Revert failed: \(error.localizedDescription)"
        }
        
        isPerformingOperation = false
    }
    
    private func createTag() async {
        guard let api = api, !newTagName.isEmpty else { return }
        isPerformingOperation = true
        operationError = nil
        operationSuccess = nil
        
        do {
            let message = newTagMessage.isEmpty ? nil : newTagMessage
            _ = try await api.gitCreateTag(projectId: project.id, name: newTagName, hash: commit.hash, message: message, repoPath: repoPath)
            operationSuccess = "Created tag '\(newTagName)' on \(commit.shortHash)"
            newTagName = ""
            newTagMessage = ""
            onOperationComplete()
        } catch {
            operationError = "Create tag failed: \(error.localizedDescription)"
        }
        
        isPerformingOperation = false
    }
    
    private func resetToCommit() async {
        guard let api = api else { return }
        isPerformingOperation = true
        operationError = nil
        operationSuccess = nil
        
        do {
            _ = try await api.gitReset(projectId: project.id, hash: commit.hash, mode: selectedResetMode, repoPath: repoPath)
            operationSuccess = "Reset (\(selectedResetMode)) to \(commit.shortHash)"
            onOperationComplete()
        } catch {
            operationError = "Reset failed: \(error.localizedDescription)"
        }
        
        isPerformingOperation = false
    }
}

// MARK: - Flow Layout (for ref badges)

/// A horizontal flow layout that wraps to the next line
struct FlowLayout: Layout {
    var spacing: CGFloat = 4
    
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = layoutSubviews(proposal: proposal, subviews: subviews)
        return result.size
    }
    
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layoutSubviews(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: .unspecified
            )
        }
    }
    
    private func layoutSubviews(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var currentX: CGFloat = 0
        var currentY: CGFloat = 0
        var lineHeight: CGFloat = 0
        var maxX: CGFloat = 0
        
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            
            if currentX + size.width > maxWidth && currentX > 0 {
                currentX = 0
                currentY += lineHeight + spacing
                lineHeight = 0
            }
            
            positions.append(CGPoint(x: currentX, y: currentY))
            lineHeight = max(lineHeight, size.height)
            currentX += size.width + spacing
            maxX = max(maxX, currentX)
        }
        
        return (
            size: CGSize(width: maxX, height: currentY + lineHeight),
            positions: positions
        )
    }
}
