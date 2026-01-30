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
import androidx.compose.material3.CardDefaults
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.cursormobile.app.data.AuthManager
import com.cursormobile.app.data.models.ChatMode
import com.cursormobile.app.data.models.Conversation
import com.cursormobile.app.data.models.Project
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatTab(
    project: Project,
    authManager: AuthManager,
    onOpenDrawer: () -> Unit,
    onNavigateToChat: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var conversations by remember { mutableStateOf<List<Conversation>>(emptyList()) }
    var totalTokens by remember { mutableStateOf<Int?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var showNewChatSheet by remember { mutableStateOf(false) }
    
    // Load conversations
    fun loadConversations() {
        scope.launch {
            isLoading = true
            error = null
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    val response = api.getProjectConversations(project.id)
                    conversations = response.conversations.sortedByDescending { it.timestamp }
                    totalTokens = response.totalTokens
                }
            } catch (e: Exception) {
                error = e.message
            } finally {
                isLoading = false
            }
        }
    }
    
    LaunchedEffect(project.id) {
        loadConversations()
    }
    
    // New chat sheet
    if (showNewChatSheet) {
        NewChatSheet(
            project = project,
            authManager = authManager,
            onDismiss = { showNewChatSheet = false },
            onChatCreated = { chatId ->
                showNewChatSheet = false
                onNavigateToChat(chatId)
            }
        )
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Chat") },
                navigationIcon = {
                    IconButton(onClick = onOpenDrawer) {
                        Icon(Icons.Default.Menu, contentDescription = "Menu")
                    }
                },
                actions = {
                    IconButton(onClick = { loadConversations() }) {
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
                        Button(onClick = { loadConversations() }) {
                            Text("Retry")
                        }
                    }
                }
                conversations.isEmpty() -> {
                    Column(
                        modifier = Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            Icons.Default.Chat,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "No conversations yet",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            text = "Start a new chat to get started",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(onClick = { showNewChatSheet = true }) {
                            Icon(Icons.Default.Add, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("New Chat")
                        }
                    }
                }
                else -> {
                    LazyColumn(
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Token summary card at the top
                        item {
                            TokenSummaryCard(
                                totalTokens = totalTokens,
                                conversationCount = conversations.size
                            )
                        }
                        
                        items(conversations) { conversation ->
                            ConversationCard(
                                conversation = conversation,
                                onClick = { onNavigateToChat(conversation.id) }
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
private fun TokenSummaryCard(
    totalTokens: Int?,
    conversationCount: Int
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "Token Usage",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                Text(
                    text = "$conversationCount conversation${if (conversationCount != 1) "s" else ""}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                )
            }
            
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = formatTokenCount(totalTokens ?: 0),
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                Text(
                    text = "estimated tokens",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                )
            }
        }
    }
}

private fun formatTokenCount(tokens: Int): String {
    return when {
        tokens >= 1_000_000 -> String.format("%.1fM", tokens / 1_000_000.0)
        tokens >= 1_000 -> String.format("%.1fK", tokens / 1_000.0)
        else -> tokens.toString()
    }
}

@Composable
private fun ConversationCard(
    conversation: Conversation,
    onClick: () -> Unit
) {
    val dateFormatter = SimpleDateFormat("MMM d, h:mm a", Locale.getDefault())
    
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
                        if (conversation.isReadOnlyConversation) MaterialTheme.colorScheme.surfaceVariant
                        else MaterialTheme.colorScheme.primaryContainer
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    if (conversation.isReadOnlyConversation) Icons.Default.Lock else Icons.Default.Chat,
                    contentDescription = null,
                    tint = if (conversation.isReadOnlyConversation) MaterialTheme.colorScheme.onSurfaceVariant
                           else MaterialTheme.colorScheme.primary
                )
            }
            
            Spacer(modifier = Modifier.width(16.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = conversation.title.ifEmpty { "New Conversation" },
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                
                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "${conversation.messageCount} messages",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    
                    conversation.estimatedTokens?.let { tokens ->
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "• ${formatTokenCount(tokens)} tokens",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    
                    if (conversation.isReadOnlyConversation) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "• Cursor IDE",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                
                Text(
                    text = dateFormatter.format(conversation.lastModified),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
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
private fun NewChatSheet(
    project: Project,
    authManager: AuthManager,
    onDismiss: () -> Unit,
    onChatCreated: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var selectedMode by remember { mutableStateOf(ChatMode.AGENT) }
    var isCreating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    
    fun createChat() {
        scope.launch {
            isCreating = true
            error = null
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    val body = mapOf(
                        "workspaceId" to project.id,
                        "mode" to selectedMode.value
                    )
                    val response = api.createConversation(body)
                    onChatCreated(response.chatId)
                }
            } catch (e: Exception) {
                error = e.message
            } finally {
                isCreating = false
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
                text = "New Chat",
                style = MaterialTheme.typography.titleLarge
            )
            
            Text(
                text = "in ${project.name}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            
            Spacer(modifier = Modifier.height(24.dp))
            
            Text(
                text = "Mode",
                style = MaterialTheme.typography.titleSmall
            )
            
            Spacer(modifier = Modifier.height(8.dp))
            
            ChatMode.entries.forEach { mode ->
                val isSelected = selectedMode == mode
                
                Surface(
                    onClick = { selectedMode = mode },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = if (isSelected) MaterialTheme.colorScheme.primaryContainer
                            else MaterialTheme.colorScheme.surface,
                    border = if (isSelected) null 
                             else ButtonDefaults.outlinedButtonBorder
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = isSelected,
                            onClick = { selectedMode = mode }
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = mode.displayName,
                                style = MaterialTheme.typography.titleSmall
                            )
                            Text(
                                text = mode.description,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                
                Spacer(modifier = Modifier.height(8.dp))
            }
            
            error?.let {
                Spacer(modifier = Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error)
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            Button(
                onClick = { createChat() },
                modifier = Modifier.fillMaxWidth(),
                enabled = !isCreating
            ) {
                if (isCreating) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Icon(Icons.Default.Add, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Start Chat")
                }
            }
            
            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}
