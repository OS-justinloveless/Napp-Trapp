package com.cursormobile.app.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import com.cursormobile.app.data.AuthManager
import com.cursormobile.app.data.WebSocketManager
import com.cursormobile.app.data.models.Project
import com.cursormobile.app.ui.components.ProjectDrawer

enum class MainTab(val icon: ImageVector, val label: String) {
    FILES(Icons.Default.Folder, "Files"),
    TERMINALS(Icons.Default.Terminal, "Terminals"),
    GIT(Icons.Default.AccountTree, "Git"),
    CHAT(Icons.Default.Chat, "Chat")
}

@Composable
fun MainScreen(
    authManager: AuthManager,
    webSocketManager: WebSocketManager,
    onNavigateToChat: (String) -> Unit,
    onLogout: () -> Unit
) {
    var selectedTab by remember { mutableStateOf(MainTab.FILES) }
    var selectedProject by remember { mutableStateOf<Project?>(null) }
    var isDrawerOpen by remember { mutableStateOf(false) }
    var isTerminalViewActive by remember { mutableStateOf(false) }
    
    val serverUrl by authManager.serverUrl.collectAsState()
    val token by authManager.token.collectAsState()
    val isConnected by webSocketManager.isConnected.collectAsState()
    
    // Connect WebSocket when authenticated
    LaunchedEffect(serverUrl, token) {
        if (serverUrl != null && token != null) {
            webSocketManager.connect(serverUrl!!, token!!)
        }
    }
    
    // Watch project path when selected
    LaunchedEffect(selectedProject) {
        selectedProject?.let { project ->
            webSocketManager.watchPath(project.path)
        }
    }
    
    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectHorizontalDragGestures { change, dragAmount ->
                    change.consume()
                    if (dragAmount > 30 && change.position.x < 50) {
                        isDrawerOpen = true
                    } else if (dragAmount < -30 && isDrawerOpen) {
                        isDrawerOpen = false
                    }
                }
            }
    ) {
        // Main content
        Column(modifier = Modifier.fillMaxSize()) {
            selectedProject?.let { project ->
                // Project selected - show tabs
                Box(modifier = Modifier.weight(1f)) {
                    when (selectedTab) {
                        MainTab.FILES -> FilesTab(
                            project = project,
                            authManager = authManager,
                            onOpenDrawer = { isDrawerOpen = true }
                        )
                        MainTab.TERMINALS -> TerminalsTab(
                            project = project,
                            authManager = authManager,
                            onOpenDrawer = { isDrawerOpen = true },
                            onTerminalViewActiveChange = { isTerminalViewActive = it }
                        )
                        MainTab.GIT -> GitTab(
                            project = project,
                            authManager = authManager,
                            onOpenDrawer = { isDrawerOpen = true }
                        )
                        MainTab.CHAT -> ChatTab(
                            project = project,
                            authManager = authManager,
                            onOpenDrawer = { isDrawerOpen = true },
                            onNavigateToChat = onNavigateToChat
                        )
                    }
                }
                
                // Floating tab bar (hide when in terminal view)
                if (!isTerminalViewActive) {
                    FloatingTabBar(
                        selectedTab = selectedTab,
                        onTabSelected = { selectedTab = it },
                        onNewChatClick = {
                            // TODO: Open new chat sheet
                        }
                    )
                }
            } ?: run {
                // No project selected
                NoProjectSelectedView(
                    onOpenDrawer = { isDrawerOpen = true },
                    authManager = authManager,
                    onLogout = onLogout
                )
            }
        }
        
        // Drawer overlay
        if (isDrawerOpen) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.3f))
                    .clickable { isDrawerOpen = false }
            )
        }
        
        // Project drawer
        AnimatedVisibility(
            visible = isDrawerOpen,
            enter = slideInHorizontally { -it },
            exit = slideOutHorizontally { -it }
        ) {
            ProjectDrawer(
                selectedProject = selectedProject,
                onProjectSelected = { project ->
                    selectedProject = project
                    isDrawerOpen = false
                },
                onSettingsClick = {
                    // Navigate to settings
                },
                onLogout = onLogout,
                authManager = authManager,
                modifier = Modifier.width(280.dp)
            )
        }
    }
}

@Composable
private fun FloatingTabBar(
    selectedTab: MainTab,
    onTabSelected: (MainTab) -> Unit,
    onNewChatClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Tab bar
        Surface(
            shape = RoundedCornerShape(28.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            tonalElevation = 8.dp,
            shadowElevation = 8.dp
        ) {
            Row(
                modifier = Modifier.padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                MainTab.entries.forEach { tab ->
                    val isSelected = selectedTab == tab
                    Box(
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(
                                if (isSelected) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.surfaceVariant
                            )
                            .clickable { onTabSelected(tab) }
                            .padding(12.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = tab.icon,
                            contentDescription = tab.label,
                            tint = if (isSelected) MaterialTheme.colorScheme.onPrimary
                                   else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
        
        Spacer(modifier = Modifier.width(12.dp))
        
        // FAB
        FloatingActionButton(
            onClick = onNewChatClick,
            containerColor = MaterialTheme.colorScheme.primary,
            shape = CircleShape
        ) {
            Icon(Icons.Default.Add, contentDescription = "New Chat")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NoProjectSelectedView(
    onOpenDrawer: () -> Unit,
    authManager: AuthManager,
    onLogout: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Napp Trapp") },
                navigationIcon = {
                    IconButton(onClick = onOpenDrawer) {
                        Icon(Icons.Default.Menu, contentDescription = "Menu")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                Icons.Default.FolderOpen,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
            
            Spacer(modifier = Modifier.height(24.dp))
            
            Text(
                text = "No Project Selected",
                style = MaterialTheme.typography.titleLarge
            )
            
            Text(
                text = "Open the project drawer to select a project",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            
            Spacer(modifier = Modifier.height(24.dp))
            
            Button(onClick = onOpenDrawer) {
                Icon(Icons.Default.Menu, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Open Projects")
            }
        }
    }
}
