const BOARD_SIZE = 13;
const WIN_SCORE = 5;
const CHOICE_COUNT = 3;

const AUGMENT_EFFECTS = {
    initiative: {
        timing: 'bid',
        bidBonus: 1,
        name: '선공 집착',
        description: '흑을 가져가기 위한 입찰 계산에 +1을 더합니다. 이 증강은 시작 증강이나 피포획 발동 증강으로 쓰이지 않고, 색 결정에만 영향을 줍니다. 같은 입찰 점수에서 흑을 안정적으로 잡고 싶을 때 쓰는 증강입니다.'
    },
    shield: {
        timing: 'capture-first',
        name: '방패진',
        description: '내 돌이 처음 잡히는 순간 1회 발동합니다. 그 포획으로 상대가 얻는 점수를 1점 줄입니다. 한 번에 여러 개가 잡혀도 총 획득 점수에서 1점만 줄고, 점수는 0점 아래로 내려가지 않습니다.'
    },
    revenge: {
        timing: 'capture-first',
        name: '복수의 수',
        description: '내 돌이 처음 잡히는 순간 1회 발동합니다. 내가 즉시 1점을 얻습니다. 실제 보드에서 상대 돌을 제거하지는 않고, 포획 점수만 추가되는 반격형 증강입니다.'
    },
    focus: {
        timing: 'start',
        name: '집중',
        description: '시작 증강으로 선택하면 게임 시작 전에 즉시 1점을 얻습니다. 5점 승리 조건에 바로 반영되므로, 백의 입찰 보정 점수와 합쳐 빠른 승리를 노릴 수 있습니다.'
    },
    pressure: {
        timing: 'capture-first',
        name: '압박',
        description: '내 돌이 처음 잡히는 순간 1회 발동합니다. 상대의 다음 턴을 건너뛰게 만들어, 돌을 잡은 플레이어가 한 번 더 둡니다. 포획을 일부러 허용해 선수를 되찾는 용도로 사용할 수 있습니다.'
    },
    extra_choice: {
        timing: 'start',
        name: '넓은 선택지',
        description: '증강 선택 단계에서 시작 증강 선택 수를 1개 늘립니다. 흑은 1개 대신 2개, 백은 2개 대신 3개를 시작 증강으로 선택합니다. 선택되지 않은 증강은 기존처럼 첫 피포획 시 발동 후보가 됩니다.'
    },
    comeback: {
        timing: 'capture-first',
        name: '역전 감각',
        description: '내 돌이 처음 잡히는 순간 1회 발동합니다. 발동 시점에 내 점수가 상대보다 낮으면 내가 1점을 얻습니다. 동점이거나 앞서고 있으면 효과 없이 소모됩니다.'
    },
    stone_tax: {
        timing: 'capture-first',
        name: '끝내기 견제',
        description: '내 돌이 처음 잡히는 순간 1회 발동합니다. 상대가 이미 4점 이상이면 상대 점수를 1점 깎습니다. 상대가 5점에 도달하는 포획을 노릴 때 역전 시간을 벌기 위한 방어형 증강입니다.'
    }
};

function createBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function opponent(color) {
    return color === 'black' ? 'white' : 'black';
}

function clampBid(value) {
    const bid = Number(value);

    if (!Number.isInteger(bid) || bid < 0 || bid > 4) {
        throw new Error('입찰 점수는 0~4 사이의 정수여야 합니다.');
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
    const timing = AUGMENT_EFFECTS[augment.code]?.timing || 'capture-first';

    return {
        id: augment.id,
        code: augment.code,
        name: augment.name,
        description: augment.description || AUGMENT_EFFECTS[augment.code]?.description || '',
        timing,
        activationType: timing === 'start' ? 'immediate' : 'automatic',
        bidBonus: AUGMENT_EFFECTS[augment.code]?.bidBonus || 0
    };
}

function pickAugmentChoices(deck) {
    return shuffle(deck).slice(0, Math.min(CHOICE_COUNT, deck.length)).map(publicAugment);
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
        sacrificeAugmentId: null,
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

function submitBid(game, socketId, bid, sacrificeAugmentId = null) {
    if (game.phase !== 'bidding') {
        throw new Error('이미 입찰이 종료되었습니다.');
    }

    const seat = getSeatBySocket(game, socketId);

    if (!seat) {
        throw new Error('참가자가 아닙니다.');
    }

    seat.bid = clampBid(bid);
    seat.sacrificeAugmentId = sacrificeAugmentId ? Number(sacrificeAugmentId) : null;

    if (seat.sacrificeAugmentId && !seat.choices.some((augment) => augment.id === seat.sacrificeAugmentId)) {
        throw new Error('희생할 수 없는 증강입니다.');
    }

    game.log.push(`${seat.user.nickname} 입찰 완료`);

    const seats = Object.values(game.seats);

    if (seats.every((candidate) => candidate.bid !== null)) {
        resolveBids(game);
    }
}

function bidPower(seat) {
    const sacrificed = seat.choices.find((augment) => augment.id === seat.sacrificeAugmentId);
    const sacrificeBonus = sacrificed ? 1 : 0;
    const passiveBonus = seat.choices.reduce((sum, augment) => sum + (AUGMENT_EFFECTS[augment.code]?.bidBonus || 0), 0);

    return seat.bid + sacrificeBonus + passiveBonus;
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
    const baseRequired = color === 'black' ? 1 : 2;
    const hasExtraChoice = player.choices.some((augment) => augment.code === 'extra_choice');
    const required = Math.min(player.choices.length, baseRequired + (hasExtraChoice ? 1 : 0));
    const choiceIds = new Set(player.choices.map((augment) => augment.id));

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
        game.log.push('게임을 시작합니다.');
        checkWinner(game);
    }
}

function prepareAugments(game, color) {
    const player = game.players[color];
    const selected = new Set(player.selectedAugmentIds);

    player.activeAugments = player.choices.filter((augment) => selected.has(augment.id));
    player.reserveAugments = player.choices.filter((augment) => !selected.has(augment.id) && augment.id !== player.sacrificeAugmentId);
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

        if (augment.code === 'focus') {
            game.scores[color] += 1;
            game.log.push(`${player.user.nickname}의 ${augment.name} 발동: 1점 획득`);
        }

        if (AUGMENT_EFFECTS[augment.code]?.timing === 'start') {
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

function applyCaptureAugments(game, capturedColor, capturingColor, capturedCount) {
    if (capturedCount <= 0) return { scoreDelta: capturedCount, skipTurn: false };

    const capturedPlayer = game.players[capturedColor];
    const capturingPlayer = game.players[capturingColor];
    let scoreDelta = capturedCount;
    let skipTurn = false;

    if (!capturedPlayer.reserveActivated && capturedPlayer.reserveAugments.length) {
        capturedPlayer.reserveActivated = true;
        capturedPlayer.activeAugments.push(...capturedPlayer.reserveAugments);
        game.log.push(`${capturedPlayer.user.nickname}의 대기 증강이 활성화되었습니다.`);
        activateImmediateAugments(game, capturedColor, capturedPlayer.reserveAugments);
        capturedPlayer.reserveAugments = [];
        capturedPlayer.captureAugments = [];
    }

    for (const augment of capturedPlayer.activeAugments) {
        if (capturedPlayer.triggeredAugmentIds.includes(augment.id)) continue;
        if (AUGMENT_EFFECTS[augment.code]?.timing !== 'capture-first') continue;

        capturedPlayer.triggeredAugmentIds.push(augment.id);

        if (augment.code === 'shield') {
            scoreDelta = Math.max(0, scoreDelta - 1);
            game.log.push(`${capturedPlayer.user.nickname}의 ${augment.name} 발동: 상대 획득 점수 -1`);
        } else if (augment.code === 'revenge') {
            game.scores[capturedColor] += 1;
            game.log.push(`${capturedPlayer.user.nickname}의 ${augment.name} 발동: 반격 1점 획득`);
        } else if (augment.code === 'pressure') {
            skipTurn = true;
            game.log.push(`${capturedPlayer.user.nickname}의 ${augment.name} 발동: ${capturingPlayer.user.nickname} 다음 턴 스킵`);
        } else if (augment.code === 'comeback') {
            if (game.scores[capturedColor] < game.scores[capturingColor]) {
                game.scores[capturedColor] += 1;
                game.log.push(`${capturedPlayer.user.nickname}의 ${augment.name} 발동: 추격 1점 획득`);
            }
        } else if (augment.code === 'stone_tax') {
            if (game.scores[capturingColor] >= 4) {
                game.scores[capturingColor] = Math.max(0, game.scores[capturingColor] - 1);
                game.log.push(`${capturedPlayer.user.nickname}의 ${augment.name} 발동: 상대 점수 -1`);
            }
        }
    }

    return { scoreDelta, skipTurn };
}

function checkWinner(game) {
    if (game.scores.black >= WIN_SCORE) game.winner = 'black';
    if (game.scores.white >= WIN_SCORE) game.winner = 'white';

    if (game.winner) {
        game.phase = 'finished';
        game.log.push(`${game.winner === 'black' ? '흑' : '백'} 승리`);
    }
}

function placeStone(game, color, x, y) {
    if (game.phase !== 'playing') throw new Error('아직 착수할 수 없습니다.');
    if (game.winner) throw new Error('이미 종료된 게임입니다.');
    if (game.turn !== color) throw new Error('상대 차례입니다.');
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE || game.board[y][x]) throw new Error('둘 수 없는 위치입니다.');

    game.board[y][x] = color;

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
            sacrificeAugmentId: revealBids ? seat.sacrificeAugmentId : null,
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
        log: game.log.slice(-8)
    };
}

module.exports = {
    BOARD_SIZE,
    WIN_SCORE,
    AUGMENT_EFFECTS,
    createGame,
    getColorBySocket,
    placeStone,
    publicGameState,
    selectAugments,
    submitBid
};
