require('dotenv').config(); // Carga las variables del archivo .env
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Esta será la URL de tu backend desplegado en Render.
// Es importante que coincida con la variable de entorno RENDER_BACKEND_URL que configurarás en Render.
// Por ahora, para pruebas locales, o si aún no tienes tu URL de Render, usa http://localhost:3000.
// Pero en Render, la variable de entorno RENDER_BACKEND_URL *DEBE* ser la URL HTTPS de tu servicio en Render.
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL || 'http://localhost:3000';

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
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        // En producción (Render), NODE_ENV será 'production' y secure será true (requiere HTTPS).
        // En desarrollo local, será false.
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true, // Evita que JavaScript del cliente acceda a la cookie
        maxAge: 24 * 60 * 60 * 1000 // 24 horas de duración de la cookie
    }
}));

// Inicializar Passport y la sesión de Passport
app.use(passport.initialize());
app.use(passport.session());

// Configuración de la estrategia de Discord
passport.use(new DiscordStrategy({
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        // Esta es la URL a la que Discord redirigirá DESPUÉS de la autorización.
        // Debe ser la URL de tu backend desplegado en Render, seguida de /auth/discord/callback.
        callbackURL: `${RENDER_BACKEND_URL}/auth/discord/callback`,
        scope: ['identify', 'email', 'guilds'] // Permisos que solicitas a Discord (ej. ID de usuario, email, servidores)
    },
    function(accessToken, refreshToken, profile, cb) {
        // Aquí es donde procesarías el perfil del usuario de Discord.
        // Por ejemplo, podrías guardarlo en una base de datos o verificar si ya existe.
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

// --- Rutas de Autenticación de Discord ---

// 1. Ruta para iniciar el proceso de OAuth de Discord
app.get('/auth/discord', passport.authenticate('discord'));

// 2. Ruta de callback después de que el usuario autoriza en Discord
// Discord redirigirá aquí, y tu backend de Render procesará la respuesta.
app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: 'https://guerramundialz.github.io/error.html' }), // <--- Tu URL de GitHub Pages para error
    function(req, res) {
        // Autenticación exitosa. Redirige de vuelta a tu página principal de GitHub Pages.
        res.redirect('https://guerramundialz.github.io/'); // <--- ¡Tu URL de GitHub Pages!
    }
);

// Ruta para obtener la información del usuario logueado
app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) {
        // req.user contiene el perfil de Discord del usuario (gracias a passport.deserializeUser)
        res.json({
            loggedIn: true,
            id: req.user.id,
            username: req.user.username,
            discriminator: req.user.discriminator,
            avatar: req.user.avatar,
            // Puedes añadir más campos del perfil de Discord si los necesitas
        });
    } else {
        res.json({ loggedIn: false });
    }
});

// Ruta para cerrar sesión
app.get('/auth/logout', (req, res, next) => {
    req.logout(function(err) { // req.logout requiere una función de callback
        if (err) { return next(err); }
        res.redirect('https://guerramundialz.github.io/'); // <--- Redirige a tu página principal de GitHub Pages
    });
});


// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor backend escuchando en ${RENDER_BACKEND_URL || `http://localhost:${PORT}`}`);
    console.log('Asegúrate de que la URL de redirección en Discord Developers y la de tu frontend sean correctas.');
});