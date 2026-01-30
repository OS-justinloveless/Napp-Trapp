@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.cursormobile.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.cursormobile.app.data.AuthManager
import com.cursormobile.app.data.SavedHost
import com.cursormobile.app.data.SavedHostsManager
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    authManager: AuthManager,
    savedHostsManager: SavedHostsManager,
    onLoginSuccess: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    
    var serverUrl by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var isConnecting by remember { mutableStateOf(false) }
    var connectingHostId by remember { mutableStateOf<String?>(null) }
    var showSetupGuide by remember { mutableStateOf(false) }
    
    val error by authManager.error.collectAsState()
    val savedHosts = savedHostsManager.savedHosts
    val hasSavedHosts = savedHosts.isNotEmpty()
    
    // QR Scanner launcher
    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let { code ->
            // Parse QR code URL: http://IP:PORT/?token=TOKEN
            try {
                val uri = android.net.Uri.parse(code)
                uri.getQueryParameter("token")?.let { t -> token = t }
                val host = uri.host
                val port = uri.port.takeIf { it != -1 } ?: 3847
                val scheme = uri.scheme ?: "http"
                if (host != null) {
                    serverUrl = "$scheme://$host:$port"
                }
                
                // Auto-connect
                if (serverUrl.isNotEmpty() && token.isNotEmpty()) {
                    scope.launch {
                        isConnecting = true
                        val success = authManager.login(serverUrl, token)
                        isConnecting = false
                        if (success) onLoginSuccess()
                    }
                }
            } catch (e: Exception) {
                // Invalid QR code format
            }
        }
    }
    
    // Camera permission launcher
    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            val options = ScanOptions().apply {
                setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                setPrompt("Scan the QR code from your terminal")
                setBeepEnabled(false)
                setOrientationLocked(false)
            }
            scanLauncher.launch(options)
        }
    }
    
    fun startQRScan() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) 
            == PackageManager.PERMISSION_GRANTED) {
            val options = ScanOptions().apply {
                setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                setPrompt("Scan the QR code from your terminal")
                setBeepEnabled(false)
                setOrientationLocked(false)
            }
            scanLauncher.launch(options)
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }
    
    fun connect() {
        scope.launch {
            isConnecting = true
            val success = authManager.login(serverUrl, token)
            isConnecting = false
            if (success) onLoginSuccess()
        }
    }
    
    fun connectToSavedHost(host: SavedHost) {
        scope.launch {
            connectingHostId = host.id
            val success = authManager.login(host.serverUrl, host.token)
            connectingHostId = null
            if (success) onLoginSuccess()
        }
    }
    
    if (showSetupGuide) {
        SetupGuideDialog(onDismiss = { showSetupGuide = false })
        return
    }
    
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(modifier = Modifier.height(40.dp))
        
        // Header
        Icon(
            imageVector = Icons.Default.PhoneAndroid,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.primary
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        Text(
            text = "Napp Trapp",
            style = MaterialTheme.typography.headlineLarge
        )
        
        Text(
            text = "Control your Cursor IDE from your Android device",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
        
        Spacer(modifier = Modifier.height(32.dp))
        
        // Setup Guide (shown prominently when no saved hosts)
        if (!hasSavedHosts) {
            SetupGuideCard(onClick = { showSetupGuide = true })
            Spacer(modifier = Modifier.height(16.dp))
            DividerWithText("OR")
            Spacer(modifier = Modifier.height(16.dp))
        }
        
        // Saved Hosts
        if (hasSavedHosts) {
            Text(
                text = "Previous Hosts",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(8.dp))
            
            savedHosts.forEach { host ->
                SavedHostCard(
                    host = host,
                    isConnecting = connectingHostId == host.id,
                    onClick = { connectToSavedHost(host) },
                    onDelete = { savedHostsManager.removeHost(host) }
                )
                Spacer(modifier = Modifier.height(8.dp))
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            DividerWithText("OR")
            Spacer(modifier = Modifier.height(16.dp))
        }
        
        // QR Code Scanner Button
        Button(
            onClick = { startQRScan() },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.QrCodeScanner, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Scan QR Code")
        }
        
        Text(
            text = "Scan the QR code shown in your terminal",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        DividerWithText("OR")
        Spacer(modifier = Modifier.height(16.dp))
        
        // Manual Entry
        Text(
            text = "Manual Connection",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.fillMaxWidth()
        )
        
        Spacer(modifier = Modifier.height(8.dp))
        
        OutlinedTextField(
            value = serverUrl,
            onValueChange = { serverUrl = it },
            label = { Text("Server Address") },
            placeholder = { Text("http://192.168.1.100:3847") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri)
        )
        
        Spacer(modifier = Modifier.height(8.dp))
        
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text("Auth Token") },
            placeholder = { Text("Enter your token") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = PasswordVisualTransformation()
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        Button(
            onClick = { connect() },
            modifier = Modifier.fillMaxWidth(),
            enabled = serverUrl.isNotBlank() && token.isNotBlank() && !isConnecting,
            shape = RoundedCornerShape(12.dp)
        ) {
            if (isConnecting) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    color = MaterialTheme.colorScheme.onPrimary
                )
            } else {
                Text("Connect")
            }
        }
        
        // Error Message
        error?.let { errorText ->
            Spacer(modifier = Modifier.height(16.dp))
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer
                ),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = errorText,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
        
        // Setup Guide at bottom if has saved hosts
        if (hasSavedHosts) {
            Spacer(modifier = Modifier.height(24.dp))
            SetupGuideCard(onClick = { showSetupGuide = true })
        }
        
        Spacer(modifier = Modifier.height(40.dp))
    }
}

@Composable
private fun DividerWithText(text: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Divider(modifier = Modifier.weight(1f))
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 16.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Divider(modifier = Modifier.weight(1f))
    }
}

@Composable
private fun SetupGuideCard(onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        )
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.MenuBook,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(32.dp)
            )
            Spacer(modifier = Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Server Setup Guide",
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = "Step-by-step instructions to get started",
                    style = MaterialTheme.typography.bodySmall,
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

@Composable
private fun SavedHostCard(
    host: SavedHost,
    isConnecting: Boolean,
    onClick: () -> Unit,
    onDelete: () -> Unit
) {
    var showDeleteDialog by remember { mutableStateOf(false) }
    
    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("Remove ${host.displayName}?") },
            text = { Text("This will remove the saved connection.") },
            confirmButton = {
                TextButton(onClick = {
                    onDelete()
                    showDeleteDialog = false
                }) {
                    Text("Remove", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
    
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        enabled = !isConnecting
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.Computer,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
            }
            
            Spacer(modifier = Modifier.width(12.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = host.displayName,
                    style = MaterialTheme.typography.titleSmall
                )
                Text(
                    text = host.serverDescription,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "Connected ${host.formattedLastConnected}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            
            if (isConnecting) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp))
            } else {
                IconButton(onClick = { showDeleteDialog = true }) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "Remove",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun SetupGuideDialog(onDismiss: () -> Unit) {
    var currentStep by remember { mutableStateOf(0) }
    
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = when (currentStep) {
                    0 -> "Prerequisites"
                    1 -> "Start the Server"
                    else -> "Connect Your Phone"
                }
            )
        },
        text = {
            Column {
                when (currentStep) {
                    0 -> {
                        SetupStep(Icons.Default.Computer, "A Mac, Windows, or Linux computer")
                        SetupStep(Icons.Default.Inventory, "Docker OR Node.js installed")
                        SetupStep(Icons.Default.Code, "Cursor IDE installed")
                        SetupStep(Icons.Default.Wifi, "Same WiFi network")
                    }
                    1 -> {
                        Text("Run one of these commands:")
                        Spacer(modifier = Modifier.height(8.dp))
                        CodeBlock("docker run justinlovelessx/napptrapp")
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Or with Node.js:", style = MaterialTheme.typography.bodySmall)
                        CodeBlock("npx napptrapp")
                    }
                    else -> {
                        Text("1. Scan the QR code shown in your terminal")
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("2. Or enter the server address and token manually")
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            "Make sure your phone is on the same WiFi network!",
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
            }
        },
        confirmButton = {
            if (currentStep < 2) {
                TextButton(onClick = { currentStep++ }) {
                    Text("Next")
                }
            } else {
                TextButton(onClick = onDismiss) {
                    Text("Done")
                }
            }
        },
        dismissButton = {
            if (currentStep > 0) {
                TextButton(onClick = { currentStep-- }) {
                    Text("Back")
                }
            } else {
                TextButton(onClick = onDismiss) {
                    Text("Close")
                }
            }
        }
    )
}

@Composable
private fun SetupStep(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(
        modifier = Modifier.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            icon,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun CodeBlock(code: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(
            text = code,
            modifier = Modifier.padding(12.dp),
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
        )
    }
}
