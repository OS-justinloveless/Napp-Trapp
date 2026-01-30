package com.cursormobile.app.data

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.util.Date
import java.util.UUID

data class SavedHost(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val serverUrl: String,
    val token: String,
    val lastConnected: Long = System.currentTimeMillis()
) {
    val displayName: String get() = name.ifEmpty { serverDescription }
    
    val serverDescription: String
        get() {
            return try {
                val url = java.net.URL(serverUrl)
                "${url.host}:${if (url.port != -1) url.port else 3847}"
            } catch (_: Exception) {
                serverUrl
            }
        }
    
    val formattedLastConnected: String
        get() {
            val diff = System.currentTimeMillis() - lastConnected
            val minutes = diff / 60000
            val hours = minutes / 60
            val days = hours / 24
            return when {
                days > 0 -> "$days days ago"
                hours > 0 -> "$hours hours ago"
                minutes > 0 -> "$minutes minutes ago"
                else -> "just now"
            }
        }
}

class SavedHostsManager(context: Context) {
    
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val gson = Gson()
    
    var savedHosts: List<SavedHost>
        get() {
            val json = prefs.getString(KEY_SAVED_HOSTS, null) ?: return emptyList()
            val type = object : TypeToken<List<SavedHost>>() {}.type
            return try {
                gson.fromJson(json, type) ?: emptyList()
            } catch (_: Exception) {
                emptyList()
            }
        }
        private set(value) {
            val json = gson.toJson(value)
            prefs.edit().putString(KEY_SAVED_HOSTS, json).apply()
        }
    
    val hasSavedHosts: Boolean get() = savedHosts.isNotEmpty()
    
    fun saveHost(name: String, serverUrl: String, token: String) {
        val hosts = savedHosts.toMutableList()
        
        // Check if host with same URL already exists
        val existingIndex = hosts.indexOfFirst { it.serverUrl == serverUrl }
        
        val host = SavedHost(
            id = if (existingIndex >= 0) hosts[existingIndex].id else UUID.randomUUID().toString(),
            name = name,
            serverUrl = serverUrl,
            token = token,
            lastConnected = System.currentTimeMillis()
        )
        
        if (existingIndex >= 0) {
            hosts[existingIndex] = host
        } else {
            hosts.add(0, host)
        }
        
        // Keep only the most recent 10 hosts
        savedHosts = hosts.take(10)
    }
    
    fun removeHost(host: SavedHost) {
        savedHosts = savedHosts.filter { it.id != host.id }
    }
    
    fun updateLastConnected(serverUrl: String) {
        val hosts = savedHosts.toMutableList()
        val index = hosts.indexOfFirst { it.serverUrl == serverUrl }
        if (index >= 0) {
            hosts[index] = hosts[index].copy(lastConnected = System.currentTimeMillis())
            savedHosts = hosts
        }
    }
    
    companion object {
        private const val PREFS_NAME = "saved_hosts"
        private const val KEY_SAVED_HOSTS = "hosts"
    }
}
