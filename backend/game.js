const BOARD_SIZE = 11;
const WIN_SCORE = 5;
const CHOICE_COUNT = 3;
const MAX_BID = 3;
const MAIN_TIME_MS = 5 * 60 * 1000;
const TIME_CHIP_MS = 20 * 1000;
const TIME_CHIP_COUNT = 3;


const AUGMENT_EFFECT_RULES = {
    capture_score_reduce: { timing: 'capture-first' },
    gain_one_on_captured: { timing: 'capture-first' },
    start_gain_one: { timing: 'start' },
    gain_one_if_behind_on_activate: { timing: 'capture-first' },
    reduce_multi_capture_score: { timing: 'capture-first' },
    cap_capture_score_two: { timing: 'capture-first' },
    gain_one_if_low_score: { timing: 'capture-first' },
    reduce_leading_capturer_score: { timing: 'capture-first' }
};

function normalizeAugment(augment) {
    const effect = augment.effect;
    const rule = AUGMENT_EFFECT_RULES[effect] || {};
    const timing = augment.timing || rule.timing || 'capture-first';

    return {
        ...augment,
        effect,
        timing,
        name: augment.name || effect,
        description: augment.description || ''
    };
}

function createBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function opponent(color) {
    return color === 'black' ? 'white' : 'black';
}

function clampBid(value) {
    const bid = Number(value);

    if (!Number.isInteger(bid) || bid < 0 || bid > MAX_BID) {
        throw new Error(`입찰 점수는 0~${MAX_BID} 사이의 정수여야 합니다.`);
    }

    return bid;
}

function shuffle(array) {
    const copy = [...array];

    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
}

function publicAugment(augment) {
    const normalized = normalizeAugment(augment);

    return {
        id: normalized.id,
        effect: normalized.effect,
        name: normalized.name,
        description: normalized.description,
        timing: normalized.timing,
        activationType: normalized.timing === 'start' ? 'immediate' : 'automatic'
    };
}

function pickAugmentChoices(deck) {
    return shuffle(deck).slice(0, Math.min(CHOICE_COUNT, deck.length)).map(publicAugment);
}

function createClock() {
    return {
        black: { mainMs: MAIN_TIME_MS, chips: TIME_CHIP_COUNT, chipMs: TIME_CHIP_MS },
        white: { mainMs: MAIN_TIME_MS, chips: TIME_CHIP_COUNT, chipMs: TIME_CHIP_MS },
        turnStartedAt: null
    };
}

function createPlayerState({ socketId, user, deck }) {
    return {
        socketId,
        user: {
            id: user.id,
            nickname: user.nickname
        },
        deck: deck.map(publicAugment),
        choices: pickAugmentChoices(deck),
        selectedAugmentIds: [],
        startAugments: [],
        captureAugments: [],
        activeAugments: [],
        reserveAugments: [],
        triggeredAugmentIds: [],
        reserveActivated: false,
        bid: null,
        ready: false
    };
}

function createGame(playerA, playerB) {
    return {
        phase: 'bidding',
        board: createBoard(),
        players: {
            black: null,
            white: null
        },
        seats: {
            a: createPlayerState(playerA),
            b: createPlayerState(playerB)
        },
        socketToSeat: {
            [playerA.socketId]: 'a',
            [playerB.socketId]: 'b'
        },
        turn: 'black',
        scores: {
            black: 0,
            white: 0
        },
        winner: null,
        draw: false,
        clock: createClock(),
        lastMove: null,
        log: ['입찰을 진행하세요. 더 많이 점수를 양보한 사람이 흑을 잡습니다.']
    };
}

function getSeatBySocket(game, socketId) {
    const seatKey = game.socketToSeat[socketId];
    return seatKey ? game.seats[seatKey] : null;
}

function getColorBySocket(game, socketId) {
    if (game.players.black?.socketId === socketId) return 'black';
    if (game.players.white?.socketId === socketId) return 'white';
    return null;
}

function submitBid(game, socketId, bid) {
    if (game.phase !== 'bidding') {
        throw new Error('이미 입찰이 종료되었습니다.');
    }

    const seat = getSeatBySocket(game, socketId);

    if (!seat) {
        throw new Error('참가자가 아닙니다.');
    }

    seat.bid = clampBid(bid);

    game.log.push(`${seat.user.nickname} 입찰 완료`);

    const seats = Object.values(game.seats);

    if (seats.every((candidate) => candidate.bid !== null)) {
        resolveBids(game);
    }
}

function bidPower(seat) {
    return seat.bid;
}

function resolveBids(game) {
    const [firstKey, secondKey] = Object.keys(game.seats);
    const first = game.seats[firstKey];
    const second = game.seats[secondKey];
    const firstPower = bidPower(first);
    const secondPower = bidPower(second);

    let blackSeatKey;

    if (firstPower > secondPower) {
        blackSeatKey = firstKey;
    } else if (secondPower > firstPower) {
        blackSeatKey = secondKey;
    } else {
        blackSeatKey = Math.random() < 0.5 ? firstKey : secondKey;
        game.log.push('입찰이 같아서 흑/백을 랜덤으로 결정했습니다.');
    }

    const whiteSeatKey = blackSeatKey === firstKey ? secondKey : firstKey;

    game.players.black = game.seats[blackSeatKey];
    game.players.white = game.seats[whiteSeatKey];

    game.scores.white = game.players.black.bid;
    game.scores.black = 0;
    game.phase = 'augment-selection';

    game.log.push(`흑: ${game.players.black.user.nickname}, 백: ${game.players.white.user.nickname}`);
    game.log.push(`백은 ${game.scores.white}점으로 시작합니다.`);
}

function selectAugments(game, socketId, selectedAugmentIds) {
    if (game.phase !== 'augment-selection') {
        throw new Error('증강 선택 단계가 아닙니다.');
    }

    const color = getColorBySocket(game, socketId);

    if (!color) {
        throw new Error('참가자가 아닙니다.');
    }

    const player = game.players[color];
    const selected = selectedAugmentIds.map(Number);
    const availableChoices = player.choices;
    const baseRequired = color === 'black' ? 1 : 2;
    const required = Math.min(availableChoices.length, baseRequired);
    const choiceIds = new Set(availableChoices.map((augment) => augment.id));

    if (selected.length !== required) {
        throw new Error(`${color === 'black' ? '흑' : '백'}은 증강 ${required}개를 선택해야 합니다.`);
    }

    if (new Set(selected).size !== selected.length || selected.some((id) => !choiceIds.has(id))) {
        throw new Error('선택할 수 없는 증강입니다.');
    }

    player.selectedAugmentIds = selected;
    player.ready = true;
    game.log.push(`${color === 'black' ? '흑' : '백'} 증강 선택 완료`);

    if (game.players.black.ready && game.players.white.ready) {
        prepareAugments(game, 'black');
        prepareAugments(game, 'white');
        applyStartAugments(game, 'black');
        applyStartAugments(game, 'white');
        game.phase = 'playing';
        startTurnClock(game);
        game.log.push('게임을 시작합니다. 각 플레이어는 기본 5분과 30초 타임 칩 3개를 가집니다.');
        checkWinner(game);

        if (!game.winner) {
            resolveTurnAvailability(game);
        }
    }
}

function prepareAugments(game, color) {
    const player = game.players[color];
    const selected = new Set(player.selectedAugmentIds);

    player.activeAugments = player.choices.filter((augment) => selected.has(augment.id));
    player.reserveAugments = player.choices.filter((augment) => !selected.has(augment.id));
    player.startAugments = player.activeAugments;
    player.captureAugments = player.reserveAugments;
}

function applyStartAugments(game, color) {
    const player = game.players[color];
    activateImmediateAugments(game, color, player.activeAugments);
}

function activateImmediateAugments(game, color, augments) {
    const player = game.players[color];

    for (const augment of augments) {
        if (player.triggeredAugmentIds.includes(augment.id)) continue;

        if (augment.effect === 'start_gain_one') {
            game.scores[color] += 1;
            game.log.push(`${player.user.nickname}의 ${augment.name} 발동: 1점 획득`);
        }

        if (augment.timing === 'start') {
            player.triggeredAugmentIds.push(augment.id);
        }
    }
}

function neighbors(x, y) {
    return [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1]
    ].filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < BOARD_SIZE && ny < BOARD_SIZE);
}

function groupAndLiberties(board, x, y) {
    const color = board[y][x];
    const seen = new Set([`${x},${y}`]);
    const stones = [];
    const liberties = new Set();
    const stack = [[x, y]];

    while (stack.length) {
        const [cx, cy] = stack.pop();
        stones.push([cx, cy]);

        for (const [nx, ny] of neighbors(cx, cy)) {
            if (board[ny][nx] === null) {
                liberties.add(`${nx},${ny}`);
            } else if (board[ny][nx] === color && !seen.has(`${nx},${ny}`)) {
                seen.add(`${nx},${ny}`);
                stack.push([nx, ny]);
            }
        }
    }

    return { stones, liberties: liberties.size };
}


function cloneBoard(board) {
    return board.map((row) => [...row]);
}

function evaluateMove(board, color, x, y) {
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE || board[y][x]) {
        return { legal: false, captured: 0 };
    }

    const nextBoard = cloneBoard(board);
    const enemy = opponent(color);
    let captured = 0;

    nextBoard[y][x] = color;

    for (const [nx, ny] of neighbors(x, y)) {
        if (nextBoard[ny][nx] === enemy) {
            const group = groupAndLiberties(nextBoard, nx, ny);

            if (group.liberties === 0) {
                captured += group.stones.length;

                for (const [gx, gy] of group.stones) {
                    nextBoard[gy][gx] = null;
                }
            }
        }
    }

    const own = groupAndLiberties(nextBoard, x, y);

    if (own.liberties === 0 && captured === 0) {
        return { legal: false, captured: 0 };
    }

    return { legal: true, captured };
}

function findMove(game, color, predicate = () => true) {
    for (let y = 0; y < BOARD_SIZE; y += 1) {
        for (let x = 0; x < BOARD_SIZE; x += 1) {
            const result = evaluateMove(game.board, color, x, y);

            if (result.legal && predicate(result)) {
                return { x, y, captured: result.captured };
            }
        }
    }

    return null;
}

function hasLegalMove(game, color) {
    return Boolean(findMove(game, color));
}

function hasCapturingMove(game, color) {
    return Boolean(findMove(game, color, (result) => result.captured > 0));
}

function finishByScore(game) {
    game.phase = 'finished';
    game.clock.turnStartedAt = null;

    if (game.scores.black > game.scores.white) {
        game.winner = 'black';
        game.log.push(`착수 가능한 포획수가 없어 현재 점수로 정산: 흑 승리`);
    } else if (game.scores.white > game.scores.black) {
        game.winner = 'white';
        game.log.push(`착수 가능한 포획수가 없어 현재 점수로 정산: 백 승리`);
    } else {
        game.winner = null;
        game.draw = true;
        game.log.push('착수 가능한 포획수가 없어 현재 점수로 정산: 무승부');
    }
}

function resolveTurnAvailability(game) {
    if (game.phase !== 'playing' || game.winner) return;

    const current = game.turn;
    const next = opponent(current);

    if (hasLegalMove(game, current)) {
        startTurnClock(game);
        return;
    }

    if (hasCapturingMove(game, next)) {
        game.log.push(`${current === 'black' ? '흑' : '백'}은 둘 수 있는 수가 없어 자동 패스되었습니다.`);
        game.turn = next;
        startTurnClock(game);
        return;
    }

    finishByScore(game);
}

function applyCaptureAugments(game, capturedColor, capturingColor, capturedCount) {
    if (capturedCount <= 0) return { scoreDelta: capturedCount, skipTurn: false };

    const capturedPlayer = game.players[capturedColor];
    let scoreDelta = capturedCount;
    let skipTurn = false;

    // 대기 증강 활성화 여부 확인
    const shouldActivateReserve = !capturedPlayer.reserveActivated && capturedPlayer.reserveAugments.length;
    
    // 현재 활성화된 증강 + 활성화될 대기 증강 목록 합치기 (단, 순수하게 효과 처리를 위한 목록)
    const augmentsToProcess = [...capturedPlayer.activeAugments];
    if (shouldActivateReserve) {
        augmentsToProcess.push(...capturedPlayer.reserveAugments);
    }

    // 1. Capture-first 타이밍의 증강 효과들을 먼저 처리
    for (const augment of augmentsToProcess) {
        if (capturedPlayer.triggeredAugmentIds.includes(augment.id)) continue;
        if (augment.timing !== 'capture-first') continue;

        // 효과 발동 조건 확인 및 처리
        if (augment.effect === 'capture_score_reduce') {
            scoreDelta = Math.max(0, scoreDelta - 1);
            game.log.push(`${capturedPlayer.user.nickname}의 ${augment.name} 발동: 상대 획득 점수 -1`);
            capturedPlayer.triggeredAugmentIds.push(augment.id);
        } else if (augment.effect === 'gain_one_on_captured') {
            game.scores[capturedColor] += 1;
            game.log.push(`${capturedPlayer.user.nickname}의 ${augment.name} 발동: 반격 1점 획득`);
            capturedPlayer.triggeredAugmentIds.push(augment.id);
        } else if (augment.effect === 'reduce_multi_capture_score') {
            if (capturedCount >= 2) {
                scoreDelta = Math.max(0, scoreDelta - 1);
                game.log.push(`${capturedPlayer.user.nickname}의 ${augment.name} 발동: 다중 포획 점수 -1`);
                capturedPlayer.triggeredAugmentIds.push(augment.id);
            }
        } else if (augment.effect === 'cap_capture_score_two') {
            scoreDelta = Math.min(scoreDelta, 2);
            game.log.push(`${capturedPlayer.user.nickname}의 ${augment.name} 발동: 포획 점수 최대 2점`);
            capturedPlayer.triggeredAugmentIds.push(augment.id);
        } else if (augment.effect === 'gain_one_if_low_score') {
            if (game.scores[capturedColor] <= 2) {
                game.scores[capturedColor] += 1;
                game.log.push(`${capturedPlayer.user.nickname}의 ${augment.name} 발동: 버티기 1점 획득`);
                capturedPlayer.triggeredAugmentIds.push(augment.id);
            }
        } else if (augment.effect === 'reduce_leading_capturer_score') {
            if (game.scores[capturingColor] + scoreDelta > game.scores[capturedColor]) {
                game.scores[capturingColor] = Math.max(0, game.scores[capturingColor] - 1);
                game.log.push(`${capturedPlayer.user.nickname}의 ${augment.name} 발동: 앞선 상대 점수 -1`);
                capturedPlayer.triggeredAugmentIds.push(augment.id);
            }
        } else if (augment.effect === 'gain_one_if_behind_on_activate') {
            if (game.scores[capturingColor] + scoreDelta > game.scores[capturedColor]) {
                game.scores[capturedColor] += 1;
                game.log.push(`${capturedPlayer.user.nickname}의 ${augment.name} 발동: 추격 1점 획득`);
                capturedPlayer.triggeredAugmentIds.push(augment.id);
            }
        }
    }

    // 2. 모든 capture-first 효과 처리 후 대기 증강을 정식으로 활성화하고 즉시 효과(start) 처리
    if (shouldActivateReserve) {
        const reserveAugments = [...capturedPlayer.reserveAugments];
        capturedPlayer.reserveActivated = true;
        capturedPlayer.activeAugments.push(...reserveAugments);
        game.log.push(`${capturedPlayer.user.nickname}의 대기 증강이 활성화되었습니다.`);
        
        // 대기 증강 중 'start' 타이밍(즉시 효과) 처리
        activateImmediateAugments(game, capturedColor, reserveAugments);
        
        capturedPlayer.reserveAugments = [];
        capturedPlayer.captureAugments = [];
    }

    return { scoreDelta, skipTurn };
}


function startTurnClock(game, now = Date.now()) {
    if (game.phase !== 'playing' || game.winner) {
        game.clock.turnStartedAt = null;
        return;
    }

    game.clock.turnStartedAt = now;
}

function spendClockTime(clockEntry, elapsedMs) {
    let remainingElapsed = Math.max(0, elapsedMs);

    // 1. 본시간 차감
    if (clockEntry.mainMs > 0) {
        const spentMain = Math.min(clockEntry.mainMs, remainingElapsed);
        clockEntry.mainMs -= spentMain;
        remainingElapsed -= spentMain;
    }

    // 본시간 내에 착수한 경우
    if (remainingElapsed <= 0) {
        return false; // 패배 아님
    }

    // 2. 초읽기(타임칩) 구간 계산
    // remainingElapsed가 정확히 chipMs의 배수일 때까지는 해당 칩 안에서 둔 것임
    // 예: 30초(chipMs) 룰에서 30,000ms 소모 -> 0개 차감 / 30,001ms 소모 -> 1개 차감
    const usedChips = Math.ceil(remainingElapsed / clockEntry.chipMs) - 1;

    if (usedChips > 0) {
        clockEntry.chips -= usedChips;
    }

    // 3. 시간패 판정
    // 남은 칩이 0개 미만이 되면 부여된 모든 타임칩 시간을 초과한 것
    if (clockEntry.chips < 0) {
        clockEntry.chips = 0;
        return true; // 시간패
    }

    return false; // 통과
}

function applyTurnClock(game, now = Date.now()) {
    if (game.phase !== 'playing' || game.winner || game.draw || !game.clock.turnStartedAt) return false;

    const color = game.turn;
    const elapsedMs = now - game.clock.turnStartedAt;
    game.clock.turnStartedAt = now;

    if (spendClockTime(game.clock[color], elapsedMs)) {
        game.winner = opponent(color);
        game.draw = false;
        game.phase = 'finished';
        game.clock.turnStartedAt = null;
        game.log.push(`${color === 'black' ? '흑' : '백'} 시간패: ${game.winner === 'black' ? '흑' : '백'} 승리`);
        return true;
    }

    return false;
}

function publicClockState(game) {
    const snapshot = JSON.parse(JSON.stringify(game.clock));

    if (game.phase === 'playing' && !game.winner && !game.draw && snapshot.turnStartedAt) {
        const live = { clock: snapshot, turn: game.turn, phase: game.phase, winner: game.winner, log: [] };
        applyTurnClock(live);
        return live.clock;
    }

    return snapshot;
}

function checkWinner(game) {
    const blackWon = game.scores.black >= WIN_SCORE;
    const whiteWon = game.scores.white >= WIN_SCORE;

    if (blackWon && whiteWon) {
        game.winner = game.scores.black >= game.scores.white ? 'black' : 'white';
    } else if (blackWon) {
        game.winner = 'black';
    } else if (whiteWon) {
        game.winner = 'white';
    }

    if (game.winner) game.draw = false;

    if (game.winner) {
        game.phase = 'finished';
        game.clock.turnStartedAt = null;
        game.log.push(`${game.winner === 'black' ? '흑' : '백'} 승리`);
    }
}

function placeStone(game, color, x, y) {
    if (game.phase !== 'playing') throw new Error('아직 착수할 수 없습니다.');
    if (game.winner) throw new Error('이미 종료된 게임입니다.');
    if (applyTurnClock(game)) throw new Error('시간이 모두 소진되었습니다.');
    if (game.turn !== color) throw new Error('상대 차례입니다.');
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE || game.board[y][x]) throw new Error('둘 수 없는 위치입니다.');

    game.board[y][x] = color;
    game.lastMove = { x, y, color };

    let captured = 0;
    const enemy = opponent(color);

    for (const [nx, ny] of neighbors(x, y)) {
        if (game.board[ny][nx] === enemy) {
            const group = groupAndLiberties(game.board, nx, ny);

            if (group.liberties === 0) {
                captured += group.stones.length;

                for (const [gx, gy] of group.stones) {
                    game.board[gy][gx] = null;
                }
            }
        }
    }

    const own = groupAndLiberties(game.board, x, y);

    if (own.liberties === 0 && captured === 0) {
        game.board[y][x] = null;
        throw new Error('자살수는 둘 수 없습니다.');
    }

    const result = applyCaptureAugments(game, enemy, color, captured);
    game.scores[color] += result.scoreDelta;

    if (captured > 0) {
        game.log.push(`${color === 'black' ? '흑' : '백'}이 ${captured}개를 포획했습니다.`);
    }

    checkWinner(game);

    if (!game.winner) {
        game.turn = result.skipTurn ? color : enemy;
        resolveTurnAvailability(game);
    }

    return { captured, scoreDelta: result.scoreDelta };
}

function publicGameState(game) {
    const revealBids = game.phase !== 'bidding';
    const revealAugments = game.phase === 'playing' || game.phase === 'finished';
    const publicSeat = (seat) => {
        if (!seat) return null;

        return {
            ...seat,
            bid: revealBids || seat.bid === null ? seat.bid : 'submitted',
            selectedAugmentIds: revealAugments ? seat.selectedAugmentIds : [],
            startAugments: revealAugments ? seat.startAugments : [],
            captureAugments: revealAugments ? seat.captureAugments : [],
            triggeredAugmentIds: revealAugments ? seat.triggeredAugmentIds : [],
            activeAugments: revealAugments ? seat.activeAugments : [],
            reserveAugments: revealAugments ? seat.reserveAugments : [],
            reserveActivated: revealAugments ? seat.reserveActivated : false
        };
    };

    return {
        phase: game.phase,
        board: game.board,
        players: {
            black: publicSeat(game.players.black),
            white: publicSeat(game.players.white)
        },
        seats: {
            a: publicSeat(game.seats.a),
            b: publicSeat(game.seats.b)
        },
        turn: game.turn,
        scores: game.scores,
        winner: game.winner,
        draw: game.draw,
        clock: publicClockState(game),
        lastMove: game.lastMove,
        timeRule: {
            mainMs: MAIN_TIME_MS,
            chipMs: TIME_CHIP_MS,
            chipCount: TIME_CHIP_COUNT
        },
        log: game.log.slice(-8)
    };
}

module.exports = {
    BOARD_SIZE,
    WIN_SCORE,
    MAIN_TIME_MS,
    TIME_CHIP_MS,
    TIME_CHIP_COUNT,
    MAX_BID,
    AUGMENT_EFFECT_RULES,
    createGame,
    applyTurnClock,
    getColorBySocket,
    hasCapturingMove,
    hasLegalMove,
    placeStone,
    publicGameState,
    resolveTurnAvailability,
    selectAugments,
    submitBid
};
