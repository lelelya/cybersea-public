function validatePost(body = {}) {
  if (typeof body.content !== 'string' || !body.content.trim()) {
    throw Object.assign(new Error('动态内容不能为空'), {status:400});
  }
  const images = body.images === undefined ? [] : body.images;
  if (!Array.isArray(images) || images.length > 9 || images.some(p => typeof p !== 'string' || !p.trim())) {
    throw Object.assign(new Error('图片必须是最多 9 个地址组成的数组'), {status:400});
  }
  return {content:body.content.trim(), images:images.map(p => p.trim())};
}
module.exports = {validatePost};
