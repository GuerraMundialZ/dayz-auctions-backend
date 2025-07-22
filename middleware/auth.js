// middleware/auth.js
const jwt = require('jsonwebtoken');

// IMPORTANTE: Asegúrate de que JWT_SECRET esté configurado en tus variables de entorno (por ejemplo, en Render).

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // console.log('Auth Header:', authHeader); // Para depuración
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        // console.log('No token provided.'); // Para depuración
        // No enviamos 401 aquí porque este middleware se aplica globalmente en server.js.
        // Si una ruta requiere autenticación, deberá verificar req.user.
        // Si no hay token, simplemente no adjuntamos req.user.
        return next(); 
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT Verification Error in middleware:', err.message);
            // Token inválido o expirado. No adjuntamos el usuario.
            return next(); 
        }
        req.user = user; // Adjuntamos el usuario al objeto de la solicitud
        // console.log('User authenticated:', req.user.username); // Para depuración
        next();
    });
};

const authorizeAdmin = (req, res, next) => {
    // req.user ya debería estar poblado por authenticateToken si el token era válido.
    if (!req.user || !req.user.roles || !req.user.roles.includes('admin')) {
        console.warn('Acceso denegado: No user or not admin role.', req.user ? req.user.id : 'No user', req.user ? req.user.roles : 'No roles'); // Para depuración
        return res.status(403).json({ message: 'Acceso denegado. Se requiere rol de administrador.' });
    }
    next();
};

module.exports = { authenticateToken, authorizeAdmin };