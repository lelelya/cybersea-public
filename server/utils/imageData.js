function decodeImage(value) {
 const fail=()=>{throw Object.assign(new Error('图片数据无效，请重新选择 PNG、JPEG、GIF 或 WebP 图片'),{status:400});};
 if(typeof value!=='string')return fail();
 const m=value.match(/^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);if(!m)return fail();
 const bytes=Buffer.from(m[2],'base64');if(!bytes.length||bytes.length>10*1024*1024||bytes.toString('base64').replace(/=+$/,'')!==m[2].replace(/=+$/,''))return fail();
 const type=m[1].toLowerCase();let valid=false;
 if(type==='png')valid=bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0&&bytes.toString('ascii',bytes.length-8,bytes.length-4)==='IEND';
 else if(type==='jpg'||type==='jpeg')valid=bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
 else if(type==='gif')valid=bytes.length>=14&&/^GIF8[79]a$/.test(bytes.toString('ascii',0,6))&&bytes[bytes.length-1]===59;
 else valid=bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length;
 if(!valid)return fail();return {bytes,extension:type==='jpeg'?'jpg':type};
}
module.exports={decodeImage};
