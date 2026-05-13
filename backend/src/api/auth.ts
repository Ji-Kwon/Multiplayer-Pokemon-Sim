import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db/client.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(32),
  password: z.string().min(8),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function setTokenCookie(res: Response, token: string): void {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
}

router.post('/register', async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Invalid input' } });
    return;
  }
  const { email, username, password } = parsed.data;

  try {
    const conflict = await pool.query<{ email: string; username: string }>(
      'SELECT email, username FROM users WHERE email = $1 OR username = $2 LIMIT 1',
      [email, username],
    );
    if (conflict.rows.length > 0) {
      const row = conflict.rows[0];
      const emailTaken = row.email === email;
      res.status(409).json({
        error: {
          code: emailTaken ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN',
          message: emailTaken ? 'Email already in use' : 'Username already taken',
        },
      });
      return;
    }

    const password_hash = await bcrypt.hash(password, 12);
    const result = await pool.query<{ id: string; email: string; username: string }>(
      'INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id, email, username',
      [email, username, password_hash],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

router.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Invalid input' } });
    return;
  }
  const { email, password } = parsed.data;

  try {
    const result = await pool.query<{ id: string; email: string; username: string; password_hash: string }>(
      'SELECT id, email, username, password_hash FROM users WHERE email = $1',
      [email],
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
      return;
    }

    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
    setTokenCookie(res, token);
    res.json({ id: user.id, email: user.email, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.status(204).end();
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query<{ id: string; email: string; username: string }>(
      'SELECT id, email, username FROM users WHERE id = $1',
      [req.userId],
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not found' } });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

export default router;
