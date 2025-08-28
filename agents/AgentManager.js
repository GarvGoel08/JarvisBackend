const { BaseAgent } = require('./BaseAgent');
const { WebAgent } = require('./WebAgent');
const { callLangChain } = require('../services/langchain');

/**
 * AgentManager - Central agent management and routing system
 * Manages all available agents and handles task routing between them
 */

// Available agents configuration - centralized in AgentManager
const AVAILABLE_AGENTS = [
    {
        name: 'WebAgent',
        description: 'Handles web scraping, browsing, and automation tasks',
        requiredParams: ['url', 'task'],
        optionalParams: ['method', 'maxIterations', 'options'],
        capabilities: [
            'Web scraping and content extraction',
            'Dynamic web browsing with Playwright',
            'Form filling and web interactions',
            'Multi-step web automation',
            'Screenshot capture',
            'Real-time web data fetching'
        ],
        examples: [
            'Scrape product information from an e-commerce site',
            'Fill out a form on a website',
            'Browse multiple pages to gather information',
            'Search for information on a website'
        ]
    },
    {
        name: 'SearchAgent',
        description: 'Performs web searches and information gathering',
        requiredParams: ['query'],
        optionalParams: ['searchType', 'maxResults', 'filters'],
        capabilities: [
            'Web search across multiple search engines',
            'News and current events search',
            'Academic and research queries',
            'Image and video search',
            'Local search and business information'
        ],
        examples: [
            'Search for latest AI developments',
            'Find recent news about a specific topic',
            'Research academic papers on a subject',
            'Look up business information'
        ],
        status: 'planned' // Not yet implemented
    },
    {
        name: 'AnalysisAgent',
        description: 'Performs data analysis, calculations, and processing',
        requiredParams: ['data', 'analysisType'],
        optionalParams: ['format', 'visualizations', 'exportType'],
        capabilities: [
            'Statistical data analysis',
            'Mathematical calculations and modeling',
            'Data visualization and charts',
            'Report generation',
            'Pattern recognition and insights'
        ],
        examples: [
            'Analyze sales data and create insights',
            'Calculate complex mathematical problems',
            'Generate statistical reports',
            'Create data visualizations'
        ],
        status: 'planned' // Not yet implemented
    },
    {
        name: 'CodeAgent',
        description: 'Handles code generation, review, and technical tasks',
        requiredParams: ['codeTask', 'language'],
        optionalParams: ['framework', 'style', 'complexity'],
        capabilities: [
            'Code generation in multiple languages',
            'Code review and optimization',
            'Technical documentation',
            'API development',
            'Database design',
            'Architecture planning'
        ],
        examples: [
            'Generate a REST API in Node.js',
            'Review and optimize existing code',
            'Create technical documentation',
            'Design database schema'
        ],
        status: 'planned' // Not yet implemented
    }
];

class AgentManager {
    constructor() {
        this.agents = new Map();
        this.taskHistory = [];
        this.activeAgents = new Set();
        
        // Register available agents
        this.registerAgent('BaseAgent', BaseAgent);
        this.registerAgent('WebAgent', WebAgent);
        
        console.log(`[AgentManager] Initialized with ${this.agents.size} agents`);
    }
    
    /**
     * Register an agent with the manager
     * @param {string} name - Agent name
     * @param {Function} agentFunction - Agent function
     */
    registerAgent(name, agentFunction) {
        this.agents.set(name, agentFunction);
        console.log(`[AgentManager] Registered agent: ${name}`);
    }
    
    /**
     * Get available agents configuration
     * @returns {Array} Array of available agents
     */
    getAvailableAgents() {
        return AVAILABLE_AGENTS.map(agent => ({
            ...agent,
            isImplemented: this.agents.has(agent.name),
            isActive: this.activeAgents.has(agent.name)
        }));
    }
    
    /**
     * Get specific agent configuration
     * @param {string} agentName - Name of the agent
     * @returns {Object|null} Agent configuration or null if not found
     */
    getAgentInfo(agentName) {
        return AVAILABLE_AGENTS.find(agent => agent.name === agentName) || null;
    }
    
    /**
     * Execute a task using the appropriate agent
     * @param {string} userPrompt - User's input/question
     * @param {string|null} lastAgentUsed - Last agent that was used
     * @param {Object} progress - Current progress information
     * @param {number} maxRoutingDepth - Maximum routing depth to prevent loops
     * @returns {Promise<Object>} Task execution result
     */
    async executeTask(userPrompt, lastAgentUsed = null, progress = {}, maxRoutingDepth = 5) {
        try {
            console.log(`[AgentManager] Executing task: "${userPrompt}"`);
            console.log(`[AgentManager] Last agent: ${lastAgentUsed}, Depth: ${maxRoutingDepth}`);
            
            // Prevent infinite routing loops
            if (maxRoutingDepth <= 0) {
                throw new Error('Maximum routing depth exceeded. Task routing stopped to prevent infinite loops.');
            }
            
            // Always start with BaseAgent for decision making
            let currentResult;
            const startTime = Date.now();
            
            if (!lastAgentUsed || lastAgentUsed === 'BaseAgent') {
                // First call or continuing from BaseAgent
                currentResult = await this.callAgent('BaseAgent', {
                    userPrompt,
                    lastAgentUsed,
                    progress
                });
            } else {
                // Continuing from a specific agent - check if we need BaseAgent routing
                currentResult = await this.handleAgentContinuation(userPrompt, lastAgentUsed, progress);
            }
            
            // Track the task
            const taskRecord = {
                id: this.generateTaskId(),
                userPrompt,
                startTime,
                endTime: Date.now(),
                processingTime: Date.now() - startTime,
                result: currentResult,
                agentChain: [lastAgentUsed || 'BaseAgent']
            };
            
            // If BaseAgent wants to route to another agent, handle the routing
            if (!currentResult.isCompleted && currentResult.nextAgent) {
                console.log(`[AgentManager] Routing to ${currentResult.nextAgent}`);
                
                const routingResult = await this.routeToAgent(
                    currentResult.nextAgent,
                    currentResult.params,
                    userPrompt,
                    progress,
                    maxRoutingDepth - 1
                );
                
                taskRecord.agentChain.push(currentResult.nextAgent);
                taskRecord.routingResult = routingResult;
                taskRecord.endTime = Date.now();
                taskRecord.processingTime = Date.now() - startTime;
                
                // Always call BaseAgent at the end to formulate final structured response
                if (routingResult && !routingResult.error && !routingResult.finallyFormulated) {
                    console.log(`[AgentManager] Calling BaseAgent to formulate final response`);
                    
                    const finalProgress = {
                        ...progress,
                        lastAgent: currentResult.nextAgent,
                        lastAgentResult: routingResult,
                        step: (progress.step || 0) + 1,
                        finalFormulation: true // Flag to indicate this is for final response formulation
                    };

                    console.log(`[AgentManager] ${currentResult.nextAgent} result:`, routingResult);
                    
                    const finalResponse = await this.callAgent('BaseAgent', {
                        userPrompt: `Provide a comprehensive, well-structured response based on the WebAgent results below. Format and present the extracted data in a user-friendly way.
                        
Original user query: "${userPrompt}"

WebAgent Results:
${JSON.stringify(routingResult, null, 2)}

Instructions:
- If products were found, format them as a numbered list with names, prices, ratings, etc.
- If no products were found, explain what happened and suggest alternatives
- Be specific about the extracted data, don't give generic advice
- Focus on presenting the actual results from WebAgent`,
                        lastAgentUsed: currentResult.nextAgent,
                        progress: finalProgress,
                        webAgentResult: routingResult // Pass the actual result data
                    });
                    
                    // Use the BaseAgent's final formulated response as the result
                    if (finalResponse && finalResponse.isCompleted && finalResponse.response) {
                        taskRecord.finalFormulatedResponse = finalResponse;
                        taskRecord.agentChain.push('BaseAgent (Final)');
                        
                        // Return the final formulated response instead of the raw routing result
                        const structuredResult = {
                            ...routingResult,
                            result: finalResponse.response,
                            isCompleted: true,
                            finallyFormulated: true,
                            originalAgentResult: routingResult,
                            agent: 'BaseAgent',
                            finalFormulationBy: 'BaseAgent',
                            timestamp: new Date().toISOString()
                        };
                        
                        this.taskHistory.push(taskRecord);
                        return structuredResult;
                    }
                } else if (routingResult && routingResult.finallyFormulated) {
                    // Agent has already been processed through BaseAgent, return as-is
                    console.log(`[AgentManager] ${currentResult.nextAgent} result already processed by BaseAgent, returning as-is`);
                    this.taskHistory.push(taskRecord);
                    return routingResult;
                }
                
                // Store task history
                this.taskHistory.push(taskRecord);
                
                return routingResult;
            }
            
            // Store task history
            this.taskHistory.push(taskRecord);
            
            return currentResult;
            
        } catch (error) {
            console.error('[AgentManager] Task execution failed:', error);
            
            return {
                isCompleted: true,
                error: true,
                message: `AgentManager error: ${error.message}`,
                timestamp: new Date().toISOString(),
                agent: 'AgentManager'
            };
        }
    }
    
    /**
     * Route task to a specific agent
     * @param {string} agentName - Target agent name
     * @param {Object} params - Parameters for the agent
     * @param {string} originalPrompt - Original user prompt
     * @param {Object} progress - Progress information
     * @param {number} remainingDepth - Remaining routing depth
     * @returns {Promise<Object>} Agent execution result
     */
    async routeToAgent(agentName, params, originalPrompt, progress, remainingDepth) {
        try {
            // Validate agent exists and is implemented
            const agentInfo = this.getAgentInfo(agentName);
            if (!agentInfo) {
                throw new Error(`Unknown agent: ${agentName}`);
            }
            
            if (!this.agents.has(agentName)) {
                return {
                    isCompleted: true,
                    error: true,
                    message: `Agent ${agentName} is not yet implemented. Available agents: ${Array.from(this.agents.keys()).join(', ')}`,
                    timestamp: new Date().toISOString(),
                    agent: 'AgentManager'
                };
            }
            
            // Validate required parameters
            const missingParams = agentInfo.requiredParams.filter(param => !params[param]);
            if (missingParams.length > 0) {
                // Try to auto-generate missing parameters using AI
                const enhancedParams = await this.enhanceParameters(agentName, params, originalPrompt, missingParams);
                params = { ...params, ...enhancedParams };
                
                // Check again after enhancement
                const stillMissingParams = agentInfo.requiredParams.filter(param => !params[param]);
                if (stillMissingParams.length > 0) {
                    throw new Error(`Missing required parameters for ${agentName}: ${stillMissingParams.join(', ')}`);
                }
            }
            
            console.log(`[AgentManager] Calling ${agentName} with params:`, params);
            
            // Mark agent as active
            this.activeAgents.add(agentName);
            
            try {
                // Call the specific agent
                const result = await this.callAgent(agentName, params);
                
                // Update progress
                const updatedProgress = {
                    ...progress,
                    lastAgent: agentName,
                    lastAgentResult: result,
                    step: (progress.step || 0) + 1
                };
                
                // If the agent task is not completed and we have remaining depth, check if we should continue
                if (!result.isCompleted && remainingDepth > 0) {
                    console.log(`[AgentManager] ${agentName} task not completed`);
                    
                    // Check if the result indicates the agent should retry or if we should try a different approach
                    if (result.error || (result.result && result.result.status === 'partially_completed')) {
                        // Agent failed or partially completed - call BaseAgent to formulate final response
                        console.log(`[AgentManager] ${agentName} failed or partially completed, calling BaseAgent for final response`);
                        
                        const finalProgress = {
                            ...updatedProgress,
                            failedAgents: [...(progress.failedAgents || []), agentName],
                            finalFormulation: true
                        };
                        
                        const finalResponse = await this.callAgent('BaseAgent', {
                            userPrompt: `Provide a comprehensive response based on the partial/failed results from ${agentName}. Present any useful information found.

Original user query: "${originalPrompt}"

Agent Results:
${JSON.stringify(result, null, 2)}

Instructions:
- Extract and present any partial data that was found
- Explain what went wrong if the agent failed
- Provide specific information from the agent's results
- Don't give generic advice, focus on the actual data returned`,
                            lastAgentUsed: agentName,
                            progress: finalProgress,
                            agentResult: result // Pass the actual result data
                        });
                        
                        // Return the BaseAgent's structured response
                        return {
                            ...finalResponse,
                            originalAgentResult: result,
                            finallyFormulated: true,
                            finalFormulationBy: 'BaseAgent',
                            partialCompletion: true,
                            timestamp: new Date().toISOString()
                        };
                    } else {
                        // Agent suggests continuation - route back to BaseAgent but mark the failed agent
                        console.log(`[AgentManager] ${agentName} suggests continuation, routing back to BaseAgent`);
                        
                        const updatedProgressWithFailedAgent = {
                            ...updatedProgress,
                            failedAgents: [...(progress.failedAgents || []), agentName]
                        };
                        
                        return await this.executeTask(
                            `Continue the task based on the ${agentName} result: ${JSON.stringify(result)}. Original task: ${originalPrompt}. Note: ${agentName} has already been tried and should not be used again.`,
                            agentName,
                            updatedProgressWithFailedAgent,
                            remainingDepth
                        );
                    }
                }
                
                // Agent completed successfully - call BaseAgent to formulate final response
                if (result.isCompleted && !result.finallyFormulated) {
                    console.log(`[AgentManager] ${agentName} completed successfully, calling BaseAgent for final response formulation`);
                    
                    const finalProgress = {
                        ...updatedProgress,
                        finalFormulation: true
                    };
                    
                    const finalResponse = await this.callAgent('BaseAgent', {
                        userPrompt: `Provide a comprehensive, well-structured response based on the successful results from ${agentName}. Present the extracted data in a user-friendly format.

Original user query: "${originalPrompt}"

Agent Results:
${JSON.stringify(result, null, 2)}

Instructions:
- Present the extracted data clearly and organized
- Format any product lists, data tables, or information nicely
- Focus on the actual results and data found
- Don't give generic advice, present the specific findings`,
                        lastAgentUsed: agentName,
                        progress: finalProgress,
                        agentResult: result // Pass the actual result data
                    });
                    
                    // Return the BaseAgent's structured response
                    if (finalResponse && finalResponse.isCompleted && finalResponse.response) {
                        return {
                            ...result,
                            result: finalResponse.response,
                            isCompleted: true,
                            finallyFormulated: true,
                            originalAgentResult: result,
                            finalFormulationBy: 'BaseAgent',
                            timestamp: new Date().toISOString()
                        };
                    }
                }
                
                return result;
                
            } finally {
                this.activeAgents.delete(agentName);
            }
            
        } catch (error) {
            this.activeAgents.delete(agentName);
            console.error(`[AgentManager] Error routing to ${agentName}:`, error);
            
            return {
                isCompleted: true,
                error: true,
                message: `Failed to route to ${agentName}: ${error.message}`,
                timestamp: new Date().toISOString(),
                agent: 'AgentManager'
            };
        }
    }
    
    /**
     * Call a specific agent with parameters
     * @param {string} agentName - Agent name
     * @param {Object} params - Parameters
     * @returns {Promise<Object>} Agent result
     */
    async callAgent(agentName, params) {
        const agent = this.agents.get(agentName);
        if (!agent) {
            throw new Error(`Agent ${agentName} not found`);
        }
        
        console.log(`[AgentManager] Executing ${agentName}`);
        const startTime = Date.now();
        
        try {
            const result = await agent(params);
            const executionTime = Date.now() - startTime;
            
            console.log(`[AgentManager] ${agentName} completed in ${executionTime}ms`);
            console.log(`[AgentManager] ${agentName} result:`, result);
            return {
                ...result,
                executionTime,
                managedBy: 'AgentManager'
            };
        } catch (error) {
            const executionTime = Date.now() - startTime;
            console.error(`[AgentManager] ${agentName} failed after ${executionTime}ms:`, error);
            throw error;
        }
    }
    
    /**
     * Handle continuation from a specific agent
     * @param {string} userPrompt - User prompt
     * @param {string} lastAgentUsed - Last agent used
     * @param {Object} progress - Progress
     * @returns {Promise<Object>} Result
     */
    async handleAgentContinuation(userPrompt, lastAgentUsed, progress) {
        // For now, always route back to BaseAgent for decision making
        return await this.callAgent('BaseAgent', {
            userPrompt,
            lastAgentUsed,
            progress
        });
    }
    
    /**
     * Enhance parameters using AI when required params are missing
     * @param {string} agentName - Target agent name
     * @param {Object} currentParams - Current parameters
     * @param {string} originalPrompt - Original user prompt
     * @param {Array} missingParams - Missing parameter names
     * @returns {Promise<Object>} Enhanced parameters
     */
    async enhanceParameters(agentName, currentParams, originalPrompt, missingParams) {
        try {
            const agentInfo = this.getAgentInfo(agentName);
            
            const systemPrompt = `You are a parameter enhancement specialist. Extract missing parameters for the ${agentName} agent.

Agent Info:
${JSON.stringify(agentInfo, null, 2)}

Current Parameters:
${JSON.stringify(currentParams, null, 2)}

Missing Parameters: ${missingParams.join(', ')}

Original User Prompt: "${originalPrompt}"

Extract and provide the missing parameters from the user prompt. Respond with JSON containing only the missing parameters.`;

            const userPrompt = `Extract the missing parameters: ${missingParams.join(', ')}`;
            
            const response = await callLangChain(systemPrompt, userPrompt);
            const enhancedParams = JSON.parse(response);
            
            console.log(`[AgentManager] Enhanced parameters for ${agentName}:`, enhancedParams);
            return enhancedParams;
            
        } catch (error) {
            console.warn(`[AgentManager] Failed to enhance parameters for ${agentName}:`, error.message);
            return {};
        }
    }
    
    /**
     * Generate unique task ID
     * @returns {string} Unique task ID
     */
    generateTaskId() {
        return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Get task history
     * @param {number} limit - Number of recent tasks to return
     * @returns {Array} Task history
     */
    getTaskHistory(limit = 10) {
        return this.taskHistory.slice(-limit);
    }
    
    /**
     * Get agent statistics
     * @returns {Object} Statistics about agent usage
     */
    getAgentStats() {
        const stats = {
            totalTasks: this.taskHistory.length,
            totalAgents: this.agents.size,
            implementedAgents: Array.from(this.agents.keys()),
            activeAgents: Array.from(this.activeAgents),
            avgProcessingTime: 0
        };
        
        if (this.taskHistory.length > 0) {
            const totalTime = this.taskHistory.reduce((sum, task) => sum + task.processingTime, 0);
            stats.avgProcessingTime = Math.round(totalTime / this.taskHistory.length);
        }
        
        return stats;
    }
    
    /**
     * Reset agent manager state
     */
    reset() {
        this.taskHistory = [];
        this.activeAgents.clear();
        console.log('[AgentManager] State reset');
    }
}

// Create singleton instance
const agentManager = new AgentManager();

module.exports = {
    AgentManager,
    agentManager,
    AVAILABLE_AGENTS
};
