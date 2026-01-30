@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.cursormobile.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.cursormobile.app.data.AuthManager
import com.cursormobile.app.data.models.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GitTab(
    project: Project,
    authManager: AuthManager,
    onOpenDrawer: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var gitStatus by remember { mutableStateOf<GitStatus?>(null) }
    var branches by remember { mutableStateOf<List<GitBranch>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var showCommitSheet by remember { mutableStateOf(false) }
    var showBranchSheet by remember { mutableStateOf(false) }
    var selectedDiffFile by remember { mutableStateOf<String?>(null) }
    var diffContent by remember { mutableStateOf<String?>(null) }
    
    // Load git status
    fun loadGitStatus() {
        scope.launch {
            isLoading = true
            error = null
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    gitStatus = api.getGitStatus(project.id)
                    val branchResponse = api.getGitBranches(project.id)
                    branches = branchResponse.branches
                }
            } catch (e: Exception) {
                error = e.message
            } finally {
                isLoading = false
            }
        }
    }
    
    // Stage file
    fun stageFile(path: String) {
        scope.launch {
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    api.gitStage(project.id, GitStageRequest(listOf(path)))
                    loadGitStatus()
                }
            } catch (e: Exception) {
                error = e.message
            }
        }
    }
    
    // Unstage file
    fun unstageFile(path: String) {
        scope.launch {
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    api.gitUnstage(project.id, GitStageRequest(listOf(path)))
                    loadGitStatus()
                }
            } catch (e: Exception) {
                error = e.message
            }
        }
    }
    
    // Discard changes
    fun discardChanges(path: String) {
        scope.launch {
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    api.gitDiscard(project.id, GitStageRequest(listOf(path)))
                    loadGitStatus()
                }
            } catch (e: Exception) {
                error = e.message
            }
        }
    }
    
    // Load diff
    fun loadDiff(path: String, staged: Boolean) {
        scope.launch {
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    val response = api.gitDiff(project.id, path, staged)
                    diffContent = response.diff
                    selectedDiffFile = path
                }
            } catch (e: Exception) {
                error = e.message
            }
        }
    }
    
    LaunchedEffect(project.id) {
        loadGitStatus()
    }
    
    // Diff sheet
    if (selectedDiffFile != null && diffContent != null) {
        DiffSheet(
            fileName = selectedDiffFile!!,
            diff = diffContent!!,
            onDismiss = {
                selectedDiffFile = null
                diffContent = null
            }
        )
        return
    }
    
    // Commit sheet
    if (showCommitSheet) {
        CommitSheet(
            project = project,
            authManager = authManager,
            onDismiss = { showCommitSheet = false },
            onCommitSuccess = {
                showCommitSheet = false
                loadGitStatus()
            }
        )
    }
    
    // Branch sheet
    if (showBranchSheet) {
        BranchSheet(
            project = project,
            authManager = authManager,
            branches = branches,
            currentBranch = gitStatus?.branch ?: "",
            onDismiss = { showBranchSheet = false },
            onBranchChanged = {
                showBranchSheet = false
                loadGitStatus()
            }
        )
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Git") },
                navigationIcon = {
                    IconButton(onClick = onOpenDrawer) {
                        Icon(Icons.Default.Menu, contentDescription = "Menu")
                    }
                },
                actions = {
                    IconButton(onClick = { loadGitStatus() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                }
            )
        },
        floatingActionButton = {
            if (gitStatus?.staged?.isNotEmpty() == true) {
                ExtendedFloatingActionButton(
                    onClick = { showCommitSheet = true },
                    icon = { Icon(Icons.Default.Check, contentDescription = null) },
                    text = { Text("Commit") }
                )
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                isLoading -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }
                error != null -> {
                    Column(
                        modifier = Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            Icons.Default.Error,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(error ?: "Unknown error", color = MaterialTheme.colorScheme.error)
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(onClick = { loadGitStatus() }) {
                            Text("Retry")
                        }
                    }
                }
                gitStatus == null -> {
                    Text(
                        text = "Not a git repository",
                        modifier = Modifier.align(Alignment.Center),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                else -> {
                    val status = gitStatus!!
                    
                    LazyColumn(
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        // Branch info
                        item {
                            Card(
                                onClick = { showBranchSheet = true },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier.padding(16.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.AccountTree,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = status.branch,
                                            style = MaterialTheme.typography.titleMedium
                                        )
                                        if (status.ahead > 0 || status.behind > 0) {
                                            Text(
                                                text = buildString {
                                                    if (status.ahead > 0) append("↑${status.ahead}")
                                                    if (status.ahead > 0 && status.behind > 0) append(" ")
                                                    if (status.behind > 0) append("↓${status.behind}")
                                                },
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                    }
                                    Icon(
                                        Icons.Default.ChevronRight,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                        
                        // Staged changes
                        if (status.staged.isNotEmpty()) {
                            item {
                                Text(
                                    text = "Staged Changes (${status.staged.size})",
                                    style = MaterialTheme.typography.titleSmall,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                            items(status.staged) { change ->
                                GitChangeItem(
                                    change = change,
                                    isStaged = true,
                                    onStageToggle = { unstageFile(change.path) },
                                    onViewDiff = { loadDiff(change.path, true) },
                                    onDiscard = null
                                )
                            }
                        }
                        
                        // Unstaged changes
                        if (status.unstaged.isNotEmpty()) {
                            item {
                                Text(
                                    text = "Changes (${status.unstaged.size})",
                                    style = MaterialTheme.typography.titleSmall,
                                    color = MaterialTheme.colorScheme.secondary
                                )
                            }
                            items(status.unstaged) { change ->
                                GitChangeItem(
                                    change = change,
                                    isStaged = false,
                                    onStageToggle = { stageFile(change.path) },
                                    onViewDiff = { loadDiff(change.path, false) },
                                    onDiscard = { discardChanges(change.path) }
                                )
                            }
                        }
                        
                        // Untracked files
                        if (status.untracked.isNotEmpty()) {
                            item {
                                Text(
                                    text = "Untracked (${status.untracked.size})",
                                    style = MaterialTheme.typography.titleSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            items(status.untracked) { path ->
                                UntrackedFileItem(
                                    path = path,
                                    onStage = { stageFile(path) }
                                )
                            }
                        }
                        
                        // No changes
                        if (status.staged.isEmpty() && status.unstaged.isEmpty() && status.untracked.isEmpty()) {
                            item {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(32.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally
                                ) {
                                    Icon(
                                        Icons.Default.CheckCircle,
                                        contentDescription = null,
                                        modifier = Modifier.size(48.dp),
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                    Spacer(modifier = Modifier.height(16.dp))
                                    Text(
                                        text = "Working tree clean",
                                        style = MaterialTheme.typography.titleMedium
                                    )
                                    Text(
                                        text = "No uncommitted changes",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                        
                        item {
                            Spacer(modifier = Modifier.height(80.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GitChangeItem(
    change: GitFileChange,
    isStaged: Boolean,
    onStageToggle: () -> Unit,
    onViewDiff: () -> Unit,
    onDiscard: (() -> Unit)?
) {
    var showMenu by remember { mutableStateOf(false) }
    
    Card(
        onClick = onViewDiff,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Status indicator
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(
                        when (change.status) {
                            "M" -> Color(0xFFFFA726)
                            "A" -> Color(0xFF66BB6A)
                            "D" -> Color(0xFFEF5350)
                            else -> MaterialTheme.colorScheme.surfaceVariant
                        }
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = change.status,
                    style = MaterialTheme.typography.labelMedium,
                    color = Color.White
                )
            }
            
            Spacer(modifier = Modifier.width(12.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = change.path.substringAfterLast("/"),
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = change.path.substringBeforeLast("/", ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            
            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(Icons.Default.MoreVert, contentDescription = "More options")
                }
                
                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false }
                ) {
                    DropdownMenuItem(
                        text = { Text(if (isStaged) "Unstage" else "Stage") },
                        onClick = {
                            showMenu = false
                            onStageToggle()
                        },
                        leadingIcon = {
                            Icon(
                                if (isStaged) Icons.Default.Remove else Icons.Default.Add,
                                contentDescription = null
                            )
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("View Diff") },
                        onClick = {
                            showMenu = false
                            onViewDiff()
                        },
                        leadingIcon = {
                            Icon(Icons.Default.Difference, contentDescription = null)
                        }
                    )
                    if (onDiscard != null) {
                        DropdownMenuItem(
                            text = { Text("Discard Changes") },
                            onClick = {
                                showMenu = false
                                onDiscard()
                            },
                            leadingIcon = {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.error
                                )
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun UntrackedFileItem(
    path: String,
    onStage: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "?",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            
            Spacer(modifier = Modifier.width(12.dp))
            
            Text(
                text = path.substringAfterLast("/"),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            
            IconButton(onClick = onStage) {
                Icon(Icons.Default.Add, contentDescription = "Stage")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DiffSheet(
    fileName: String,
    diff: String,
    onDismiss: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        modifier = Modifier.fillMaxHeight(0.9f)
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Difference,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = fileName.substringAfterLast("/"),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "Close")
                }
            }
            
            Divider()
            
            Surface(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(8.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(8.dp)
            ) {
                LazyColumn(
                    modifier = Modifier.padding(12.dp)
                ) {
                    val lines = diff.lines()
                    items(lines.size) { index ->
                        val line = lines[index]
                        val backgroundColor = when {
                            line.startsWith("+") && !line.startsWith("+++") -> Color(0xFF1A3D1A)
                            line.startsWith("-") && !line.startsWith("---") -> Color(0xFF3D1A1A)
                            line.startsWith("@@") -> Color(0xFF1A1A3D)
                            else -> Color.Transparent
                        }
                        
                        Text(
                            text = line,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(backgroundColor)
                                .padding(horizontal = 4.dp, vertical = 1.dp)
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CommitSheet(
    project: Project,
    authManager: AuthManager,
    onDismiss: () -> Unit,
    onCommitSuccess: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf("") }
    var isCommitting by remember { mutableStateOf(false) }
    var isGenerating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    
    fun generateMessage() {
        scope.launch {
            isGenerating = true
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    val response = api.generateCommitMessage(project.id)
                    message = response.message
                }
            } catch (e: Exception) {
                error = e.message
            } finally {
                isGenerating = false
            }
        }
    }
    
    fun commit() {
        if (message.isBlank()) return
        scope.launch {
            isCommitting = true
            error = null
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    val response = api.gitCommit(project.id, GitCommitRequest(message))
                    if (response.success) {
                        onCommitSuccess()
                    } else {
                        error = response.error ?: "Commit failed"
                    }
                }
            } catch (e: Exception) {
                error = e.message
            } finally {
                isCommitting = false
            }
        }
    }
    
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Commit Changes") },
        text = {
            Column {
                OutlinedTextField(
                    value = message,
                    onValueChange = { message = it },
                    label = { Text("Commit message") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    maxLines = 5
                )
                
                Spacer(modifier = Modifier.height(8.dp))
                
                TextButton(
                    onClick = { generateMessage() },
                    enabled = !isGenerating
                ) {
                    if (isGenerating) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                    Icon(Icons.Default.AutoAwesome, contentDescription = null)
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Generate with AI")
                }
                
                error?.let {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(it, color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { commit() },
                enabled = message.isNotBlank() && !isCommitting
            ) {
                if (isCommitting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Text("Commit")
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BranchSheet(
    project: Project,
    authManager: AuthManager,
    branches: List<GitBranch>,
    currentBranch: String,
    onDismiss: () -> Unit,
    onBranchChanged: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var isSwitching by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    
    fun switchBranch(branch: String) {
        scope.launch {
            isSwitching = true
            error = null
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    val response = api.gitCheckout(project.id, GitCheckoutRequest(branch))
                    if (response.success) {
                        onBranchChanged()
                    } else {
                        error = response.error ?: "Failed to switch branch"
                    }
                }
            } catch (e: Exception) {
                error = e.message
            } finally {
                isSwitching = false
            }
        }
    }
    
    val sheetState = rememberModalBottomSheetState()
    
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = "Branches",
                style = MaterialTheme.typography.titleLarge
            )
            
            Spacer(modifier = Modifier.height(16.dp))
            
            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error)
                Spacer(modifier = Modifier.height(8.dp))
            }
            
            if (isSwitching) {
                Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else {
                branches.forEach { branch ->
                    val isCurrent = branch.name == currentBranch
                    
                    Surface(
                        onClick = { if (!isCurrent) switchBranch(branch.name) },
                        modifier = Modifier.fillMaxWidth(),
                        color = if (isCurrent) MaterialTheme.colorScheme.primaryContainer
                                else MaterialTheme.colorScheme.surface
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.AccountTree,
                                contentDescription = null,
                                tint = if (isCurrent) MaterialTheme.colorScheme.primary
                                       else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Text(
                                text = branch.name,
                                style = MaterialTheme.typography.bodyLarge,
                                modifier = Modifier.weight(1f)
                            )
                            if (isCurrent) {
                                Icon(
                                    Icons.Default.Check,
                                    contentDescription = "Current",
                                    tint = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }
                }
            }
            
            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}
