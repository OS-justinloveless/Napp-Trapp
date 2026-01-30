package com.cursormobile.app.data.models

data class SystemInfo(
    val hostname: String,
    val platform: String,
    val arch: String,
    val username: String,
    val cpus: Int,
    val memory: MemoryInfo,
    val uptime: Long
) {
    val platformName: String
        get() = when (platform) {
            "darwin" -> "macOS"
            "linux" -> "Linux"
            "win32" -> "Windows"
            else -> platform
        }
    
    val formattedUptime: String
        get() {
            val days = uptime / 86400
            val hours = (uptime % 86400) / 3600
            val minutes = (uptime % 3600) / 60
            return when {
                days > 0 -> "${days}d ${hours}h"
                hours > 0 -> "${hours}h ${minutes}m"
                else -> "${minutes}m"
            }
        }
}

data class MemoryInfo(
    val total: Long,
    val free: Long,
    val used: Long
) {
    val formattedTotal: String
        get() = formatBytes(total)
    
    val formattedUsed: String
        get() = formatBytes(used)
    
    val usagePercentage: Float
        get() = if (total > 0) (used.toFloat() / total.toFloat()) * 100f else 0f
    
    private fun formatBytes(bytes: Long): String {
        val gb = bytes / (1024.0 * 1024.0 * 1024.0)
        return String.format("%.1f GB", gb)
    }
}

data class NetworkInterface(
    val name: String,
    val address: String
) {
    val id: String get() = "$name-$address"
}

data class NetworkResponse(
    val addresses: List<NetworkInterface>
)

data class CursorStatus(
    val isRunning: Boolean,
    val version: String? = null,
    val pid: Int? = null
)

data class OpenCursorRequest(
    val path: String
)

data class OpenCursorResponse(
    val success: Boolean,
    val message: String? = null
)

data class ExecRequest(
    val command: String,
    val cwd: String? = null
)

data class ExecResponse(
    val success: Boolean,
    val stdout: String? = null,
    val stderr: String? = null,
    val exitCode: Int? = null
)
