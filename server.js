require('dotenv').config();
const express = require('express');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const cron = require('node-cron');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Esta será la URL de tu backend desplegado en Render.
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL || `https://guerra-mundial-z-backend.onrender.com`;
// Esta será la URL de tu frontend de GitHub Pages.
const FRONTEND_URL = 'https://guerramundialz.github.io'; // ¡Tu URL de GitHub Pages!

// IDs de Discord de los administradores. ¡CAMBIA ESTO CON LOS IDs REALES!
// Estos IDs se usan para determinar si un usuario es admin en el callback de Discord.
const ADMIN_DISCORD_IDS = ['954100893366775870', '652900302412054571']; // <-- ¡CONFIRMA ESTOS IDs!

// URL del Webhook de Discord para notificaciones.
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Configuración de CORS
const corsOptions = {
    origin: FRONTEND_URL,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

// Middleware para parsear cuerpos de petición JSON.
app.use(express.json());

app.use(passport.initialize());

// --- Importar modelos y middlewares ---
const User = require('./models/User'); // Importa el modelo de usuario
const { authenticateToken, authorizeAdmin } = require('./middleware/auth'); // Importa los middlewares de autenticación
const Auction = require('./models/Auction'); // Importa el modelo de Subasta

// --- Configuración de la estrategia de Discord ---
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL, // Debe coincidir con la URL en Discord Dev Portal
    scope: ['identify', 'email', 'guilds'] // Asegúrate de que los scopes sean correctos para obtener la info necesaria
},
async function(accessToken, refreshToken, profile, cb) {
    console.log('--- Passport Callback Iniciado ---');
    console.log('Profile ID:', profile.id);
    console.log('Profile Username:', profile.username);

    try {
        let user = await User.findOne({ discordId: profile.id });

        // Determinar si el usuario es administrador basado en su ID de Discord
        // Si tienes un sistema de roles más complejo en Discord, podrías usar profile.guilds o profile.roles aquí
        // Por ahora, se basa en una lista de IDs de Discord predefinidos.
        const isAdminUser = ADMIN_DISCORD_IDS.includes(profile.id);
        const roles = isAdminUser ? ['user', 'admin'] : ['user'];

        if (user) {
            // Actualizar tokens y roles si es necesario
            user.username = profile.username;
            user.discriminator = profile.discriminator;
            user.avatar = profile.avatar;
            user.accessToken = accessToken;
            user.refreshToken = refreshToken;
            user.role = isAdminUser ? 'admin' : 'user'; // Actualizar el rol en la DB
            await user.save();
        } else {
            // Crear nuevo usuario si no existe
            user = new User({
                discordId: profile.id,
                username: profile.username,
                discriminator: profile.discriminator,
                avatar: profile.avatar,
                accessToken: accessToken,
                refreshToken: refreshToken,
                role: isAdminUser ? 'admin' : 'user' // Asignar rol al crear
            });
            await user.save();
        }
        // Adjuntar los roles al perfil de Discord para que estén disponibles en req.user después
        profile.roles = roles;
        profile.isAdmin = isAdminUser; // Añadir también una bandera isAdmin
        return cb(null, profile);
    } catch (err) {
        console.error('Error en el callback de Passport:', err);
        return cb(err, null);
    }
}));

// Aplica el middleware authenticateToken a TODAS las rutas para parsear el JWT si existe.
// Si no hay token o es inválido, req.user simplemente no se adjuntará, y las rutas que lo necesiten
// deberán manejarlo (o ser protegidas con authorizeAdmin/authenticateToken en la ruta misma).
app.use(authenticateToken); // Este middleware debe ir antes de las rutas que lo usan

// --- Conexión a la base de datos MongoDB ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Conectado a MongoDB'))
    .catch(err => console.error('Error de conexión a MongoDB:', err));


// --- Rutas del Servidor ---

// 1. Ruta raíz para verificar que el backend está funcionando
app.get('/', (req, res) => {
    console.log('--- Ruta raíz accedida ---');
    res.send('¡El backend de Guerra Mundial Z está funcionando correctamente con JWT y Subastas!');
});

// 2. Ruta para iniciar el proceso de OAuth de Discord
app.get('/auth/discord', passport.authenticate('discord'));

// 3. Ruta de callback después de que el usuario autoriza en Discord
app.get('/auth/discord/callback',
    passport.authenticate('discord', {
        session: false, // No usamos sesiones de Express
        failureRedirect: `${FRONTEND_URL}/error.html` // Redirección al frontend en caso de fallo
    }),
    function(req, res) {
        console.log('--- Autenticación Exitosa en Backend (Discord) ---');
        console.log('Usuario de Discord (req.user):', req.user.username, 'Roles:', req.user.roles);

        // Generar un JWT para el usuario autenticado, incluyendo los roles y la bandera isAdmin
        const token = jwt.sign(
            {
                id: req.user.id,
                username: req.user.username,
                discriminator: req.user.discriminator,
                avatar: req.user.avatar,
                roles: req.user.roles, // Incluir los roles en el JWT
                isAdmin: req.user.isAdmin // Incluir la bandera isAdmin en el JWT
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' } // Token expira en 1 hora
        );

        console.log('JWT generado. Redirigiendo a frontend con token.');
        res.redirect(`${FRONTEND_URL}/?token=${token}`);
    }
);

// Ruta para obtener la información del usuario logueado (ahora incluye roles y isAdmin)
app.get('/api/user', (req, res) => {
    console.log('--- Solicitud a /api/user ---');
    if (req.user) {
        console.log('Usuario autenticado por JWT:', req.user.username, 'Roles:', req.user.roles, 'isAdmin:', req.user.isAdmin);
        res.json({
            loggedIn: true,
            id: req.user.id,
            username: req.user.username,
            discriminator: req.user.discriminator,
            avatar: req.user.avatar,
            roles: req.user.roles, // Asegurarse de que los roles se envíen al frontend
            isAdmin: req.user.isAdmin // Asegurarse de que isAdmin se envíe al frontend
        });
    } else {
        console.log('Usuario NO autenticado por JWT.');
        res.json({ loggedIn: false });
    }
});

// Ruta para cerrar sesión (con JWT, es más simple: el frontend simplemente descarta el token)
app.get('/auth/logout', (req, res) => {
    console.log('--- Solicitud de cierre de sesión ---');
    // En un sistema basado en JWT, el backend no "cierra la sesión" per se.
    // Simplemente informa al cliente que puede descartar el token.
    res.status(200).json({ message: 'Sesión cerrada exitosamente (token eliminado del cliente).' });
});

// Importar y usar las rutas de subastas
// Las rutas de subastas estarán bajo /api/auctions
const auctionRoutes = require('./routes/auctions'); // Asegúrate de que la ruta sea correcta
app.use('/api/auctions', auctionRoutes);

// --- Tarea Programada para Finalizar Subastas ---
cron.schedule('* * * * *', async () => { // Se ejecuta cada minuto
    console.log('Buscando subastas finalizadas automáticamente...');
    const now = new Date();
    try {
        const endedAuctions = await Auction.find({
            status: 'active',
            endDate: { $lte: now }
        });

        for (const auction of endedAuctions) {
            auction.status = 'finalized'; // Cambiar el estado a 'finalized'

            // Determinar ganador y precio final
            if (auction.currentBidderId) {
                auction.winnerId = auction.currentBidderId;
                auction.winnerName = auction.currentBidderName;
                auction.finalPrice = auction.currentBid;
            } else {
                auction.winnerId = null;
                auction.winnerName = null;
                auction.finalPrice = null; // No hubo pujas
            }

            await auction.save();

            let message;
            let embedColor;
            if (auction.winnerId) {
                message = `🎉 ¡La subasta de **${auction.title}** ha finalizado automáticamente! El ganador es **${auction.winnerName}** con una puja de **${auction.finalPrice} Rublos**. ¡Felicidades!`;
                embedColor = 3066993; // Un color verde para Discord (hex 0x2ECC71)
            } else {
                message = `💔 La subasta de **${auction.title}** ha finalizado automáticamente sin pujas.`;
                embedColor = 10038562; // Un color gris/rojo para Discord (hex 0x99AAB5)
            }

            console.log(message);
            if (DISCORD_WEBHOOK_URL) {
                axios.post(DISCORD_WEBHOOK_URL, {
                    content: message,
                    embeds: [{
                        title: `Subasta Finalizada: ${auction.title}`,
                        description: auction.winnerId ? `Ganador: **${auction.winnerName}**\nPuja Final: **${auction.finalPrice} Rublos**` : 'No hubo pujas.',
                        url: `${FRONTEND_URL}/subastas.html`, // URL CORRECTA
                        color: embedColor,
                        thumbnail: { url: auction.imageUrl || 'https://via.placeholder.com/150' },
                        footer: { text: `Subasta ID: ${auction._id}` }
                    }]
                }).catch(err => console.error("Error enviando webhook de fin de subasta:", err.message));
            }
        }
    } catch (error) {
        console.error('Error en la tarea programada de subastas:', error);
    }
});


// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor backend escuchando en ${RENDER_BACKEND_URL}`);
    console.log('Asegúrate de que las variables de entorno de Render (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_CALLBACK_URL, JWT_SECRET, MONGODB_URI, DISCORD_WEBHOOK_URL) sean correctas.');
});
