package com.cursormobile.app.data.models

import com.google.gson.annotations.SerializedName
import java.util.Date

data class Project(
    val id: String,
    val name: String,
    val path: String,
    val lastOpened: Date? = null
)

data class ProjectsResponse(
    val projects: List<Project>
)

data class ProjectResponse(
    val project: Project
)

data class ProjectTree(
    val tree: List<FileTreeItem>?
)

data class FileTreeItem(
    val name: String,
    val path: String,
    val type: String,
    val children: List<FileTreeItem>? = null,
    val size: Int? = null,
    @SerializedName("extension")
    val fileExtension: String? = null
) {
    val id: String get() = path
    val isDirectory: Boolean get() = type == "directory"
}

data class CreateProjectRequest(
    val name: String,
    val path: String? = null,
    val template: String? = null
)

data class CreateProjectResponse(
    val success: Boolean,
    val project: NewProject? = null
) {
    data class NewProject(
        val name: String,
        val path: String,
        val createdAt: String
    )
}
