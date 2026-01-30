package com.cursormobile.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.Date
import java.util.concurrent.TimeUnit

data class FileChange(
    val id: String = java.util.UUID.randomUUID().toString(),
    val event: String,
    val path: String,
    val relativePath: String,
    val timestamp: Date = Date()
)

class WebSocketManager {
    
    private var webSocket: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    
    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()
    
    private val _fileChanges = MutableStateFlow<List<FileChange>>(emptyList())
    val fileChanges: StateFlow<List<FileChange>> = _fileChanges.asStateFlow()
    
    private var serverUrl: String? = null
    private var token: String? = null
    private var currentWatchPath: String? = null
    
    fun connect(serverUrl: String, token: String) {
        this.serverUrl = serverUrl
        this.token = token
        
        disconnect()
        
        val wsUrl = serverUrl
            .replace("http://", "ws://")
            .replace("https://", "wss://")
        
        val request = Request.Builder()
            .url("$wsUrl/ws?token=$token")
            .build()
        
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                scope.launch {
                    _isConnected.value = true
                    
                    // Re-watch current path if any
                    currentWatchPath?.let { watchPath(it) }
                }
            }
            
            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }
            
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                scope.launch {
                    _isConnected.value = false
                }
            }
            
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                scope.launch {
                    _isConnected.value = false
                    
                    // Attempt to reconnect after a delay
                    kotlinx.coroutines.delay(5000)
                    serverUrl?.let { url ->
                        token?.let { tok ->
                            connect(url, tok)
                        }
                    }
                }
            }
        })
    }
    
    fun disconnect() {
        webSocket?.close(1000, "Client disconnecting")
        webSocket = null
        _isConnected.value = false
    }
    
    fun watchPath(path: String) {
        currentWatchPath = path
        
        if (_isConnected.value) {
            val message = JSONObject().apply {
                put("type", "watch")
                put("path", path)
            }
            webSocket?.send(message.toString())
        }
    }
    
    fun unwatchPath(path: String) {
        if (currentWatchPath == path) {
            currentWatchPath = null
        }
        
        if (_isConnected.value) {
            val message = JSONObject().apply {
                put("type", "unwatch")
                put("path", path)
            }
            webSocket?.send(message.toString())
        }
    }
    
    private fun handleMessage(text: String) {
        try {
            val json = JSONObject(text)
            val type = json.optString("type")
            
            when (type) {
                "file-change" -> {
                    val event = json.optString("event")
                    val path = json.optString("path")
                    val relativePath = json.optString("relativePath", path)
                    
                    val change = FileChange(
                        event = event,
                        path = path,
                        relativePath = relativePath
                    )
                    
                    scope.launch {
                        val currentChanges = _fileChanges.value.toMutableList()
                        currentChanges.add(0, change)
                        // Keep only the last 50 changes
                        _fileChanges.value = currentChanges.take(50)
                    }
                }
                
                "terminal-output" -> {
                    // Handle terminal output updates
                    val terminalId = json.optString("terminalId")
                    val data = json.optString("data")
                    // TODO: Broadcast to terminal view
                }
                
                "pong" -> {
                    // Keep-alive response
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
    
    fun sendPing() {
        if (_isConnected.value) {
            val message = JSONObject().apply {
                put("type", "ping")
            }
            webSocket?.send(message.toString())
        }
    }
    
    fun subscribeToTerminal(terminalId: String) {
        if (_isConnected.value) {
            val message = JSONObject().apply {
                put("type", "subscribe-terminal")
                put("terminalId", terminalId)
            }
            webSocket?.send(message.toString())
        }
    }
    
    fun unsubscribeFromTerminal(terminalId: String) {
        if (_isConnected.value) {
            val message = JSONObject().apply {
                put("type", "unsubscribe-terminal")
                put("terminalId", terminalId)
            }
            webSocket?.send(message.toString())
        }
    }
    
    fun clearFileChanges() {
        _fileChanges.value = emptyList()
    }
}
