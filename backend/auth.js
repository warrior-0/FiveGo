const express = require('express');
const bcrypt = require('bcrypt');
const db = require('./db');

const router = express.Router();

router.post('/register', async (req, res, next) => {
    try {
        const { username, nickname, password } = req.body;

        if (!username || !nickname || !password) {
            return res.status(400).json({ message: '모든 값을 입력하세요.' });
        }

        const hash = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, ?)', [username, nickname, hash]);
        res.status(201).json({ message: 'registered' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: '이미 사용 중인 아이디 또는 닉네임입니다.' });
        }

        next(error);
    }
});

router.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body;
        const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        const user = rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        }

        req.session.regenerate((error) => {
            if (error) return next(error);

            req.session.userId = user.id;
            res.json({ message: 'logged in' });
        });
    } catch (error) {
        next(error);
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ message: 'logged out' });
    });
});

router.get('/me', async (req, res, next) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ message: '로그인이 필요합니다.' });
        }

        const [rows] = await db.query('SELECT id, username, nickname FROM users WHERE id = ?', [req.session.userId]);
        res.json({ user: rows[0] });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
