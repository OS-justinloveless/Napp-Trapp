package com.cursormobile.app.data

import com.cursormobile.app.data.models.*
import retrofit2.Response
import retrofit2.http.*

interface ApiService {
    
    // System endpoints
    @GET("api/system/info")
    suspend fun getSystemInfo(): SystemInfo
    
    @GET("api/system/network")
    suspend fun getNetworkInfo(): NetworkResponse
    
    @GET("api/system/cursor-status")
    suspend fun getCursorStatus(): CursorStatus
    
    @GET("api/system/models")
    suspend fun getAvailableModels(): ModelsResponse
    
    @POST("api/system/open-cursor")
    suspend fun openInCursor(@Body request: OpenCursorRequest): OpenCursorResponse
    
    @POST("api/system/exec")
    suspend fun executeCommand(@Body request: ExecRequest): ExecResponse
    
    // Projects endpoints
    @GET("api/projects")
    suspend fun getProjects(): ProjectsResponse
    
    @GET("api/projects/{id}")
    suspend fun getProject(@Path("id") id: String): ProjectResponse
    
    @GET("api/projects/{id}/tree")
    suspend fun getProjectTree(
        @Path("id") id: String,
        @Query("depth") depth: Int = 3
    ): ProjectTree
    
    @POST("api/projects")
    suspend fun createProject(@Body request: CreateProjectRequest): CreateProjectResponse
    
    @POST("api/projects/{id}/open")
    suspend fun openProject(@Path("id") id: String): Response<Unit>
    
    @GET("api/projects/{projectId}/conversations")
    suspend fun getProjectConversations(@Path("projectId") projectId: String): ConversationsResponse
    
    // Suggestions endpoints
    @GET("api/suggestions/{projectId}")
    suspend fun getSuggestions(
        @Path("projectId") projectId: String,
        @Query("type") type: String? = null,
        @Query("query") query: String? = null
    ): SuggestionsResponse
    
    @GET("api/suggestions/{projectId}/rules")
    suspend fun getProjectRules(@Path("projectId") projectId: String): SuggestionsResponse
    
    @GET("api/suggestions/{projectId}/agents")
    suspend fun getAgents(@Path("projectId") projectId: String): SuggestionsResponse
    
    @GET("api/suggestions/{projectId}/commands")
    suspend fun getCommands(@Path("projectId") projectId: String): SuggestionsResponse
    
    @GET("api/suggestions/skills")
    suspend fun getSkills(): SuggestionsResponse
    
    // Files endpoints
    @GET("api/files/list")
    suspend fun listDirectory(@Query("dirPath") path: String): DirectoryListResponse
    
    @GET("api/files/read")
    suspend fun readFile(@Query("filePath") path: String): FileContent
    
    @POST("api/files/write")
    suspend fun writeFile(@Body request: WriteFileRequest): WriteFileResponse
    
    @POST("api/files/create")
    suspend fun createFile(@Body request: CreateFileRequest): CreateFileResponse
    
    @DELETE("api/files/delete")
    suspend fun deleteFile(@Query("filePath") path: String): DeleteFileResponse
    
    @POST("api/files/rename")
    suspend fun renameFile(@Body request: RenameFileRequest): RenameFileResponse
    
    @POST("api/files/move")
    suspend fun moveFile(@Body request: MoveFileRequest): MoveFileResponse
    
    // Conversations endpoints
    @GET("api/conversations")
    suspend fun getConversations(): ConversationsResponse
    
    @GET("api/conversations/{id}")
    suspend fun getConversation(@Path("id") id: String): ConversationDetail
    
    @GET("api/conversations/{id}/messages")
    suspend fun getConversationMessages(
        @Path("id") id: String,
        @Query("limit") limit: Int? = null,
        @Query("offset") offset: Int? = null
    ): MessagesResponse
    
    @POST("api/conversations")
    suspend fun createConversation(@Body body: Map<String, Any?>): CreateConversationResponse
    
    @POST("api/conversations/{id}/fork")
    suspend fun forkConversation(
        @Path("id") id: String,
        @Body body: Map<String, Any?>
    ): ForkConversationResponse
    
    // Terminals endpoints
    @GET("api/terminals")
    suspend fun getTerminals(@Query("projectPath") projectPath: String? = null): TerminalsResponse
    
    @GET("api/terminals/{id}")
    suspend fun getTerminal(
        @Path("id") id: String,
        @Query("projectPath") projectPath: String,
        @Query("includeContent") includeContent: Boolean = true
    ): TerminalDetailResponse
    
    @GET("api/terminals/{id}/content")
    suspend fun getTerminalContent(
        @Path("id") id: String,
        @Query("projectPath") projectPath: String,
        @Query("tail") tailLines: Int? = null
    ): TerminalContentResponse
    
    @POST("api/terminals/{id}/input")
    suspend fun sendTerminalInput(
        @Path("id") id: String,
        @Body request: TerminalInputRequest
    ): Response<Unit>
    
    // Git endpoints
    @GET("api/git/{projectId}/scan-repos")
    suspend fun scanGitRepositories(
        @Path("projectId") projectId: String,
        @Query("maxDepth") maxDepth: Int? = null
    ): GitRepositoriesResponse
    
    @GET("api/git/{projectId}/status")
    suspend fun getGitStatus(
        @Path("projectId") projectId: String,
        @Query("repoPath") repoPath: String? = null
    ): GitStatus
    
    @GET("api/git/{projectId}/branches")
    suspend fun getGitBranches(
        @Path("projectId") projectId: String,
        @Query("repoPath") repoPath: String? = null
    ): GitBranchesResponse
    
    @POST("api/git/{projectId}/stage")
    suspend fun gitStage(
        @Path("projectId") projectId: String,
        @Body request: GitStageRequest,
        @Query("repoPath") repoPath: String? = null
    ): GitOperationResponse
    
    @POST("api/git/{projectId}/unstage")
    suspend fun gitUnstage(
        @Path("projectId") projectId: String,
        @Body request: GitStageRequest,
        @Query("repoPath") repoPath: String? = null
    ): GitOperationResponse
    
    @POST("api/git/{projectId}/discard")
    suspend fun gitDiscard(
        @Path("projectId") projectId: String,
        @Body request: GitStageRequest,
        @Query("repoPath") repoPath: String? = null
    ): GitOperationResponse
    
    @POST("api/git/{projectId}/commit")
    suspend fun gitCommit(
        @Path("projectId") projectId: String,
        @Body request: GitCommitRequest,
        @Query("repoPath") repoPath: String? = null
    ): GitOperationResponse
    
    @POST("api/git/{projectId}/push")
    suspend fun gitPush(
        @Path("projectId") projectId: String,
        @Body request: GitPushPullRequest,
        @Query("repoPath") repoPath: String? = null
    ): GitOperationResponse
    
    @POST("api/git/{projectId}/pull")
    suspend fun gitPull(
        @Path("projectId") projectId: String,
        @Body request: GitPushPullRequest,
        @Query("repoPath") repoPath: String? = null
    ): GitOperationResponse
    
    @POST("api/git/{projectId}/checkout")
    suspend fun gitCheckout(
        @Path("projectId") projectId: String,
        @Body request: GitCheckoutRequest,
        @Query("repoPath") repoPath: String? = null
    ): GitOperationResponse
    
    @POST("api/git/{projectId}/branch")
    suspend fun gitCreateBranch(
        @Path("projectId") projectId: String,
        @Body request: GitCreateBranchRequest,
        @Query("repoPath") repoPath: String? = null
    ): GitOperationResponse
    
    @GET("api/git/{projectId}/diff")
    suspend fun gitDiff(
        @Path("projectId") projectId: String,
        @Query("file") file: String,
        @Query("staged") staged: Boolean = false,
        @Query("repoPath") repoPath: String? = null
    ): GitDiffResponse
    
    @POST("api/git/{projectId}/fetch")
    suspend fun gitFetch(
        @Path("projectId") projectId: String,
        @Body request: GitFetchRequest,
        @Query("repoPath") repoPath: String? = null
    ): GitOperationResponse
    
    @POST("api/git/{projectId}/clean")
    suspend fun gitClean(
        @Path("projectId") projectId: String,
        @Body request: GitStageRequest,
        @Query("repoPath") repoPath: String? = null
    ): GitOperationResponse
    
    @GET("api/git/{projectId}/remotes")
    suspend fun getGitRemotes(
        @Path("projectId") projectId: String,
        @Query("repoPath") repoPath: String? = null
    ): GitRemotesResponse
    
    @GET("api/git/{projectId}/log")
    suspend fun gitLog(
        @Path("projectId") projectId: String,
        @Query("limit") limit: Int = 10,
        @Query("repoPath") repoPath: String? = null
    ): GitLogResponse
    
    @POST("api/git/{projectId}/generate-commit-message")
    suspend fun generateCommitMessage(
        @Path("projectId") projectId: String,
        @Query("repoPath") repoPath: String? = null
    ): GenerateCommitMessageResponse
}
