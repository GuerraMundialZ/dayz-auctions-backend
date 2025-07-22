// models/Auction.js
const mongoose = require('mongoose');

// Esquema para el historial de pujas
const bidSchema = new mongoose.Schema({
    bidderId: {
        type: String, // ID de Discord del pujador
        required: true
    },
    bidderName: {
        type: String, // Nombre de Discord del pujador
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

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
        default: 'https://via.placeholder.com/300x200?text=No+Image', // URL de imagen por defecto
        trim: true
    },
    startBid: {
        type: Number,
        required: true,
        min: 0
    },
    currentBid: { // Puja actual, se actualiza con cada nueva puja
        type: Number,
        required: true,
        min: 0,
        default: 0 // Se inicializará con startBid en el pre-save
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
    creatorId: { // ID de Discord del usuario que creó la subasta
        type: String,
        required: true
    },
    creatorName: { // Nombre de Discord del usuario que creó la subasta
        type: String,
        required: true
    },
    status: { // 'active', 'finalized', 'cancelled'
        type: String,
        enum: ['active', 'finalized', 'cancelled'],
        default: 'active'
    },
    bidHistory: [bidSchema], // Array de pujas para llevar un registro
    winnerId: { // ID de Discord del ganador (si la subasta finaliza con pujas)
        type: String,
        default: null
    },
    winnerName: { // Nombre de Discord del ganador
        type: String,
        default: null
    },
    finalPrice: { // Precio final de la subasta
        type: Number,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Middleware para asegurar que currentBid sea al menos startBid al crear una nueva subasta
AuctionSchema.pre('save', function(next) {
    if (this.isNew && this.currentBid === 0) { // Solo si es un documento nuevo y currentBid es 0 (su default)
        this.currentBid = this.startBid;
    }
    next();
});

module.exports = mongoose.model('Auction', AuctionSchema);
