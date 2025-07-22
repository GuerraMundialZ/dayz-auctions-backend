require('dotenv').config();
const express = require('express');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const cron = require('node-cron');
const axios = require('axios'); // Necesario para hacer llamadas a la API de Discord

const app = express();
const PORT = process.env.PORT || 3000;

// Esta será la URL de tu backend desplegado en Render.
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL || `https://guerra-mundial-z-backend.onrender.com`;
// Esta será la URL de tu frontend de GitHub Pages.
const FRONTEND_URL = 'https://guerramundialz.github.io'; // ¡Tu URL de GitHub Pages!

// ¡IMPORTANTE! Reemplaza con el ID de tu SERVIDOR (GUILD) de Discord.
// Necesario para verificar los roles del usuario en ese servidor.
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || 'TU_ID_DE_SERVIDOR_DISCORD_AQUI'; // <-- ¡CONFIRMA ESTE ID!

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

// --- Configuración de la estrategia de Discord ---
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL, // Debe coincidir con la URL en Discord Dev Portal
    // ¡IMPORTANTE! Añadido 'guilds.members.read' para obtener los roles del usuario en un gremio
    scope: ['identify', 'email', 'guilds', 'guilds.members.read']
},
async function(accessToken, refreshToken, profile, cb) {
    console.log('--- Passport Callback Iniciado ---');
    console.log('Profile ID:', profile.id);
    console.log('Profile Username:', profile.username);

    let isAdminUser = false;
    let userGuildRoles = []; // Almacenará los IDs de los roles del usuario en el gremio

    try {
        // Hacemos una llamada a la API de Discord para obtener los roles del usuario en el gremio específico
        const guildMemberResponse = await axios.get(
            `https://discord.com/api/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        // Los roles del usuario en el gremio están en guildMemberResponse.data.roles
        userGuildRoles = guildMemberResponse.data.roles;
        console.log('Roles del usuario en el gremio:', userGuildRoles);

        // Importamos la lista de IDs de rol de administrador desde el middleware
        // para determinar si el usuario es admin.
        const { ADMIN_DISCORD_ROLE_IDS } = require('./middleware/auth');
        isAdminUser = userGuildRoles.some(roleId => ADMIN_DISCORD_ROLE_IDS.includes(roleId));

    } catch (error) {
        console.error('Error al obtener roles del gremio desde Discord API:', error.response ? error.response.data : error.message);
        // Si hay un error al obtener los roles (ej. el usuario no está en el gremio),
        // no se le considerará administrador por rol.
        isAdminUser = false;
        userGuildRoles = []; // Asegurarse de que sea un array vacío si falla
    }

    // Adjuntar la bandera isAdmin y los roles del gremio al perfil para el JWT
    profile.isAdmin = isAdminUser;
    profile.guildRoles = userGuildRoles; // Guardamos los roles obtenidos del gremio

    return cb(null, profile);
}));

// --- Importación de Middlewares de Autenticación y Autorización ---
const { authenticateToken, authorizeAdmin } = require('./middleware/auth');

// Aplica el middleware authenticateToken a TODAS las rutas para parsear el JWT si existe.
app.use(authenticateToken);

// --- Conexión a la base de datos MongoDB ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Conectado a MongoDB'))
    .catch(err => console.error('Error de conexión a MongoDB:', err));

// Importar el modelo de Subasta (necesario para el cron job y rutas)
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
        session: false, // No usamos sesiones de Express
        failureRedirect: `${FRONTEND_URL}/error.html` // Redirección al frontend en caso de fallo
    }),
    function(req, res) {
        console.log('--- Autenticación Exitosa en Backend (Discord) ---');
        console.log('Usuario de Discord (req.user):', req.user.username, 'isAdmin:', req.user.isAdmin);
        console.log('Roles de Gremio en JWT:', req.user.guildRoles);

        // Generar un JWT para el usuario autenticado, incluyendo la bandera isAdmin y los roles del gremio
        const token = jwt.sign(
            {
                id: req.user.id,
                username: req.user.username,
                discriminator: req.user.discriminator,
                avatar: req.user.avatar,
                isAdmin: req.user.isAdmin, // Incluir la bandera isAdmin en el JWT
                guildRoles: req.user.guildRoles // ¡IMPORTANTE! Incluir los roles del gremio en el JWT
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' } // Token expira en 1 hora
        );

        console.log('JWT generado. Redirigiendo a frontend con token.');
        res.redirect(`${FRONTEND_URL}/?token=${token}`);
    }
);

// Ruta para obtener la información del usuario logueado (ahora incluye isAdmin y guildRoles)
app.get('/api/user', (req, res) => {
    console.log('--- Solicitud a /api/user ---');
    if (req.user) {
        console.log('Usuario autenticado por JWT:', req.user.username, 'isAdmin:', req.user.isAdmin);
        console.log('Roles de Gremio enviados al frontend:', req.user.guildRoles);
        res.json({
            loggedIn: true,
            id: req.user.id,
            username: req.user.username,
            discriminator: req.user.discriminator,
            avatar: req.user.avatar,
            isAdmin: req.user.isAdmin, // Asegurarse de que isAdmin se envíe al frontend
            guildRoles: req.user.guildRoles // ¡IMPORTANTE! Enviar los roles del gremio al frontend
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

// Importar y usar las rutas de subastas
const auctionRoutes = require('./routes/auctions');
app.use('/api/auctions', auctionRoutes); // Las rutas de subastas estarán bajo /api/auctions

// --- Tarea Programada para Finalizar Subastas ---
cron.schedule('* * * * *', async () => { // Se ejecuta cada minuto
    console.log('Buscando subastas finalizadas...');
    const now = new Date();
    try {
        const endedAuctions = await Auction.find({
            status: 'active',
            endDate: { $lte: now }
        });

        for (const auction of endedAuctions) {
            auction.status = 'finalized';
            // Establecer ganador y precio final si hubo pujas
            if (auction.currentBidderId) {
                auction.winnerId = auction.currentBidderId;
                auction.winnerName = auction.currentBidderName;
                auction.finalPrice = auction.currentBid;
            } else {
                auction.winnerId = null;
                auction.winnerName = null;
                auction.finalPrice = null;
            }
            await auction.save();

            let message;
            let embedColor;
            if (auction.currentBidderId) {
                message = `🎉 ¡La subasta de **${auction.title}** ha finalizado! El ganador es **${auction.currentBidderName}** con una puja de **${auction.currentBid} Rublos**. ¡Felicidades!`;
                embedColor = 3066993; // Un color verde para Discord (hex 0x2ECC71)
            } else {
                message = `💔 La subasta de **${auction.title}** ha finalizado sin pujas.`;
                embedColor = 10038562; // Un color gris/rojo para Discord (hex 0x99AAB5)
            }

            console.log(message);
            if (DISCORD_WEBHOOK_URL) {
                axios.post(DISCORD_WEBHOOK_URL, {
                    content: message,
                    embeds: [{
                        title: `Subasta Finalizada: ${auction.title}`,
                        description: auction.currentBidderId ? `Ganador: **${auction.currentBidderName}**\nPuja Final: **${auction.currentBid} Rublos**` : 'No hubo pujas.',
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
    console.log('Asegúrate de que las variables de entorno de Render (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_CALLBACK_URL, JWT_SECRET, MONGODB_URI, DISCORD_WEBHOOK_URL, DISCORD_GUILD_ID) sean correctas.');
});
