require('dotenv').config();
const express = require('express');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');
const jwt = require('jsonwebtoken'); // Importar jsonwebtoken
const mongoose = require('mongoose'); // NUEVO: Importar mongoose para la base de datos
const cron = require('node-cron'); // NUEVO: Importar node-cron para tareas programadas
const axios = require('axios'); // NUEVO: Importar axios para enviar webhooks a Discord

const app = express();
const PORT = process.env.PORT || 3000;

// Esta será la URL de tu backend desplegado en Render.
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL || `http://localhost:${PORT}`;
// Esta será la URL de tu frontend de GitHub Pages.
const FRONTEND_URL = 'https://guerramundialz.github.io'; // <--- ¡Tu URL de GitHub Pages!

// NUEVO: IDs de Discord de los administradores. ¡CAMBIA ESTO CON LOS IDs REALES!
// Puedes obtener tu ID de Discord activando el "Modo Desarrollador" en Discord (Ajustes de Usuario -> Avanzado)
// y luego haciendo clic derecho en tu nombre de usuario y seleccionando "Copiar ID".
const ADMIN_DISCORD_IDS = ['954100893366775870', 'TU_ID_DE_ADMIN_DISCORD_2']; // <-- ¡MODIFICA ESTO!

// NUEVO: URL del Webhook de Discord para notificaciones de subastas.
// Configura esto en Render como variable de entorno.
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Configuración de CORS
const corsOptions = {
    origin: FRONTEND_URL,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

// NUEVO: Middleware para parsear cuerpos de petición JSON. ¡CRUCIAL para POST/PUT!
app.use(express.json());

app.use(passport.initialize());

// --- Configuración de la estrategia de Discord ---
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'email', 'guilds'] // guilds para posibles verificaciones de roles en el futuro
},
function(accessToken, refreshToken, profile, cb) {
    console.log('--- Passport Callback Iniciado ---');
    console.log('Profile ID:', profile.id);
    console.log('Profile Username:', profile.username);

    // NUEVO: Determinar si el usuario es administrador basado en su ID de Discord
    const roles = ADMIN_DISCORD_IDS.includes(profile.id) ? ['user', 'admin'] : ['user'];
    profile.roles = roles; // Añadir los roles al perfil de Discord

    return cb(null, profile);
}));

// --- Middleware para verificar el JWT (renombrado y modificado para incluir roles) ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return next();
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT Verification Error:', err.message);
            return next();
        }
        req.user = user; // user contendrá id, username, discriminator, avatar, y AHORA roles
        next();
    });
};

// NUEVO: Middleware para autorizar solo a administradores
const authorizeAdmin = (req, res, next) => {
    if (!req.user || !req.user.roles || !req.user.roles.includes('admin')) {
        return res.status(403).json({ message: 'Acceso denegado. Se requiere rol de administrador.' });
    }
    next();
};

// Aplica el middleware authenticateToken a todas las rutas que necesiten autenticación
app.use(authenticateToken);

// --- NUEVO: Conexión a la base de datos MongoDB ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Conectado a MongoDB'))
    .catch(err => console.error('Error de conexión a MongoDB:', err));

// NUEVO: Importar el modelo de Subasta (necesario para el cron job)
const Auction = require('./models/Auction');

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
        session: false,
        failureRedirect: `${FRONTEND_URL}/error.html`
    }),
    function(req, res) {
        console.log('--- Autenticación Exitosa en Backend (Discord) ---');
        console.log('Usuario de Discord (req.user):', req.user.username, 'Roles:', req.user.roles);

        // Generar un JWT para el usuario autenticado, incluyendo los roles
        const token = jwt.sign(
            {
                id: req.user.id,
                username: req.user.username,
                discriminator: req.user.discriminator,
                avatar: req.user.avatar,
                roles: req.user.roles // Incluir los roles en el JWT
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        console.log('JWT generado. Redirigiendo a frontend con token.');
        res.redirect(`${FRONTEND_URL}/?token=${token}`);
    }
);

// Ruta para obtener la información del usuario logueado (ahora incluye roles)
app.get('/api/user', (req, res) => {
    console.log('--- Solicitud a /api/user ---');
    if (req.user) {
        console.log('Usuario autenticado por JWT:', req.user.username, 'Roles:', req.user.roles);
        res.json({
            loggedIn: true,
            id: req.user.id,
            username: req.user.username,
            discriminator: req.user.discriminator,
            avatar: req.user.avatar,
            roles: req.user.roles // Asegurarse de que los roles se envíen al frontend
        });
    } else {
        console.log('Usuario NO autenticado por JWT.');
        res.json({ loggedIn: false });
    }
});

// Ruta para cerrar sesión (con JWT, es más simple: el frontend simplemente descarta el token)
app.get('/auth/logout', (req, res) => {
    console.log('--- Solicitud de cierre de sesión ---');
    res.status(200).json({ message: 'Sesión cerrada exitosamente (token eliminado del cliente).' });
});

// NUEVO: Importar y usar las rutas de subastas
const auctionRoutes = require('./routes/auctions');
app.use('/api/auctions', auctionRoutes); // Las rutas de subastas estarán bajo /api/auctions

// --- NUEVO: Tarea Programada para Finalizar Subastas ---
cron.schedule('* * * * *', async () => { // Se ejecuta cada minuto
    console.log('Buscando subastas finalizadas...');
    const now = new Date();
    try {
        const endedAuctions = await Auction.find({
            status: 'active',
            endDate: { $lte: now }
        });

        for (const auction of endedAuctions) {
            auction.status = 'completed';
            await auction.save();

            let message;
            let embedColor;
            if (auction.currentBidderId) {
                message = `🎉 ¡La subasta de **${auction.title}** ha finalizado! El ganador es **${auction.currentBidderName}** con una puja de **${auction.currentBid} Rublos**. ¡Felicidades!`;
                embedColor = 3066993; // Un color verde para Discord
            } else {
                message = `💔 La subasta de **${auction.title}** ha finalizado sin pujas.`;
                embedColor = 10038562; // Un color gris/rojo para Discord
            }

            console.log(message);
            if (DISCORD_WEBHOOK_URL) {
                axios.post(DISCORD_WEBHOOK_URL, {
                    content: message,
                    embeds: [{
                        title: `Subasta Finalizada: ${auction.title}`,
                        description: auction.currentBidderId ? `Ganador: **${auction.currentBidderName}**\nPuja Final: **${auction.currentBid} Rublos**` : 'No hubo pujas.',
                        url: `$https://guerramundialz.github.io/#auctions`, // <-- ¡Asegúrate de que esta URL sea correcta!
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