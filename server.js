const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));

const WORDS = {
  general: ['Апельсин', 'Телевизор', 'Космонавт', 'Парашют', 'Айсберг', 'Скрипка', 'Вулкан', 'Гитара', 'Компас'],
  easy: ['Кот', 'Собака', 'Яблоко', 'Машина', 'Солнце', 'Дом', 'Книга', 'Телефон'],
  hard: ['Идентификация', 'Синхрофазотрон', 'Гипотеза', 'Экстраполяция', 'Метафора']
};

const rooms = {};

function isValidMine(mineWord, targetWord, mines) {
  const mine = mineWord.trim().toLowerCase();
  const target = targetWord.trim().toLowerCase();

  if (mine.includes(' ') || !mine) return { valid: false, reason: 'Нужно ввести строго одно слово!' };
  if (mine === target) return { valid: false, reason: 'Нельзя писать само загаданное слово!' };

  if (mine.length >= 4 && target.length >= 4) {
    if (mine.startsWith(target.substring(0, 4)) || target.startsWith(mine.substring(0, 4))) {
      return { valid: false, reason: 'Запрещено использовать однокоренные слова!' };
    }
  }

  return { valid: true };
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ nickname }) => {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    rooms[roomId] = { hostId: socket.id, players: {}, mines: {}, targetWord: '' };
    socket.join(roomId);
    rooms[roomId].players[socket.id] = { nickname, score: 0 };
    socket.emit('room_joined', { roomId, isHost: true });
    sendUpdates(roomId);
  });

  socket.on('join_room', ({ nickname, roomId }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('error_message', 'Комната не найдена!');
    socket.join(roomId);
    room.players[socket.id] = { nickname, score: 0 };
    socket.emit('room_joined', { roomId, isHost: false });
    sendUpdates(roomId);
  });

  socket.on('start_game', ({ roomId, category, timer }) => {
    const room = rooms[roomId];
    const wordsList = WORDS[category] || WORDS.general;
    room.targetWord = wordsList[Math.floor(Math.random() * wordsList.length)];
    room.mines = {};

    const playerIds = Object.keys(room.players);
    const explainerId = playerIds[Math.floor(Math.random() * playerIds.length)];
    let guesserId = playerIds.find(id => id !== explainerId) || explainerId;

    room.explainerId = explainerId;
    room.guesserId = guesserId;

    playerIds.forEach(id => {
      let role = 'trapper';
      if (id === explainerId) role = 'explainer';
      if (id === guesserId) role = 'guesser';
      io.to(id).emit('mining_phase_start', { role, targetWord: role === 'guesser' ? null : room.targetWord, timer });
    });

    let timeLeft = parseInt(timer);
    clearInterval(room.timerInt);
    room.timerInt = setInterval(() => {
      timeLeft--;
      io.to(roomId).emit('timer_tick', timeLeft);
      if (timeLeft <= 0) {
        clearInterval(room.timerInt);
        io.to(roomId).emit('explain_phase_start', { targetWord: room.targetWord });
      }
    }, 1000);
  });

  socket.on('submit_mine', ({ roomId, mineWord }) => {
    const room = rooms[roomId];
    const check = isValidMine(mineWord, room.targetWord, room.mines);
    if (!check.valid) return socket.emit('error_message', check.reason);

    room.mines[socket.id] = { word: mineWord, authorId: socket.id, authorName: room.players[socket.id].nickname, likes: 0 };
    socket.emit('mine_saved_success');
  });

  socket.on('round_end', ({ roomId, result }) => {
    const room = rooms[roomId];
    if (result === 'guessed') {
      if (room.players[room.explainerId]) room.players[room.explainerId].score += 100;
      if (room.players[room.guesserId]) room.players[room.guesserId].score += 100;
    }
    io.to(roomId).emit('round_over', { result, targetWord: room.targetWord, mines: Object.values(room.mines) });
    sendUpdates(roomId);
  });

  socket.on('like_mine', ({ roomId, mineAuthorId }) => {
    const room = rooms[roomId];
    if (room && room.mines[mineAuthorId]) {
      room.mines[mineAuthorId].likes++;
      if (room.players[mineAuthorId]) room.players[mineAuthorId].score += 25;
      sendUpdates(roomId);
    }
  });

  socket.on('next_round', ({ roomId }) => {
    io.to(roomId).emit('room_joined', { roomId, isHost: socket.id === rooms[roomId].hostId });
  });
});

function sendUpdates(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const playersList = Object.values(room.players);
  const leaderboard = [...playersList].sort((a, b) => b.score - a.score);
  io.to(roomId).emit('update_players', { players: playersList, leaderboard });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
