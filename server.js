require('dotenv').config();
const express = require('express');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const cron = require('node-cron');
const axios = require('axios'); // Asegúrate de que axios esté instalado (npm install axios)

const app = express();
const PORT = process.env.PORT || 3000;

// Esta será la URL de tu backend desplegado en Render.
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL || `https://guerra-mundial-z-backend.onrender.com`;
// Esta será la URL de tu frontend de GitHub Pages.
const FRONTEND_URL = 'https://guerramundialz.github.io'; // ¡Tu URL de GitHub Pages!

// --- CAMBIO AQUI ---
// No necesitamos ADMIN_DISCORD_IDS aquí en server.js directamente.
// La verificación de roles de administrador se hará comparando los roles
// que Discord nos da contra una lista de roles de administrador definida
// en el middleware de autorización, que es más robusto.
// const ADMIN_DISCORD_IDS = ['954100893366775870', '652900302412054571']; // <-- ¡SE ELIMINA ESTO!
// --- FIN CAMBIO ---


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
// CAMBIO AQUI: Añadido 'guilds.members.read' al scope
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL, // Debe coincidir con la URL en Discord Dev Portal
    scope: ['identify', 'email', 'guilds', 'guilds.members.read'] // <-- CAMBIO AQUI: AGREGADO 'guilds.members.read'
},
async function(accessToken, refreshToken, profile, cb) { // <-- CAMBIO AQUI: `async` para usar await
    console.log('--- Passport Callback Iniciado ---');
    console.log('Profile ID:', profile.id);
    console.log('Profile Username:', profile.username);

    // --- CAMBIO AQUI: Obtener roles reales del servidor de Discord ---
    let userDiscordRoles = [];
    const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID; // Se accede a la variable de entorno aquí

    if (DISCORD_GUILD_ID) {
        try {
            // Realizar una petición a la API de Discord para obtener los detalles del miembro en el gremio (servidor)
            const guildMemberResponse = await axios.get(`https://discord.com/api/users/@me/guilds/${DISCORD_GUILD_ID}/member`, {
                headers: {
                    Authorization: `Bearer ${accessToken}`, // Usamos el accessToken del usuario
                },
            });

            if (guildMemberResponse.status === 200) {
                userDiscordRoles = guildMemberResponse.data.roles; // Esto es un array de IDs de rol de Discord
                console.log(`Roles de Discord obtenidos para ${profile.username}:`, userDiscordRoles);
            } else {
                console.warn(`No se pudieron obtener los roles para el usuario ${profile.username} en el servidor ${DISCORD_GUILD_ID}. Código de estado: ${guildMemberResponse.status}`);
                // userDiscordRoles permanecerá vacío
            }
        } catch (error) {
            console.error('Error al intentar obtener roles de Discord desde el backend:', error.message);
            // userDiscordRoles permanecerá vacío en caso de error
        }
    } else {
        console.warn("ADVERTENCIA: DISCORD_GUILD_ID no está configurado en las variables de entorno. No se verificarán los roles de Discord.");
    }
    // --- FIN CAMBIO AQUI ---

    // Adjuntar los roles obtenidos (o vacío) al perfil.
    profile.roles = userDiscordRoles; // <-- CAMBIO AQUI: Ahora usa los roles reales de Discord

    return cb(null, profile);
}));

// --- Importación de Middlewares de Autenticación y Autorización ---
// Ahora se importan desde un archivo separado para mejor modularidad.
// CAMBIO AQUI: auth.js debe contener la lógica de `JWT_SECRET` y los `ADMIN_DISCORD_ROLE_IDS`
const { authenticateToken, authorizeAdmin } = require('./middleware/auth');


// Aplica el middleware authenticateToken a TODAS las rutas para parsear el JWT si existe.
// Si no hay token o es inválido, req.user simplemente no se adjuntará, y las rutas que lo necesiten
// deberán manejarlo (o ser protegidas con authorizeAdmin/authenticateToken en la ruta misma).
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
        // req.user ahora tiene profile.roles con los IDs de rol de Discord
        console.log('Usuario de Discord (req.user):', req.user.username, 'Roles:', req.user.roles);

        // Generar un JWT para el usuario autenticado, incluyendo los roles
        // CAMBIO AQUI: Asegurarse de que process.env.JWT_SECRET esté accesible
        if (!process.env.JWT_SECRET) {
            console.error("ERROR: JWT_SECRET no está definido. No se puede generar el token JWT.");
            return res.status(500).send("Error de configuración del servidor.");
        }

        const token = jwt.sign(
            {
                id: req.user.id,
                username: req.user.username,
                discriminator: req.user.discriminator,
                avatar: req.user.avatar,
                roles: req.user.roles // <-- ¡Este es el array de IDs de rol de Discord!
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' } // Token expira en 1 hora
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
    // En un sistema basado en JWT, el backend no "cierra la sesión" per se.
    // Simplemente informa al cliente que puede descartar el token.
    res.status(200).json({ message: 'Sesión cerrada exitosamente (token eliminado del cliente).' });
});

// Importar y usar las rutas de subastas
// NOTA: routes/auctions.js ahora importará authenticateToken y authorizeAdmin
// directamente desde ./middleware/auth.js para usarlos en sus rutas específicas.
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
            auction.status = 'completed';
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
                        url: `https://guerramundialz.github.io/subastas.html`, // URL CORRECTA
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