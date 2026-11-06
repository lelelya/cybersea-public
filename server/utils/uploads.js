const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../uploads');
function removeUnusedUpload(db,url) {
 if(typeof url!=='string'||!url.startsWith('/uploads/'))return false;
 const checks=[['album_photos','path'],['messages','image_path'],['messages','voice_path'],['stories','audio_path'],['moments','image_path'],['persona','ai_avatar_path'],['persona','user_avatar_path'],['persona','ai_portrait_path'],['persona','user_portrait_path']];
 for(const [table,column] of checks)if(db.prepare(`SELECT 1 FROM ${table} WHERE instr(COALESCE(${column},''),?)>0 LIMIT 1`).get(url))return false;
 let file;try{file=path.resolve(root,decodeURIComponent(url.slice('/uploads/'.length)));}catch{return false;}
 const inside=p=>p.startsWith(root+path.sep);
 if(!inside(file))return false;
 try{if(!inside(fs.realpathSync(file))||!fs.statSync(file).isFile())return false;fs.unlinkSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}
}
module.exports={removeUnusedUpload};
