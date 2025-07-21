require('dotenv').config(); // Carga las variables del archivo .env
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Esta será la URL de tu backend desplegado en Render.
// Es importante que la variable de entorno RENDER_BACKEND_URL esté configurada en Render.
// Si no está, por defecto usará localhost para desarrollo.
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL || `http://localhost:${PORT}`;

// Configuración de CORS para permitir solicitudes desde tu GitHub Pages
// ¡IMPORTANTE! Asegúrate de que esta sea la URL EXACTA de tu GitHub Pages.
const corsOptions = {
    origin: 'https://guerramundialz.github.io', // <--- ¡TU URL de GitHub Pages!
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // Esto permite que las cookies de sesión se envíen
    optionsSuccessStatus: 204
};
app.use(cors(corsOptions));


// Configuración de la sesión
// Utiliza una clave secreta larga y aleatoria. Render la leerá de la variable de entorno SESSION_SECRET.
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_super_secret_key_dev', // Asegúrate de configurar SESSION_SECRET en Render
    resave: false,
    saveUninitialized: false,
    cookie: {
        // En producción (Render), NODE_ENV será 'production' y secure será true (requiere HTTPS).
        // En desarrollo local, será false.
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true, // Evita que JavaScript del cliente acceda a la cookie
        maxAge: 24 * 60 * 60 * 1000, // 24 horas de duración de la cookie
        sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax' // 'None' para cross-site con secure:true en prod
    }
}));

// Inicializar Passport y la sesión de Passport
app.use(passport.initialize());
app.use(passport.session());

// --- Rutas de Autenticación de Discord ---

// Configuración de la estrategia de Discord
passport.use(new DiscordStrategy({
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        // Esta es la URL a la que Discord redirigirá DESPUÉS de la autorización.
        // Debe ser la URL de tu backend desplegado en Render, seguida de /auth/discord/callback.
        // Configura DISCORD_CALLBACK_URL en Render: https://guerra-mundial-z-backend.onrender.com/auth/discord/callback
        callbackURL: process.env.DISCORD_CALLBACK_URL,
        scope: ['identify', 'email', 'guilds'] // Permisos que solicitas a Discord (ej. ID de usuario, email, servidores)
    },
    function(accessToken, refreshToken, profile, cb) {
        // ESTOS LOGS SON CLAVE PARA DEPURAR EL PASSPORT CALLBACK
        console.log('--- Passport Callback Iniciado ---');
        console.log('Profile ID:', profile.id);
        console.log('Profile Username:', profile.username);
        // console.log('Full Profile:', profile); // Descomentar para ver el perfil completo si es necesario

        // Aquí es donde normalmente guardarías o buscarías al usuario en tu base de datos.
        // Para este ejemplo, simplemente pasamos el perfil.
        return cb(null, profile);
    }
));

// Serialización y deserialización del usuario
// Necesario para que Passport guarde y recupere el usuario de la sesión.
passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(obj, done) {
    done(null, obj);
});

// --- Rutas del Servidor ---

// 1. **NUEVA RUTA: Ruta raíz para verificar que el backend está funcionando**
app.get('/', (req, res) => {
    console.log('--- Ruta raíz accedida ---');
    res.send('¡El backend de Guerra Mundial Z está funcionando correctamente!');
});

// 2. Ruta para iniciar el proceso de OAuth de Discord
app.get('/auth/discord', passport.authenticate('discord'));

// 3. Ruta de callback después de que el usuario autoriza en Discord
// Discord redirigirá aquí, y tu backend de Render procesará la respuesta.
app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: 'https://guerramundialz.github.io/error.html' }), // <--- Tu URL de GitHub Pages para error
    function(req, res) {
        // Autenticación exitosa. Redirige de vuelta a tu página principal de GitHub Pages.
        console.log('--- Autenticación Exitosa en Backend, redirigiendo a frontend ---');
        console.log('Usuario autenticado:', req.user.username);
        res.redirect('https://guerramundialz.github.io/'); // <--- ¡Tu URL de GitHub Pages!
    }
);

// Ruta para obtener la información del usuario logueado
app.get('/api/user', (req, res) => {
    console.log('--- Solicitud a /api/user ---');
    if (req.isAuthenticated()) {
        console.log('Usuario autenticado:', req.user.username);
        res.json({
            loggedIn: true,
            id: req.user.id,
            username: req.user.username,
            discriminator: req.user.discriminator,
            avatar: req.user.avatar,
            // Puedes añadir más campos del perfil de Discord si los necesitas
        });
    } else {
        console.log('Usuario NO autenticado.');
        res.json({ loggedIn: false });
    }
});

// Ruta para cerrar sesión
app.get('/auth/logout', (req, res, next) => {
    console.log('--- Intentando cerrar sesión ---');
    req.logout(function(err) { // req.logout requiere una función de callback
        if (err) {
            console.error('Error al cerrar sesión:', err);
            return next(err);
        }
        console.log('Sesión cerrada, redirigiendo a frontend.');
        res.redirect('https://guerramundialz.github.io/'); // <--- Redirige a tu página principal de GitHub Pages
    });
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor backend escuchando en ${RENDER_BACKEND_URL}`);
    console.log('Asegúrate de que las variables de entorno de Render (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_CALLBACK_URL, SESSION_SECRET) sean correctas.');
});