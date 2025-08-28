const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();


const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/jarvisai';

// Global variables
let agentManager = null;

// MongoDB Connection
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log(`[${new Date().toISOString()}] Connected to MongoDB`);
})
.catch((error) => {
  console.error(`[${new Date().toISOString()}] MongoDB connection error:`, error);
  process.exit(1);
});


// Security middleware
app.use(helmet());

// CORS middleware
app.use(cors());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Custom logging format with timestamp
morgan.token('timestamp', () => {
    return new Date().toISOString();
});

const logFormat = ':timestamp :method :url :status :res[content-length] - :response-time ms :remote-addr';
app.use(morgan(logFormat));

// Custom request logger for additional details
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - User-Agent: ${req.get('User-Agent')}`);
    next();
});

// Import routes
const jobsRoutes = require('./routes/jobs');

// API Routes
app.use('/api/jobs', jobsRoutes);

// Routes
app.get('/', (req, res) => {
    console.log(`[${new Date().toISOString()}] Root endpoint accessed`);
    res.json({
        message: 'JarvisAI is running',
        status: 'active',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    console.log(`[${new Date().toISOString()}] Health check endpoint accessed`);
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        agents: agentManager ? 'initialized' : 'not initialized',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});


// Error handling middleware
app.use((err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] Error:`, err.stack);
    res.status(500).json({
        error: 'Internal Server Error',
        message: err.message,
        timestamp: new Date().toISOString()
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] JarvisAI Backend Server is running on port ${PORT}`);
    console.log(`[${new Date().toISOString()}] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[${new Date().toISOString()}] WebSocket server enabled`);
});

module.exports = app;
