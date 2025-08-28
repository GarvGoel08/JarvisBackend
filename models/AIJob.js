const mongoose = require('mongoose');
const { Schema } = mongoose;

const aiJobSchema = new Schema({
    createdBy: {
        type: String,
        required: true
    },
    jobType: {
        type: String,
        required: true
    },
    parameters: {
        type: Schema.Types.Mixed,
        required: true
    },
    routedTo: {
        type: String,
        required: false
    },
    status: {
        type: String,
        enum: ['pending', 'in-progress', 'completed', 'failed'],
        default: 'pending'
    },
    result: {
        type: Schema.Types.Mixed,
        required: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const AIJob = mongoose.model('AIJob', aiJobSchema);
module.exports = AIJob;
