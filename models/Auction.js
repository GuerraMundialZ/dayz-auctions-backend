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
        default: 'https://via.placeholder.com/300', // Sugiero un tamaño más común
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
        // El default de 0 aquí es solo para la definición del esquema.
        // El middleware pre-save y la lógica en la ruta de creación de subastas
        // se encargarán de inicializarlo correctamente con startBid.
        default: 0 
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
    // --- NUEVO CAMPO: Historial de Pujas ---
    bidHistory: [
        {
            bidderId: {
                type: String,
                required: true
            },
            bidderName: {
                type: String,
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
        }
    ],
    // --- FIN NUEVO CAMPO ---
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Middleware para asegurar que currentBid sea al menos startBid al crear una nueva subasta
AuctionSchema.pre('save', function(next) {
    // Solo aplica esta lógica si es un nuevo documento (isNew)
    // y si currentBid aún no ha sido establecido (por ejemplo, si se crea sin especificarlo)
    // o si es 0 (que es el default del esquema, y lo queremos inicializar con startBid)
    if (this.isNew && this.currentBid === 0) {
        this.currentBid = this.startBid;
    }
    next();
});

module.exports = mongoose.model('Auction', AuctionSchema);