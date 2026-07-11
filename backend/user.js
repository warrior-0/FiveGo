const express = require('express');
const db = require('./db');
const router = express.Router();
router.get('/profile', async (req,res,next)=>{ try{ const [rows]=await db.query('SELECT nickname, rank_score, wins, losses, draws FROM users WHERE id = ?',[req.session.userId]); res.json({user:rows[0]}); }catch(e){next(e);} });
module.exports = router;
