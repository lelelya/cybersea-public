// Compatibility facade; all context qualification is shared by Memory V2.
const RECENT_MESSAGE_LIMIT=200;
function getContext(){return require('./modules/memoryBank/service').getMemoryService().recentMessages({limit:RECENT_MESSAGE_LIMIT});}
module.exports={getContext,RECENT_MESSAGE_LIMIT};
