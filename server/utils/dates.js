function dateValid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d=new Date(value+'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===value;
}
function timeValid(value) { return value == null || value === '' || typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validateDates(body, fields, times=[]) {
  for(const field of fields)if(body[field]!==undefined&&body[field]!==null&&body[field]!==''&&!dateValid(body[field]))throw Object.assign(new Error(field+' 必须是有效的 YYYY-MM-DD 日期'),{status:400});
  for(const field of times)if(!timeValid(body[field]))throw Object.assign(new Error(field+' 必须是有效的 HH:mm 时间'),{status:400});
}
function parseTimestamp(value) { return new Date(typeof value==='string'?value.replace(/^(\d{4}-\d{2}-\d{2}) /,'$1T'):value); }
module.exports={dateValid,timeValid,validateDates,parseTimestamp};
