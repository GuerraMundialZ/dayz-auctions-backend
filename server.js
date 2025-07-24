require('dotenv').config();
const express = require('express');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const cron = require('node-cron');
const axios = require('axios'); // Needed to send webhooks to Discord
const http = require('http'); // Import HTTP module for Socket.IO
const { Server } = require('socket.io'); // Import Server from Socket.IO

const app = express();
const server = http.createServer(app); // Create HTTP server from Express app
const io = new Server(server, { // Initialize Socket.IO with the HTTP server
    cors: {
        origin: process.env.FRONTEND_URL || 'https://guerramundialz.github.io', // Allow CORS for your frontend
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});

const PORT = process.env.PORT || 3000;

// This will be the URL of your backend deployed on Render.
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL || `https://guerra-mundial-z-backend.onrender.com`;
// This will be the URL of your GitHub Pages frontend.
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://guerramundialz.github.io'; // Your GitHub Pages URL!

// IMPORTANT! Replace with your Discord SERVER (GUILD) ID.
// Required to verify user roles in that server.
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || 'YOUR_DISCORD_GUILD_ID_HERE'; // <-- CONFIRM THIS ID!

// Discord Webhook URL for notifications.
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// CORS configuration
const corsOptions = {
    origin: FRONTEND_URL,
    credentials: true // Allow sending cookies/auth headers
};
app.use(cors(corsOptions));

// Middleware to parse JSON bodies
app.use(express.json());

// --- Passport.js Discord Strategy Configuration ---
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: `${RENDER_BACKEND_URL}/auth/discord/callback`, // Must match the redirect URI in your Discord application settings
    scope: ['identify', 'guilds', 'guilds.members.read'] // Request necessary scopes: identify (user info), guilds (user's guilds), guilds.members.read (user's roles in guilds)
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // In a real application, you would save/update user data in your database here.
        // For this example, we'll just use the Discord profile.

        // Fetch guild member info to get roles
        const guildMemberResponse = await axios.get(`https://discord.com/api/v10/users/@me/guilds/${DISCORD_GUILD_ID}/member`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });
        const member = guildMemberResponse.data;

        // Check if the user has the 'admin' role (replace with your actual admin role ID)
        // You need to get the actual ID of your admin role from Discord.
        const isAdmin = member.roles.includes(process.env.DISCORD_ADMIN_ROLE_ID); // Replace with your admin role ID

        const user = {
            id: profile.id,
            username: profile.username,
            avatar: profile.avatar,
            discriminator: profile.discriminator,
            avatarUrl: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${parseInt(profile.discriminator) % 5}.png`,
            isAdmin: isAdmin, // Attach admin status
            guilds: profile.guilds // Attach guilds if needed later
        };

        return done(null, user);
    } catch (error) {
        console.error('Error fetching Discord guild member info:', error.response ? error.response.data : error.message);
        return done(error);
    }
}));

// Passport.js session setup (not strictly needed for JWT, but good practice if using sessions)
passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

app.use(passport.initialize());
// app.use(passport.session()); // Only if you plan to use session-based authentication

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));

// --- Middleware to authenticate JWT token ---
// This should ideally be in a separate file (e.g., middleware/auth.js)
// But for completeness, defining it here if it's not already imported.
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.status(401).json({ message: 'No token provided.' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid or expired token.' });
        req.user = user; // Attach user payload to request
        next();
    });
};

// Middleware to authorize admin (assuming req.user has isAdmin property)
const authorizeAdmin = (req, res, next) => {
    if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ message: 'Acceso denegado. Se requiere rol de administrador.' });
    }
    next();
};

// --- Discord Authentication Routes ---
// Route to initiate Discord OAuth
app.get('/auth/discord', passport.authenticate('discord'));

// Discord OAuth callback route
app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: FRONTEND_URL }),
    (req, res) => {
        // Successful authentication, generate JWT token
        const user = req.user; // User object from Discord profile (populated by Passport strategy)
        const token = jwt.sign({
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            discriminator: user.discriminator,
            avatarUrl: user.avatarUrl,
            isAdmin: user.isAdmin // Include isAdmin status in the token payload
        }, process.env.JWT_SECRET, { expiresIn: '1h' }); // Token expires in 1 hour

        // Redirect to frontend with token in URL parameter
        res.redirect(`${FRONTEND_URL}?token=${token}`);
    }
);

// Route to get authenticated user info (protected)
app.get('/auth/user', authenticateToken, async (req, res) => {
    // req.user contains the decoded JWT payload, which now includes isAdmin
    res.json({
        id: req.user.id,
        username: req.user.username,
        avatarUrl: req.user.avatarUrl,
        isAdmin: req.user.isAdmin
    });
});

// --- Auction Routes (Pass io instance to the router) ---
const auctionsRouter = require('./routes/auctions')(io); // Pass the io instance
app.use('/api/auctions', auctionsRouter);

// --- Scheduled Task for Auction Finalization ---
cron.schedule('*/5 * * * *', async () => { // Runs every 5 minutes
    console.log('Running scheduled auction finalization task...');
    try {
        const now = new Date();
        // Find auctions that have ended and are still 'active'
        const endedAuctions = await mongoose.model('Auction').find({
            endDate: { $lte: now },
            status: 'active'
        });

        for (const auction of endedAuctions) {
            let message = '';
            let embedColor = 0; // Default color

            if (auction.currentBidderId) {
                // Auction ended with bids
                auction.status = 'finalized';
                auction.winnerId = auction.currentBidderId;
                auction.winnerName = auction.currentBidderName;
                auction.finalPrice = auction.currentBid;
                message = `🎉 ¡La subasta **${auction.title}** ha finalizado! Ganador: **${auction.currentBidderName}** con **${auction.currentBid} Rublos**`;
                embedColor = 3066993; // Green color for Discord (hex 0x2ECC71)
            } else {
                // Auction ended without bids
                auction.status = 'cancelled'; // Or 'finalized' with no winner, depending on desired logic
                auction.finalPrice = auction.startBid; // Or 0, or null
                message = `😔 La subasta **${auction.title}** ha finalizado sin pujas.`;
                embedColor = 10038562; // A grey/red color for Discord (hex 0x99AAB5)
            }

            await auction.save();
            console.log(message);
            if (DISCORD_WEBHOOK_URL) {
                axios.post(DISCORD_WEBHOOK_URL, {
                    content: message,
                    embeds: [{
                        title: `Subasta Finalizada: ${auction.title}`,
                        description: auction.currentBidderId ? `Ganador: **${auction.currentBidderName}**\nPuja Final: **${auction.finalPrice} Rublos**` : 'No hubo pujas.',
                        url: `${FRONTEND_URL}/subastas.html`, // CORRECT URL
                        color: embedColor,
                        thumbnail: { url: auction.imageUrl || 'https://via.placeholder.com/150' },
                        footer: { text: `Subasta ID: ${auction._id}` }
                    }]
                }).catch(err => console.error("Error sending end auction webhook:", err.message));
            }

            // Emit Socket.IO event to notify clients about the updated auction
            io.emit('auctionUpdated', auction);
        }
    } catch (error) {
        console.error('Error in scheduled auction task:', error);
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected to Socket.IO:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected from Socket.IO:', socket.id);
    });
});


// Start the HTTP server (not the Express app directly)
server.listen(PORT, () => {
    console.log(`Backend server listening on ${RENDER_BACKEND_URL}`);
    console.log('Make sure Render environment variables (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID, DISCORD_ADMIN_ROLE_ID, JWT_SECRET, MONGODB_URI, DISCORD_WEBHOOK_URL, FRONTEND_URL, RENDER_BACKEND_URL) are set correctly.');
});
