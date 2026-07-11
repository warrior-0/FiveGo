const express = require('express');
const db = require('./db');
const router = express.Router();
router.get('/', async (req,res,next)=>{ try{ const [augments]=await db.query('SELECT id, name, description FROM augments ORDER BY id'); res.json({augments}); }catch(e){next(e);} });
router.get('/deck', async (req,res,next)=>{ try{ const [rows]=await db.query('SELECT augment_id FROM user_augments WHERE user_id = ?',[req.session.userId]); res.json({deck: rows.map(r=>r.augment_id)}); }catch(e){next(e);} });
router.post('/deck', async (req,res,next)=>{ const ids=req.body.augmentIds||[]; if(ids.length!==5) return res.status(400).json({message:'증강은 정확히 5개를 선택해야 합니다.'}); const conn=await db.getConnection(); try{ await conn.beginTransaction(); await conn.query('DELETE FROM user_augments WHERE user_id = ?',[req.session.userId]); for(const id of ids) await conn.query('INSERT INTO user_augments (user_id, augment_id) VALUES (?, ?)',[req.session.userId,id]); await conn.commit(); res.json({message:'saved'});}catch(e){ await conn.rollback(); next(e);} finally{ conn.release(); } });
module.exports = router;
