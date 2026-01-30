package com.cursormobile.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.cursormobile.app.data.AuthManager
import com.cursormobile.app.data.models.FileContent
import com.cursormobile.app.data.models.FileItem
import com.cursormobile.app.data.models.Project
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilesTab(
    project: Project,
    authManager: AuthManager,
    onOpenDrawer: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var currentPath by remember { mutableStateOf(project.path) }
    var files by remember { mutableStateOf<List<FileItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedFile by remember { mutableStateOf<FileItem?>(null) }
    var fileContent by remember { mutableStateOf<FileContent?>(null) }
    var isLoadingContent by remember { mutableStateOf(false) }
    
    // Load directory contents
    fun loadDirectory(path: String) {
        scope.launch {
            isLoading = true
            error = null
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    val response = api.listDirectory(path)
                    files = response.items.sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase() }))
                    currentPath = path
                }
            } catch (e: Exception) {
                error = e.message
            } finally {
                isLoading = false
            }
        }
    }
    
    // Load file content
    fun loadFile(file: FileItem) {
        scope.launch {
            isLoadingContent = true
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    fileContent = api.readFile(file.path)
                    selectedFile = file
                }
            } catch (e: Exception) {
                error = "Failed to load file: ${e.message}"
            } finally {
                isLoadingContent = false
            }
        }
    }
    
    LaunchedEffect(project.path) {
        loadDirectory(project.path)
    }
    
    // File viewer sheet
    if (selectedFile != null && fileContent != null) {
        FileViewerSheet(
            file = selectedFile!!,
            content = fileContent!!,
            onDismiss = {
                selectedFile = null
                fileContent = null
            }
        )
        return
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Files", style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = currentPath.removePrefix(project.path).ifEmpty { "/" },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onOpenDrawer) {
                        Icon(Icons.Default.Menu, contentDescription = "Menu")
                    }
                },
                actions = {
                    // Back button if not at root
                    if (currentPath != project.path) {
                        IconButton(onClick = {
                            val parentPath = currentPath.substringBeforeLast("/")
                            if (parentPath.startsWith(project.path)) {
                                loadDirectory(parentPath)
                            }
                        }) {
                            Icon(Icons.Default.ArrowUpward, contentDescription = "Parent Directory")
                        }
                    }
                    
                    IconButton(onClick = { loadDirectory(currentPath) }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                }
            )
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
                        Button(onClick = { loadDirectory(currentPath) }) {
                            Text("Retry")
                        }
                    }
                }
                files.isEmpty() -> {
                    Text(
                        text = "Empty directory",
                        modifier = Modifier.align(Alignment.Center),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                else -> {
                    LazyColumn(
                        contentPadding = PaddingValues(bottom = 100.dp)
                    ) {
                        items(files) { file ->
                            FileItemRow(
                                file = file,
                                onClick = {
                                    if (file.isDirectory) {
                                        loadDirectory(file.path)
                                    } else {
                                        loadFile(file)
                                    }
                                }
                            )
                        }
                    }
                }
            }
            
            if (isLoadingContent) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.5f)),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
        }
    }
}

@Composable
private fun FileItemRow(
    file: FileItem,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            val icon = when {
                file.isDirectory -> Icons.Default.Folder
                file.fileExtension in listOf("kt", "java", "swift", "js", "ts", "py") -> Icons.Default.Code
                file.fileExtension in listOf("md", "txt") -> Icons.Default.Description
                file.fileExtension in listOf("json", "xml", "yaml", "yml") -> Icons.Default.DataObject
                file.fileExtension in listOf("png", "jpg", "jpeg", "gif", "svg") -> Icons.Default.Image
                else -> Icons.Default.InsertDriveFile
            }
            
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(
                        if (file.isDirectory) MaterialTheme.colorScheme.primaryContainer
                        else MaterialTheme.colorScheme.surfaceVariant
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = if (file.isDirectory) MaterialTheme.colorScheme.primary
                           else MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            
            Spacer(modifier = Modifier.width(16.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = file.name,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                
                if (!file.isDirectory) {
                    Text(
                        text = file.formattedSize,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            
            if (file.isDirectory) {
                Icon(
                    Icons.Default.ChevronRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FileViewerSheet(
    file: FileItem,
    content: FileContent,
    onDismiss: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        modifier = Modifier.fillMaxHeight(0.9f)
    ) {
        Column(
            modifier = Modifier.fillMaxSize()
        ) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Description,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = file.name,
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = "${content.language} • ${file.formattedSize}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "Close")
                }
            }
            
            Divider()
            
            // Content
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
                    val lines = content.content.lines()
                    items(lines.size) { index ->
                        Row {
                            Text(
                                text = "${index + 1}".padStart(4),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
                            )
                            Spacer(modifier = Modifier.width(16.dp))
                            Text(
                                text = lines[index],
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
                            )
                        }
                    }
                }
            }
        }
    }
}
