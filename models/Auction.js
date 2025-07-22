// models/Auction.js
const mongoose = require('mongoose');

const AuctionSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    imageUrl: {
        type: String,
        default: 'https://via.placeholder.com/150', // Imagen por defecto si no se proporciona
        trim: true
    },
    startBid: {
        type: Number,
        required: true,
        min: 0
    },
    currentBid: {
        type: Number,
        required: true,
        min: 0,
        default: 0 // Se inicializa con startBid en el middleware pre-save
    },
    currentBidderId: { // ID de Discord del usuario que hizo la última puja
        type: String,
        default: null
    },
    currentBidderName: { // Nombre de Discord del usuario que hizo la última puja
        type: String,
        default: null
    },
    endDate: { // Fecha y hora de finalización de la subasta
        type: Date,
        required: true
    },
    creatorId: { // ID de Discord del administrador que creó la subasta
        type: String,
        required: true
    },
    creatorName: { // Nombre de Discord del administrador que creó la subasta
        type: String,
        required: true
    },
    status: { // 'active', 'completed', 'cancelled'
        type: String,
        enum: ['active', 'completed', 'cancelled'],
        default: 'active'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Middleware para asegurar que currentBid sea al menos startBid al crear
AuctionSchema.pre('save', function(next) {
    if (this.isNew && this.currentBid === 0) {
        this.currentBid = this.startBid;
    }
    next();
});

module.exports = mongoose.model('Auction', AuctionSchema);