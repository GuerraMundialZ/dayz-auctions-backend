// middleware/auth.js
const jwt = require('jsonwebtoken');

// IMPORTANTE: Asegúrate de que JWT_SECRET esté configurado en tus variables de entorno (por ejemplo, en Render).

// --- CAMBIO AQUI ---
// Define los IDs de los roles de administrador de Discord que tienes en tu servidor.
// Estos IDs son cadenas numéricas y DEBEN COINCIDIR EXACTAMENTE con los IDs de los roles
// en tu servidor de Discord.
//
// Para encontrar un ID de rol:
// 1. Activa el Modo Desarrollador en Discord (Ajustes de Usuario -> Avanzado).
// 2. Ve a la configuración de tu servidor.
// 3. Ve a "Roles".
// 4. Haz clic derecho en el rol que quieres que sea administrador y selecciona "Copiar ID".
const ADMIN_DISCORD_ROLE_IDS = [
    '1397175186935255091', // Reemplaza con el ID real de tu primer rol de administrador
    // Por ejemplo: '123456789012345678', '987654321098765432'
];

// Validación para asegurar que ADMIN_DISCORD_ROLE_IDS no esté vacío en producción
if (process.env.NODE_ENV === 'production' && ADMIN_DISCORD_ROLE_IDS.some(id => id.includes('TU_ID_DE_ROL_DE_ADMINISTRADOR_AQUI'))) {
    console.error('ERROR: ADMIN_DISCORD_ROLE_IDS contiene valores de marcador de posición. ¡Cámbialos por IDs reales de tus roles de Discord!');
    process.exit(1); // Considera detener la aplicación si esto no se ha configurado correctamente
}
// --- FIN CAMBIO ---

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        req.user = null;
        return next();
    }

    // --- CAMBIO AQUI ---
    // Asegurarse de que JWT_SECRET esté definido antes de usarlo.
    if (!process.env.JWT_SECRET) {
        console.error("ERROR: JWT_SECRET no está definido en las variables de entorno para el middleware de autenticación.");
        // Si no está definido, no podemos verificar el token de forma segura.
        // Podrías decidir enviar un error 500 o simplemente pasar a next() sin req.user.
        // Para robustez en producción, es mejor que se maneje con una variable de entorno obligatoria.
        req.user = null; // No autenticado si falta el secreto
        return next();
    }
    // --- FIN CAMBIO ---

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT Verification Error in middleware:', err.message);
            req.user = null;
            return next();
        }
        req.user = user;
        next();
    });
};

const authorizeAdmin = (req, res, next) => {
    // req.user.roles es un array de IDs de rol de Discord que se adjuntó al JWT.
    if (!req.user || !req.user.roles || !Array.isArray(req.user.roles)) {
        console.warn('Acceso denegado: Usuario no autenticado o sin roles válidos.');
        return res.status(403).json({ message: 'Acceso denegado. No autenticado o roles no disponibles.' });
    }

    // --- CAMBIO AQUI ---
    // Comprobar si el usuario tiene AL MENOS UNO de los roles de administrador definidos.
    const hasAdminRole = req.user.roles.some(roleId => ADMIN_DISCORD_ROLE_IDS.includes(roleId));

    if (hasAdminRole) {
        next(); // El usuario tiene un rol de administrador, permite el acceso.
    } else {
        console.warn(`Acceso denegado: Usuario ${req.user.username || 'Desconocido'} (ID: ${req.user.id || 'Desconocido'}) intentó acceder a ruta de admin sin el rol requerido. Roles del usuario: ${req.user.roles.join(', ')}`);
        return res.status(403).json({ message: 'Acceso denegado. Se requiere un rol de administrador de Discord.' });
    }
    // --- FIN CAMBIO ---
};

module.exports = { authenticateToken, authorizeAdmin };