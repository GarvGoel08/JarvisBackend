const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { Ollama } = require('ollama');
const contentManager = require('../utils/contentManager');
require('dotenv').config();

// Environment check
const isDevelopment = process.env.NODE_ENV === 'development';

// Round-robin API key management
class APIKeyManager {
    constructor() {
        // Extract all Google AI API keys from environment variables
        this.apiKeys = [];
        for (let i = 1; i <= 12; i++) {
            const key = process.env[`GOOGLE_AI_KEY_${i}`];
            if (key) {
                this.apiKeys.push(key);
            }
        }
        
        if (this.apiKeys.length === 0) {
            throw new Error('No Google AI API keys found in environment variables');
        }
        
        this.currentIndex = 0;
        console.log(`Initialized API Key Manager with ${this.apiKeys.length} keys`);
    }
    
    /**
     * Get the next API key using round-robin strategy
     * @returns {string} - The next API key
     */
    getNextKey() {
        const key = this.apiKeys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
        return key;
    }
    
    /**
     * Get current key index (for debugging)
     * @returns {number} - Current index
     */
    getCurrentIndex() {
        return this.currentIndex;
    }
    
    /**
     * Get total number of available keys
     * @returns {number} - Total keys count
     */
    getTotalKeys() {
        return this.apiKeys.length;
    }
}

// Initialize the API key manager (only for production)
let apiKeyManager = null;

// Initialize Ollama client (only for development)
let ollamaClient = null;

if (isDevelopment) {
    // Development: Use Ollama
    ollamaClient = new Ollama({
        host: process.env.OLLAMA_HOST || 'https://ollama.com',
        headers: true ? {
            Authorization: `Bearer 96a54c567d8c4a90a60497bd2c4e87e6.QdoVFFd_LlRGUR_S-iqR_a47`
        } : {}
    });
    console.log('🔧 Development mode: Using Ollama for AI requests');
} else {
    // Production: Use Google Generative AI
    apiKeyManager = new APIKeyManager();
    console.log('🚀 Production mode: Using Google Generative AI');
}

/**
 * Calls AI model (Ollama in dev, Google Generative AI in prod) with automatic content optimization
 * @param {string} systemPrompt - The system message
 * @param {string} userPrompt - The user message
 * @param {Object} options - Additional options for the model
 * @returns {Promise<string>} - The AI response
 */
async function callLangChain(systemPrompt, userPrompt, options = {}) {
    // Prepare and optimize content before making the request
    const preparedContent = contentManager.prepareForLLM(
        systemPrompt, 
        userPrompt, 
        options.task || ''
    );

    // Log optimization info if content was modified
    if (preparedContent.wasOptimized) {
        console.log(`[LangChain] Content optimized: ${preparedContent.tokenInfo.totalTokens} tokens (stage: ${preparedContent.optimizationStage})`);
    }

    // Use optimized content for the actual call
    if (isDevelopment) {
        return await callOllama(preparedContent.systemPrompt, preparedContent.userContent, options);
    } else {
        return await callGoogleAI(preparedContent.systemPrompt, preparedContent.userContent, options);
    }
}

/**
 * Call Ollama for development environment
 * @param {string} systemPrompt - The system message
 * @param {string} userPrompt - The user message
 * @param {Object} options - Additional options
 * @returns {Promise<string>} - The AI response
 */
async function callOllama(systemPrompt, userPrompt, options = {}) {
    try {
        const model = options.model || 'gpt-oss:20b';
        
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        console.log(`🔧 [Dev] Calling Ollama with model: ${model}`);
        
        // Get token configuration from environment
        const maxTokens = options.maxOutputTokens || 
                         parseInt(process.env.OLLAMA_MAX_TOKENS) || 
                         1024;
        const temperature = options.temperature || 
                           parseFloat(process.env.OLLAMA_TEMPERATURE) || 
                           0.3;
        
        // For streaming responses, we'll collect the full response
        const response = await ollamaClient.chat({
            model: model,
            messages: messages,
            stream: false, // Set to false to get complete response at once
            options: {
                temperature: temperature,
                top_p: options.top_p || 0.9,
                num_predict: maxTokens, // Ollama uses num_predict instead of max_tokens
                num_ctx: parseInt(process.env.OLLAMA_CONTEXT_LENGTH) || 8192,
                repeat_penalty: 1.1,
                ...options
            }
        });

        console.log(`✅ [Dev] Ollama response received successfully (${maxTokens} max tokens)`);
        return response.message.content;
        
    } catch (error) {
        console.error('❌ [Dev] Ollama call failed:', error);
        throw new Error(`Failed to process request with Ollama: ${error.message}`);
    }
}

/**
 * Call Google Generative AI for production environment
 * @param {string} systemPrompt - The system message
 * @param {string} userPrompt - The user message
 * @param {Object} options - Additional options
 * @returns {Promise<string>} - The AI response
 */
async function callGoogleAI(systemPrompt, userPrompt, options = {}) {
    const maxRetries = Math.min(3, apiKeyManager.getTotalKeys());
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const apiKey = apiKeyManager.getNextKey();
            
            const model = new ChatGoogleGenerativeAI({
                model: options.model || "gemini-1.5-flash",
                temperature: options.temperature || 0.2,
                maxOutputTokens: options.maxOutputTokens || 1024,
                apiKey: apiKey,
                ...options
            });

            const messages = [
                new SystemMessage(systemPrompt),
                new HumanMessage(userPrompt)
            ];

            const response = await model.invoke(messages);
            
            // Log successful API key usage (optional, for monitoring)
            console.log(`✅ [Prod] Successfully used Google AI key ending in ...${apiKey.slice(-4)} (attempt ${attempt + 1})`);
            
            return response.content;
        } catch (error) {
            lastError = error;
            console.warn(`⚠️ [Prod] Google AI call failed on attempt ${attempt + 1}:`, error.message);
            
            // If it's a rate limit or quota error, try next key
            if (error.message.includes('quota') || 
                error.message.includes('rate') || 
                error.message.includes('limit') ||
                error.status === 429) {
                continue;
            }
            
            // For other errors, don't retry with different keys
            break;
        }
    }
    
    // If all retries failed
    console.error('❌ [Prod] All Google AI key attempts failed:', lastError);
    throw new Error(`Failed to process request with Google AI after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Batch process multiple prompts efficiently
 * @param {Array} prompts - Array of {systemPrompt, userPrompt, options} objects
 * @returns {Promise<Array>} - Array of responses
 */
async function batchCallLangChain(prompts) {
    const results = await Promise.allSettled(
        prompts.map(({ systemPrompt, userPrompt, options }) => 
            callLangChain(systemPrompt, userPrompt, options)
        )
    );
    
    return results.map(result => {
        if (result.status === 'fulfilled') {
            return { success: true, data: result.value };
        } else {
            return { success: false, error: result.reason.message };
        }
    });
}

/**
 * Get API statistics (works for both environments)
 * @returns {Object} - Statistics about API usage
 */
function getAPIKeyStats() {
    if (isDevelopment) {
        return {
            environment: 'development',
            provider: 'Ollama',
            host: ollamaClient?.config?.host || 'http://localhost:11434',
            model: 'gpt-oss:20b'
        };
    } else {
        return {
            environment: 'production',
            provider: 'Google Generative AI',
            totalKeys: apiKeyManager.getTotalKeys(),
            currentIndex: apiKeyManager.getCurrentIndex(),
            nextKeyPreview: apiKeyManager.apiKeys[apiKeyManager.getCurrentIndex()]?.slice(-4) || 'N/A'
        };
    }
}

module.exports = {
    callLangChain,
    batchCallLangChain,
    getAPIKeyStats
};
