// routes/auctions.js
const express = require('express');
const Auction = require('../models/Auction'); // Import your auction model
const axios = require('axios'); // Required to send Discord webhooks

// --- IMPORTANT: Make sure these middlewares exist and are exported from '../middleware/auth' ---
// It is assumed that authenticateToken attaches req.user and authorizeAdmin verifies if req.user is admin.
const { authenticateToken, authorizeAdmin } = require('../middleware/auth');

// Make sure these environment variables are accessible in your runtime environment (Render).
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://guerramundialz.github.io'; // Your GitHub Pages URL!

// Export a function that receives the io instance
module.exports = (io) => {
    const router = express.Router();

    // 1. GET /api/auctions - Get ALL auctions (for the administration panel)
    // This route is now protected for administrators and returns all auctions (active, finalized, canceled).
    router.get('/', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const auctions = await Auction.find().sort({ endDate: 1 });
            res.json(auctions);
        } catch (error) {
            console.error('Error fetching all auctions for admin:', error);
            res.status(500).json({ message: 'Error getting auctions for administration.' });
        }
    });

    // 2. GET /api/auctions/active - Get only active auctions (for the user auction page)
    // This is the route that normal users will use to view active auctions.
    router.get('/active', async (req, res) => {
        try {
            // Search for active auctions whose end date is greater than the current date
            const auctions = await Auction.find({ status: 'active', endDate: { $gt: new Date() } }).sort({ endDate: 1 });
            res.json(auctions);
        } catch (error) {
            console.error('Error fetching active auctions:', error);
            res.status(500).json({ message: 'Error getting active auctions.' });
        }
    });

    // 3. GET /api/auctions/:id - Get a specific auction by ID (for editing in admin)
    // Protected for administrators
    router.get('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const auction = await Auction.findById(req.params.id);
            if (!auction) {
                return res.status(404).json({ message: 'Auction not found.' });
            }
            res.json(auction);
        } catch (error) {
            console.error('Error fetching single auction:', error);
            res.status(500).json({ message: 'Error getting auction.' });
        }
    });

    // 4. POST /api/auctions - Create a new auction (Administrators only)
    // The route is now '/', consistent with the administration panel frontend
    router.post('/', authenticateToken, authorizeAdmin, async (req, res) => {
        const { title, description, imageUrl, startBid, endDate } = req.body;

        if (!title || !description || !startBid || !endDate) {
            return res.status(400).json({ message: 'All fields are required.' });
        }
        const parsedEndDate = new Date(endDate);
        if (isNaN(parsedEndDate.getTime()) || parsedEndDate <= new Date()) {
            return res.status(400).json({ message: 'The end date must be a valid future date.' });
        }
        if (startBid < 0) {
            return res.status(400).json({ message: 'The starting bid cannot be negative.' });
        }

        try {
            const newAuction = new Auction({
                title,
                description,
                imageUrl: imageUrl || 'https://via.placeholder.com/300x200?text=No+Image', // Use default image if not provided
                startBid: parseFloat(startBid),
                currentBid: parseFloat(startBid), // Current bid starts with the starting bid
                endDate: parsedEndDate,
                creatorId: req.user.id,
                creatorName: req.user.username,
                status: 'active' // Ensure initial status is active
            });

            await newAuction.save();

            if (DISCORD_WEBHOOK_URL) {
                axios.post(DISCORD_WEBHOOK_URL, {
                    content: `🚨 New auction created by **${newAuction.creatorName}**! **${newAuction.title}** with a starting bid of **${newAuction.startBid} Rubles**. Ends <t:${Math.floor(newAuction.endDate.getTime() / 1000)}:F>. Bid now on the website!`,
                    embeds: [{
                        title: newAuction.title,
                        description: newAuction.description,
                        url: `${FRONTEND_URL}/subastas.html`, // CORRECT URL
                        color: 15158332, // A vibrant color for Discord
                        image: { url: newAuction.imageUrl },
                        fields: [
                            { name: "Starting Bid", value: `${newAuction.startBid} Rubles`, inline: true },
                            { name: "Ends", value: `<t:${Math.floor(newAuction.endDate.getTime() / 1000)}:R>`, inline: true }
                        ],
                        footer: { text: `Created by ${newAuction.creatorName} | ID: ${newAuction._id}` }
                    }]
                }).catch(err => console.error("Error sending Discord webhook for new auction:", err.message));
            }

            // Emit Socket.IO event when a new auction is created
            io.emit('auctionUpdated', newAuction);

            res.status(201).json(newAuction);
        } catch (error) {
            console.error('Error creating auction:', error);
            res.status(500).json({ message: 'Error creating auction.' });
        }
    });

    // 5. PUT /api/auctions/:id - Update an existing auction (Administrators only)
    router.put('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        const { id } = req.params;
        const { title, description, imageUrl, startBid, endDate, currentBid, currentBidderId, currentBidderName, status } = req.body;

        try {
            const auction = await Auction.findById(id);
            if (!auction) {
                return res.status(404).json({ message: 'Auction not found to update.' });
            }

            // Update fields if provided
            if (title !== undefined) auction.title = title;
            if (description !== undefined) auction.description = description;
            if (imageUrl !== undefined) auction.imageUrl = imageUrl || 'https://via.placeholder.com/300x200?text=No+Image';
            if (startBid !== undefined) auction.startBid = parseFloat(startBid);
            if (endDate !== undefined) {
                const parsedEndDate = new Date(endDate);
                if (isNaN(parsedEndDate.getTime())) {
                    return res.status(400).json({ message: 'The end date is not valid.' });
                }
                auction.endDate = parsedEndDate;
            }
            // Allow admin to adjust current bid and bidder if necessary
            if (currentBid !== undefined) auction.currentBid = parseFloat(currentBid);
            if (currentBidderId !== undefined) auction.currentBidderId = currentBidderId;
            if (currentBidderName !== undefined) auction.currentBidderName = currentBidderName;
            if (status !== undefined) auction.status = status; // Allow changing status

            // Additional validations before saving
            if (auction.startBid < 0) {
                return res.status(400).json({ message: 'The starting bid cannot be negative.' });
            }
            if (auction.currentBid < 0) {
                return res.status(400).json({ message: 'The current bid cannot be negative.' });
            }
            // If status is changed to 'active', end date must be in the future
            if (auction.status === 'active' && auction.endDate <= new Date()) {
                return res.status(400).json({ message: 'Cannot activate an auction with a past end date.' });
            }


            await auction.save();

            // Emit Socket.IO event when an auction is updated
            io.emit('auctionUpdated', auction);

            res.json({ message: 'Auction updated successfully.', auction });
        } catch (error) {
            console.error('Error updating auction:', error);
            res.status(500).json({ message: 'Error updating auction.' });
        }
    });

    // 6. DELETE /api/auctions/:id - Delete an auction (Administrators only)
    router.delete('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        const { id } = req.params;

        try {
            const deletedAuction = await Auction.findByIdAndDelete(id);

            if (!deletedAuction) {
                return res.status(404).json({ message: 'Auction not found to delete.' });
            }

            // Emit Socket.IO event when an auction is deleted
            io.emit('auctionDeleted', deletedAuction._id);

            res.json({ message: 'Auction deleted successfully.' });
        } catch (error) {
            console.error('Error deleting auction:', error);
            res.status(500).json({ message: 'Error deleting auction.' });
        }
    });

    // 7. POST /api/auctions/:id/finalize - Manually finalize an auction (Administrators only)
    router.post('/:id/finalize', authenticateToken, authorizeAdmin, async (req, res) => {
        const { id } = req.params;

        try {
            const auction = await Auction.findById(id);

            if (!auction) {
                return res.status(404).json({ message: 'Auction not found.' });
            }

            if (auction.status === 'finalized' || auction.status === 'cancelled') {
                return res.status(400).json({ message: `The auction is already ${auction.status}.` });
            }

            auction.status = 'finalized';
            // If there is a current bidder, that is the winner
            if (auction.currentBidderId) {
                auction.winnerId = auction.currentBidderId;
                auction.winnerName = auction.currentBidderName;
                auction.finalPrice = auction.currentBid;
            } else {
                auction.winnerId = null;
                auction.winnerName = null;
                auction.finalPrice = null; // Or the starting price if there were no bids and you want it to be that
            }
            auction.endDate = new Date(); // Set end date to now

            await auction.save();

            // Optional: Send a Discord webhook to notify manual finalization
            if (DISCORD_WEBHOOK_URL) {
                let message = '';
                let embedColor = 5793266; // A green color for Discord (hex 0x57F287)

                if (auction.winnerId) {
                    message = `🎉 Auction **${auction.title}** has been manually finalized! Winner: **${auction.winnerName}** with **${auction.finalPrice} Rubles**.`;
                } else {
                    message = `⚠️ Auction **${auction.title}** has been manually finalized with no bids.`;
                    embedColor = 10038562; // A gray/red color for Discord (hex 0x99AAB5)
                }

                axios.post(DISCORD_WEBHOOK_URL, {
                    content: message,
                    embeds: [{
                        title: `Auction Manually Finalized: ${auction.title}`,
                        description: auction.winnerId ? `Winner: **${auction.winnerName}**\nFinal Bid: **${auction.finalPrice} Rubles**` : 'No bids.',
                        url: `${FRONTEND_URL}/subastas.html`,
                        color: embedColor,
                        thumbnail: { url: auction.imageUrl || 'https://via.placeholder.com/150' },
                        footer: { text: `Auction ID: ${auction._id}` }
                    }]
                }).catch(err => console.error("Error sending Discord webhook for manual auction end:", err.message));
            }

            // Emit Socket.IO event when an auction is manually finalized
            io.emit('auctionUpdated', auction);

            res.json({ message: 'Auction manually finalized successfully.', auction });
        } catch (error) {
            console.error('Error finalizing auction manually:', error);
            res.status(500).json({ message: 'Error manually finalizing auction.' });
        }
    });


    // 8. POST /api/auctions/:id/bid - Place a bid
    // Apply authenticateToken to ensure req.user is available.
    router.post('/:id/bid', authenticateToken, async (req, res) => {
        const { id } = req.params;
        const { bidAmount } = req.body;

        // Verify that the user is authenticated to bid
        if (!req.user || !req.user.id || !req.user.username) {
            return res.status(401).json({ message: 'You must log in to place a bid.' });
        }

        if (typeof bidAmount !== 'number' || bidAmount <= 0) {
            return res.status(400).json({ message: 'The bid amount must be a positive number.' });
        }

        try {
            const auction = await Auction.findById(id);

            if (!auction) {
                return res.status(404).json({ message: 'Auction not found.' });
            }
            if (auction.status !== 'active' || auction.endDate <= new Date()) {
                return res.status(400).json({ message: 'This auction is not active or has already ended.' });
            }
            if (bidAmount <= auction.currentBid) {
                return res.status(400).json({ message: `Your bid (${bidAmount} Rubles) must be greater than the current bid (${auction.currentBid} Rubles).` });
            }
            // Additional validation: If you are already the current bidder, your bid must be strictly higher to outbid yourself
            if (req.user.id === auction.currentBidderId && bidAmount <= auction.currentBid) {
                 return res.status(400).json({ message: 'You are already the current bidder. Your bid must be higher to outbid yourself.' });
            }

            // Save the previous bid before updating the current one
            const oldBid = auction.currentBid;

            auction.currentBid = bidAmount;
            auction.currentBidderId = req.user.id;
            auction.currentBidderName = req.user.username;
            // Add the bid to the history
            auction.bidHistory.push({
                bidderId: req.user.id,
                bidderName: req.user.username,
                amount: bidAmount,
                timestamp: new Date()
            });
            await auction.save();

            if (DISCORD_WEBHOOK_URL) {
                axios.post(DISCORD_WEBHOOK_URL, {
                    // Clearer message for the webhook, using oldBid
                    content: `🔔 New bid on **${auction.title}**! **${req.user.username}** has bid **${bidAmount} Rubles**.`,
                    embeds: [{
                        title: `New Bid on ${auction.title}`,
                        description: `**${req.user.username}** has bid **${bidAmount} Rubles**.\nPrevious Bid: **${oldBid} Rubles**\nNew Bid: **${auction.currentBid} Rubles**`,
                        url: `${FRONTEND_URL}/subastas.html`, // CORRECT URL
                        color: 3447003, // Blue color for Discord
                        thumbnail: { url: req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${parseInt(req.user.id) % 5}.png` },
                        footer: { text: `Ends <t:${Math.floor(auction.endDate.getTime() / 1000)}:R>` }
                    }]
                }).catch(err => console.error("Error sending Discord webhook for new bid:", err.message));
            }

            // Emit Socket.IO event when a bid is placed
            io.emit('auctionUpdated', auction);

            res.json({ message: 'Bid placed successfully.', auction });
        } catch (error) {
            console.error('Error placing bid:', error);
            res.status(500).json({ message: 'Error placing bid.' });
        }
    });

    return router;
};
