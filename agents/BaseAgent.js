const { callLangChain } = require('../services/langchain');

/**
 * BaseAgent - Main decision-making and routing agent
 * Now works with AgentManager for centralized agent management
 */

/**
 * Base Agent - Main decision-making and routing agent
 * @param {Object} params - Parameters object
 * @param {string} params.userPrompt - The user's input/question
 * @param {string|null} params.lastAgentUsed - The last agent that was used
 * @param {Object} params.progress - Current progress information
 * @returns {Promise<Object>} - Response object with routing decision or final answer
 */
async function BaseAgent(params) {
    try {
        // Handle both old signature (userPrompt, lastAgentUsed, progress) and new object signature
        let userPrompt, lastAgentUsed, progress;
        
        if (typeof params === 'string') {
            // Old signature: BaseAgent(userPrompt, lastAgentUsed, progress)
            userPrompt = params;
            lastAgentUsed = arguments[1] || null;
            progress = arguments[2] || {};
        } else {
            // New signature: BaseAgent({userPrompt, lastAgentUsed, progress, webAgentResult, agentResult})
            ({ userPrompt, lastAgentUsed = null, progress = {}, webAgentResult, agentResult } = params);
            
            // If webAgentResult or agentResult is passed, include it in progress for context
            if (webAgentResult) {
                progress.webAgentResult = webAgentResult;
                progress.lastAgentResult = webAgentResult;
            }
            if (agentResult) {
                progress.agentResult = agentResult;
                progress.lastAgentResult = agentResult;
            }
        }

        // Validate inputs
        if (!userPrompt || typeof userPrompt !== 'string') {
            throw new Error('Valid user prompt is required');
        }

        // Get available agents from AgentManager (lazy import to avoid circular dependency)
        const { AVAILABLE_AGENTS } = require('./AgentManager');

        // Create system prompt for decision making
        const systemPrompt = `You are a smart routing agent that decides whether to:
1. Provide a direct answer if you have sufficient current knowledge and the question doesn't require real-time data
2. Route to a specialized agent if additional processing is needed
3. Formulate final comprehensive responses when called to synthesize results from other agents

Available Agents:
${AVAILABLE_AGENTS.map(agent => 
    `- ${agent.name}: ${agent.description}
  Status: ${agent.status || 'implemented'}
  Required params: ${agent.requiredParams.join(', ')}
  Optional params: ${agent.optionalParams ? agent.optionalParams.join(', ') : 'none'}
  Capabilities: ${agent.capabilities.join(', ')}
  Examples: ${agent.examples ? agent.examples.join('; ') : 'none'}`
).join('\n\n')}

Current Context:
- Last Agent Used: ${lastAgentUsed || 'None'}
- Failed Agents: ${progress.failedAgents ? progress.failedAgents.join(', ') : 'None'}
- Final Formulation Mode: ${progress.finalFormulation ? 'YES - Provide comprehensive final response' : 'NO'}
- Progress: ${JSON.stringify(progress)}

Response Rules:
1. **ROUTING AND DECISION MODE**: Your primary job is routing to appropriate agents or providing quick direct answers to simple questions.

2. If you can answer directly with current knowledge (factual, general knowledge, calculations, etc.) AND the question is simple, respond with:
   {"isCompleted": true, "response": "your direct answer"}

3. If you need to route to an agent for web data, complex analysis, or specialized tasks, respond with:
   {"isCompleted": false, "nextAgent": "AgentName", "params": {"param1": "value1"}, "reasoning": "why this agent is needed"}

4. CRITICAL: Do NOT route to agents listed in Failed Agents. These have already been tried and failed.

5. **IMPORTANT**: When finalFormulation is true, it means other agents have completed their work and you're asked to provide a final response. However, the AgentManager will automatically route the result to ResponseFormatterAgent for proper formatting. In this case, just acknowledge completion:
   {"isCompleted": true, "response": "Agent processing completed. Results will be formatted for display."}

6. Be conservative about routing - only route when you truly need additional data or specialized processing.

7. Consider the conversation flow and previous agents used to avoid loops.

8. Only route to agents with status 'implemented' or no status field. Do not route to 'planned' agents.

9. Ensure all required parameters are included in the params object.

10. Focus on decision-making and routing rather than detailed response formatting - that's handled by specialized agents.

12. In the final response, give a concise response, never explicitely state what the models were unable to do, instead just give the best possible response based on the information available.

13. If information generated is very generic and proper answer is not given, return a response that is more helpful and detailed based on the information available.

4. Use Plain Text with some formatting for readability, avoid cokmplex structures like tables since it is not handled.`;

        // Create user prompt with context
        const contextualPrompt = `
User Query: "${userPrompt}"

Previous Context:
- Last Agent: ${lastAgentUsed || 'None'}
- Failed Agents: ${progress.failedAgents ? progress.failedAgents.join(', ') : 'None'}
- Final Formulation Mode: ${progress.finalFormulation ? 'YES - Provide final comprehensive response' : 'NO'}

${progress.lastAgentResult ? `
Previous Agent Result:
${JSON.stringify(progress.lastAgentResult, null, 2)}
` : ''}

${progress.finalFormulation ? 
    `IMPORTANT: You are in FINAL FORMULATION MODE. 
    
    Analyze the agent results above and provide a comprehensive, well-structured final response based on the ACTUAL DATA found.
    
    Instructions:
    - Extract specific details from the agent results (product names, prices, ratings, etc.)
    - Format the information in a user-friendly way
    - If products were found, list them clearly with details
    - If no data was found, explain what happened and suggest alternatives
    - Focus on the ACTUAL RESULTS, don't give generic advice
    - Use clear formatting with bullet points or numbered lists
    - Be specific and detailed based on the real data found
    
    Do NOT route to other agents.` : 
    'Please analyze this request and decide whether to provide a direct answer or route to a specialized agent.'
}

Remember: Do NOT route to any agents listed in Failed Agents.`;

        // Call LangChain for decision making
        const aiResponse = await callLangChain(systemPrompt, contextualPrompt);
        
        // Parse the AI response
        let parsedResponse;
        try {
            // Remove ```json and ``` if present
            const cleanedResponse = aiResponse.replace(/```json?/g, '').replace(/```/g, '').trim();
            parsedResponse = JSON.parse(cleanedResponse);
        } catch (parseError) {
            // If JSON parsing fails, treat as a direct response
            console.warn('Failed to parse AI response as JSON, treating as direct response');
            parsedResponse = {
                isCompleted: true,
                response: aiResponse
            };
        }

        // Validate the parsed response
        if (parsedResponse.isCompleted) {
            // Check if we're in final formulation mode or should enhance the response
            let finalResponse = parsedResponse.response;
            
            // If we're in final formulation mode, prioritize the AI-generated response
            if (progress.finalFormulation) {
                // Check if the prompt indicates we're trying to reprocess already formatted data
                if (userPrompt.includes('WebAgent Results:') && userPrompt.includes('"result":')) {
                    // This looks like we're being asked to reprocess already formatted data
                    // Extract the actual formatted result from the WebAgent
                    try {
                        const webAgentMatch = userPrompt.match(/WebAgent Results:\s*({.*})/s);
                        if (webAgentMatch) {
                            const webAgentResult = JSON.parse(webAgentMatch[1]);
                            if (webAgentResult.result && typeof webAgentResult.result === 'string' && 
                                webAgentResult.result.includes('**Smartphones') && 
                                webAgentResult.result.includes('### ')) {
                                // This is already a formatted response, return it directly
                                console.log('[BaseAgent] Detected already formatted result, returning as-is');
                                return {
                                    isCompleted: true,
                                    response: webAgentResult.result,
                                    timestamp: new Date().toISOString(),
                                    agent: 'BaseAgent',
                                    finalFormulation: true,
                                    directPassthrough: true
                                };
                            }
                        }
                    } catch (e) {
                        console.warn('[BaseAgent] Failed to parse WebAgent result for passthrough check');
                    }
                }
                
                // In final formulation mode, the AI should provide a comprehensive response
                // But we can still enhance it with extracted data if the response is too generic
                if (finalResponse.length < 200 || finalResponse.includes('successfully navigated') || 
                    finalResponse.includes('I attempted to help')) {
                    const enhancedResponse = generateDetailedResponse(userPrompt, progress);
                    if (enhancedResponse && enhancedResponse.length > finalResponse.length) {
                        finalResponse = enhancedResponse;
                    }
                }
            } else if (progress.lastAgentResult && (progress.lastAgentResult.isCompleted === false || progress.lastAgentResult.result)) {
                // This means an agent was used but may not have fully completed
                // Enhance the response with extracted information
                const enhancedResponse = generateDetailedResponse(userPrompt, progress);
                if (enhancedResponse && enhancedResponse.length > finalResponse.length) {
                    finalResponse = enhancedResponse;
                }
            }
            
            // Direct response
            return {
                isCompleted: true,
                response: finalResponse,
                timestamp: new Date().toISOString(),
                agent: 'BaseAgent',
                finalFormulation: progress.finalFormulation || false
            };
        } else {
            // Routing response - but check if we're in final formulation mode
            if (progress.finalFormulation) {
                console.warn(`[BaseAgent] AI tried to route in final formulation mode, providing direct response instead`);
                
                // Extract and provide detailed information from previous agent results
                let directResponse = generateDetailedResponse(userPrompt, progress);
                
                return {
                    isCompleted: true,
                    response: directResponse,
                    timestamp: new Date().toISOString(),
                    agent: 'BaseAgent',
                    finalFormulation: true,
                    forcedCompletion: true
                };
            }
            
            const { nextAgent, params = {}, reasoning } = parsedResponse;
            
            // Check if the agent has already failed
            if (progress.failedAgents && progress.failedAgents.includes(nextAgent)) {
                console.warn(`[BaseAgent] Attempted to route to failed agent ${nextAgent}, providing direct response instead`);
                
                // Extract and provide detailed information from previous agent results
                let directResponse = generateDetailedResponse(userPrompt, progress);
                
                return {
                    isCompleted: true,
                    response: directResponse,
                    timestamp: new Date().toISOString(),
                    agent: 'BaseAgent',
                    fallbackResponse: true
                };
            }
            
            // Validate that the next agent exists and is implemented
            const { AVAILABLE_AGENTS } = require('./AgentManager');
            const targetAgent = AVAILABLE_AGENTS.find(agent => agent.name === nextAgent);
            
            if (!targetAgent) {
                throw new Error(`Invalid agent specified: ${nextAgent}`);
            }
            
            if (targetAgent.status === 'planned') {
                throw new Error(`Agent ${nextAgent} is not yet implemented`);
            }

            return {
                isCompleted: false,
                nextAgent,
                params,
                reasoning: reasoning || `Routing to ${nextAgent} for specialized processing`,
                availableAgents: AVAILABLE_AGENTS,
                timestamp: new Date().toISOString(),
                agent: 'BaseAgent'
            };
        }

    } catch (error) {
        console.error('Error in BaseAgent:', error);
        return {
            isCompleted: true,
            response: `I encountered an error while processing your request: ${error.message}. Please try rephrasing your question.`,
            error: true,
            timestamp: new Date().toISOString(),
            agent: 'BaseAgent'
        };
    }
}

/**
 * Generate a detailed response based on previous agent results
 * @param {string} userPrompt - Original user query
 * @param {Object} progress - Progress object containing agent results
 * @returns {string} - Formatted response with extracted information
 */
function generateDetailedResponse(userPrompt, progress) {
    let response = '';
    
    // Check if we have WebAgent results with extracted product data
    if (progress.lastAgentResult && progress.lastAgentResult.result) {
        const agentResult = progress.lastAgentResult.result;
        
        // Check for extracted data from WebAgent
        if (agentResult.extractedData && agentResult.extractedData.products && agentResult.extractedData.products.length > 0) {
            const products = agentResult.extractedData.products;
            const query = userPrompt.toLowerCase();
            
            if (query.includes('phone') && query.includes('20')) {
                response = `# Phones Under ₹20,000 on Amazon India\n\n`;
                response += `I found **${products.length} phones** under ₹20,000. Here are the details:\n\n`;
                
                products.forEach((product, index) => {
                    response += `**${index + 1}. ${product.name || 'Product Name Not Available'}**\n`;
                    if (product.brand) response += `   - Brand: ${product.brand}\n`;
                    if (product.price) response += `   - Price: ${product.price}\n`;
                    if (product.rating) response += `   - Rating: ${product.rating}/5\n`;
                    if (product.reviewCount) response += `   - Reviews: ${product.reviewCount} reviews\n`;
                    if (product.link) response += `   - Link: ${product.link}\n`;
                    if (product.offers && product.offers.length > 0) {
                        response += `   - Offers: ${product.offers.join(', ')}\n`;
                    }
                    response += '\n';
                });
                
                response += `\n**Source:** ${agentResult.extractedData.pageUrl}\n`;
                response += `**Last Updated:** ${agentResult.extractedData.extractionTime}\n`;
                
            } else {
                // Generic product listing
                response = `# Search Results\n\n`;
                response += `I found **${products.length} products** matching your search. Here are the details:\n\n`;
                
                products.forEach((product, index) => {
                    response += `**${index + 1}. ${product.name || 'Product Name Not Available'}**\n`;
                    if (product.price) response += `   - Price: ${product.price}\n`;
                    if (product.rating) response += `   - Rating: ${product.rating}/5\n`;
                    if (product.reviewCount) response += `   - Reviews: ${product.reviewCount} reviews\n`;
                    if (product.link) response += `   - Link: ${product.link}\n`;
                    response += '\n';
                });
            }
            
            return response;
        }
        
        // Check for partial results or summary
        if (agentResult.summary) {
            response = `# Search Results Summary\n\n`;
            response += `${agentResult.summary}\n\n`;
            
            if (agentResult.status === 'Incomplete') {
                response += `**Note:** The search was not fully completed, but here's what I found:\n`;
                response += `- Visited: ${progress.lastAgentResult.url}\n`;
                response += `- Iterations completed: ${progress.lastAgentResult.totalIterations || 'Unknown'}\n\n`;
                response += `**Suggestions:**\n`;
                response += `1. Try visiting the website directly\n`;
                response += `2. Use the website's search and filter options\n`;
                response += `3. Check for mobile apps which might have better performance\n`;
            }
            
            return response;
        }
    }
    
    // Fallback for legacy WebAgent results or no structured data
    if (progress.lastAgentResult && progress.lastAgentResult.allSteps) {
        const steps = progress.lastAgentResult.allSteps;
        let foundProducts = [];
        let searchUrl = '';
        let totalProducts = 0;
        
        // Extract information from the steps
        for (const step of steps) {
            if (step.result) {
                const result = step.result;
                
                // Extract search URL
                if (result.finalUrl && result.finalUrl.includes('search')) {
                    searchUrl = result.finalUrl;
                }
                
                // Extract product information from interaction or browsing steps
                if (result.updatedPageInfo && result.updatedPageInfo.content) {
                    const content = result.updatedPageInfo.content;
                    
                    // Try to extract product count
                    const productCountMatch = content.match(/(\d{1,3}(?:,\d{3})*)\s*results/i);
                    if (productCountMatch) {
                        totalProducts = productCountMatch[1];
                    }
                    
                    // Extract specific product mentions from content
                    const productMatches = content.match(/(realme|vivo|Motorola|OPPO|Samsung|Xiaomi|Redmi)[^₹]*₹[\d,]+[^₹]*?(?=(?:realme|vivo|Motorola|OPPO|Samsung|Xiaomi|Redmi|Add to Compare|₹))/gi);
                    if (productMatches && productMatches.length > 0) {
                        foundProducts = productMatches.slice(0, 5); // Get first 5 products
                    }
                }
                
                // Extract product info from ecommerce data if available
                if (result.pageInfo && result.pageInfo.ecommerce && result.pageInfo.ecommerce.products) {
                    const products = result.pageInfo.ecommerce.products;
                    foundProducts = foundProducts.concat(products.slice(0, 3));
                }
            }
        }
        
        // Generate response based on extracted information
        if (userPrompt.toLowerCase().includes('phone') && userPrompt.toLowerCase().includes('20')) {
            response = `# Phones Under ₹20,000 Search Results\n\n`;
            
            if (totalProducts) {
                response += `I found **${totalProducts} phones** under ₹20,000 available. Here are some key findings:\n\n`;
            }
            
            if (foundProducts.length > 0) {
                response += `## Top Phone Options:\n`;
                foundProducts.forEach((product, index) => {
                    if (typeof product === 'string') {
                        // Clean up the product string
                        const cleanProduct = product.replace(/\s+/g, ' ').trim();
                        if (cleanProduct.length > 20) {
                            response += `${index + 1}. ${cleanProduct}\n`;
                        }
                    } else if (product.title && product.price) {
                        response += `${index + 1}. **${product.title}** - ${product.price}\n`;
                    }
                });
                response += `\n`;
            }
            
            if (searchUrl) {
                response += `## Complete Results:\n`;
                response += `You can view all available phones under ₹20,000 at: ${searchUrl}\n\n`;
            }
            
            response += `## Recommendations:\n`;
            response += `- **Popular Brands**: Realme, Vivo, Motorola, OPPO are offering good phones in this range\n`;
            response += `- **Key Features to Look For**: 6GB+ RAM, 128GB+ storage, 50MP+ camera, 5000mAh+ battery\n`;
            response += `- **5G Support**: Many phones in this range now offer 5G connectivity\n`;
            response += `- **Check Reviews**: Always read customer reviews and ratings before purchasing\n\n`;
            response += `Would you like me to help you compare specific models or find phones with particular features?`;
        } else {
            // Generic response for other queries
            response = generateGenericResponse(userPrompt, progress);
        }
    } else {
        // Fallback when no useful data is found
        response = generateGenericResponse(userPrompt, progress);
    }
    
    return response;
}

/**
 * Generate a generic response when specific data extraction fails
 * @param {string} userPrompt - Original user query
 * @param {Object} progress - Progress object
 * @returns {string} - Generic helpful response
 */
function generateGenericResponse(userPrompt, progress) {
    let response = `I attempted to help with your request: "${userPrompt}"\n\n`;
    
    if (progress.lastAgentResult && progress.lastAgentResult.result) {
        const result = progress.lastAgentResult.result;
        if (result.summary) {
            response += `Here's what I found: ${result.summary}\n\n`;
        } else if (result.information) {
            response += `Information gathered: ${result.information}\n\n`;
        }
    }
    
    // Add helpful suggestions based on the query
    if (userPrompt.toLowerCase().includes('phone')) {
        response += `For finding phones in your budget:\n`;
        response += `1. Visit Flipkart.com directly and use their search and filter options\n`;
        response += `2. Compare features like RAM, storage, camera quality, and battery life\n`;
        response += `3. Check customer reviews and ratings\n`;
        response += `4. Look for ongoing offers and exchange deals\n`;
    } else if (userPrompt.toLowerCase().includes('search') || userPrompt.toLowerCase().includes('find')) {
        response += `For better search results:\n`;
        response += `1. Try using more specific keywords\n`;
        response += `2. Use official websites or apps for the most up-to-date information\n`;
        response += `3. Compare multiple sources for accuracy\n`;
    }
    
    return response;
}

/**
 * Get information about available agents
 * @returns {Array} Array of available agents with their configurations
 */
function getAvailableAgents() {
    const { AVAILABLE_AGENTS } = require('./AgentManager');
    return AVAILABLE_AGENTS;
}

module.exports = {
    BaseAgent,
    getAvailableAgents
};
