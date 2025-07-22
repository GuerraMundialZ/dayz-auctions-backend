// routes/auctions.js
const express = require('express');
const router = express.Router();
const Auction = require('../models/Auction'); // Importa tu modelo de subasta
const axios = require('axios'); // Necesario para enviar webhooks a Discord

// --- IMPORTANTE: Asegúrate de que estos middlewares existan y se exporten desde '../middleware/auth' ---
// Se asume que authenticateToken adjunta req.user y authorizeAdmin verifica si req.user es admin.
const { authenticateToken, authorizeAdmin } = require('../middleware/auth');

// Asegúrate de que estas variables de entorno estén accesibles en tu entorno de ejecución (Render).
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const FRONTEND_URL = 'https://guerramundialz.github.io'; // ¡Tu URL de GitHub Pages!

// 1. GET /api/auctions - Obtener TODAS las subastas (para el panel de administración)
// Esta ruta ahora está protegida para administradores y devuelve todas las subastas.
router.get('/', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        // Para el panel de administración, queremos ver todas las subastas, activas o no.
        const auctions = await Auction.find().sort({ endDate: 1 });
        res.json(auctions);
    } catch (error) {
        console.error('Error fetching all auctions for admin:', error);
        res.status(500).json({ message: 'Error al obtener las subastas para administración.' });
    }
});

// 2. GET /api/auctions/active - Obtener solo subastas activas (para la página de subastas de usuario)
// Esta es la ruta que usarán los usuarios normales para ver las subastas activas.
router.get('/active', async (req, res) => {
    try {
        const auctions = await Auction.find({ status: 'active', endDate: { $gt: new Date() } }).sort({ endDate: 1 });
        res.json(auctions);
    } catch (error) {
        console.error('Error fetching active auctions:', error);
        res.status(500).json({ message: 'Error al obtener las subastas activas.' });
    }
});

// 3. GET /api/auctions/:id - Obtener una subasta específica por ID (para edición en admin)
router.get('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const auction = await Auction.findById(req.params.id);
        if (!auction) {
            return res.status(404).json({ message: 'Subasta no encontrada.' });
        }
        res.json(auction);
    } catch (error) {
        console.error('Error fetching single auction:', error);
        res.status(500).json({ message: 'Error al obtener la subasta.' });
    }
});

// 4. POST /api/auctions - Crear una nueva subasta (Solo administradores)
router.post('/', authenticateToken, authorizeAdmin, async (req, res) => {
    const { title, description, imageUrl, startBid, endDate } = req.body;

    if (!title || !description || !startBid || !endDate) {
        return res.status(400).json({ message: 'Todos los campos son obligatorios.' });
    }
    const parsedEndDate = new Date(endDate);
    if (isNaN(parsedEndDate.getTime()) || parsedEndDate <= new Date()) {
        return res.status(400).json({ message: 'La fecha de finalización debe ser una fecha futura válida.' });
    }
    if (startBid < 0) {
        return res.status(400).json({ message: 'La puja inicial no puede ser negativa.' });
    }

    try {
        const newAuction = new Auction({
            title,
            description,
            imageUrl: imageUrl || 'https://via.placeholder.com/300x200?text=No+Image', // Usar imagen por defecto si no se proporciona
            startBid: parseFloat(startBid),
            // currentBid se inicializa automáticamente con startBid gracias al middleware pre-save en Auction.js
            endDate: parsedEndDate,
            creatorId: req.user.id,
            creatorName: req.user.username,
            status: 'active' // Asegurarse de que el estado inicial sea activo
        });

        await newAuction.save();

        if (DISCORD_WEBHOOK_URL) {
            axios.post(DISCORD_WEBHOOK_URL, {
                content: `🚨 ¡Nueva subasta creada por **${newAuction.creatorName}**! **${newAuction.title}** con puja inicial de **${newAuction.startBid} Rublos**. Finaliza el <t:${Math.floor(newAuction.endDate.getTime() / 1000)}:F>. ¡Puja ahora en la web!`,
                embeds: [{
                    title: newAuction.title,
                    description: newAuction.description,
                    url: `${FRONTEND_URL}/subastas.html`,
                    color: 15158332, // Un color vibrante para Discord
                    image: { url: newAuction.imageUrl },
                    fields: [
                        { name: "Puja Inicial", value: `${newAuction.startBid} Rublos`, inline: true },
                        { name: "Finaliza", value: `<t:${Math.floor(newAuction.endDate.getTime() / 1000)}:R>`, inline: true }
                    ],
                    footer: { text: `Creada por ${newAuction.creatorName} | ID: ${newAuction._id}` }
                }]
            }).catch(err => console.error("Error enviando webhook de Discord para nueva subasta:", err.message));
        }

        res.status(201).json(newAuction);
    } catch (error) {
        console.error('Error creating auction:', error);
        res.status(500).json({ message: 'Error al crear la subasta.' });
    }
});

// 5. PUT /api/auctions/:id - Actualizar una subasta existente (Solo administradores)
router.put('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { title, description, imageUrl, startBid, endDate, currentBid, currentBidderId, currentBidderName, status } = req.body;

    try {
        const auction = await Auction.findById(id);
        if (!auction) {
            return res.status(404).json({ message: 'Subasta no encontrada para actualizar.' });
        }

        // Actualizar campos si se proporcionan
        if (title !== undefined) auction.title = title;
        if (description !== undefined) auction.description = description;
        if (imageUrl !== undefined) auction.imageUrl = imageUrl || 'https://via.placeholder.com/300x200?text=No+Image';
        if (startBid !== undefined) auction.startBid = parseFloat(startBid);
        if (endDate !== undefined) {
            const parsedEndDate = new Date(endDate);
            if (isNaN(parsedEndDate.getTime())) {
                return res.status(400).json({ message: 'La fecha de finalización no es válida.' });
            }
            auction.endDate = parsedEndDate;
        }
        // Permitir que el admin pueda ajustar la puja actual y el pujador si es necesario
        if (currentBid !== undefined) auction.currentBid = parseFloat(currentBid);
        if (currentBidderId !== undefined) auction.currentBidderId = currentBidderId;
        if (currentBidderName !== undefined) auction.currentBidderName = currentBidderName;
        if (status !== undefined) auction.status = status; // Permitir cambiar el estado

        // Validaciones adicionales antes de guardar
        if (auction.startBid < 0) {
            return res.status(400).json({ message: 'La puja inicial no puede ser negativa.' });
        }
        if (auction.currentBid < 0) {
            return res.status(400).json({ message: 'La puja actual no puede ser negativa.' });
        }
        // Si el estado se cambia a 'active', la fecha de fin debe ser futura
        if (auction.status === 'active' && auction.endDate <= new Date()) {
            return res.status(400).json({ message: 'No se puede activar una subasta con fecha de finalización pasada.' });
        }


        await auction.save();
        res.json({ message: 'Subasta actualizada con éxito.', auction });
    } catch (error) {
        console.error('Error updating auction:', error);
        res.status(500).json({ message: 'Error al actualizar la subasta.' });
    }
});

// 6. DELETE /api/auctions/:id - Eliminar una subasta (Solo administradores)
router.delete('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const deletedAuction = await Auction.findByIdAndDelete(id);

        if (!deletedAuction) {
            return res.status(404).json({ message: 'Subasta no encontrada para eliminar.' });
        }

        res.json({ message: 'Subasta eliminada con éxito.' });
    } catch (error) {
        console.error('Error deleting auction:', error);
        res.status(500).json({ message: 'Error al eliminar la subasta.' });
    }
});

// 7. POST /api/auctions/:id/finalize - Finalizar una subasta manualmente (Solo administradores)
router.post('/:id/finalize', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const auction = await Auction.findById(id);

        if (!auction) {
            return res.status(404).json({ message: 'Subasta no encontrada.' });
        }

        if (auction.status === 'finalized' || auction.status === 'cancelled') {
            return res.status(400).json({ message: `La subasta ya está ${auction.status}.` });
        }

        auction.status = 'finalized';
        // Si hay un pujador actual, ese es el ganador
        if (auction.currentBidderId) {
            auction.winnerId = auction.currentBidderId;
            auction.winnerName = auction.currentBidderName;
            auction.finalPrice = auction.currentBid;
        } else {
            auction.winnerId = null;
            auction.winnerName = null;
            auction.finalPrice = null; // O el precio inicial si no hubo pujas y quieres que sea ese
        }
        auction.endDate = new Date(); // Establecer la fecha de fin a ahora

        await auction.save();

        // Opcional: Enviar un webhook de Discord para notificar la finalización manual
        if (DISCORD_WEBHOOK_URL) {
            let message = '';
            let embedColor = 5793266; // Un color verde para Discord (hex 0x57F287)

            if (auction.winnerId) {
                message = `🎉 ¡Subasta **${auction.title}** ha sido finalizada manualmente! Ganador: **${auction.winnerName}** con **${auction.finalPrice} Rublos**.`;
            } else {
                message = `⚠️ Subasta **${auction.title}** ha sido finalizada manualmente sin pujas.`;
                embedColor = 10038562; // Un color gris/rojo para Discord (hex 0x99AAB5)
            }

            axios.post(DISCORD_WEBHOOK_URL, {
                content: message,
                embeds: [{
                    title: `Subasta Finalizada Manualmente: ${auction.title}`,
                    description: auction.winnerId ? `Ganador: **${auction.winnerName}**\nPuja Final: **${auction.finalPrice} Rublos**` : 'No hubo pujas.',
                    url: `${FRONTEND_URL}/subastas.html`,
                    color: embedColor,
                    thumbnail: { url: auction.imageUrl || 'https://via.placeholder.com/150' },
                    footer: { text: `Subasta ID: ${auction._id}` }
                }]
            }).catch(err => console.error("Error enviando webhook de fin de subasta manual:", err.message));
        }

        res.json({ message: 'Subasta finalizada manualmente con éxito.', auction });
    } catch (error) {
        console.error('Error finalizing auction manually:', error);
        res.status(500).json({ message: 'Error al finalizar la subasta manualmente.' });
    }
});


// 8. POST /api/auctions/:id/bid - Realizar una puja
// Aplica authenticateToken para asegurar que req.user esté disponible.
router.post('/:id/bid', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { bidAmount } = req.body;

    // Verificar que el usuario esté autenticado para pujar
    if (!req.user || !req.user.id || !req.user.username) {
        return res.status(401).json({ message: 'Debes iniciar sesión para realizar una puja.' });
    }

    if (typeof bidAmount !== 'number' || bidAmount <= 0) {
        return res.status(400).json({ message: 'La cantidad de puja debe ser un número positivo.' });
    }

    try {
        const auction = await Auction.findById(id);

        if (!auction) {
            return res.status(404).json({ message: 'Subasta no encontrada.' });
        }
        if (auction.status !== 'active' || auction.endDate <= new Date()) {
            return res.status(400).json({ message: 'Esta subasta no está activa o ya ha finalizado.' });
        }
        if (bidAmount <= auction.currentBid) {
            return res.status(400).json({ message: `Tu puja (${bidAmount} Rublos) debe ser mayor que la puja actual (${auction.currentBid} Rublos).` });
        }
        // NUEVA VALIDACIÓN: Si ya eres el pujador actual, tu puja debe ser estrictamente mayor para superarte a ti mismo
        if (req.user.id === auction.currentBidderId && bidAmount <= auction.currentBid) {
            return res.status(400).json({ message: 'Ya eres el pujador actual. Tu puja debe ser superior para superarte.' });
        }

        // Guardar la puja anterior antes de actualizar la actual
        const oldBid = auction.currentBid;

        auction.currentBid = bidAmount;
        auction.currentBidderId = req.user.id;
        auction.currentBidderName = req.user.username;
        // Añadir la puja al historial
        auction.bidHistory.push({
            bidderId: req.user.id,
            bidderName: req.user.username,
            amount: bidAmount,
            timestamp: new Date()
        });
        await auction.save();

        if (DISCORD_WEBHOOK_URL) {
            axios.post(DISCORD_WEBHOOK_URL, {
                // Mensaje más claro para el webhook, usando oldBid
                content: `🔔 ¡Nueva puja en **${auction.title}**! **${req.user.username}** ha pujado **${bidAmount} Rublos**.`,
                embeds: [{
                    title: `Nueva Puja en ${auction.title}`,
                    description: `**${req.user.username}** ha pujado **${bidAmount} Rublos**.\nPuja anterior: **${oldBid} Rublos**\nNueva puja: **${auction.currentBid} Rublos**`,
                    url: `${FRONTEND_URL}/subastas.html`, // URL CORRECTA
                    color: 3447003, // Color azul para Discord
                    thumbnail: { url: req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${parseInt(req.user.id) % 5}.png` },
                    footer: { text: `Finaliza el <t:${Math.floor(auction.endDate.getTime() / 1000)}:R>` }
                }]
            }).catch(err => console.error("Error enviando webhook de Discord para nueva puja:", err.message));
        }

        res.json({ message: 'Puja realizada con éxito.', auction });
    } catch (error) {
        console.error('Error placing bid:', error);
        res.status(500).json({ message: 'Error al realizar la puja.' });
    }
});

module.exports = router;
