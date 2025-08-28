const express = require('express');
const router = express.Router();
const { createJob, getJobStatus, testBaseAgent, getAgentInfo } = require('../controllers/jobsController');

/**
 * Jobs Routes
 * Handles job-related API endpoints
 */

/**
 * POST /api/jobs
 * Create a new job and process it with BaseAgent
 * 
 * Body Parameters:
 * - userPrompt (string, required): The user's input/question
 * - lastAgentUsed (string, optional): The last agent that was used
 * - progress (object, optional): Current progress information
 */
router.post('/', createJob);

/**
 * GET /api/jobs/:jobId
 * Get job status by ID (placeholder for future implementation)
 */
router.get('/:jobId', getJobStatus);

/**
 * POST /api/jobs/test
 * Test BaseAgent directly (for development/debugging)
 * 
 * Body Parameters:
 * - userPrompt (string, required): The user's input/question
 * - lastAgentUsed (string, optional): The last agent that was used  
 * - progress (object, optional): Current progress information
 */
router.post('/test', testBaseAgent);

/**
 * GET /api/jobs/agents
 * Get available agents and system statistics
 */
router.get('/agents', getAgentInfo);

module.exports = router;
