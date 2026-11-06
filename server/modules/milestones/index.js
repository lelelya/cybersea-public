// Legacy module adapter. Main callers exclude this snippet and use the shared context.
module.exports={router:require('./routes'),getContextSnippet(){const s=require('../memoryBank/service').getMemoryService();return s.listMilestones().filter(m=>m.status==='active'&&m.pinned).map(m=>m.date+' '+m.title+'\n'+m.description).join('\n\n')||null;}};
