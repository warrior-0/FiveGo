const db = require('./db');
const {
    activateAugment,
    applyTurnClock,
    applyAugmentSelection,
    availableAugmentChoices,
    createGame,
    getColorBySocket,
    placeStone,
    publicGameState,
    currentSelectionStep,
    selectAugments,
    submitBid,
    resolveBids
} = require('./game');

const waiting = [];
const games = new Map();
const socketRooms = new Map();
const clockIntervals = new Map();
const decisionTimers = new Map();

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
        `SELECT a.id, a.name, a.description, a.timing, a.effect
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
    if (game.resultSaved || game.resultSaving) return;

    if (!game.winner) return;

    game.resultSaving = true;

    const loser = game.winner === 'black' ? 'white' : 'black';
    const winnerId = game.players[game.winner].user.id;
    const loserId = game.players[loser].user.id;

    try {
        await db.query('UPDATE users SET wins = wins + 1, rank_score = rank_score + 15 WHERE id = ?', [winnerId]);
        await db.query('UPDATE users SET losses = losses + 1, rank_score = GREATEST(rank_score - 15, 0) WHERE id = ?', [loserId]);
        game.resultSaved = true;
    } finally {
        game.resultSaving = false;
    }
}


function clearDecisionTimer(roomId) {
    const timerId = decisionTimers.get(roomId);
    if (!timerId) return;
    clearTimeout(timerId);
    decisionTimers.delete(roomId);
}

function ensureDecisionTimer(io, roomId, game) {
    clearDecisionTimer(roomId);

    if (!game || !game.decisionDeadlineAt || game.winner) return;

    const delay = Math.max(0, game.decisionDeadlineAt - Date.now());
    const timerId = setTimeout(async () => {
        const liveGame = games.get(roomId);
        if (!liveGame || liveGame.winner || !liveGame.decisionDeadlineAt) return;

        if (liveGame.phase === 'bidding') {
            for (const seat of Object.values(liveGame.seats)) {
                if (seat.bid === null) {
                    seat.bid = 0;
                    liveGame.log.push(`${seat.user.nickname} 입찰 시간 초과: 0점 자동 입찰`);
                }
            }

            if (Object.values(liveGame.seats).every((seat) => seat.bid !== null)) {
                resolveBids(liveGame);
            }
        } else if (liveGame.phase === 'augment-selection') {
            const step = currentSelectionStep(liveGame);
            if (step) {
                const choices = availableAugmentChoices(liveGame.players[step.color], step.source);
                const autoIds = choices.slice(0, step.count).map((augment) => augment.id);
                liveGame.log.push(`${step.color === 'black' ? '흑' : '백'} 증강 선택 시간 초과: 자동 선택`);
                applyAugmentSelection(liveGame, step.color, autoIds);
            }
        }

        if (liveGame.phase === 'playing') ensureClockInterval(io, roomId, liveGame);
        ensureDecisionTimer(io, roomId, liveGame);
        await finalizeResultIfNeeded(liveGame);
        await emitState(io, roomId, liveGame);
    }, delay);

    decisionTimers.set(roomId, timerId);
}

async function finalizeResultIfNeeded(game) {
    await saveResultIfNeeded(game);
}

async function emitState(io, roomId, game) {
    io.to(roomId).emit('gameState', publicGameState(game));
}

function ensureClockInterval(io, roomId, game) {
    if (clockIntervals.has(roomId)) return;

    const intervalId = setInterval(async () => {
        const liveGame = games.get(roomId);

        if (!liveGame || liveGame.phase !== 'playing' || liveGame.winner) {
            clearInterval(intervalId);
            clockIntervals.delete(roomId);
            return;
        }

        // 서버 측에서 현재 시간 기준으로 시간 소모를 적용하고, 시간패 여부를 판단
        const isTimedOut = applyTurnClock(liveGame);

        if (isTimedOut) {
            // 시간패 발생 시 즉시 결과 저장, 상태 전송 및 인터벌 종료
            await finalizeResultIfNeeded(liveGame);
            await emitState(io, roomId, liveGame);
            clearInterval(intervalId);
            clockIntervals.delete(roomId);
            return;
        }

        // 매 초마다 갱신된 시간 상태를 클라이언트에 전송
        // 이 때 클라이언트의 currentState.clock이 갱신되어 타이머가 동기화됨
        io.to(roomId).emit('gameState', publicGameState(liveGame));
    }, 1000);

    clockIntervals.set(roomId, intervalId);
}

function cleanupRoom(roomId) {
    clearDecisionTimer(roomId);

    const intervalId = clockIntervals.get(roomId);

    if (intervalId) {
        clearInterval(intervalId);
        clockIntervals.delete(roomId);
    }

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
    if (color && !game.winner) {
        game.winner = color === 'black' ? 'white' : 'black';
        game.phase = 'finished';
        game.clock.turnStartedAt = null;
        game.decisionDeadlineAt = null;
        game.log.push(`${game.players[color]?.user?.nickname || '상대'}님이 나갔습니다.`);
        game.log.push(`직접 '나가기' 버튼을 눌러 로비로 이동해 주세요.`);
        
        clearDecisionTimer(roomId);
        await finalizeResultIfNeeded(game);
        await emitState(io, roomId, game);
    }
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
                ensureDecisionTimer(io, roomId, game);
                await finalizeResultIfNeeded(game);
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

        socket.on('submitBid', async ({ roomId, bid }) => {
            try {
                const game = games.get(roomId);

                if (!game) throw new Error('게임을 찾을 수 없습니다.');

                submitBid(game, socket.id, bid);
                ensureDecisionTimer(io, roomId, game);
                await finalizeResultIfNeeded(game);
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
                if (game.phase === 'playing') {
                    ensureClockInterval(io, roomId, game);
                }
                ensureDecisionTimer(io, roomId, game);
                await finalizeResultIfNeeded(game);
                await emitState(io, roomId, game);
            } catch (error) {
                socket.emit('gameError', error.message);
            }
        });

        socket.on('activateAugment', async ({ roomId, augmentId }) => {
            const game = games.get(roomId);

            try {
                if (!game) throw new Error('게임을 찾을 수 없습니다.');

                activateAugment(game, socket.id, augmentId);
                ensureDecisionTimer(io, roomId, game);
                await finalizeResultIfNeeded(game);
                await emitState(io, roomId, game);
            } catch (error) {
                socket.emit('gameError', error.message);

                if (game?.winner) {
                    await finalizeResultIfNeeded(game);
                    await emitState(io, roomId, game);
                }
            }
        });

        socket.on('placeStone', async ({ roomId, x, y }) => {
            const game = games.get(roomId);

            try {
                if (!game) throw new Error('게임을 찾을 수 없습니다.');

                const color = getColorBySocket(game, socket.id);

                if (!color) throw new Error('참가자가 아닙니다.');

                placeStone(game, color, Number(x), Number(y));
                if (game.phase === 'playing') {
                    ensureClockInterval(io, roomId, game);
                }
                ensureDecisionTimer(io, roomId, game);
                await finalizeResultIfNeeded(game);
                await emitState(io, roomId, game);
            } catch (error) {
                socket.emit('gameError', error.message);

                if (game?.winner) {
                    await finalizeResultIfNeeded(game);
                    await emitState(io, roomId, game);
                }
            }
        });

        socket.on('leaveRoom', async (ack) => {
            const roomId = socketRooms.get(socket.id);
            if (roomId) {
                const game = games.get(roomId);
                if (game) {
                    const color = getColorBySocket(game, socket.id);
                    if (color && !game.winner) {
                        game.winner = color === 'black' ? 'white' : 'black';
                        game.phase = 'finished';
                        game.clock.turnStartedAt = null;
                        game.decisionDeadlineAt = null;
                        game.log.push(`${game.players[color]?.user?.nickname || '상대'}님이 기권했습니다.`);
                    }
                    clearDecisionTimer(roomId);
                    await finalizeResultIfNeeded(game);
                    await emitState(io, roomId, game);
                }
                
                socket.leave(roomId);
                socketRooms.delete(socket.id);
                // 방에 아무도 없으면 정리
                const room = io.sockets.adapter.rooms.get(roomId);
                if (!room || room.size === 0) {
                    cleanupRoom(roomId);
                }
            }
            if (typeof ack === 'function') ack();
        });

        socket.on('disconnect', async () => {
            await handlePlayerExit(io, socket, '상대 접속이 끊겼습니다. 매칭을 다시 시작해 주세요.');
        });
    });
}

module.exports = attachSocket;
