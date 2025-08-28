/**
 * Content Management Utility
 * Handles token counting, content truncation, and smart content filtering
 */

require('dotenv').config();

class ContentManager {
    constructor() {
        this.maxContentLength = parseInt(process.env.MAX_CONTENT_LENGTH) || 6000;
        this.maxTokensPerRequest = parseInt(process.env.MAX_TOKENS_PER_REQUEST) || 3500;
        this.enableChunking = process.env.ENABLE_CONTENT_CHUNKING === 'true';
    }

    /**
     * Estimate tokens in text (rough approximation)
     * @param {string} text - Text to analyze
     * @returns {number} Estimated token count
     */
    estimateTokens(text) {
        if (!text || typeof text !== 'string') return 0;
        
        // More accurate token estimation
        // English: ~4 chars per token, but varies with punctuation and structure
        const words = text.split(/\s+/).filter(word => word.length > 0);
        const characters = text.length;
        
        // Weighted estimation considering both word count and character count
        const wordBasedEstimate = words.length * 1.3; // Average 1.3 tokens per word
        const charBasedEstimate = characters / 4; // ~4 chars per token
        
        // Take the average for better accuracy
        return Math.ceil((wordBasedEstimate + charBasedEstimate) / 2);
    }

    /**
     * Validate if request size is within limits
     * @param {string} prompt - System prompt
     * @param {string} content - User content
     * @returns {Object} Validation result
     */
    validateRequestSize(prompt, content) {
        const promptTokens = this.estimateTokens(prompt);
        const contentTokens = this.estimateTokens(content);
        const totalTokens = promptTokens + contentTokens;
        
        return {
            isValid: totalTokens <= this.maxTokensPerRequest,
            totalTokens,
            promptTokens,
            contentTokens,
            maxTokens: this.maxTokensPerRequest,
            exceedsBy: Math.max(0, totalTokens - this.maxTokensPerRequest)
        };
    }

    /**
     * Smart content truncation that preserves structure
     * @param {string} content - Content to truncate
     * @param {number} maxLength - Maximum length (optional)
     * @returns {string} Truncated content
     */
    truncateContent(content, maxLength = null) {
        if (!content || typeof content !== 'string') return '';
        
        const targetLength = maxLength || this.maxContentLength;
        
        if (content.length <= targetLength) {
            return content;
        }

        // Try to truncate at natural boundaries
        const truncated = content.substring(0, targetLength);
        
        // Find the last complete sentence
        const lastPeriod = truncated.lastIndexOf('.');
        const lastNewline = truncated.lastIndexOf('\n');
        const lastSpace = truncated.lastIndexOf(' ');
        
        // Choose the best truncation point
        let cutPoint = targetLength;
        if (lastPeriod > targetLength * 0.8) {
            cutPoint = lastPeriod + 1;
        } else if (lastNewline > targetLength * 0.8) {
            cutPoint = lastNewline;
        } else if (lastSpace > targetLength * 0.8) {
            cutPoint = lastSpace;
        }

        const result = content.substring(0, cutPoint).trim();
        return result + (cutPoint < content.length ? '\n... [Content truncated for token limits]' : '');
    }

    /**
     * Extract and filter relevant content for web scraping
     * @param {Object} pageData - Raw page data
     * @param {string} task - Current task description
     * @returns {Object} Filtered and optimized page data
     */
    optimizePageData(pageData, task = '') {
        if (!pageData || typeof pageData !== 'object') {
            return { error: 'Invalid page data' };
        }

        // Create optimized version with relevant content only
        const optimized = {
            title: pageData.title || '',
            url: pageData.url || '',
            readyState: pageData.readyState || '',
        };

        // Add headings (always important for structure)
        if (pageData.headings && Array.isArray(pageData.headings)) {
            optimized.headings = pageData.headings
                .slice(0, 15) // Limit to first 15 headings
                .map(h => ({
                    level: h.level,
                    text: this.truncateContent(h.text, 200)
                }));
        }

        // Add interactive elements (essential for actions)
        if (pageData.content?.clickables) {
            optimized.interactiveElements = pageData.content.clickables
                .filter(el => el.text && el.text.trim().length > 0)
                .slice(0, 30) // Limit to 30 most relevant
                .map(el => ({
                    text: this.truncateContent(el.text, 100),
                    tagName: el.tagName,
                    href: el.href,
                    className: el.className,
                    id: el.id
                }));
        }

        // Add forms (important for interactions)
        if (pageData.content?.forms) {
            optimized.forms = pageData.content.forms.map(form => ({
                action: form.action,
                method: form.method,
                inputs: form.inputs?.slice(0, 10).map(input => ({
                    type: input.type,
                    name: input.name,
                    placeholder: this.truncateContent(input.placeholder, 50)
                }))
            }));
        }

        // Add relevant content based on task
        if (pageData.content?.dataContainers) {
            optimized.contentContainers = pageData.content.dataContainers
                .filter(container => container.hasContent)
                .slice(0, 10) // Limit containers
                .map(container => ({
                    textContent: this.truncateContent(container.textContent, 300),
                    tagName: container.tagName,
                    className: container.className,
                    linkCount: container.linkCount,
                    imageCount: container.imageCount
                }));
        }

        // Add essential page text (truncated)
        if (pageData.bodyText) {
            optimized.pageText = this.truncateContent(pageData.bodyText, 2000);
        }

        // Add page metrics (lightweight)
        if (pageData.content?.totalElements) {
            optimized.pageMetrics = {
                totalElements: pageData.content.totalElements.divs + pageData.content.totalElements.spans,
                links: pageData.content.totalElements.links,
                forms: pageData.content.totalElements.forms,
                buttons: pageData.content.totalElements.buttons
            };
        }

        return optimized;
    }

    /**
     * Create content chunks for large content processing
     * @param {string} content - Content to chunk
     * @param {number} chunkSize - Size of each chunk
     * @returns {Array} Array of content chunks
     */
    createContentChunks(content, chunkSize = 3000) {
        if (!content || content.length <= chunkSize) {
            return [content];
        }

        const chunks = [];
        let currentPos = 0;

        while (currentPos < content.length) {
            let chunkEnd = Math.min(currentPos + chunkSize, content.length);
            
            // Try to end at a natural boundary
            if (chunkEnd < content.length) {
                const lastPeriod = content.lastIndexOf('.', chunkEnd);
                const lastNewline = content.lastIndexOf('\n', chunkEnd);
                
                if (lastPeriod > currentPos + chunkSize * 0.8) {
                    chunkEnd = lastPeriod + 1;
                } else if (lastNewline > currentPos + chunkSize * 0.8) {
                    chunkEnd = lastNewline;
                }
            }

            chunks.push(content.substring(currentPos, chunkEnd).trim());
            currentPos = chunkEnd;
        }

        return chunks.filter(chunk => chunk.length > 0);
    }

    /**
     * Prepare content for LLM request with automatic optimization
     * @param {string} systemPrompt - System prompt
     * @param {string|Object} userContent - User content (string or object)
     * @param {string} task - Current task
     * @returns {Object} Optimized content ready for LLM
     */
    prepareForLLM(systemPrompt, userContent, task = '') {
        // Convert object content to string if needed
        let contentString = '';
        if (typeof userContent === 'object') {
            // Optimize object data first
            const optimizedData = this.optimizePageData(userContent, task);
            contentString = JSON.stringify(optimizedData, null, 2);
        } else {
            contentString = userContent || '';
        }

        // Validate initial size
        const validation = this.validateRequestSize(systemPrompt, contentString);
        
        if (validation.isValid) {
            return {
                systemPrompt,
                userContent: contentString,
                tokenInfo: validation,
                wasOptimized: false
            };
        }

        console.log(`[ContentManager] Content too large (${validation.totalTokens} tokens), optimizing...`);

        // Apply progressive truncation
        let optimizedContent = contentString;
        
        // Stage 1: Truncate to max length
        if (optimizedContent.length > this.maxContentLength) {
            optimizedContent = this.truncateContent(optimizedContent);
        }

        // Stage 2: Re-validate
        const secondValidation = this.validateRequestSize(systemPrompt, optimizedContent);
        if (secondValidation.isValid) {
            return {
                systemPrompt,
                userContent: optimizedContent,
                tokenInfo: secondValidation,
                wasOptimized: true,
                optimizationStage: 'truncated'
            };
        }

        // Stage 3: Aggressive truncation (50% of max length)
        const aggressiveLength = Math.floor(this.maxContentLength * 0.5);
        optimizedContent = this.truncateContent(contentString, aggressiveLength);
        
        const finalValidation = this.validateRequestSize(systemPrompt, optimizedContent);
        
        return {
            systemPrompt,
            userContent: optimizedContent,
            tokenInfo: finalValidation,
            wasOptimized: true,
            optimizationStage: 'aggressive',
            warning: finalValidation.isValid ? null : 'Content may still exceed token limits'
        };
    }

    /**
     * Clean HTML content for better processing
     * @param {string} html - HTML content
     * @returns {string} Cleaned content
     */
    cleanHtmlContent(html) {
        if (!html || typeof html !== 'string') return '';

        return html
            // Remove scripts and styles
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
            
            // Remove navigation and footer noise
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            
            // Remove comments and meta tags
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<meta[^>]*>/gi, '')
            .replace(/<link[^>]*>/gi, '')
            
            // Clean up whitespace
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Get content statistics
     * @param {string} content - Content to analyze
     * @returns {Object} Content statistics
     */
    getContentStats(content) {
        if (!content) return { length: 0, tokens: 0, words: 0, lines: 0 };

        const words = content.split(/\s+/).filter(w => w.length > 0);
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        
        return {
            length: content.length,
            tokens: this.estimateTokens(content),
            words: words.length,
            lines: lines.length,
            avgWordsPerLine: Math.round(words.length / Math.max(1, lines.length))
        };
    }
}

module.exports = new ContentManager();
