const { createGame, placeStone } = require('./game');
const waiting = [];
const games = new Map();
function attachSocket(io){
 io.on('connection', socket => {
  socket.on('joinMatch', () => {
   if(waiting.length){ const opponentSocket=waiting.shift(); const roomId=`room-${socket.id}-${opponentSocket.id}`; const players={black:opponentSocket.id, white:socket.id}; const game=createGame(players); games.set(roomId,game); socket.join(roomId); opponentSocket.join(roomId); opponentSocket.emit('matchFound',{roomId,color:'black'}); socket.emit('matchFound',{roomId,color:'white'}); io.to(roomId).emit('gameState',game); }
   else { waiting.push(socket); socket.emit('gameError','상대를 기다리는 중입니다.'); }
  });
  socket.on('placeStone', ({roomId,x,y}) => { try{ const game=games.get(roomId); if(!game) throw new Error('게임을 찾을 수 없습니다.'); const color=game.players.black===socket.id?'black':game.players.white===socket.id?'white':null; if(!color) throw new Error('참가자가 아닙니다.'); placeStone(game,color,Number(x),Number(y)); io.to(roomId).emit('gameState',game); } catch(e){ socket.emit('gameError',e.message); } });
  socket.on('disconnect',()=>{ const i=waiting.indexOf(socket); if(i>=0) waiting.splice(i,1); });
 });
}
module.exports = attachSocket;
