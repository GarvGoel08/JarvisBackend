const { agentManager } = require('../agents/AgentManager');
const { v4: uuidv4 } = require('uuid');

/**
 * Jobs Controller
 * Handles job-related operations and BaseAgent testing
 */

/**
 * Create a new job and process it with BaseAgent
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createJob = async (req, res) => {
    try {
        const { userPrompt, lastAgentUsed, progress } = req.body;
        
        // Validation
        if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Valid userPrompt is required',
                timestamp: new Date().toISOString()
            });
        }

        // Generate unique job ID
        const jobId = uuidv4();
        
        console.log(`[${new Date().toISOString()}] Creating job ${jobId} with prompt: "${userPrompt}"`);
        
        // Call AgentManager for processing
        const startTime = Date.now();
        const result = await agentManager.executeTask(
            userPrompt.trim(),
            lastAgentUsed || null,
            progress || {}
        );
        const processingTime = Date.now() - startTime;
        
        console.log(`[${new Date().toISOString()}] Job ${jobId} processed in ${processingTime}ms`);
        
        // Return response with job information
        return res.status(200).json({
            success: true,
            jobId: jobId,
            input: {
                userPrompt: userPrompt.trim(),
                lastAgentUsed: lastAgentUsed || null,
                progress: progress || {}
            },
            result: result,
            processingTime: processingTime,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in createJob:`, error);
        
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Get job status (placeholder for future implementation)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getJobStatus = async (req, res) => {
    try {
        const { jobId } = req.params;
        
        return res.status(200).json({
            success: true,
            message: 'Job status endpoint - not yet implemented',
            jobId: jobId,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in getJobStatus:`, error);
        
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Test BaseAgent directly (for development/debugging)
 * @param {Object} req - Express request object  
 * @param {Object} res - Express response object
 */
const testBaseAgent = async (req, res) => {
    try {
        const { userPrompt, lastAgentUsed, progress } = req.body;
        
        if (!userPrompt) {
            return res.status(400).json({
                success: false,
                error: 'userPrompt is required for testing',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log(`[${new Date().toISOString()}] Testing BaseAgent with prompt: "${userPrompt}"`);
        
        const startTime = Date.now();
        const result = await agentManager.executeTask(userPrompt, lastAgentUsed, progress);
        const processingTime = Date.now() - startTime;
        
        return res.status(200).json({
            success: true,
            testResult: result,
            processingTime: processingTime,
            input: { userPrompt, lastAgentUsed, progress },
            agentStats: agentManager.getAgentStats(),
            availableAgents: agentManager.getAvailableAgents(),
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in testBaseAgent:`, error);
        
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Get available agents and system statistics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAgentInfo = async (req, res) => {
    try {
        const availableAgents = agentManager.getAvailableAgents();
        const agentStats = agentManager.getAgentStats();
        const recentTasks = agentManager.getTaskHistory(5);
        
        return res.status(200).json({
            success: true,
            availableAgents: availableAgents,
            statistics: agentStats,
            recentTasks: recentTasks.map(task => ({
                id: task.id,
                userPrompt: task.userPrompt.substring(0, 100) + '...',
                processingTime: task.processingTime,
                agentChain: task.agentChain,
                isCompleted: task.result?.isCompleted || false
            })),
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in getAgentInfo:`, error);
        
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = {
    createJob,
    getJobStatus,
    testBaseAgent,
    getAgentInfo
};
