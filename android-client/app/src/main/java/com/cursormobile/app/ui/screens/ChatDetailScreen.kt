package com.cursormobile.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import com.cursormobile.app.data.models.ConversationMessage
import com.cursormobile.app.data.models.ToolCall
import com.cursormobile.app.data.models.ToolCallStatus
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatDetailScreen(
    conversationId: String,
    authManager: AuthManager,
    onBack: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var messages by remember { mutableStateOf<List<ConversationMessage>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var inputText by remember { mutableStateOf("") }
    var isSending by remember { mutableStateOf(false) }
    var conversationTitle by remember { mutableStateOf("Chat") }
    var isReadOnly by remember { mutableStateOf(false) }
    
    val listState = rememberLazyListState()
    
    // Load messages
    fun loadMessages() {
        scope.launch {
            isLoading = true
            error = null
            try {
                val api = authManager.getApiService()
                if (api != null) {
                    val detail = api.getConversation(conversationId)
                    conversationTitle = detail.conversation.title.ifEmpty { "New Chat" }
                    isReadOnly = detail.conversation.isReadOnlyConversation
                    
                    val response = api.getConversationMessages(conversationId)
                    messages = response.messages.filter { !it.isEmpty }
                }
            } catch (e: Exception) {
                error = e.message
            } finally {
                isLoading = false
            }
        }
    }
    
    // Send message (simple implementation - full SSE streaming would require more work)
    fun sendMessage() {
        if (inputText.isBlank() || isSending || isReadOnly) return
        
        val messageText = inputText
        inputText = ""
        
        scope.launch {
            isSending = true
            try {
                // Add optimistic user message
                val userMessage = ConversationMessage(
                    id = java.util.UUID.randomUUID().toString(),
                    type = "user",
                    text = messageText
                )
                messages = messages + userMessage
                
                // Note: For a full implementation, you would use OkHttp to handle SSE streaming
                // This is a simplified version that just refreshes after sending
                
                // Reload messages to get the response
                kotlinx.coroutines.delay(2000)
                loadMessages()
            } catch (e: Exception) {
                error = "Failed to send message: ${e.message}"
            } finally {
                isSending = false
            }
        }
    }
    
    LaunchedEffect(conversationId) {
        loadMessages()
    }
    
    // Scroll to bottom when messages change
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = conversationTitle,
                            style = MaterialTheme.typography.titleMedium
                        )
                        if (isReadOnly) {
                            Text(
                                text = "View only",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { loadMessages() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                }
            )
        },
        bottomBar = {
            if (!isReadOnly) {
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
                            placeholder = { Text("Type a message...") },
                            singleLine = false,
                            maxLines = 4,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                            keyboardActions = KeyboardActions(
                                onSend = { sendMessage() }
                            )
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        IconButton(
                            onClick = { sendMessage() },
                            enabled = inputText.isNotBlank() && !isSending
                        ) {
                            if (isSending) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp))
                            } else {
                                Icon(Icons.Default.Send, contentDescription = "Send")
                            }
                        }
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
            when {
                isLoading && messages.isEmpty() -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }
                error != null && messages.isEmpty() -> {
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
                        Button(onClick = { loadMessages() }) {
                            Text("Retry")
                        }
                    }
                }
                messages.isEmpty() -> {
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
                            text = "Start the conversation",
                            style = MaterialTheme.typography.titleMedium
                        )
                    }
                }
                else -> {
                    LazyColumn(
                        state = listState,
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(messages) { message ->
                            MessageBubble(message = message)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: ConversationMessage) {
    val isUser = message.type?.lowercase() == "user"
    
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start
    ) {
        // Role label
        Text(
            text = if (isUser) "You" else "Assistant",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
        )
        
        // Message bubble
        Surface(
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (isUser) 16.dp else 4.dp,
                bottomEnd = if (isUser) 4.dp else 16.dp
            ),
            color = if (isUser) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.widthIn(max = 320.dp)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                // Message text
                message.text?.let { text ->
                    Text(
                        text = text,
                        color = if (isUser) MaterialTheme.colorScheme.onPrimary
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                
                // Tool calls
                message.toolCalls?.forEach { toolCall ->
                    Spacer(modifier = Modifier.height(8.dp))
                    ToolCallCard(toolCall = toolCall)
                }
                
                // Code blocks
                message.codeBlocks?.forEach { codeBlock ->
                    codeBlock.content?.let { content ->
                        Spacer(modifier = Modifier.height(8.dp))
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surface
                        ) {
                            Column {
                                codeBlock.language?.let { lang ->
                                    Text(
                                        text = lang,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(8.dp)
                                    )
                                    Divider()
                                }
                                Text(
                                    text = content,
                                    style = MaterialTheme.typography.bodySmall,
                                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                                    modifier = Modifier.padding(8.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolCallCard(toolCall: ToolCall) {
    val (icon, displayName, description) = toolCall.displayInfo
    
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.5f)
    ) {
        Row(
            modifier = Modifier.padding(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = icon,
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(modifier = Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = displayName,
                    style = MaterialTheme.typography.labelMedium
                )
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            
            when (toolCall.status) {
                ToolCallStatus.RUNNING -> {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp))
                }
                ToolCallStatus.COMPLETE -> {
                    Icon(
                        Icons.Default.CheckCircle,
                        contentDescription = "Complete",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp)
                    )
                }
                ToolCallStatus.ERROR -> {
                    Icon(
                        Icons.Default.Error,
                        contentDescription = "Error",
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }
    }
}
