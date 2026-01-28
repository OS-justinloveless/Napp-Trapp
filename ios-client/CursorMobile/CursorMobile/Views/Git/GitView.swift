import SwiftUI

// MARK: - iOS-style Jiggle Animation Modifier

extension View {
    func jiggle(isJiggling: Bool, seed: Int = 0) -> some View {
        self.modifier(JiggleModifier(isJiggling: isJiggling, seed: seed))
    }
}

struct JiggleModifier: ViewModifier {
    let isJiggling: Bool
    let seed: Int
    
    // Use seed to create slight variations between items
    private var rotationAmount: Double {
        1.8 + Double(abs(seed) % 5) * 0.2  // 1.8 to 2.6 degrees
    }
    
    private var duration: Double {
        0.10 + Double(abs(seed) % 4) * 0.015  // 0.10 to 0.145 seconds
    }
    
    private var phaseOffset: Double {
        Double(abs(seed) % 7) * 0.3  // Offset to desync animations
    }
    
    func body(content: Content) -> some View {
        if isJiggling {
            content
                .modifier(ContinuousJiggleEffect(
                    rotationAmount: rotationAmount,
                    duration: duration,
                    phaseOffset: phaseOffset
                ))
        } else {
            content
        }
    }
}

struct ContinuousJiggleEffect: ViewModifier {
    let rotationAmount: Double
    let duration: Double
    let phaseOffset: Double
    
    @State private var rotation: Double = 0
    @State private var offset: CGFloat = 0
    
    func body(content: Content) -> some View {
        content
            .rotationEffect(.degrees(rotation))
            .offset(x: offset, y: 0)
            .onAppear {
                // Start with a random phase
                rotation = -rotationAmount
                offset = -0.5
                
                // Use a slight delay based on phase offset for desync
                DispatchQueue.main.asyncAfter(deadline: .now() + phaseOffset * 0.05) {
                    withAnimation(
                        .easeInOut(duration: duration)
                        .repeatForever(autoreverses: true)
                    ) {
                        rotation = rotationAmount
                        offset = 0.5
                    }
                }
            }
    }
}

/// Represents a unified file change for display purposes
/// Combines both tracked unstaged changes and untracked files
struct UnifiedFileChange: Identifiable, Hashable {
    let path: String
    let status: String  // "modified", "added", "deleted", "renamed", "copied", "unmerged", "untracked"
    let oldPath: String?
    let isUntracked: Bool
    
    var id: String { path }
    
    /// Human-readable status
    var statusDisplay: String {
        switch status {
        case "modified": return "Modified"
        case "added", "untracked": return "Added"
        case "deleted": return "Deleted"
        case "renamed": return "Renamed"
        case "copied": return "Copied"
        case "unmerged": return "Conflict"
        default: return status.capitalized
        }
    }
    
    /// SF Symbol for this status in unstaged context
    var unstagedIcon: String {
        switch status {
        case "modified": return "pencil"
        case "added", "untracked": return "plus"
        case "deleted": return "minus"
        case "renamed": return "arrow.right"
        case "copied": return "doc.on.doc"
        case "unmerged": return "exclamationmark.triangle"
        default: return "questionmark"
        }
    }
    
    /// SF Symbol for this status in staged context (always checkmark for staged files)
    var stagedIcon: String {
        return "checkmark"
    }
    
    /// Color for this status
    var statusColor: Color {
        switch status {
        case "modified": return .orange
        case "added", "untracked": return .green
        case "deleted": return .red
        case "renamed", "copied": return .blue
        case "unmerged": return .yellow
        default: return .gray
        }
    }
    
    /// Create from a GitFileChange (tracked file)
    init(from change: GitFileChange) {
        self.path = change.path
        self.status = change.status
        self.oldPath = change.oldPath
        self.isUntracked = false
    }
    
    /// Create from an untracked file path
    init(untrackedPath: String) {
        self.path = untrackedPath
        self.status = "untracked"
        self.oldPath = nil
        self.isUntracked = true
    }
}

struct GitView: View {
    let project: Project
    @EnvironmentObject var authManager: AuthManager
    
    @State private var status: GitStatus?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showCommitSheet = false
    @State private var showBranchSheet = false
    @State private var selectedFile: GitFileChange?
    @State private var selectedFileStaged = false
    @State private var showDiffSheet = false
    @State private var selectedUntrackedFilePath: String?
    @State private var showFileViewerSheet = false
    @State private var isPushing = false
    @State private var isPulling = false
    @State private var operationMessage: String?
    
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
    
    /// Combined list of unstaged changes (tracked modifications + untracked files)
    private var unstagedChanges: [UnifiedFileChange] {
        guard let status = status else { return [] }
        
        var changes: [UnifiedFileChange] = []
        
        // Add tracked unstaged changes
        for change in status.unstaged {
            changes.append(UnifiedFileChange(from: change))
        }
        
        // Add untracked files as "Added" files
        for path in status.untracked {
            let untrackedChange = UnifiedFileChange(untrackedPath: path)
            print("[GitView] Adding untracked file to changes: \(path), isUntracked: \(untrackedChange.isUntracked)")
            changes.append(untrackedChange)
        }
        
        // Sort by path for consistent ordering
        return changes.sorted { $0.path < $1.path }
    }
    
    /// Staged changes as unified format
    private var stagedChanges: [UnifiedFileChange] {
        guard let status = status else { return [] }
        return status.staged.map { UnifiedFileChange(from: $0) }.sorted { $0.path < $1.path }
    }
    
    var body: some View {
        ZStack {
            Group {
                if status == nil && isLoading {
                    VStack(spacing: 16) {
                        ProgressView()
                            .scaleEffect(1.2)
                        Text("Loading git status...")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = errorMessage, status == nil {
                    ContentUnavailableView {
                        Label("Error", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") {
                            Task { await loadStatus() }
                        }
                    }
                } else if let status = status {
                    gitStatusView(status)
                } else {
                    ContentUnavailableView {
                        Label("No Git Status", systemImage: "arrow.triangle.branch")
                    } description: {
                        Text("Unable to load git status")
                    } actions: {
                        Button("Refresh") {
                            Task { await loadStatus() }
                        }
                    }
                }
            }
            
            // Overlay loading indicator when refreshing with existing data
            if isLoading && status != nil {
                VStack {
                    HStack {
                        Spacer()
                        ProgressView()
                            .padding(8)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .padding(.horizontal)
                    Spacer()
                }
            }
        }
        .navigationTitle("Git")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 12) {
                    // Selection mode toggle (only show if there are unstaged changes)
                    if !unstagedChanges.isEmpty {
                        Button {
                            withAnimation {
                                isSelectionMode.toggle()
                                if !isSelectionMode {
                                    selectedUnstagedPaths.removeAll()
                                }
                            }
                        } label: {
                            Image(systemName: isSelectionMode ? "arrow.uturn.backward.circle.fill" : "arrow.uturn.backward.circle")
                        }
                    }
                    
                    // Pull button
                    Button {
                        Task { await pull() }
                    } label: {
                        if isPulling {
                            ProgressView()
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: "arrow.down.circle")
                        }
                    }
                    .disabled(isPulling || isPushing)
                    
                    // Push button
                    Button {
                        Task { await push() }
                    } label: {
                        if isPushing {
                            ProgressView()
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: "arrow.up.circle")
                        }
                    }
                    .disabled(isPulling || isPushing)
                }
            }
        }
        .refreshable {
            await loadStatus()
        }
        .task {
            await loadStatus()
        }
        .onChange(of: project.id) { _, _ in
            // Reset state when project changes
            status = nil
            isLoading = true
            errorMessage = nil
            selectedFile = nil
            selectedUnstagedPaths = []
            isSelectionMode = false
            Task { await loadStatus() }
        }
        .sheet(isPresented: $showCommitSheet) {
            GitCommitSheet(project: project, stagedFiles: status?.staged ?? []) {
                Task { await loadStatus() }
            }
        }
        .sheet(isPresented: $showBranchSheet) {
            GitBranchSheet(project: project, currentBranch: status?.branch ?? "") {
                Task { await loadStatus() }
            }
        }
        .sheet(isPresented: $showDiffSheet) {
            if let file = selectedFile {
                GitDiffSheet(project: project, file: file, staged: selectedFileStaged)
            }
        }
        .sheet(isPresented: $showFileViewerSheet) {
            if let filePath = selectedUntrackedFilePath {
                FileViewerSheet(filePath: filePath)
            }
        }
        .alert("Git Operation", isPresented: .init(
            get: { operationMessage != nil },
            set: { if !$0 { operationMessage = nil } }
        )) {
            Button("OK") { operationMessage = nil }
        } message: {
            if let message = operationMessage {
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
    
    @ViewBuilder
    private func gitStatusView(_ status: GitStatus) -> some View {
        VStack(spacing: 0) {
            List {
                // Branch section
                Section {
                    Button {
                        showBranchSheet = true
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
                } header: {
                    Text("Branch")
                }
                
                // Staged changes
                if !stagedChanges.isEmpty {
                    Section {
                        if isStagedExpanded {
                            ForEach(stagedChanges) { file in
                                stagedFileRow(file)
                            }
                        }
                    } header: {
                        collapsibleSectionHeader(
                            title: "Staged Changes",
                            count: stagedChanges.count,
                            isExpanded: $isStagedExpanded,
                            accentColor: .green,
                            actionLabel: "Unstage All",
                            actionIcon: "minus.circle"
                        ) {
                            Task { await unstageAllFiles(stagedChanges.map { $0.path }) }
                        }
                    }
                }
                
                // Changes (combined unstaged + untracked)
                if !unstagedChanges.isEmpty {
                    Section {
                        if isChangesExpanded {
                            ForEach(unstagedChanges) { file in
                                unstagedFileRow(file)
                            }
                        }
                    } header: {
                        collapsibleSectionHeader(
                            title: "Changes",
                            count: unstagedChanges.count,
                            isExpanded: $isChangesExpanded,
                            accentColor: .orange,
                            actionLabel: "Stage All",
                            actionIcon: "plus.circle"
                        ) {
                            Task { await stageAllFiles(unstagedChanges.map { $0.path }) }
                        }
                    }
                }
                
                // Empty state
                if !status.hasChanges {
                    Section {
                        ContentUnavailableView {
                            Label("No Changes", systemImage: "checkmark.circle")
                        } description: {
                            Text("Working tree is clean")
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            
            // Bottom action bar
            VStack(spacing: 0) {
                // Batch undo button when files are selected
                if isSelectionMode && !selectedUnstagedPaths.isEmpty {
                    Divider()
                    
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
                        .padding(.vertical, 14)
                        .background(Color.red)
                        .foregroundStyle(.white)
                        .cornerRadius(12)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Color(.systemGroupedBackground))
                }
                
                // Commit button when there are staged changes
                if !status.staged.isEmpty && selectedUnstagedPaths.isEmpty {
                    Divider()
                    
                    Button {
                        showCommitSheet = true
                    } label: {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                            Text("Commit \(status.staged.count) file\(status.staged.count == 1 ? "" : "s")")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .cornerRadius(12)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Color(.systemGroupedBackground))
                }
            }
        }
    }
    
    @ViewBuilder
    private func collapsibleSectionHeader(
        title: String,
        count: Int,
        isExpanded: Binding<Bool>,
        accentColor: Color,
        actionLabel: String? = nil,
        actionIcon: String? = nil,
        action: (() -> Void)? = nil
    ) -> some View {
        HStack {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.wrappedValue.toggle()
                }
            } label: {
                HStack {
                    Image(systemName: isExpanded.wrappedValue ? "chevron.down" : "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(accentColor)
                        .frame(width: 16)
                    
                    Text(title)
                        .textCase(.uppercase)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    
                    Text("\(count)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(accentColor.opacity(0.8), in: Capsule())
                }
            }
            .buttonStyle(.plain)
            
            Spacer()
            
            if let actionLabel = actionLabel, let action = action {
                Button {
                    action()
                } label: {
                    HStack(spacing: 4) {
                        if let icon = actionIcon {
                            Image(systemName: icon)
                                .font(.caption2)
                        }
                        Text(actionLabel)
                            .font(.caption)
                    }
                    .foregroundStyle(accentColor)
                }
                .buttonStyle(.plain)
            }
        }
    }
    
    @ViewBuilder
    private func stagedFileRow(_ file: UnifiedFileChange) -> some View {
        HStack(spacing: 12) {
            // Unstage button - uses checkmark icon for staged files
            Button {
                Task { await unstageFile(file.path) }
            } label: {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.green)
            }
            .buttonStyle(.plain)
            
            // File info - tappable for diff
            Button {
                if let originalFile = status?.staged.first(where: { $0.path == file.path }) {
                    selectedFile = originalFile
                    selectedFileStaged = true
                    showDiffSheet = true
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
            // Selection or stage button
            if isSelectionMode {
                // Selection checkbox
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
                // Stage button
                Button {
                    print("[GitView] Stage button tapped for file: \(file.path), isUntracked: \(file.isUntracked)")
                    Task { await stageFile(file.path) }
                } label: {
                    Image(systemName: "circle")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44) // Ensure adequate tap target
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
            }
            
            // File info - tappable for viewing
            // For untracked files: shows file content
            // For tracked files: shows diff
            Button {
                if file.isUntracked {
                    // For untracked (newly added) files, show the file viewer
                    // Need to get the full path - combine project path with relative path
                    selectedUntrackedFilePath = "\(project.path)/\(file.path)"
                    showFileViewerSheet = true
                } else if let originalFile = status?.unstaged.first(where: { $0.path == file.path }) {
                    // For tracked files with changes, show the diff
                    selectedFile = originalFile
                    selectedFileStaged = false
                    showDiffSheet = true
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
                print("[GitView] Swipe-to-stage triggered for file: \(file.path)")
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
    
    // MARK: - Actions
    
    private func loadStatus() async {
        guard let api = api else { return }
        
        isLoading = true
        errorMessage = nil
        
        do {
            status = try await api.getGitStatus(projectId: project.id)
            if let status = status {
                print("[GitView] Loaded status - staged: \(status.staged.count), unstaged: \(status.unstaged.count), untracked: \(status.untracked.count)")
                print("[GitView] Untracked files: \(status.untracked)")
            }
        } catch {
            print("[GitView] loadStatus error: \(error)")
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    private func stageFile(_ path: String) async {
        print("[GitView] stageFile called with path: \(path)")
        print("[GitView] Project ID: \(project.id)")
        
        guard let api = api else {
            print("[GitView] ERROR: api is nil - serverUrl: \(authManager.serverUrl ?? "nil"), token: \(authManager.token != nil ? "exists" : "nil")")
            return
        }
        
        print("[GitView] Calling API gitStage...")
        
        do {
            let result = try await api.gitStage(projectId: project.id, files: [path])
            print("[GitView] gitStage succeeded: \(result)")
            await loadStatus()
        } catch {
            print("[GitView] gitStage FAILED: \(error)")
            operationMessage = "Failed to stage: \(error.localizedDescription)"
        }
    }
    
    private func unstageFile(_ path: String) async {
        guard let api = api else { return }
        
        do {
            _ = try await api.gitUnstage(projectId: project.id, files: [path])
            await loadStatus()
        } catch {
            operationMessage = "Failed to unstage: \(error.localizedDescription)"
        }
    }
    
    private func stageAllFiles(_ paths: [String]) async {
        guard let api = api, !paths.isEmpty else { return }
        
        do {
            _ = try await api.gitStage(projectId: project.id, files: paths)
            await loadStatus()
        } catch {
            operationMessage = "Failed to stage files: \(error.localizedDescription)"
        }
    }
    
    private func unstageAllFiles(_ paths: [String]) async {
        guard let api = api, !paths.isEmpty else { return }
        
        do {
            _ = try await api.gitUnstage(projectId: project.id, files: paths)
            await loadStatus()
        } catch {
            operationMessage = "Failed to unstage files: \(error.localizedDescription)"
        }
    }
    
    private func undoChanges(_ files: [UnifiedFileChange]) async {
        guard let api = api, !files.isEmpty else { return }
        
        // Separate tracked and untracked files
        let trackedFiles = files.filter { !$0.isUntracked }.map { $0.path }
        let untrackedFiles = files.filter { $0.isUntracked }.map { $0.path }
        
        do {
            // Discard changes for tracked files
            if !trackedFiles.isEmpty {
                _ = try await api.gitDiscard(projectId: project.id, files: trackedFiles)
            }
            
            // Clean (delete) untracked files
            if !untrackedFiles.isEmpty {
                _ = try await api.gitClean(projectId: project.id, files: untrackedFiles)
            }
            
            // Clear selection after undo
            selectedUnstagedPaths.removeAll()
            filesToUndo = []
            
            await loadStatus()
        } catch {
            operationMessage = "Failed to undo: \(error.localizedDescription)"
        }
    }
    
    private func push() async {
        guard let api = api else { return }
        
        isPushing = true
        do {
            let result = try await api.gitPush(projectId: project.id)
            operationMessage = result.output ?? "Push successful"
            await loadStatus()
        } catch {
            operationMessage = "Push failed: \(error.localizedDescription)"
        }
        isPushing = false
    }
    
    private func pull() async {
        guard let api = api else { return }
        
        isPulling = true
        do {
            let result = try await api.gitPull(projectId: project.id)
            operationMessage = result.output ?? "Pull successful"
            await loadStatus()
        } catch {
            operationMessage = "Pull failed: \(error.localizedDescription)"
        }
        isPulling = false
    }
}

#Preview {
    NavigationStack {
        GitView(project: Project(
            id: "test",
            name: "Test Project",
            path: "/test"
        ))
    }
    .environmentObject(AuthManager())
}
