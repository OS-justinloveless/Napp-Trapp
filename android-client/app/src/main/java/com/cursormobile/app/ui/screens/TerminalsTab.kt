@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.cursormobile.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.cursormobile.app.data.AuthManager
import com.cursormobile.app.data.models.Project
import com.cursormobile.app.data.models.Terminal
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalsTab(
    project: Project,
    authManager: AuthManager,
    onOpenDrawer: () -> Unit,
    onTerminalViewActiveChange: (Boolean) -> Unit
) {
    val scope = rememberCoroutineScope()
    var terminals by remember { mutableStateOf<List<Terminal>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedTerminal by remember { mutableStateOf<Terminal?>(null) }
    
    // Load terminals
    fun loadTerminals() {
        scope.launch {
            isLoading = true
            error = null
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    val response = api.getTerminals(project.path)
                    terminals = response.terminals
                }
            } catch (e: Exception) {
                error = e.message
            } finally {
                isLoading = false
            }
        }
    }
    
    LaunchedEffect(project.path) {
        loadTerminals()
    }
    
    // Terminal view
    if (selectedTerminal != null) {
        onTerminalViewActiveChange(true)
        TerminalView(
            terminal = selectedTerminal!!,
            project = project,
            authManager = authManager,
            onBack = {
                selectedTerminal = null
                onTerminalViewActiveChange(false)
                loadTerminals()
            }
        )
        return
    }
    
    onTerminalViewActiveChange(false)
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Terminals") },
                navigationIcon = {
                    IconButton(onClick = onOpenDrawer) {
                        Icon(Icons.Default.Menu, contentDescription = "Menu")
                    }
                },
                actions = {
                    IconButton(onClick = { loadTerminals() }) {
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
                        Button(onClick = { loadTerminals() }) {
                            Text("Retry")
                        }
                    }
                }
                terminals.isEmpty() -> {
                    Column(
                        modifier = Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            Icons.Default.Terminal,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "No terminals open",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            text = "Open a terminal in Cursor IDE",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                else -> {
                    LazyColumn(
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(terminals) { terminal ->
                            TerminalCard(
                                terminal = terminal,
                                onClick = { selectedTerminal = terminal }
                            )
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
private fun TerminalCard(
    terminal: Terminal,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(
                        if (terminal.active) MaterialTheme.colorScheme.primaryContainer
                        else MaterialTheme.colorScheme.surfaceVariant
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.Terminal,
                    contentDescription = null,
                    tint = if (terminal.active) MaterialTheme.colorScheme.primary
                           else MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            
            Spacer(modifier = Modifier.width(16.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = terminal.name,
                    style = MaterialTheme.typography.titleSmall
                )
                Text(
                    text = terminal.cwd.substringAfterLast("/"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(
                                when {
                                    terminal.active -> MaterialTheme.colorScheme.primary
                                    terminal.exitCode == 0 -> MaterialTheme.colorScheme.tertiary
                                    terminal.exitCode != null -> MaterialTheme.colorScheme.error
                                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                                }
                            )
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = terminal.statusText,
                        style = MaterialTheme.typography.labelSmall,
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TerminalView(
    terminal: Terminal,
    project: Project,
    authManager: AuthManager,
    onBack: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var content by remember { mutableStateOf("") }
    var inputText by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(true) }
    val scrollState = rememberScrollState()
    
    // Load terminal content
    fun loadContent() {
        scope.launch {
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    val response = api.getTerminalContent(terminal.id, project.path)
                    content = response.content
                }
            } catch (e: Exception) {
                content = "Error loading terminal content: ${e.message}"
            } finally {
                isLoading = false
            }
        }
    }
    
    // Send input to terminal
    fun sendInput(text: String) {
        scope.launch {
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    val request = com.cursormobile.app.data.models.TerminalInputRequest(
                        data = text + "\n",
                        projectPath = project.path
                    )
                    api.sendTerminalInput(terminal.id, request)
                    inputText = ""
                    delay(100)
                    loadContent()
                }
            } catch (e: Exception) {
                // Handle error
            }
        }
    }
    
    LaunchedEffect(terminal.id) {
        loadContent()
    }
    
    // Auto-refresh content
    LaunchedEffect(terminal.id) {
        while (true) {
            delay(2000)
            loadContent()
        }
    }
    
    // Auto-scroll to bottom
    LaunchedEffect(content) {
        scrollState.animateScrollTo(scrollState.maxValue)
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(terminal.name, style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = terminal.statusText,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { loadContent() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                }
            )
        },
        bottomBar = {
            Surface(
                tonalElevation = 2.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .padding(8.dp)
                        .fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("Enter command...") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(
                            onSend = { sendInput(inputText) }
                        )
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    IconButton(
                        onClick = { sendInput(inputText) },
                        enabled = inputText.isNotBlank()
                    ) {
                        Icon(Icons.Default.Send, contentDescription = "Send")
                    }
                }
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (isLoading) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            } else {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(8.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        text = content.ifEmpty { "Terminal output will appear here..." },
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(12.dp)
                            .verticalScroll(scrollState),
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
                    )
                }
            }
        }
    }
}
