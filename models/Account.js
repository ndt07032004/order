const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { 
        type: String, 
        enum: ['admin', 'kitchen', 'staff'], 
        required: true 
    },
    fullName: String,
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Account', AccountSchema);