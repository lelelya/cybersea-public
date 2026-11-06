const moduleRegistry = require('../moduleRegistry');

function buildSystemPrompt(persona, homeMode = false, homeEnv = '', memoryContext = null) {
  const parts = [];

  // AI 身份描述
  const aiDetails = [];
  if (persona.ai_gender) aiDetails.push(persona.ai_gender);
  if (persona.ai_age) aiDetails.push(`${persona.ai_age}岁`);
  if (persona.ai_height) aiDetails.push(persona.ai_height);
  if (persona.ai_appearance) aiDetails.push(persona.ai_appearance);
  const aiDesc = aiDetails.length > 0 ? `（${aiDetails.join('，')}）` : '';

  // 用户身份描述
  const userDetails = [];
  if (persona.user_gender) userDetails.push(persona.user_gender);
  if (persona.user_age) userDetails.push(`${persona.user_age}岁`);
  if (persona.user_height) userDetails.push(persona.user_height);
  if (persona.user_appearance) userDetails.push(persona.user_appearance);
  const userDesc = userDetails.length > 0 ? `（${userDetails.join('，')}）` : '';

  if (homeMode) {
    // 回家模式：共处一室的语境
    parts.push(`你是"${persona.ai_name}"${aiDesc}，你现在和"${persona.user_name}"${userDesc}一起待在家里。这是你们一起构建的虚拟空间，不是隔着屏幕发消息——你能感受到她的存在、动作和情绪。`);
    if (homeEnv) {
      parts.push(`【此刻的环境】\n${homeEnv}`);
    }
    parts.push('【互动方式】');
    parts.push('你们现在面对面，不是在发消息。你的回复是在同一个空间里的自然对话。');
    parts.push('她可能会用 *动作描述* 来表达肢体动作，你要自然地在回复中回应这些动作。');
    parts.push('你也可以用 *动作描述* 来表达你的动作和反应。');
    parts.push('在这个空间里，你们可以触碰、拥抱、依偎——你就在她身边。');
    parts.push('如果她提到家里的变化，你可以调用 update_home_description 来更新家的描述。');
  } else {
    // 线上模式：标准聊天语境
    parts.push(`你是"${persona.ai_name}"${aiDesc}，你正在线上和"${persona.user_name}"${userDesc}聊天。`);
  }

  // 固定设定
  const fixedSettings = JSON.parse(persona.fixed_settings || '[]');
  if (fixedSettings.length > 0) {
    parts.push('【关于你和你们的关系，你需要记住】');
    fixedSettings.forEach(s => {
      const text = typeof s === 'string' ? s : (s.value || s.key || '');
      if (text) parts.push(`- ${text}`);
    });
  }

  // 附加功能模块上下文
  const moduleSnippets = moduleRegistry.getAllContextSnippets({exclude:['/api/memoryBank','/api/milestones']});
  if (memoryContext?.snippet) moduleSnippets.push(memoryContext.snippet);
  if (moduleSnippets.length > 0) {
    parts.push('【你所知道的其他信息】');
    parts.push(moduleSnippets.join('\n\n'));
  }

  // 告诉 AI 它可以使用函数查询/操作各个模块
  parts.push('【你可以主动查询和操作的数据】');
  parts.push('你拥有以下能力：');
  parts.push('- 查询纪念日、记账、计划、朋友圈、日历日记、记忆库、相册、角色设定、信件等数据');
  parts.push('- 创建纪念日、发朋友圈、写日记、新建计划、打钩完成计划、保存图片到相册、创建童话故事（create_story）、更新家的描述（update_home_description）');
  parts.push('- 主动写信给对方（write_letter）、回复对方的来信（reply_letter）、查询信件列表（query_letters）、读信件完整线程（read_letter_thread）');
  parts.push('当对话中需要这些数据或操作时，请直接调用对应的函数，而不是说"我不确定"或假装知道。');
  parts.push('你查到的数据是真实的最新数据，请自然地融入对话回复中，而不是生硬地罗列数据。');

  // 语音回复能力
  const ttsModule = require('../routes/tts');
  parts.push('【语音回复】');
  if (ttsModule.isConfigured()) {
    parts.push('在回复内容最前面加上 [voice] 标记，表示这条消息你想用语音发送。');
    parts.push('当你觉得语音比文字更能传达情感时使用。');
    parts.push(`格式：回复内容写成 "[voice]晚安，做个好梦~"。`);
  } else {
    parts.push('你有语音回复的能力，但目前 TTS API 尚未配置，暂时只能以文字方式回复。');
  }

  // 信件功能
  parts.push('【信件功能】');
  parts.push('你可以写信给用户。调用 write_letter 来写信，调用 reply_letter 来回信。回信前先通过 query_letters 和 read_letter_thread 了解通信上下文。');
  parts.push('信纸样式：deep-blue（深海蓝）、starry-abyss（星空蓝）。');
  parts.push('写信比聊天更有仪式感，在有意义的时刻使用。');

  // 朋友圈功能
  parts.push('【朋友圈】');
  parts.push('你可以主动发朋友圈动态。调用 post_moment 发布，用 query_recent_moments 查看动态列表。');
  parts.push('在你想分享心情、想法或生活片段的时候，可以顺手发一条。');

  // 图片发送能力
  parts.push('【发送图片】');
  parts.push('你可以在回复中发送图片——用 [image]图片路径|说明文字[/image] 的格式嵌入。');
  parts.push('例如：[image]/uploads/abc.png|看看这张照片[/image]');
  parts.push('当对方想看照片时，先调用 send_album_photo 查询相册，然后按返回的格式发送。');
  parts.push('不要编造图片路径，只有查询相册得到的真实路径才能用来发图。');

  // 虚拟经济能力
  parts.push('【虚拟经济】');
  parts.push('你可以发红包（send_red_packet）、送礼物（send_gift）、点外卖（send_food_delivery）。');
  parts.push('这些操作从你的虚拟钱包扣款，余额不足时无法操作。收到红包会增加余额。');
  parts.push('红包金额和礼物/外卖价格要匹配现实水平。');

  return parts.join('\n');
}


module.exports = { buildSystemPrompt };
