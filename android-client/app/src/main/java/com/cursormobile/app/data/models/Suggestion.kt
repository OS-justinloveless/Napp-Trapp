package com.cursormobile.app.data.models

data class Suggestion(
    val id: String,
    val type: SuggestionType,
    val name: String,
    val description: String? = null,
    val path: String? = null,
    val icon: String? = null,
    val insertText: String? = null
)

enum class SuggestionType {
    FILE,
    FOLDER,
    SYMBOL,
    RULE,
    AGENT,
    COMMAND,
    SKILL
}

data class SuggestionsResponse(
    val suggestions: List<Suggestion>
)
