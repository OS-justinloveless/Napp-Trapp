package com.cursormobile.app.data.models

import java.util.Date

data class Conversation(
    val id: String,
    val type: String,
    val title: String,
    val timestamp: Double,
    val messageCount: Int,
    val workspaceId: String,
    val source: String,
    val projectName: String? = null,
    val workspaceFolder: String? = null,
    val isProjectChat: Boolean? = null,
    val isReadOnly: Boolean? = null,
    val readOnlyReason: String? = null,
    val canFork: Boolean? = null,
    val estimatedTokens: Int? = null
) {
    val displayName: String get() = projectName ?: "Global"
    val lastModified: Date get() = Date((timestamp).toLong())
    val isGlobalChat: Boolean get() = !(isProjectChat ?: true)
    val isReadOnlyConversation: Boolean get() = isReadOnly ?: (source != "mobile")
    val canForkConversation: Boolean get() = canFork ?: (isReadOnlyConversation && messageCount > 0)
}

data class ConversationsResponse(
    val conversations: List<Conversation>,
    val totalTokens: Int? = null
)

data class ConversationDetail(
    val conversation: Conversation
)

data class ConversationMessage(
    val id: String? = null,
    val type: String? = null,
    val text: String? = null,
    val timestamp: Double? = null,
    val modelType: String? = null,
    val codeBlocks: List<CodeBlock>? = null,
    val selections: List<String>? = null,
    val relevantFiles: List<String>? = null,
    var toolCalls: List<ToolCall>? = null,
    var attachments: List<MessageAttachment>? = null
) {
    val messageId: String get() = id ?: java.util.UUID.randomUUID().toString()
    val isAssistant: Boolean get() = type?.lowercase() == "assistant"
    val content: String? get() = text
    val role: String? get() = type
    
    val isEmpty: Boolean get() {
        val hasText = !text?.trim().isNullOrEmpty()
        val hasToolCalls = !toolCalls.isNullOrEmpty()
        val hasCodeBlocks = !codeBlocks.isNullOrEmpty()
        return !hasText && !hasToolCalls && !hasCodeBlocks
    }
    
    data class CodeBlock(
        val type: String? = null,
        val language: String? = null,
        val content: String? = null,
        val diffId: String? = null
    )
}

data class MessageAttachment(
    val id: String,
    val type: AttachmentType,
    val filename: String,
    val mimeType: String,
    val size: Int? = null,
    val data: String? = null,
    val url: String? = null,
    val thumbnailData: String? = null
) {
    val displayName: String get() = filename
    val isImage: Boolean get() = type == AttachmentType.IMAGE
}

enum class AttachmentType {
    IMAGE, DOCUMENT, FILE
}

data class ToolCall(
    val id: String,
    val name: String,
    var input: Map<String, Any?>? = null,
    var status: ToolCallStatus = ToolCallStatus.RUNNING,
    var result: String? = null
) {
    val displayInfo: Triple<String, String, String>
        get() {
            val inputMap = input ?: emptyMap()
            return when (name) {
                "Read" -> {
                    val path = inputMap["path"]?.toString() ?: ""
                    val fileName = path.substringAfterLast("/")
                    Triple("📄", "Read File", if (fileName.isEmpty()) "Reading file" else "Reading $fileName")
                }
                "Write" -> {
                    val path = inputMap["path"]?.toString() ?: ""
                    val fileName = path.substringAfterLast("/")
                    Triple("✏️", "Write File", if (fileName.isEmpty()) "Writing file" else "Writing to $fileName")
                }
                "Edit", "StrReplace" -> {
                    val path = inputMap["path"]?.toString() ?: ""
                    val fileName = path.substringAfterLast("/")
                    Triple("🔧", "Edit File", if (fileName.isEmpty()) "Editing file" else "Editing $fileName")
                }
                "Shell", "Bash" -> {
                    val command = inputMap["command"]?.toString() ?: ""
                    val shortCommand = if (command.length > 40) command.take(40) + "..." else command
                    Triple("💻", "Run Command", if (shortCommand.isEmpty()) "Running command" else "$ $shortCommand")
                }
                "Grep" -> {
                    val pattern = inputMap["pattern"]?.toString() ?: ""
                    val shortPattern = if (pattern.length > 30) pattern.take(30) + "..." else pattern
                    Triple("🔍", "Search", if (shortPattern.isEmpty()) "Searching" else "Searching for \"$shortPattern\"")
                }
                "Glob" -> {
                    val pattern = inputMap["pattern"]?.toString() ?: inputMap["glob_pattern"]?.toString() ?: ""
                    Triple("📂", "Find Files", if (pattern.isEmpty()) "Finding files" else "Finding $pattern")
                }
                "LS" -> {
                    val path = inputMap["path"]?.toString() ?: inputMap["target_directory"]?.toString() ?: ""
                    val dirName = path.substringAfterLast("/")
                    Triple("📁", "List Directory", if (dirName.isEmpty()) "Listing directory" else "Listing $dirName")
                }
                "WebSearch" -> {
                    val query = inputMap["query"]?.toString() ?: inputMap["search_term"]?.toString() ?: ""
                    val shortQuery = if (query.length > 35) query.take(35) + "..." else query
                    Triple("🌐", "Web Search", if (shortQuery.isEmpty()) "Web search" else "Searching: \"$shortQuery\"")
                }
                "WebFetch" -> {
                    val urlString = inputMap["url"]?.toString() ?: ""
                    val host = try { java.net.URL(urlString).host } catch (_: Exception) { null }
                    Triple("🌍", "Fetch URL", if (host != null) "Fetching $host" else "Fetching URL")
                }
                "TodoWrite" -> Triple("✅", "Update Todos", "Updating task list")
                "Delete" -> {
                    val path = inputMap["path"]?.toString() ?: ""
                    val fileName = path.substringAfterLast("/")
                    Triple("🗑️", "Delete File", if (fileName.isEmpty()) "Deleting file" else "Deleting $fileName")
                }
                else -> Triple("🔧", name, "Running tool")
            }
        }
}

enum class ToolCallStatus {
    RUNNING, COMPLETE, ERROR
}

data class MessagesResponse(
    val messages: List<ConversationMessage>
)

data class CreateConversationResponse(
    val chatId: String,
    val success: Boolean,
    val model: String? = null,
    val mode: String? = null
)

data class ModelsResponse(
    val models: List<AIModel>,
    val cached: Boolean? = null
)

data class AIModel(
    val id: String,
    val name: String,
    val isDefault: Boolean,
    val isCurrent: Boolean
)

enum class ChatMode(val value: String, val displayName: String, val description: String) {
    AGENT("agent", "Agent", "Full agent with file editing"),
    PLAN("plan", "Plan", "Read-only planning mode"),
    ASK("ask", "Ask", "Q&A style explanations");
    
    companion object {
        fun fromValue(value: String): ChatMode = entries.find { it.value == value } ?: AGENT
    }
}

data class ForkConversationResponse(
    val success: Boolean,
    val originalConversationId: String,
    val newConversationId: String,
    val conversation: Conversation,
    val messagesCopied: Int
)
