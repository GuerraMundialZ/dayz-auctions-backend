// models/Auction.js
const mongoose = require('mongoose');

// Schema for bid history
const bidSchema = new mongoose.Schema({
    bidderId: {
        type: String, // Discord ID of the bidder
        required: true
    },
    bidderName: {
        type: String, // Discord name of the bidder
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
        default: 'https://cdn.discordapp.com/attachments/1225080795132072039/1397334415578890240/descargar.png?ex=68815895&is=68800715&hm=0d272bd18fb45d369c3fd7b7000e3140fc214da84e3f7cc678ff29641f964a1f&', // Default image URL
        trim: true
    },
    startBid: {
        type: Number,
        required: true,
        min: 0
    },
    currentBid: { // Current bid, updated with each new bid
        type: Number,
        required: true,
        min: 0,
        default: 0 // Will be initialized with startBid in pre-save
    },
    currentBidderId: { // Discord ID of the user who made the last bid
        type: String,
        default: null
    },
    currentBidderName: { // Discord name of the user who made the last bid
        type: String,
        default: null
    },
    endDate: { // Auction end date and time
        type: Date,
        required: true
    },
    creatorId: { // Discord ID of the user who created the auction
        type: String,
        required: true
    },
    creatorName: { // Discord name of the user who created the auction
        type: String,
        required: true
    },
    status: { // 'active', 'finalized', 'cancelled'
        type: String,
        enum: ['active', 'finalized', 'cancelled'],
        default: 'active'
    },
    bidHistory: [bidSchema], // Array of bids to keep a record
    winnerId: { // Discord ID of the winner (if the auction ends with bids)
        type: String,
        default: null
    },
    winnerName: { // Discord name of the winner
        type: String,
        default: null
    },
    finalPrice: { // Final price of the auction
        type: Number,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Middleware to ensure currentBid is at least startBid when creating a new auction
AuctionSchema.pre('save', function(next) {
    if (this.isNew && this.currentBid === 0) { // Only if it's a new document and currentBid is 0 (its default)
        this.currentBid = this.startBid;
    }
    next();
});

module.exports = mongoose.model('Auction', AuctionSchema);
