const BOARD_SIZE = 13;
const WIN_SCORE = 5;
function createBoard(){ return Array.from({length:BOARD_SIZE},()=>Array(BOARD_SIZE).fill(null)); }
function createGame(players){ return { board:createBoard(), players, turn:'black', scores:{black:0,white:0}, winner:null }; }
function opponent(color){ return color === 'black' ? 'white' : 'black'; }
function neighbors(x,y){ return [[x+1,y],[x-1,y],[x,y+1],[x,y-1]].filter(([nx,ny])=>nx>=0&&ny>=0&&nx<BOARD_SIZE&&ny<BOARD_SIZE); }
function groupAndLiberties(board,x,y){ const color=board[y][x]; const seen=new Set([`${x},${y}`]); const stones=[]; let liberties=0; const stack=[[x,y]]; while(stack.length){ const [cx,cy]=stack.pop(); stones.push([cx,cy]); for(const [nx,ny] of neighbors(cx,cy)){ if(board[ny][nx]===null) liberties++; else if(board[ny][nx]===color && !seen.has(`${nx},${ny}`)){ seen.add(`${nx},${ny}`); stack.push([nx,ny]); } } } return {stones, liberties}; }
function placeStone(game,color,x,y){ if(game.winner) throw new Error('이미 종료된 게임입니다.'); if(game.turn!==color) throw new Error('상대 차례입니다.'); if(x<0||y<0||x>=BOARD_SIZE||y>=BOARD_SIZE||game.board[y][x]) throw new Error('둘 수 없는 위치입니다.'); game.board[y][x]=color; let captured=0; for(const [nx,ny] of neighbors(x,y)){ if(game.board[ny][nx]===opponent(color)){ const group=groupAndLiberties(game.board,nx,ny); if(group.liberties===0){ captured+=group.stones.length; for(const [gx,gy] of group.stones) game.board[gy][gx]=null; } } } const own=groupAndLiberties(game.board,x,y); if(own.liberties===0 && captured===0){ game.board[y][x]=null; throw new Error('자살수는 둘 수 없습니다.'); } game.scores[color]+=captured; if(game.scores[color]>=WIN_SCORE) game.winner=color; game.turn=opponent(color); return {captured}; }
module.exports = { BOARD_SIZE, WIN_SCORE, createGame, placeStone };
