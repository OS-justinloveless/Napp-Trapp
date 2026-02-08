import SwiftUI

/// Enum representing all possible sheets in Git views
/// Using a single sheet with an enum prevents SwiftUI conflicts from multiple .sheet() modifiers
/// repoPath is included so the parent view knows which repository the action is for
enum GitSheetType: Identifiable, Equatable {
    case commit(stagedFiles: [GitFileChange], repoPath: String?)
    case branch(currentBranch: String, repoPath: String?)
    case diffTracked(file: GitFileChange, staged: Bool, repoPath: String?)
    case diffUntracked(path: String, repoPath: String?)
    case commitDetail(commit: GitCommit, repoPath: String?)
    case graph(repoPath: String?)
    
    var id: String {
        switch self {
        case .commit(_, let repoPath):
            return "commit-\(repoPath ?? "root")"
        case .branch(_, let repoPath):
            return "branch-\(repoPath ?? "root")"
        case .diffTracked(let file, let staged, let repoPath):
            return "diff-tracked-\(file.path)-\(staged)-\(repoPath ?? "root")"
        case .diffUntracked(let path, let repoPath):
            return "diff-untracked-\(path)-\(repoPath ?? "root")"
        case .commitDetail(let commit, let repoPath):
            return "commit-detail-\(commit.hash)-\(repoPath ?? "root")"
        case .graph(let repoPath):
            return "graph-\(repoPath ?? "root")"
        }
    }
    
    var repoPath: String? {
        switch self {
        case .commit(_, let rp), .branch(_, let rp), .diffTracked(_, _, let rp), .diffUntracked(_, let rp), .commitDetail(_, let rp), .graph(let rp):
            return rp
        }
    }
}

/// A section view that displays git status and controls for a single repository
struct GitRepoSection: View {
    let project: Project
    let repository: GitRepository
    @Binding var isExpanded: Bool
    @EnvironmentObject var authManager: AuthManager
    
    // Callback when status changes (e.g., after commit, to refresh parent)
    var onStatusChanged: (() -> Void)?
    
    // Callback to show a sheet - lifted to parent to survive view recreation
    var onShowSheet: ((GitSheetType) -> Void)?
    
    // Callback for showing toasts (lifted to parent)
    var onShowToast: ((ToastData) -> Void)?
    
    // Refresh trigger - when changed by the parent, forces a status reload
    var refreshTrigger: UUID = UUID()
    
    @State private var status: GitStatus?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var isPushing = false
    @State private var isPulling = false
    @State private var operationError: String?
    @State private var githubURL: URL?
    
    // Section collapse states
    @State private var isStagedExpanded = true
    @State private var isChangesExpanded = true
    
    // Multi-select state
    @State private var isSelectionMode = false
    @State private var selectedUnstagedPaths: Set<String> = []
    
    // Confirmation dialog state
    @State private var showUndoConfirmation = false
    @State private var filesToUndo: [UnifiedFileChange] = []
    
    private var api: APIService? {
        guard let serverUrl = authManager.serverUrl,
              let token = authManager.token else { return nil }
        return APIService(serverUrl: serverUrl, token: token)
    }
    
    /// The repoPath to pass to API calls (nil for root repo)
    private var repoPath: String? {
        repository.isRoot ? nil : repository.path
    }
    
    /// Combined list of unstaged changes (tracked modifications + untracked files)
    private var unstagedChanges: [UnifiedFileChange] {
        guard let status = status else { return [] }
        
        var changes: [UnifiedFileChange] = []
        
        for change in status.unstaged {
            changes.append(UnifiedFileChange(from: change))
        }
        
        for path in status.untracked {
            changes.append(UnifiedFileChange(untrackedPath: path))
        }
        
        return changes.sorted { $0.path < $1.path }
    }
    
    /// Staged changes as unified format
    private var stagedChanges: [UnifiedFileChange] {
        guard let status = status else { return [] }
        return status.staged.map { UnifiedFileChange(from: $0) }.sorted { $0.path < $1.path }
    }
    
    var body: some View {
        Section {
            if isExpanded {
                // Git controls
                gitControlsRow
                
                // Loading/error state
                if status == nil && isLoading {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                    .padding(.vertical, 8)
                } else if let error = errorMessage, status == nil {
                    Text(error)
                        .foregroundStyle(.red)
                        .font(.caption)
                } else if let status = status {
                    // Branch row
                    branchRow(status)
                    
                    // Commit button (above staged changes)
                    if !status.staged.isEmpty && selectedUnstagedPaths.isEmpty {
                        commitButton(stagedCount: status.staged.count)
                    }
                    
                    // Staged changes
                    if !stagedChanges.isEmpty {
                        stagedSection
                    }
                    
                    // Unstaged changes
                    if !unstagedChanges.isEmpty {
                        unstagedSection
                    }
                    
                    // Empty state
                    if !status.hasChanges {
                        HStack {
                            Image(systemName: "checkmark.circle")
                                .foregroundStyle(.green)
                            Text("Working tree clean")
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                    
                    // Batch undo button
                    if isSelectionMode && !selectedUnstagedPaths.isEmpty {
                        batchUndoButton
                    }
                    
                    // Commit history graph
                    historySection
                }
            }
        } header: {
            repoHeader
        }
        .task {
            if isExpanded {
                await loadStatus()
                await loadRemotes()
            }
        }
        .onChange(of: isExpanded) { _, expanded in
            if expanded && status == nil {
                Task {
                    await loadStatus()
                    await loadRemotes()
                }
            }
        }
        .onChange(of: refreshTrigger) { _, _ in
            Task {
                await loadStatus()
            }
        }
        .alert("Git Error", isPresented: .init(
            get: { operationError != nil },
            set: { if !$0 { operationError = nil } }
        )) {
            Button("OK") { operationError = nil }
        } message: {
            if let message = operationError {
                Text(message)
            }
        }
        .confirmationDialog(
            "Undo Changes",
            isPresented: $showUndoConfirmation,
            titleVisibility: .visible
        ) {
            Button("Undo \(filesToUndo.count) file\(filesToUndo.count == 1 ? "" : "s")", role: .destructive) {
                Task { await undoChanges(filesToUndo) }
            }
            Button("Cancel", role: .cancel) {
                filesToUndo = []
            }
        } message: {
            Text("This will permanently discard changes to the selected files. This cannot be undone.")
        }
    }
    
    // MARK: - Header
    
    @ViewBuilder
    private var repoHeader: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                isExpanded.toggle()
            }
        } label: {
            HStack {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.blue)
                    .frame(width: 16)
                
                Image(systemName: "folder.fill")
                    .foregroundStyle(.blue)
                
                Text(repository.name)
                    .font(.headline)
                    .foregroundStyle(.primary)
                
                if !repository.isRoot {
                    Text(repository.path)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                
                Spacer()
                
                if let status = status {
                    if status.hasChanges {
                        Text("\(status.totalChanges)")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Color.orange.opacity(0.8), in: Capsule())
                    } else {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                } else if isLoading {
                    ProgressView()
                        .scaleEffect(0.7)
                }
            }
        }
        .buttonStyle(.plain)
    }
    
    // MARK: - Git Controls Row
    
    @ViewBuilder
    private var gitControlsRow: some View {
        HStack(spacing: 16) {
            // Pull button
            Button {
                Task { await pull() }
            } label: {
                VStack(spacing: 4) {
                    if isPulling {
                        ProgressView()
                            .frame(width: 24, height: 24)
                    } else {
                        Image(systemName: "arrow.down.circle.fill")
                            .font(.title2)
                    }
                    Text("Pull")
                        .font(.caption)
                }
                .frame(maxWidth: .infinity)
            }
            .disabled(isPulling || isPushing)
            .foregroundStyle(isPulling || isPushing ? Color.secondary : Color.blue)
            
            // Push button
            Button {
                Task { await push() }
            } label: {
                VStack(spacing: 4) {
                    if isPushing {
                        ProgressView()
                            .frame(width: 24, height: 24)
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                    }
                    Text("Push")
                        .font(.caption)
                }
                .frame(maxWidth: .infinity)
            }
            .disabled(isPulling || isPushing)
            .foregroundStyle(isPulling || isPushing ? Color.secondary : Color.green)
            
            // Undo mode button
            if !unstagedChanges.isEmpty {
                Button {
                    withAnimation {
                        isSelectionMode.toggle()
                        if !isSelectionMode {
                            selectedUnstagedPaths.removeAll()
                        }
                    }
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: isSelectionMode ? "arrow.uturn.backward.circle.fill" : "arrow.uturn.backward.circle")
                            .font(.title2)
                        Text("Undo")
                            .font(.caption)
                    }
                    .frame(maxWidth: .infinity)
                }
                .foregroundStyle(isSelectionMode ? .red : .orange)
            }
            
            // GitHub button
            if githubURL != nil {
                Button {
                    openInGitHub()
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "arrow.up.forward.square.fill")
                            .font(.title2)
                        Text("GitHub")
                            .font(.caption)
                    }
                    .frame(maxWidth: .infinity)
                }
                .foregroundStyle(.purple)
            }
        }
        .buttonStyle(.plain)
        .padding(.vertical, 8)
    }
    
    // MARK: - Branch Row
    
    @ViewBuilder
    private func branchRow(_ status: GitStatus) -> some View {
        Button {
            onShowSheet?(.branch(currentBranch: status.branch, repoPath: repoPath))
        } label: {
            HStack {
                Image(systemName: "arrow.triangle.branch")
                    .foregroundStyle(.blue)
                Text(status.branch)
                    .foregroundStyle(.primary)
                Spacer()
                if status.ahead > 0 || status.behind > 0 {
                    HStack(spacing: 8) {
                        if status.ahead > 0 {
                            Label("\(status.ahead)", systemImage: "arrow.up")
                                .font(.caption)
                                .foregroundStyle(.green)
                        }
                        if status.behind > 0 {
                            Label("\(status.behind)", systemImage: "arrow.down")
                                .font(.caption)
                                .foregroundStyle(.orange)
                        }
                    }
                }
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
    
    // MARK: - Staged Section
    
    @ViewBuilder
    private var stagedSection: some View {
        DisclosureGroup(isExpanded: $isStagedExpanded) {
            ForEach(stagedChanges) { file in
                stagedFileRow(file)
            }
        } label: {
            HStack {
                Text("Staged Changes")
                    .font(.subheadline.weight(.medium))
                Text("\(stagedChanges.count)")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Color.green.opacity(0.8), in: Capsule())
                Spacer()
                Button {
                    Task { await unstageAllFiles(stagedChanges.map { $0.path }) }
                } label: {
                    Text("Unstage All")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
                .buttonStyle(.plain)
            }
        }
    }
    
    // MARK: - Unstaged Section
    
    @ViewBuilder
    private var unstagedSection: some View {
        DisclosureGroup(isExpanded: $isChangesExpanded) {
            ForEach(unstagedChanges) { file in
                unstagedFileRow(file)
            }
        } label: {
            HStack {
                Text("Changes")
                    .font(.subheadline.weight(.medium))
                Text("\(unstagedChanges.count)")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Color.orange.opacity(0.8), in: Capsule())
                Spacer()
                Button {
                    Task { await stageAllFiles(unstagedChanges.map { $0.path }) }
                } label: {
                    Text("Stage All")
                        .font(.caption)
                        .foregroundStyle(.green)
                }
                .buttonStyle(.plain)
            }
        }
    }
    
    // MARK: - History Section
    
    @ViewBuilder
    private var historySection: some View {
        Button {
            onShowSheet?(.graph(repoPath: repoPath))
        } label: {
            HStack {
                Image(systemName: "clock.arrow.circlepath")
                    .foregroundStyle(.blue)
                Text("Commit History")
                    .foregroundStyle(.primary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
    
    // MARK: - File Rows
    
    @ViewBuilder
    private func stagedFileRow(_ file: UnifiedFileChange) -> some View {
        HStack(spacing: 12) {
            Button {
                Task { await unstageFile(file.path) }
            } label: {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.green)
            }
            .buttonStyle(.plain)
            
            Button {
                if let originalFile = status?.staged.first(where: { $0.path == file.path }) {
                    onShowSheet?(.diffTracked(file: originalFile, staged: true, repoPath: repoPath))
                }
            } label: {
                HStack {
                    Image(systemName: file.stagedIcon)
                        .foregroundStyle(file.statusColor)
                        .frame(width: 24)
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.path.components(separatedBy: "/").last ?? file.path)
                            .foregroundStyle(.primary)
                        if file.path.contains("/") {
                            Text(file.path.components(separatedBy: "/").dropLast().joined(separator: "/"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    
                    Spacer()
                    
                    Text(file.statusDisplay)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .buttonStyle(.plain)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button {
                Task { await unstageFile(file.path) }
            } label: {
                Label("Unstage", systemImage: "minus.circle")
            }
            .tint(.orange)
        }
    }
    
    @ViewBuilder
    private func unstagedFileRow(_ file: UnifiedFileChange) -> some View {
        HStack(spacing: 12) {
            if isSelectionMode {
                Button {
                    if selectedUnstagedPaths.contains(file.path) {
                        selectedUnstagedPaths.remove(file.path)
                    } else {
                        selectedUnstagedPaths.insert(file.path)
                    }
                } label: {
                    Image(systemName: selectedUnstagedPaths.contains(file.path) ? "checkmark.circle.fill" : "circle")
                        .font(.title2)
                        .foregroundStyle(selectedUnstagedPaths.contains(file.path) ? .blue : .secondary)
                }
                .buttonStyle(.plain)
            } else {
                Button {
                    Task { await stageFile(file.path) }
                } label: {
                    Image(systemName: "circle")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
            }
            
            Button {
                if file.isUntracked {
                    onShowSheet?(.diffUntracked(path: file.path, repoPath: repoPath))
                } else if let originalFile = status?.unstaged.first(where: { $0.path == file.path }) {
                    onShowSheet?(.diffTracked(file: originalFile, staged: false, repoPath: repoPath))
                }
            } label: {
                HStack {
                    Image(systemName: file.unstagedIcon)
                        .foregroundStyle(file.statusColor)
                        .frame(width: 24)
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.path.components(separatedBy: "/").last ?? file.path)
                            .foregroundStyle(.primary)
                        if file.path.contains("/") {
                            Text(file.path.components(separatedBy: "/").dropLast().joined(separator: "/"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    
                    Spacer()
                    
                    Text(file.statusDisplay)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .buttonStyle(.plain)
        }
        .jiggle(isJiggling: isSelectionMode, seed: file.path.hashValue)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button {
                Task { await stageFile(file.path) }
            } label: {
                Label("Stage", systemImage: "plus.circle")
            }
            .tint(.green)
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button(role: .destructive) {
                filesToUndo = [file]
                showUndoConfirmation = true
            } label: {
                Label("Undo", systemImage: "arrow.uturn.backward")
            }
        }
    }
    
    // MARK: - Action Buttons
    
    @ViewBuilder
    private func commitButton(stagedCount: Int) -> some View {
        Button {
            onShowSheet?(.commit(stagedFiles: status?.staged ?? [], repoPath: repoPath))
        } label: {
            HStack {
                Image(systemName: "checkmark.circle.fill")
                Text("Commit \(stagedCount) file\(stagedCount == 1 ? "" : "s")")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Color.accentColor)
            .foregroundStyle(.white)
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
        .padding(.top, 8)
    }
    
    @ViewBuilder
    private var batchUndoButton: some View {
        Button(role: .destructive) {
            let selectedFiles = unstagedChanges.filter { selectedUnstagedPaths.contains($0.path) }
            filesToUndo = selectedFiles
            showUndoConfirmation = true
        } label: {
            HStack {
                Image(systemName: "arrow.uturn.backward")
                Text("Undo \(selectedUnstagedPaths.count) file\(selectedUnstagedPaths.count == 1 ? "" : "s")")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Color.red)
            .foregroundStyle(.white)
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
        .padding(.top, 8)
    }
    
    // MARK: - Actions
    
    private func loadStatus() async {
        guard let api = api else { return }
        
        isLoading = true
        errorMessage = nil
        
        do {
            status = try await api.getGitStatus(projectId: project.id, repoPath: repoPath)
        } catch {
            print("[GitRepoSection] loadStatus error: \(error)")
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    private func loadRemotes() async {
        guard let api = api else { return }
        
        do {
            let remotes = try await api.getGitRemotes(projectId: project.id, repoPath: repoPath)
            if let origin = remotes.first(where: { $0.name == "origin" }) {
                githubURL = gitRemoteToWebURL(origin.fetchUrl ?? origin.pushUrl)
            } else if let firstRemote = remotes.first {
                githubURL = gitRemoteToWebURL(firstRemote.fetchUrl ?? firstRemote.pushUrl)
            }
        } catch {
            print("[GitRepoSection] Failed to load remotes: \(error)")
        }
    }
    
    private func stageFile(_ path: String) async {
        guard let api = api else { return }
        
        do {
            _ = try await api.gitStage(projectId: project.id, files: [path], repoPath: repoPath)
            await loadStatus()
        } catch {
            operationError = "Failed to stage: \(error.localizedDescription)"
        }
    }
    
    private func unstageFile(_ path: String) async {
        guard let api = api else { return }
        
        do {
            _ = try await api.gitUnstage(projectId: project.id, files: [path], repoPath: repoPath)
            await loadStatus()
        } catch {
            operationError = "Failed to unstage: \(error.localizedDescription)"
        }
    }
    
    private func stageAllFiles(_ paths: [String]) async {
        guard let api = api, !paths.isEmpty else { return }
        
        do {
            _ = try await api.gitStage(projectId: project.id, files: paths, repoPath: repoPath)
            await loadStatus()
        } catch {
            operationError = "Failed to stage files: \(error.localizedDescription)"
        }
    }
    
    private func unstageAllFiles(_ paths: [String]) async {
        guard let api = api, !paths.isEmpty else { return }
        
        do {
            _ = try await api.gitUnstage(projectId: project.id, files: paths, repoPath: repoPath)
            await loadStatus()
        } catch {
            operationError = "Failed to unstage files: \(error.localizedDescription)"
        }
    }
    
    private func undoChanges(_ files: [UnifiedFileChange]) async {
        guard let api = api, !files.isEmpty else { return }
        
        let trackedFiles = files.filter { !$0.isUntracked }.map { $0.path }
        let untrackedFiles = files.filter { $0.isUntracked }.map { $0.path }
        
        do {
            if !trackedFiles.isEmpty {
                _ = try await api.gitDiscard(projectId: project.id, files: trackedFiles, repoPath: repoPath)
            }
            
            if !untrackedFiles.isEmpty {
                _ = try await api.gitClean(projectId: project.id, files: untrackedFiles, repoPath: repoPath)
            }
            
            selectedUnstagedPaths.removeAll()
            filesToUndo = []
            
            await loadStatus()
        } catch {
            operationError = "Failed to undo: \(error.localizedDescription)"
        }
    }
    
    private func push() async {
        guard let api = api else { return }
        
        isPushing = true
        do {
            _ = try await api.gitPush(projectId: project.id, repoPath: repoPath)
            onShowToast?(.success("Push successful"))
            await loadStatus()
        } catch {
            operationError = "Push failed: \(error.localizedDescription)"
        }
        isPushing = false
    }
    
    private func pull() async {
        guard let api = api else { return }
        
        isPulling = true
        do {
            _ = try await api.gitPull(projectId: project.id, repoPath: repoPath)
            onShowToast?(.success("Pull successful"))
            await loadStatus()
        } catch {
            operationError = "Pull failed: \(error.localizedDescription)"
        }
        isPulling = false
    }
    
    private func gitRemoteToWebURL(_ urlString: String?) -> URL? {
        guard let urlString = urlString else { return nil }
        
        var webUrl = urlString
        
        if webUrl.hasPrefix("git@") {
            webUrl = webUrl.replacingOccurrences(of: "git@", with: "https://")
            webUrl = webUrl.replacingOccurrences(of: ":", with: "/", options: [], range: webUrl.range(of: ":"))
        }
        
        if webUrl.hasSuffix(".git") {
            webUrl = String(webUrl.dropLast(4))
        }
        
        return URL(string: webUrl)
    }
    
    private func openInGitHub() {
        guard let url = githubURL else { return }
        UIApplication.shared.open(url)
    }
}
