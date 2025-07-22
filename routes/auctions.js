// routes/auctions.js
const express = require('express');
const router = express.Router();
const Auction = require('../models/Auction'); // Importa tu modelo de subasta
// Importa los middlewares de autenticación y autorización desde server.js
// Asumimos que server.js los exporta o que son globales, pero es mejor importarlos
// Para este setup, los middlewares authenticateToken y authorizeAdmin están en server.js
// y se aplican globalmente o se pueden pasar aquí si se exportaran desde server.js.
// Para simplificar, asumiremos que authenticateToken se aplica globalmente y authorizeAdmin
// se usará directamente donde se necesite.

// Si los middlewares estuvieran en un archivo separado como middleware/auth.js:
// const { authenticateToken, authorizeAdmin } = require('../middleware/auth');
// Pero como los he puesto en server.js, los usarás directamente en las rutas si no los exportas.
// Para que esto funcione, necesitas exportarlos de server.js o copiarlos aquí.
// La forma más limpia es tenerlos en un archivo `middleware/auth.js` y importarlos.
// Para este ejemplo, voy a asumir que los middlewares están disponibles globalmente o que los copiarás aquí.

// Para que este archivo funcione de forma independiente, necesitamos los middlewares aquí.
// Copiando los middlewares de auth directamente para este archivo:
const jwt = require('jsonwebtoken');
const ADMIN_DISCORD_IDS = ['TU_ID_DE_ADMIN_DISCORD_1', 'TU_ID_DE_ADMIN_DISCORD_2']; // <-- ¡MODIFICA ESTO!

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

const authorizeAdmin = (req, res, next) => {
    const userIsAdmin = ADMIN_DISCORD_IDS.includes(req.user.id);
    if (!userIsAdmin) {
        return res.status(403).json({ message: 'Acceso denegado. Se requiere rol de administrador.' });
    }
    next();
};
// Fin de la copia de middlewares


const axios = require('axios'); // Necesario para enviar webhooks a Discord
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL; // Tu webhook para notificaciones
const FRONTEND_URL = 'https://guerramundialz.github.io'; // <--- ¡Tu URL de GitHub Pages!

// 1. GET /api/auctions - Obtener todas las subastas activas
router.get('/', async (req, res) => {
    try {
        const auctions = await Auction.find({ status: 'active', endDate: { $gt: new Date() } }).sort({ endDate: 1 });
        res.json(auctions);
    } catch (error) {
        console.error('Error fetching auctions:', error);
        res.status(500).json({ message: 'Error al obtener las subastas.' });
    }
});

// 2. POST /api/admin/auctions - Crear una nueva subasta (Solo administradores)
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
            imageUrl,
            startBid,
            currentBid: startBid,
            endDate: new Date(endDate),
            creatorId: req.user.id,
            creatorName: req.user.username
        });

        await newAuction.save();

        if (DISCORD_WEBHOOK_URL) {
            axios.post(DISCORD_WEBHOOK_URL, {
                content: `🚨 ¡Nueva subasta creada por ${req.user.username}! **${newAuction.title}** con puja inicial de ${newAuction.startBid} Rublos. Finaliza el ${newAuction.endDate.toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })}. ¡Puja ahora en tu web!`,
                embeds: [{
                    title: newAuction.title,
                    description: newAuction.description,
                    url: `$https://guerramundialz.github.io/#auctions`, // <-- ¡MODIFICA ESTO con la URL de tu sitio!
                    color: 15158332,
                    image: { url: newAuction.imageUrl || 'https://via.placeholder.com/150' },
                    fields: [
                        { name: "Puja Inicial", value: `${newAuction.startBid} Rublos`, inline: true },
                        { name: "Finaliza", value: `<t:${Math.floor(newAuction.endDate.getTime() / 1000)}:R>`, inline: true }
                    ],
                    footer: { text: `Creada por ${newAuction.creatorName}` }
                }]
            }).catch(err => console.error("Error enviando webhook de Discord para nueva subasta:", err.message));
        }

        res.status(201).json(newAuction);
    } catch (error) {
        console.error('Error creating auction:', error);
        res.status(500).json({ message: 'Error al crear la subasta.' });
    }
});

// 3. POST /api/auctions/:id/bid - Realizar una puja
router.post('/:id/bid', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { bidAmount } = req.body;

    if (!bidAmount || isNaN(bidAmount) || bidAmount <= 0) {
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
        if (req.user.id === auction.currentBidderId) {
             return res.status(400).json({ message: 'Ya eres el pujador actual. Tu puja debe ser superior para superarte.' });
        }

        auction.currentBid = bidAmount;
        auction.currentBidderId = req.user.id;
        auction.currentBidderName = req.user.username;
        await auction.save();

        if (DISCORD_WEBHOOK_URL) {
            axios.post(DISCORD_WEBHOOK_URL, {
                content: `🔔 ¡Nueva puja en **${auction.title}**! **${req.user.username}** ha pujado **${bidAmount} Rublos** (anterior: ${auction.currentBid - (bidAmount - auction.currentBid)} Rublos). ¡Supera la oferta!`,
                embeds: [{
                    title: `Nueva Puja en ${auction.title}`,
                    description: `**${req.user.username}** ha pujado **${bidAmount} Rublos**.\nPuja actual: **${auction.currentBid} Rublos**`,
                    url: `$https://guerramundialz.github.io/#auctions`, // <-- ¡MODIFICA ESTO con la URL de tu sitio!
                    color: 3447003,
                    thumbnail: { url: req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${parseInt(req.user.id) % 5}.png` },
                    footer: { text: `Finaliza en ${auction.endDate.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}` }
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