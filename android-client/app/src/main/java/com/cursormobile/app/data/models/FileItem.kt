package com.cursormobile.app.data.models

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class FileItem(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val size: Int,
    val modified: Date? = null
) {
    val id: String get() = path
    
    val formattedSize: String
        get() {
            val kb = 1024.0
            val mb = kb * 1024
            val gb = mb * 1024
            return when {
                size < kb -> "$size B"
                size < mb -> String.format("%.1f KB", size / kb)
                size < gb -> String.format("%.1f MB", size / mb)
                else -> String.format("%.1f GB", size / gb)
            }
        }
    
    val fileExtension: String
        get() = name.substringAfterLast('.', "").lowercase()
    
    val icon: String
        get() = if (isDirectory) "folder" else when (fileExtension) {
            "swift" -> "code"
            "kt", "java" -> "code"
            "js", "jsx", "ts", "tsx" -> "code"
            "py" -> "code"
            "json" -> "data"
            "md", "txt" -> "description"
            "html", "css" -> "language"
            "png", "jpg", "jpeg", "gif", "svg" -> "image"
            "pdf" -> "picture_as_pdf"
            else -> "insert_drive_file"
        }
}

data class DirectoryListResponse(
    val items: List<FileItem>
)

data class FileContent(
    val path: String,
    val content: String,
    val size: Int,
    val modified: String,
    val extension: String
) {
    val language: String
        get() = when (extension.lowercase()) {
            "swift" -> "swift"
            "js" -> "javascript"
            "jsx" -> "jsx"
            "ts" -> "typescript"
            "tsx" -> "tsx"
            "py" -> "python"
            "rb" -> "ruby"
            "go" -> "go"
            "rs" -> "rust"
            "java" -> "java"
            "kt" -> "kotlin"
            "json" -> "json"
            "yaml", "yml" -> "yaml"
            "xml" -> "xml"
            "html" -> "html"
            "css" -> "css"
            "scss", "sass" -> "scss"
            "md" -> "markdown"
            "sql" -> "sql"
            "sh", "bash" -> "bash"
            else -> "plaintext"
        }
}

data class WriteFileRequest(
    val filePath: String,
    val content: String
)

data class WriteFileResponse(
    val success: Boolean,
    val path: String,
    val diff: String? = null
)

data class CreateFileRequest(
    val filePath: String,
    val content: String? = null
)

data class CreateFileResponse(
    val success: Boolean,
    val path: String
)

data class DeleteFileResponse(
    val success: Boolean,
    val deleted: String
)

data class RenameFileRequest(
    val oldPath: String,
    val newName: String
)

data class RenameFileResponse(
    val success: Boolean,
    val oldPath: String,
    val newPath: String
)

data class MoveFileRequest(
    val sourcePath: String,
    val destinationPath: String
)

data class MoveFileResponse(
    val success: Boolean,
    val sourcePath: String,
    val destinationPath: String
)
