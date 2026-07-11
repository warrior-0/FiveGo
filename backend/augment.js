const express = require('express');
const db = require('./db');

const router = express.Router();

router.get('/', async (req, res, next) => {
    try {
        const [augments] = await db.query('SELECT id, code, name, description FROM augments ORDER BY id');
        res.json({ augments });
    } catch (error) {
        next(error);
    }
});

router.get('/deck', async (req, res, next) => {
    try {
        const [rows] = await db.query('SELECT augment_id FROM user_augments WHERE user_id = ? ORDER BY augment_id', [req.session.userId]);
        res.json({ deck: rows.map((row) => row.augment_id) });
    } catch (error) {
        next(error);
    }
});

router.post('/deck', async (req, res, next) => {
    const ids = [...new Set((req.body.augmentIds || []).map(Number))];

    if (ids.length !== 5 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
        return res.status(400).json({ message: '증강은 중복 없이 정확히 5개를 선택해야 합니다.' });
    }

    const conn = await db.getConnection();

    try {
        const [existing] = await conn.query(`SELECT id FROM augments WHERE id IN (${ids.map(() => '?').join(',')})`, ids);

        if (existing.length !== 5) {
            return res.status(400).json({ message: '존재하지 않는 증강이 포함되어 있습니다.' });
        }

        await conn.beginTransaction();
        await conn.query('DELETE FROM user_augments WHERE user_id = ?', [req.session.userId]);

        for (const id of ids) {
            await conn.query('INSERT INTO user_augments (user_id, augment_id) VALUES (?, ?)', [req.session.userId, id]);
        }

        await conn.commit();
        res.json({ message: 'saved' });
    } catch (error) {
        await conn.rollback();
        next(error);
    } finally {
        conn.release();
    }
});

module.exports = router;
