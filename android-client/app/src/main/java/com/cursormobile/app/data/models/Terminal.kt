package com.cursormobile.app.data.models

import java.util.Date

data class Terminal(
    val id: String,
    val name: String,
    val cwd: String,
    val pid: Int,
    val active: Boolean,
    val exitCode: Int? = null,
    val source: String? = null,
    val lastCommand: String? = null,
    val activeCommand: String? = null,
    val shell: String? = null,
    val projectPath: String? = null,
    val createdAt: Double? = null,
    val cols: Int? = null,
    val rows: Int? = null,
    val exitSignal: String? = null,
    val exitedAt: Double? = null,
    val isHistory: Boolean? = null
) {
    val statusText: String
        get() = when {
            active -> {
                if (!activeCommand.isNullOrEmpty()) {
                    val cmdName = activeCommand.split(" ").firstOrNull() ?: activeCommand
                    "Running: $cmdName"
                } else {
                    "Running"
                }
            }
            exitCode != null -> "Exited ($exitCode)"
            else -> "Idle"
        }
    
    val createdDate: Date?
        get() = createdAt?.let { Date((it).toLong()) }
    
    val exitedDate: Date?
        get() = exitedAt?.let { Date((it).toLong()) }
}

data class TerminalsResponse(
    val terminals: List<Terminal>,
    val count: Int,
    val source: String? = null,
    val message: String? = null
)

data class TerminalResponse(
    val terminal: Terminal
)

data class TerminalDetailResponse(
    val terminal: Terminal,
    val content: String? = null
)

data class TerminalContentResponse(
    val id: String,
    val content: String,
    val metadata: TerminalMetadata? = null
)

data class TerminalMetadata(
    val pid: String? = null,
    val cwd: String? = null,
    val last_command: String? = null,
    val last_exit_code: String? = null,
    val active_command: String? = null
)

data class TerminalInputRequest(
    val data: String,
    val projectPath: String
)

data class TerminalActionResponse(
    val success: Boolean
)
