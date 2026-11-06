const express=require('express');const router=express.Router();
const service=()=>require('../memoryBank/service').getMemoryService();
const run=(fn,status=200)=>(r,res)=>{try{res.status(status).json(fn(r));}catch(e){res.status(e.status||500).json({error:e.status?e.message:'记忆服务暂时不可用',code:e.code||'MEMORY_ERROR'});}};
router.get('/',run(()=>({milestones:service().listMilestones()})));
router.post('/import',run(r=>{const v=service().importData({milestones:r.body});return {...v,count:v.milestones,skipped:v.duplicates};}));
router.post('/',run(r=>service().write('milestone',{...r.body,op:'create'},{actor:'user'}).item,201));
router.put('/:id',run(r=>service().write('milestone',{...r.body,op:'update_item',id:r.params.id},{actor:'user'}).item));
router.delete('/:id',run(r=>service().purge('milestone',r.params.id,r.body.expected_revision)));
module.exports=router;
