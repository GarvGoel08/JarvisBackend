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

CRITICAL FORMATTING RULES:
1. NEVER truncate or skip products - format ALL items provided in the data
2. Write in a conversational, helpful tone
3. Use simple bullet points (•) for lists, no complex tables
4. Include all important details (names, prices, ratings, links)
5. Use clear headings with ## for main sections
6. Keep responses concise but complete - include EVERY product
7. Always include source information at the end
8. Use ₹ symbol for Indian prices, $ for USD prices
9. Format ratings as "X.X★" or "X.X/5 stars"
10. Include review counts when available
11. Make Amazon/product links clickable with [text](url) format
12. For large lists, mention total count and ensure all items are included

RESPONSE STRUCTURE:
- Start with a brief summary including total count
- List ALL items with key details
- End with source and date information
- NO tables, NO JSON, NO complex formatting
- Keep it conversational and easy to read

SAMPLE FORMAT FOR MULTIPLE PRODUCTS:
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

[Continue for ALL products - do not stop or truncate]

---
*Source: [source] | Found [X] products | Updated: [date]*

IMPORTANT: If there are many products, you MUST include them all. Do not use phrases like "and many more" or truncate the list. The user expects to see every product that was found.`;

        // Handle large datasets more efficiently
        let processedData = dataToFormat;
        let isLargeDataset = false;

        // If we have products, process them intelligently
        if (dataToFormat && dataToFormat.products && dataToFormat.products.length > 0) {
            const products = dataToFormat.products;
            isLargeDataset = products.length > 20;
            
            // For large datasets, create a more concise summary for the LLM
            if (isLargeDataset) {
                processedData = {
                    ...dataToFormat,
                    products: products.map(product => ({
                        name: product.name,
                        price: product.price,
                        priceNumeric: product.priceNumeric,
                        rating: product.rating,
                        reviewCount: product.reviewCount,
                        link: product.link,
                        brand: product.brand
                    }))
                };
                console.log(`[ResponseFormatter] Processing large dataset with ${products.length} products`);
            }
        }

        // Create the user prompt with optimized data
        const userPromptForFormatter = `Please format this data into a user-friendly response for the query: "${userPrompt}"

${isLargeDataset ? 'Note: This is a large dataset. Please format ALL items in the list, ensuring none are truncated.' : ''}

Raw Data Summary:
- Total Products: ${dataToFormat?.products?.length || 'Unknown'}
- Data Source: ${dataSource}
- Source Agent: ${lastAgent}

Product Details:
${JSON.stringify(processedData, null, 2)}

IMPORTANT INSTRUCTIONS:
1. Format ALL products in the dataset - do not truncate or skip any
2. Use bullet points (•) for easy reading
3. Include: Product name, price, rating, review count, key features
4. Make all Amazon links clickable with [View on Amazon](link) format
5. Keep descriptions concise but informative
6. If there are more than 10 products, group them logically or mention "showing top X results"
7. Always include the total number of products found

Create a complete response that includes every product in the data.`;

        // Get the formatted response with increased token limit for large datasets
        const tokenLimit = isLargeDataset ? 4000 : 2500;
        const formattedResponse = await callLangChain(systemPrompt, userPromptForFormatter, {
            maxTokens: tokenLimit,
            temperature: 0.1 // Even lower temperature for more consistent formatting
        });

        console.log(`[ResponseFormatter] Successfully formatted response (${formattedResponse.length} chars)`);

        // Quality check: Ensure all products are included in the response
        let finalResponse = formattedResponse.trim();
        
        if (dataToFormat?.products?.length > 0) {
            const expectedProductCount = dataToFormat.products.length;
            const responseProductCount = (finalResponse.match(/•\s*\*\*/g) || []).length;
            
            console.log(`[ResponseFormatter] Expected ${expectedProductCount} products, found ${responseProductCount} in response`);
            
            // If significant products are missing, use direct formatting
            if (responseProductCount < expectedProductCount * 0.8) {
                console.log(`[ResponseFormatter] LLM response appears truncated, using direct formatting`);
                finalResponse = createDirectFormattedResponse(userPrompt, dataToFormat, dataSource);
            }
        }

        return {
            isCompleted: true,
            response: finalResponse,
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
 * Create a direct formatted response when LLM truncates the output
 */
function createDirectFormattedResponse(userPrompt, dataToFormat, dataSource) {
    if (!dataToFormat?.products?.length) {
        return `## Results for: ${userPrompt}\n\nI found some information but couldn't format it properly. Please try a more specific query.`;
    }
    
    const products = dataToFormat.products;
    const pageUrl = dataToFormat.pageUrl || dataSource;
    
    let response = `## Best Phones Under ₹20,000 on Amazon\n\n`;
    response += `I found ${products.length} great options that fit your budget. Here are all the phones with their details:\n\n`;
    
    products.forEach((product, index) => {
        response += `• **${product.name || `Product ${index + 1}`}** - ${product.price || 'Price not available'}\n`;
        
        if (product.rating) {
            response += `  Rating: ${product.rating}★`;
            if (product.reviewCount) {
                response += ` (${product.reviewCount.toLocaleString()} reviews)`;
            }
            response += '\n';
        }
        
        // Add key features from the product name
        if (product.name && product.name.length > 50) {
            const features = extractKeyFeatures(product.name);
            if (features.length > 0) {
                response += `  Key features: ${features.join(', ')}\n`;
            }
        }
        
        if (product.link) {
            response += `  [View on Amazon](${product.link})\n`;
        }
        
        response += '\n';
    });
    
    response += `---\n*Source: ${pageUrl} | Found ${products.length} products | Updated: ${new Date().toLocaleDateString()}*`;
    
    return response;
}

/**
 * Extract key features from product names
 */
function extractKeyFeatures(productName) {
    const features = [];
    const name = productName.toLowerCase();
    
    // RAM detection
    const ramMatch = name.match(/(\d+)\s*gb\s*ram/);
    if (ramMatch) features.push(`${ramMatch[1]}GB RAM`);
    
    // Storage detection
    const storageMatch = name.match(/(\d+)\s*gb\s*storage/);
    if (storageMatch) features.push(`${storageMatch[1]}GB Storage`);
    
    // Display features
    if (name.includes('amoled')) features.push('AMOLED display');
    if (name.includes('120hz')) features.push('120Hz refresh rate');
    
    // Camera features
    const cameraMatch = name.match(/(\d+)\s*mp/);
    if (cameraMatch) features.push(`${cameraMatch[1]}MP camera`);
    
    // Battery
    const batteryMatch = name.match(/(\d+)\s*mah/);
    if (batteryMatch) features.push(`${batteryMatch[1]}mAh battery`);
    
    // 5G support
    if (name.includes('5g')) features.push('5G support');
    
    return features.slice(0, 3); // Limit to 3 key features
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
