require('dotenv').config();
const express = require('express');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');
const jwt = require('jsonwebtoken'); // Importar jsonwebtoken

const app = express();
const PORT = process.env.PORT || 3000;

// Esta será la URL de tu backend desplegado en Render.
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL || `http://localhost:${PORT}`;
// Esta será la URL de tu frontend de GitHub Pages.
const FRONTEND_URL = 'https://guerramundialz.github.io'; // <--- ¡Tu URL de GitHub Pages!

// Configuración de CORS
const corsOptions = {
    origin: FRONTEND_URL,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // Esto es más relevante para cookies, pero no hace daño aquí
    optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

// Ya no necesitamos express-session ni passport.session() con JWTs
// app.use(session({...}));
// app.use(passport.session());

app.use(passport.initialize()); // Passport.initialize() todavía es necesario para Passport.use()

// --- Configuración de la estrategia de Discord ---
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'email', 'guilds']
},
function(accessToken, refreshToken, profile, cb) {
    console.log('--- Passport Callback Iniciado ---');
    console.log('Profile ID:', profile.id);
    console.log('Profile Username:', profile.username);

    // Con JWT, no necesitamos llamar a done(null, profile) para establecer una sesión Passport.
    // Solo necesitamos el 'profile' para generar nuestro token.
    // Pasamos el profile a la siguiente etapa como parte del 'done' para que Passport sepa que la autenticación fue exitosa.
    return cb(null, profile);
}));

// No necesitamos serializeUser/deserializeUser con JWT para el manejo de sesiones en el backend
// passport.serializeUser(...);
// passport.deserializeUser(...);

// --- Middleware para verificar el JWT ---
const verifyToken = (req, res, next) => {
    // Busca el token en el encabezado Authorization (Bearer Token)
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        // console.log('No Authorization header provided.'); // Para depuración
        return next(); // Opcional: permitir pasar si no hay token para rutas públicas
    }

    const token = authHeader.split(' ')[1]; // El token es la segunda parte (Bearer TOKEN)
    if (!token) {
        // console.log('No token found in Authorization header.'); // Para depuración
        return next(); // Opcional: permitir pasar si no hay token
    }

    // Verificar el token usando la misma clave secreta con la que se firmó
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT Verification Error:', err.message);
            // Si el token es inválido o ha expirado, no autenticamos al usuario
            return next(); // Opcional: permitir pasar si token es inválido, para que req.user sea undefined
        }
        // Si el token es válido, adjuntamos la información del usuario al objeto de solicitud
        req.user = user;
        // console.log('JWT verified. User:', req.user.username); // Para depuración
        next(); // Continuar con la siguiente función de middleware/ruta
    });
};

// Aplica el middleware verifyToken a todas las rutas que necesiten autenticación
app.use(verifyToken);


// --- Rutas del Servidor ---

// 1. Ruta raíz para verificar que el backend está funcionando
app.get('/', (req, res) => {
    console.log('--- Ruta raíz accedida ---');
    res.send('¡El backend de Guerra Mundial Z está funcionando correctamente con JWT!');
});

// 2. Ruta para iniciar el proceso de OAuth de Discord
app.get('/auth/discord', passport.authenticate('discord'));

// 3. Ruta de callback después de que el usuario autoriza en Discord
app.get('/auth/discord/callback',
    passport.authenticate('discord', {
        session: false, // ¡IMPORTANTE! Con JWT, no queremos crear una sesión de Passport
        failureRedirect: `${FRONTEND_URL}/error.html` // Redirige a tu frontend en caso de fallo
    }),
    function(req, res) {
        // Si llegamos aquí, la autenticación de Discord fue exitosa
        console.log('--- Autenticación Exitosa en Backend (Discord) ---');
        console.log('Usuario de Discord (req.user):', req.user.username);

        // Generar un JWT para el usuario autenticado
        // Usa una clave secreta FUERTE y ALMACENADA EN VARIABLES DE ENTORNO
        const token = jwt.sign(
            { id: req.user.id, username: req.user.username, discriminator: req.user.discriminator, avatar: req.user.avatar },
            process.env.JWT_SECRET,
            { expiresIn: '1h' } // El token expirará en 1 hora
        );

        console.log('JWT generado. Redirigiendo a frontend con token.');

        // Redirige al frontend y adjunta el token JWT como un parámetro de consulta
        res.redirect(`${FRONTEND_URL}/?token=${token}`);
    }
);

// Ruta para obtener la información del usuario logueado
app.get('/api/user', (req, res) => {
    console.log('--- Solicitud a /api/user ---');
    if (req.user) { // req.user es establecido por nuestro middleware verifyToken si el JWT es válido
        console.log('Usuario autenticado por JWT:', req.user.username);
        res.json({
            loggedIn: true,
            id: req.user.id,
            username: req.user.username,
            discriminator: req.user.discriminator,
            avatar: req.user.avatar,
        });
    } else {
        console.log('Usuario NO autenticado por JWT.');
        res.json({ loggedIn: false });
    }
});

// Ruta para cerrar sesión (con JWT, es más simple: el frontend simplemente descarta el token)
app.get('/auth/logout', (req, res) => {
    console.log('--- Solicitud de cierre de sesión ---');
    // Con JWT, el logout es manejado principalmente por el cliente (frontend)
    // que elimina el token de su almacenamiento local.
    // Aquí solo respondemos con un mensaje o redirigimos.
    res.status(200).json({ message: 'Sesión cerrada exitosamente (token eliminado del cliente).' });
    // O si prefieres una redirección directa (menos común para logout de JWT)
    // res.redirect(FRONTEND_URL);
});


// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor backend escuchando en ${RENDER_BACKEND_URL}`);
    console.log('Asegúrate de que las variables de entorno de Render (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_CALLBACK_URL, JWT_SECRET, NODE_ENV) sean correctas.');
});