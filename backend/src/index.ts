import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRouter from './api/auth.js';
import teamsRouter from './api/teams.js';
import { pokemonRouter, itemsRouter, naturesRouter } from './api/pokemon.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' } });

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get('/api/v1/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/teams', teamsRouter);
app.use('/api/v1/pokemon', pokemonRouter);
app.use('/api/v1/items', itemsRouter);
app.use('/api/v1/natures', naturesRouter);

io.on('connection', (socket) => {
  socket.on('battle:join', (battleId: string) => {
    socket.join(battleId);
  });
});

const PORT = process.env.PORT ?? 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
