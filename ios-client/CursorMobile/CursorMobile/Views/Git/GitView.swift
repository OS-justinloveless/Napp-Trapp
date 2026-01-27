import SwiftUI

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
    @State private var isPushing = false
    @State private var isPulling = false
    @State private var operationMessage: String?
    
    // Section collapse states
    @State private var isStagedExpanded = true
    @State private var isUnstagedExpanded = true
    @State private var isUntrackedExpanded = true
    
    private var api: APIService? {
        guard let serverUrl = authManager.serverUrl,
              let token = authManager.token else { return nil }
        return APIService(serverUrl: serverUrl, token: token)
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
                if !status.staged.isEmpty {
                    Section {
                        if isStagedExpanded {
                            ForEach(status.staged) { file in
                                fileRow(file, staged: true)
                            }
                        }
                    } header: {
                        collapsibleSectionHeader(
                            title: "Staged Changes",
                            count: status.staged.count,
                            isExpanded: $isStagedExpanded,
                            accentColor: .green,
                            actionLabel: "Unstage All",
                            actionIcon: "minus.circle"
                        ) {
                            Task { await unstageAllFiles(status.staged.map { $0.path }) }
                        }
                    }
                }
                
                // Unstaged changes
                if !status.unstaged.isEmpty {
                    Section {
                        if isUnstagedExpanded {
                            ForEach(status.unstaged) { file in
                                fileRow(file, staged: false)
                            }
                        }
                    } header: {
                        collapsibleSectionHeader(
                            title: "Changes",
                            count: status.unstaged.count,
                            isExpanded: $isUnstagedExpanded,
                            accentColor: .orange,
                            actionLabel: "Stage All",
                            actionIcon: "plus.circle"
                        ) {
                            Task { await stageAllFiles(status.unstaged.map { $0.path }) }
                        }
                    }
                }
                
                // Untracked files
                if !status.untracked.isEmpty {
                    Section {
                        if isUntrackedExpanded {
                            ForEach(status.untracked, id: \.self) { file in
                                untrackedFileRow(file)
                            }
                        }
                    } header: {
                        collapsibleSectionHeader(
                            title: "Untracked Files",
                            count: status.untracked.count,
                            isExpanded: $isUntrackedExpanded,
                            accentColor: .gray,
                            actionLabel: "Stage All",
                            actionIcon: "plus.circle"
                        ) {
                            Task { await stageAllFiles(status.untracked) }
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
            
            // Floating commit button at bottom
            if !status.staged.isEmpty {
                VStack(spacing: 0) {
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
    private func fileRow(_ file: GitFileChange, staged: Bool) -> some View {
        HStack(spacing: 12) {
            // Stage/Unstage button
            Button {
                Task {
                    if staged {
                        await unstageFile(file.path)
                    } else {
                        await stageFile(file.path)
                    }
                }
            } label: {
                Image(systemName: staged ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(staged ? .green : .secondary)
            }
            .buttonStyle(.plain)
            
            // File info - tappable for diff
            Button {
                selectedFile = file
                selectedFileStaged = staged
                showDiffSheet = true
            } label: {
                HStack {
                    Image(systemName: file.statusIcon)
                        .foregroundStyle(statusColor(for: file))
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
            if staged {
                Button {
                    Task { await unstageFile(file.path) }
                } label: {
                    Label("Unstage", systemImage: "minus.circle")
                }
                .tint(.orange)
            } else {
                Button {
                    Task { await stageFile(file.path) }
                } label: {
                    Label("Stage", systemImage: "plus.circle")
                }
                .tint(.green)
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            if !staged {
                Button(role: .destructive) {
                    Task { await discardFile(file.path) }
                } label: {
                    Label("Discard", systemImage: "trash")
                }
            }
        }
    }
    
    @ViewBuilder
    private func untrackedFileRow(_ path: String) -> some View {
        HStack(spacing: 12) {
            // Stage button
            Button {
                Task { await stageFile(path) }
            } label: {
                Image(systemName: "circle")
                    .font(.title2)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            
            // File info
            HStack {
                Image(systemName: "questionmark.circle")
                    .foregroundStyle(.gray)
                    .frame(width: 24)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(path.components(separatedBy: "/").last ?? path)
                        .foregroundStyle(.primary)
                    if path.contains("/") {
                        Text(path.components(separatedBy: "/").dropLast().joined(separator: "/"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                
                Spacer()
                
                Text("Untracked")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button {
                Task { await stageFile(path) }
            } label: {
                Label("Stage", systemImage: "plus.circle")
            }
            .tint(.green)
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
    
    // MARK: - Actions
    
    private func loadStatus() async {
        guard let api = api else { return }
        
        isLoading = true
        errorMessage = nil
        
        do {
            status = try await api.getGitStatus(projectId: project.id)
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    private func stageFile(_ path: String) async {
        guard let api = api else { return }
        
        do {
            _ = try await api.gitStage(projectId: project.id, files: [path])
            await loadStatus()
        } catch {
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
    
    private func discardFile(_ path: String) async {
        guard let api = api else { return }
        
        do {
            _ = try await api.gitDiscard(projectId: project.id, files: [path])
            await loadStatus()
        } catch {
            operationMessage = "Failed to discard: \(error.localizedDescription)"
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
