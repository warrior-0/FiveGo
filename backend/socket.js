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
const socketRooms = new Map();

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
    let index = waiting.findIndex((entry) => entry.socket.id === socket.id);

    while (index >= 0) {
        waiting.splice(index, 1);
        index = waiting.findIndex((entry) => entry.socket.id === socket.id);
    }
}

function removeUserFromWaiting(userId) {
    let index = waiting.findIndex((entry) => Number(entry.player.user.id) === Number(userId));

    while (index >= 0) {
        waiting.splice(index, 1);
        index = waiting.findIndex((entry) => Number(entry.player.user.id) === Number(userId));
    }
}

function pruneWaiting() {
    for (let index = waiting.length - 1; index >= 0; index -= 1) {
        if (!waiting[index].socket.connected) {
            waiting.splice(index, 1);
        }
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

function cleanupRoom(roomId) {
    const game = games.get(roomId);

    if (!game) return;

    Object.keys(game.socketToSeat).forEach((socketId) => socketRooms.delete(socketId));
    games.delete(roomId);
}

async function handlePlayerExit(io, socket, reason = '상대가 방을 나갔습니다.') {
    removeFromWaiting(socket);
    if (socket.request.session?.userId) {
        removeUserFromWaiting(socket.request.session.userId);
    }

    const roomId = socketRooms.get(socket.id);
    if (!roomId) return;

    const game = games.get(roomId);
    if (!game) {
        socketRooms.delete(socket.id);
        return;
    }

    const color = getColorBySocket(game, socket.id);

    if (color && game.phase === 'playing' && !game.winner) {
        game.winner = color === 'black' ? 'white' : 'black';
        game.phase = 'finished';
        game.log.push(`${game.players[color].user.nickname} 이탈: ${game.winner === 'black' ? '흑' : '백'} 승리`);
        await emitState(io, roomId, game);
    } else {
        io.to(roomId).emit('roomClosed', reason);
    }

    io.in(roomId).socketsLeave(roomId);
    cleanupRoom(roomId);
}

function attachSocket(io) {
    io.on('connection', (socket) => {
        socket.on('joinMatch', async () => {
            try {
                removeFromWaiting(socket);
                pruneWaiting();

                const player = await loadUser(socket);
                removeUserFromWaiting(player.user.id);

                const opponentIndex = waiting.findIndex((entry) => (
                    entry.socket.connected && Number(entry.player.user.id) !== Number(player.user.id)
                ));
                const opponent = opponentIndex >= 0 ? waiting.splice(opponentIndex, 1)[0] : null;

                if (!opponent) {
                    waiting.push({ socket, player });
                    socket.emit('gameError', '상대를 기다리는 중입니다.');
                    return;
                }

                const roomId = `room-${socket.id}-${opponent.socket.id}`;
                const game = createGame({ socketId: opponent.socket.id, ...opponent.player }, { socketId: socket.id, ...player });

                games.set(roomId, game);
                socketRooms.set(socket.id, roomId);
                socketRooms.set(opponent.socket.id, roomId);
                socket.join(roomId);
                opponent.socket.join(roomId);

                socket.emit('matchFound', { roomId });
                opponent.socket.emit('matchFound', { roomId });
                await emitState(io, roomId, game);
            } catch (error) {
                socket.emit('gameError', error.message);
            }
        });

        socket.on('cancelMatch', (ack) => {
            removeFromWaiting(socket);
            if (socket.request.session?.userId) {
                removeUserFromWaiting(socket.request.session.userId);
            }
            if (typeof ack === 'function') ack();
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

        socket.on('leaveRoom', async (ack) => {
            await handlePlayerExit(io, socket, '상대가 방을 나갔습니다. 매칭을 다시 시작해 주세요.');
            if (typeof ack === 'function') ack();
        });

        socket.on('disconnect', async () => {
            await handlePlayerExit(io, socket, '상대 접속이 끊겼습니다. 매칭을 다시 시작해 주세요.');
        });
    });
}

module.exports = attachSocket;
