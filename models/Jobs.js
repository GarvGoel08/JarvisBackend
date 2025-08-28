// AI Jobs: User, AI Jobs(Created by Main Agent), Job Status, Job Result, Timestamps
const mongoose = require('mongoose');
const { Schema } = mongoose;
const jobSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    userPrompt: { type: String, required: true },
    aiJobs: [{ type: Schema.Types.ObjectId, ref: 'AIJob' }],
    status: { type: String, enum: ['pending', 'in-progress', 'completed', 'failed'], default: 'pending' },
    result: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Job = mongoose.model('Job', jobSchema);
module.exports = Job;