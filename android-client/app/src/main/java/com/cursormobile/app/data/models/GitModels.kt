package com.cursormobile.app.data.models

data class GitRepository(
    val path: String,
    val relativePath: String,
    val name: String,
    val isRoot: Boolean,
    val branch: String? = null,
    val hasChanges: Boolean? = null
)

data class GitRepositoriesResponse(
    val repositories: List<GitRepository>
)

data class GitStatus(
    val branch: String,
    val ahead: Int = 0,
    val behind: Int = 0,
    val staged: List<GitFileChange> = emptyList(),
    val unstaged: List<GitFileChange> = emptyList(),
    val untracked: List<String> = emptyList(),
    val hasUncommittedChanges: Boolean = false,
    val isDetached: Boolean = false,
    val trackingBranch: String? = null
)

data class GitFileChange(
    val path: String,
    val status: String,
    val oldPath: String? = null
) {
    val statusDisplay: String
        get() = when (status) {
            "M" -> "Modified"
            "A" -> "Added"
            "D" -> "Deleted"
            "R" -> "Renamed"
            "C" -> "Copied"
            "U" -> "Unmerged"
            "?" -> "Untracked"
            else -> status
        }
    
    val statusColor: String
        get() = when (status) {
            "M" -> "orange"
            "A" -> "green"
            "D" -> "red"
            "R" -> "blue"
            else -> "gray"
        }
}

data class GitBranch(
    val name: String,
    val current: Boolean,
    val remote: Boolean = false,
    val tracking: String? = null,
    val ahead: Int = 0,
    val behind: Int = 0
)

data class GitBranchesResponse(
    val branches: List<GitBranch>
)

data class GitCommit(
    val hash: String,
    val shortHash: String,
    val message: String,
    val author: String,
    val email: String,
    val date: String,
    val timestamp: Long
)

data class GitLogResponse(
    val commits: List<GitCommit>
)

data class GitRemote(
    val name: String,
    val fetchUrl: String,
    val pushUrl: String
)

data class GitRemotesResponse(
    val remotes: List<GitRemote>
)

data class GitStageRequest(
    val files: List<String>
)

data class GitCommitRequest(
    val message: String,
    val files: List<String>? = null
)

data class GitPushPullRequest(
    val remote: String? = null,
    val branch: String? = null
)

data class GitCheckoutRequest(
    val branch: String
)

data class GitCreateBranchRequest(
    val name: String,
    val checkout: Boolean = true
)

data class GitFetchRequest(
    val remote: String? = null
)

data class GitOperationResponse(
    val success: Boolean,
    val message: String? = null,
    val error: String? = null
)

data class GitDiffResponse(
    val diff: String,
    val isTruncated: Boolean = false,
    val totalLines: Int? = null
)

data class GenerateCommitMessageResponse(
    val message: String
)
