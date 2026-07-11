const path = require('path');
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./auth');
const userRoutes = require('./user');
const augmentRoutes = require('./augment');
const attachSocket = require('./socket');

const app = express();

if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

const server = http.createServer(app);
const corsOptions = {
    origin: process.env.CLIENT_ORIGIN,
    credentials: true
};
const io = new Server(server, {
    cors: corsOptions,
    pingInterval: 5000,
    pingTimeout: 5000
});
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'none',
        secure: true
    }
});

function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ message: '로그인이 필요합니다.' });
    }

    next();
}

app.use(cors(corsOptions));
app.use(express.json());
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, '..')));
app.use('/api', authRoutes);
app.use('/api/user', requireAuth, userRoutes);
app.use('/api/augments', requireAuth, augmentRoutes);
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
});

attachSocket(io);
server.listen(process.env.PORT || 3000, () => console.log('Odook server running'));
