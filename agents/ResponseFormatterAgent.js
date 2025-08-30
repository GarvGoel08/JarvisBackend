const { callLangChain } = require('../services/langchain');

/**
 * ResponseFormatterAgent - Specialized agent for formatting final user responses
 * Takes raw agent results and formats them into clean, user-friendly responses
 */

/**
 * Response Formatter Agent - Formats raw data into user-friendly responses
 * @param {Object} params - Parameters object
 * @param {string} params.userPrompt - The original user query
 * @param {Object} params.agentResult - Raw result from other agents
 * @param {string} params.lastAgent - Name of the agent that provided the data
 * @returns {Promise<Object>} - Formatted response object
 */
async function ResponseFormatterAgent(params) {
    try {
        const { userPrompt, agentResult, lastAgent } = params;

        if (!userPrompt || !agentResult) {
            throw new Error('userPrompt and agentResult are required');
        }

        console.log(`[ResponseFormatter] Formatting response from ${lastAgent} for user query: "${userPrompt}"`);

        // Extract the actual data from the agent result
        let dataToFormat = null;
        let dataSource = 'Unknown';

        // Handle different agent result structures
        if (agentResult.result && agentResult.result.extractedData) {
            dataToFormat = agentResult.result.extractedData;
            dataSource = agentResult.url || agentResult.result.extractedData.pageUrl || 'Web';
        } else if (agentResult.extractedData) {
            dataToFormat = agentResult.extractedData;
            dataSource = agentResult.url || agentResult.extractedData.pageUrl || 'Web';
        } else if (agentResult.result) {
            dataToFormat = agentResult.result;
            dataSource = agentResult.url || 'Web';
        } else {
            dataToFormat = agentResult;
            dataSource = 'Agent';
        }

        // Create a comprehensive but user-friendly system prompt
        const systemPrompt = `You are a professional response formatter. Your job is to take raw data from web agents and format it into clean, user-friendly responses.

FORMATTING RULES:
1. Write in a conversational, helpful tone
2. Use simple bullet points (•) for lists, no complex tables
3. Include all important details (names, prices, ratings, links)
4. Use clear headings with ## for main sections
5. Keep responses concise but complete
6. Always include source information at the end
7. Use ₹ symbol for Indian prices, $ for USD prices
8. Format ratings as "X.X/5 stars" or "X.X★"
9. Include review counts when available
10. Make Amazon/product links clickable with [text](url) format

RESPONSE STRUCTURE:
- Start with a brief summary
- List items with key details
- End with source and date information
- NO tables, NO JSON, NO complex formatting
- Keep it conversational and easy to read

SAMPLE FORMAT:
## [Query Topic]

I found [X] great options for you:

• **Product Name** - ₹XX,XXX
  Rating: X.X★ (X,XXX reviews)
  Key features: [brief description]
  [View on Amazon](link)

• **Product Name 2** - ₹XX,XXX
  Rating: X.X★ (X,XXX reviews)  
  Key features: [brief description]
  [View on Amazon](link)

---
*Source: Amazon India | Updated: [date]*`;

        // Create the user prompt with the data
        const userPromptForFormatter = `Please format this data into a user-friendly response for the query: "${userPrompt}"

Raw Data:
${JSON.stringify(dataToFormat, null, 2)}

Data Source: ${dataSource}
Source Agent: ${lastAgent}

Create a conversational, well-formatted response that directly answers the user's question. Include all relevant product details but keep it easy to read.`;

        // Get the formatted response
        const formattedResponse = await callLangChain(systemPrompt, userPromptForFormatter, {
            maxTokens: 2000,
            temperature: 0.2 // Low temperature for consistent formatting
        });

        console.log(`[ResponseFormatter] Successfully formatted response (${formattedResponse.length} chars)`);

        return {
            isCompleted: true,
            response: formattedResponse.trim(),
            timestamp: new Date().toISOString(),
            agent: 'ResponseFormatterAgent',
            sourceAgent: lastAgent,
            dataProcessed: dataToFormat?.products?.length || dataToFormat?.length || 1,
            originalQuery: userPrompt
        };

    } catch (error) {
        console.error(`[ResponseFormatter] Error formatting response: ${error.message}`);

        // Fallback: try to extract basic info and format it simply
        try {
            const fallbackResponse = createFallbackResponse(params);
            return {
                isCompleted: true,
                response: fallbackResponse,
                timestamp: new Date().toISOString(),
                agent: 'ResponseFormatterAgent',
                fallback: true,
                error: error.message
            };
        } catch (fallbackError) {
            return {
                isCompleted: true,
                response: "I found some information for your query, but I'm having trouble formatting it properly. Please try rephrasing your question or contact support if this issue persists.",
                timestamp: new Date().toISOString(),
                agent: 'ResponseFormatterAgent',
                error: true,
                message: error.message
            };
        }
    }
}

/**
 * Create a fallback response when AI formatting fails
 */
function createFallbackResponse(params) {
    const { userPrompt, agentResult, lastAgent } = params;
    
    let response = `## Results for: ${userPrompt}\n\n`;
    
    // Try to extract products if available
    if (agentResult?.result?.extractedData?.products) {
        const products = agentResult.result.extractedData.products;
        response += `I found ${products.length} items:\n\n`;
        
        products.slice(0, 10).forEach((product, index) => {
            response += `• **${product.name || 'Product ' + (index + 1)}**`;
            if (product.price) response += ` - ${product.price}`;
            if (product.rating) response += ` | Rating: ${product.rating}★`;
            if (product.reviewCount) response += ` (${product.reviewCount} reviews)`;
            if (product.link) response += `\n  [View Product](${product.link})`;
            response += '\n\n';
        });
        
        if (agentResult.result.extractedData.pageUrl) {
            response += `---\n*Source: ${agentResult.result.extractedData.pageUrl}*`;
        }
    } else if (agentResult?.result?.summary) {
        response += agentResult.result.summary;
    } else {
        response += "I processed your request successfully, but the detailed results are in a format that's difficult to display. Please try a more specific query.";
    }
    
    return response;
}

module.exports = { ResponseFormatterAgent };
