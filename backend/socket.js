const db = require('./db');
const {
    createGame,
    getColorBySocket,
    placeStone,
    publicGameState,
    selectAugments,
    submitBid
} = require('./game');

const waiting = [];
const games = new Map();

async function loadUser(socket) {
    const userId = socket.request.session?.userId;

    if (!userId) {
        throw new Error('로그인이 필요합니다.');
    }

    const [users] = await db.query('SELECT id, nickname FROM users WHERE id = ?', [userId]);
    const user = users[0];

    if (!user) {
        throw new Error('유저를 찾을 수 없습니다.');
    }

    const [deck] = await db.query(
        `SELECT a.id, a.code, a.name, a.description
         FROM user_augments ua
         JOIN augments a ON a.id = ua.augment_id
         WHERE ua.user_id = ?
         ORDER BY a.id`,
        [userId]
    );

    if (deck.length !== 5) {
        throw new Error('게임을 시작하려면 증강 덱 5개를 먼저 저장해야 합니다.');
    }

    return { user, deck };
}

function removeFromWaiting(socket) {
    const index = waiting.findIndex((entry) => entry.socket.id === socket.id);

    if (index >= 0) {
        waiting.splice(index, 1);
    }
}

async function saveResultIfNeeded(game) {
    if (!game.winner || game.resultSaved) return;

    const loser = game.winner === 'black' ? 'white' : 'black';
    const winnerId = game.players[game.winner].user.id;
    const loserId = game.players[loser].user.id;

    await db.query('UPDATE users SET wins = wins + 1, rank_score = rank_score + 15 WHERE id = ?', [winnerId]);
    await db.query('UPDATE users SET losses = losses + 1, rank_score = GREATEST(rank_score - 15, 0) WHERE id = ?', [loserId]);
    game.resultSaved = true;
}

async function emitState(io, roomId, game) {
    await saveResultIfNeeded(game);
    io.to(roomId).emit('gameState', publicGameState(game));
}

function attachSocket(io) {
    io.on('connection', (socket) => {
        socket.on('joinMatch', async () => {
            try {
                removeFromWaiting(socket);

                const player = await loadUser(socket);
                const opponent = waiting.shift();

                if (!opponent) {
                    waiting.push({ socket, player });
                    socket.emit('gameError', '상대를 기다리는 중입니다.');
                    return;
                }

                const roomId = `room-${socket.id}-${opponent.socket.id}`;
                const game = createGame({ socketId: opponent.socket.id, ...opponent.player }, { socketId: socket.id, ...player });

                games.set(roomId, game);
                socket.join(roomId);
                opponent.socket.join(roomId);

                socket.emit('matchFound', { roomId });
                opponent.socket.emit('matchFound', { roomId });
                await emitState(io, roomId, game);
            } catch (error) {
                socket.emit('gameError', error.message);
            }
        });

        socket.on('submitBid', async ({ roomId, bid, sacrificeAugmentId }) => {
            try {
                const game = games.get(roomId);

                if (!game) throw new Error('게임을 찾을 수 없습니다.');

                submitBid(game, socket.id, bid, sacrificeAugmentId);
                await emitState(io, roomId, game);
            } catch (error) {
                socket.emit('gameError', error.message);
            }
        });

        socket.on('selectAugments', async ({ roomId, augmentIds }) => {
            try {
                const game = games.get(roomId);

                if (!game) throw new Error('게임을 찾을 수 없습니다.');

                selectAugments(game, socket.id, augmentIds || []);
                await emitState(io, roomId, game);
            } catch (error) {
                socket.emit('gameError', error.message);
            }
        });

        socket.on('placeStone', async ({ roomId, x, y }) => {
            try {
                const game = games.get(roomId);

                if (!game) throw new Error('게임을 찾을 수 없습니다.');

                const color = getColorBySocket(game, socket.id);

                if (!color) throw new Error('참가자가 아닙니다.');

                placeStone(game, color, Number(x), Number(y));
                await emitState(io, roomId, game);
            } catch (error) {
                socket.emit('gameError', error.message);
            }
        });

        socket.on('disconnect', () => {
            removeFromWaiting(socket);
        });
    });
}

module.exports = attachSocket;
