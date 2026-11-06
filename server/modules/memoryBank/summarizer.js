// Compatibility entry: durable jobs replace whole-profile rewriting.
const {PROFILE_KEYS}=require('./constants');
function runSummarization(options){return require('./service').getMemoryService().enqueueMaintenance(options);}
module.exports={runSummarization,PROFILE_KEYS};
