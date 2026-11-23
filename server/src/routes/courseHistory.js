import {Router} from 'express';
import {requireIdentity} from '../middleware/requireIdentity.js';
import {requireServiceConsent} from '../middleware/requireConsent.js';
import {listCourseHistory} from '../services/courseHistoryListService.js';
const router=Router();
router.get('/',requireIdentity,requireServiceConsent,async(req,res)=>{res.set('Cache-Control','no-store');try{return res.json({records:await listCourseHistory(req.identity)});}catch(e){return res.status(e.status===403?403:503).json({error:e.status===403?'登入身分無法對應資料':'修課紀錄暫時無法載入'});}});
export default router;
