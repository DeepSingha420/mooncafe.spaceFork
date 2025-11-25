const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const MAX_MESSAGES_PER_CIRCLE = 50;

// Serve static files from the 'public' directory
app.use(express.static('public'));

// In-memory data store for circles
const circles = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('newUser', (data) => {
        const { nickname, flair, clientToken, circle: circleId } = data;
        
        // Ensure circle exists
        if (!circles[circleId]) {
            circles[circleId] = {
                users: {},
                messages: []
            };
        }
        const circle = circles[circleId];

        // Nickname uniqueness check
        const existingUser = Object.values(circle.users).find(u => u.nickname === nickname);
        if (existingUser && existingUser.clientToken !== clientToken) {
            socket.emit('nicknameError', { message: `Nickname "${nickname}" is already in use. Please choose another.` });
            return;
        }

        // Join the socket room
        socket.join(circleId);
        // Store circle on the socket for easy access on disconnect
        socket.circleId = circleId;

        // Store user data
        const user = { nickname, flair, clientToken, id: socket.id, avatar: '👤' };
        circle.users[socket.id] = user;

        console.log(`${nickname} (${socket.id}) joined circle: ${circleId}`);

        // Send message history to the new user
        socket.emit('messageHistory', circle.messages);

        // Broadcast system message to the circle
        socket.to(circleId).emit('systemMessage', `${nickname} has joined the circle.`);
        
        // Send the updated user list to everyone in the circle
        io.to(circleId).emit('userList', Object.values(circle.users));
    });

    socket.on('chatMessage', (messageData) => {
        const circleId = socket.circleId;
        const circle = circles[circleId];
        const user = circle ? circle.users[socket.id] : null;

        if (user && circle) {
            const fullMessage = {
                username: user.nickname,
                flair: user.flair,
                avatar: user.avatar,
                text: messageData.text,
                style: messageData.style,
                timestamp: new Date()
            };
            
            // Add to message history and cap it
            circle.messages.push(fullMessage);
            if (circle.messages.length > MAX_MESSAGES_PER_CIRCLE) {
                circle.messages.shift();
            }

            // Broadcast the message to the circle
            io.to(circleId).emit('message', fullMessage);
        }
    });

    socket.on('disconnect', () => {
        const circleId = socket.circleId;
        const circle = circles[circleId];

        if (circle) {
            const user = circle.users[socket.id];
            if (user) {
                console.log(`${user.nickname} has left circle: ${circleId}`);
                
                // Remove user from the circle
                delete circle.users[socket.id];

                // If the circle is empty, delete it to save memory
                if (Object.keys(circle.users).length === 0) {
                    delete circles[circleId];
                    console.log(`Circle ${circleId} is empty and has been removed.`);
                } else {
                    // Broadcast that the user has left and the new user list
                    io.to(circleId).emit('systemMessage', `${user.nickname} has left the circle.`);
                    io.to(circleId).emit('userList', Object.values(circle.users));
                }
            }
        }
        console.log(`User disconnected: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
