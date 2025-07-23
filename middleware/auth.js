// middleware/auth.js
const jwt = require('jsonwebtoken');

// IMPORTANTE: Asegúrate de que JWT_SECRET esté configurado en tus variables de entorno (por ejemplo, en Render).

// ¡IMPORTANTE! Define los IDs de los roles de administrador de Discord que tienes en tu servidor.
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
    // Puedes añadir más IDs de rol si tienes varios roles de administrador.
];

// Validación para asegurar que ADMIN_DISCORD_ROLE_IDS no esté vacío en producción
if (process.env.NODE_ENV === 'production' && ADMIN_DISCORD_ROLE_IDS.some(id => id.includes('1397175186935255091'))) {
    console.error('1397175186935255091');
    // Considera una acción más drástica aquí en producción si esto es crítico (ej. process.exit(1))
}

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        req.user = null; // No hay token, no hay usuario autenticado
        return next();
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT Verification Error in middleware:', err.message);
            req.user = null; // Token inválido
            return next();
        }
        // Adjunta el payload decodificado (que ahora incluye 'isAdmin' y 'guildRoles' del server.js)
        req.user = user;
        next();
    });
};

const authorizeAdmin = (req, res, next) => {
    // req.user.guildRoles contiene los IDs de rol del usuario en el gremio,
    // obtenidos y añadidos al JWT por server.js.
    // Verificamos si alguno de esos roles está en nuestra lista de roles de administrador.
    if (req.user && req.user.guildRoles && Array.isArray(req.user.guildRoles) &&
        req.user.guildRoles.some(roleId => ADMIN_DISCORD_ROLE_IDS.includes(roleId))) {
        next(); // El usuario tiene un rol de administrador, permite el acceso.
    } else {
        console.warn(`Acceso denegado: Usuario ${req.user ? req.user.username : 'Desconocido'} (ID: ${req.user ? req.user.id : 'Desconocido'}) intentó acceder a ruta de admin sin el rol requerido.`);
        return res.status(403).json({ message: 'Acceso denegado. No tienes permisos de administrador.' });
    }
};

module.exports = {
    authenticateToken,
    authorizeAdmin,
    ADMIN_DISCORD_ROLE_IDS // Exportamos esto para que server.js pueda usarlo
};
