// routes/auctions.js
const express = require('express');
const router = express.Router();
const Auction = require('../models/Auction'); // Importa tu modelo de subasta
const axios = require('axios'); // Necesario para enviar webhooks a Discord

// --- IMPORTANTE: Asegúrate de que estos middlewares existan y se exporten desde '../middleware/auth' ---
const { authenticateToken, authorizeAdmin } = require('../middleware/auth');

// Asegúrate de que estas variables de entorno estén accesibles en tu entorno de ejecución (Render).
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const FRONTEND_URL = 'https://guerramundialz.github.io'; // ¡Tu URL de GitHub Pages!

// 1. GET /api/auctions - Obtener todas las subastas activas
router.get('/', async (req, res) => {
    try {
        // Busca subastas activas cuya fecha de finalización sea mayor que la actual
        const auctions = await Auction.find({ status: 'active', endDate: { $gt: new Date() } }).sort({ endDate: 1 });
        res.json(auctions);
    } catch (error) {
        console.error('Error fetching auctions:', error);
        res.status(500).json({ message: 'Error al obtener las subastas.' });
    }
});

// 2. POST /api/admin/auctions - Crear una nueva subasta (Solo administradores)
// Aplica authenticateToken primero para asegurar que req.user esté disponible,
// luego authorizeAdmin para verificar el rol.
router.post('/admin', authenticateToken, authorizeAdmin, async (req, res) => {
    const { title, description, imageUrl, startBid, endDate } = req.body;

    if (!title || !description || !startBid || !endDate) {
        return res.status(400).json({ message: 'Todos los campos son obligatorios.' });
    }
    if (new Date(endDate) <= new Date()) {
        return res.status(400).json({ message: 'La fecha de finalización debe ser en el futuro.' });
    }
    if (startBid < 0) {
        return res.status(400).json({ message: 'La puja inicial no puede ser negativa.' });
    }

    try {
        const newAuction = new Auction({
            title,
            description,
            // Proporcionar una imagen por defecto si imageUrl está vacío o no se proporciona
            imageUrl: imageUrl || 'https://via.placeholder.com/300', 
            startBid: parseFloat(startBid), // Asegúrate de que sea un número
            currentBid: parseFloat(startBid), // La puja actual empieza con la puja inicial
            endDate: new Date(endDate),
            creatorId: req.user.id,
            creatorName: req.user.username
        });

        await newAuction.save();

        if (DISCORD_WEBHOOK_URL) {
            axios.post(DISCORD_WEBHOOK_URL, {
                content: `🚨 ¡Nueva subasta creada por **${req.user.username}**! **${newAuction.title}** con puja inicial de **${newAuction.startBid} Rublos**. Finaliza el <t:${Math.floor(newAuction.endDate.getTime() / 1000)}:F>. ¡Puja ahora en la web!`,
                embeds: [{
                    title: newAuction.title,
                    description: newAuction.description,
                    url: `${FRONTEND_URL}/subastas.html`, // URL CORRECTA
                    color: 15158332, // Un color vibrante para Discord
                    image: { url: newAuction.imageUrl }, // Usar la URL que ya tiene el default
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

// NUEVA RUTA: 4. PUT /api/auctions/:id - Actualizar una subasta existente (Solo administradores)
router.put('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { title, description, imageUrl, startBid, endDate, currentBid, currentBidderId, currentBidderName, status } = req.body;

    // Validación básica: los campos obligatorios deben estar presentes
    if (!title || !description || !startBid || !endDate) {
        return res.status(400).json({ message: 'Todos los campos obligatorios (título, descripción, puja inicial, fecha de fin) son necesarios para actualizar.' });
    }

    if (new Date(endDate) <= new Date()) {
        return res.status(400).json({ message: 'La fecha de finalización debe ser en el futuro.' });
    }

    try {
        const updatedAuction = await Auction.findByIdAndUpdate(id, {
            title,
            description,
            imageUrl: imageUrl || 'https://via.placeholder.com/300', // Mantener imagen por defecto
            startBid: parseFloat(startBid),
            endDate: new Date(endDate),
            // Permitir que se actualice la puja actual y el pujador, pero con cuidado desde el admin
            currentBid: parseFloat(currentBid), 
            currentBidderId: currentBidderId || null,
            currentBidderName: currentBidderName || null,
            status: status || 'active' // Puedes permitir cambiar el estado, por ejemplo, a 'finalized'
        }, { new: true, runValidators: true }); // `new: true` devuelve el documento modificado, `runValidators: true` asegura que se ejecuten las validaciones del esquema

        if (!updatedAuction) {
            return res.status(404).json({ message: 'Subasta no encontrada para actualizar.' });
        }

        res.json({ message: 'Subasta actualizada con éxito.', auction: updatedAuction });
    } catch (error) {
        console.error('Error updating auction:', error);
        res.status(500).json({ message: 'Error al actualizar la subasta.' });
    }
});

// NUEVA RUTA: 5. DELETE /api/auctions/:id - Eliminar una subasta (Solo administradores)
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


// 3. POST /api/auctions/:id/bid - Realizar una puja
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