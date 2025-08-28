# JarvisAI Backend - Multi-Agent System

A sophisticated Node.js Express server implementing a multi-agent AI system with comprehensive request logging, real-time updates, and intelligent job processing.

## 🚀 Features

### Core System
- **Multi-Agent Architecture**: Head agent for query refinement and routing, Web Navigator agent for web scraping
- **MongoDB Integration**: Complete job storage and tracking system
- **Real-time Updates**: WebSocket support for live frontend updates
- **LangChain Integration**: All AI calls use LangChain with Google Generative AI
- **Round-Robin API Keys**: Load balancing across 10-12 Google AI API keys
- **Comprehensive Logging**: Every request logged with timestamps and details

### Agent System
- **Head Agent**: 
  - Query analysis and refinement
  - Intelligent agent routing
  - Direct responses for general knowledge
  - Request validation and filtering
- **Web Navigator Agent**: 
  - Web scraping with Playwright
  - Real-time data extraction
  - Multi-source research capability
  - Dynamic content handling

### Advanced Features
- **Job Queue Management**: Concurrent job processing with queue system
- **Error Handling**: Comprehensive error tracking and recovery
- **Performance Monitoring**: Agent performance metrics and health monitoring
- **Graceful Shutdown**: Clean resource cleanup on system shutdown

## 📁 Project Structure

```
JarvisBackend/
├── agents/
│   ├── headAgent.js           # Query analysis & routing agent
│   └── webNavigatorAgent.js   # Web scraping & research agent
├── models/
│   └── schemas.js             # MongoDB schemas for jobs & agents
├── services/
│   ├── agentManager.js        # Central agent coordination
│   └── googleAI.js           # LangChain Google AI service
├── index.js                   # Main server file
├── package.json
├── .env                       # Environment configuration
└── README.md
```

## 🛠 Installation

### Prerequisites
- Node.js (v18 or higher)
- MongoDB (local or remote)
- Google AI API keys (10-12 recommended for round-robin)

### Setup Steps

1. **Navigate to the backend directory**:
```bash
cd JarvisBackend
```

2. **Install dependencies**:
```bash
npm install
```

3. **Install Playwright browsers** (for web navigation):
```bash
npx playwright install
```

4. **Configure environment variables**:
   - Copy `.env.example` to `.env`
   - Add your Google AI API keys
   - Configure MongoDB URI if not using localhost

```env
# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/jarvisai

# Google AI API Keys (Add 10-12 keys for optimal performance)
GOOGLE_AI_KEY_1=your_actual_google_ai_key_1
GOOGLE_AI_KEY_2=your_actual_google_ai_key_2
# ... add more keys

# Server Configuration
PORT=3000
NODE_ENV=development

# Contact Email
CONTACT_EMAIL=garvgoel2927@gmail.com
```

5. **Start MongoDB** (if running locally):
```bash
mongod
```

## 🚀 Running the Server

### Development Mode (with auto-restart):
```bash
npm run dev
```

### Production Mode:
```bash
npm start
```

The server will start on port 3000 (or your configured PORT) with:
- MongoDB connection
- Agent system initialization
- WebSocket server for real-time updates
- Comprehensive request logging

## 📡 API Endpoints

### Core Endpoints

#### `GET /`
Returns server status and version information.

**Response:**
```json
{
  "message": "JarvisAI is running",
  "status": "active",
  "timestamp": "2025-08-25T...",
  "version": "1.0.0"
}
```

#### `GET /health`
Comprehensive health check with system status.

**Response:**
```json
{
  "status": "healthy",
  "uptime": 123.456,
  "timestamp": "2025-08-25T...",
  "agents": "initialized",
  "mongodb": "connected"
}
```

### Job Management

#### `POST /api/jobs`
Submit a new job for processing.

**Request:**
```json
{
  "query": "What are the latest developments in AI technology?"
}
```

**Response:**
```json
{
  "jobId": "uuid-string",
  "status": "created",
  "message": "Job submitted successfully",
  "timestamp": "2025-08-25T..."
}
```

#### `GET /api/jobs/:jobId`
Get status and details of a specific job.

**Response:**
```json
{
  "jobId": "uuid-string",
  "originalQuery": "user query",
  "refinedQuery": "processed query",
  "status": "completed",
  "response": "AI generated response",
  "processingSteps": [...],
  "metadata": {...}
}
```

#### `GET /api/jobs`
Get recent jobs with optional filtering.

**Query Parameters:**
- `limit`: Number of jobs to return (default: 20)
- `status`: Filter by job status

### System Monitoring

#### `GET /api/status`
Get comprehensive system status including agent health, queue status, and performance metrics.

**Response:**
```json
{
  "agents": {
    "head": {...},
    "web_navigator": {...}
  },
  "queue": {
    "pending": 0,
    "active": 1,
    "maxConcurrent": 5
  },
  "recentJobs": [...],
  "stats": {...}
}
```

## 🔄 WebSocket Events

### Client → Server
- `subscribe_job`: Subscribe to job updates
- `unsubscribe_job`: Unsubscribe from job updates

### Server → Client
- `job_created`: New job created
- `job_update`: Job status/progress update
- `job_completed`: Job finished successfully
- `job_failed`: Job failed with error
- `system_status`: System status update
- `agent_task`: Internal agent communication

## 🤖 Agent Workflow

### 1. Job Submission
- User submits query via API
- Job created in MongoDB with unique ID
- Added to processing queue
- Frontend notified via WebSocket

### 2. Head Agent Processing
- Analyzes and refines user query
- Determines if it can answer directly
- Routes to appropriate agent if needed
- Rejects invalid/impossible requests

### 3. Web Navigator Agent (if routed)
- Creates navigation plan
- Uses Playwright to scrape web content
- Extracts relevant information
- Synthesizes final response

### 4. Response Delivery
- Final response stored in MongoDB
- Frontend updated via WebSocket
- Job marked as completed
- Performance metrics recorded

## 🔧 Configuration

### Agent Settings
- **Max Concurrent Jobs**: 5 (configurable)
- **Navigation Steps**: 10 max per job
- **Scroll Attempts**: 3 max per page
- **Request Timeout**: 15 seconds

### API Key Management
- Round-robin distribution across keys
- Automatic error handling and retry
- Key health monitoring
- Manual error count reset available

## 📊 Monitoring & Logging

### Request Logging
- Morgan HTTP request logging
- Custom timestamp format
- User-Agent tracking
- Response time monitoring

### Agent Activity
- All agent actions logged to MongoDB
- Performance metrics collection
- Error tracking and recovery
- Health status monitoring

### Database Schema
- **Job**: Complete job lifecycle tracking
- **AgentActivity**: Detailed agent performance logs
- **AgentStatus**: Real-time agent health monitoring

## 🛡 Error Handling

### Comprehensive Error Management
- Graceful degradation on API failures
- Automatic retry mechanisms
- Fallback responses for critical failures
- Clean resource cleanup

### Job Failure Handling
- Detailed error messages
- User-friendly error responses
- Contact information for unsupported requests
- Automatic agent health recovery

## 🚦 Development

### Adding New Agents
1. Create agent class in `agents/` directory
2. Implement required methods: `processJob()`, `getStatus()`
3. Register agent in `AgentManager`
4. Update Head Agent routing logic

### Testing
```bash
# Test API endpoint
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the weather today?"}'

# Monitor job status
curl http://localhost:3000/api/jobs/[job-id]
```

## 📝 License

ISC License

## 👨‍💻 Contact

For questions or support regarding unsupported use cases, please contact: garvgoel2927@gmail.com

---

**Note**: Make sure to add your actual Google AI API keys to the `.env` file before running the server. The system requires at least one valid API key to function properly.
