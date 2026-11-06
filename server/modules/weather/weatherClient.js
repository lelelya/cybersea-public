// server/modules/weather/weatherClient.js
// 封装天气查询。使用 wttr.in（免费、无需API Key，直接传城市名即可查询当天天气），
// 如果用户希望换成其他天气服务商，只改这一个文件。

// 英文天气描述 → 中文映射（wttr.in 偶尔不返回 lang_zh 时的兜底）
const WEATHER_DESC_MAP = {
  'sunny': '晴',
  'clear': '晴',
  'partly cloudy': '多云',
  'cloudy': '阴',
  'overcast': '阴',
  'mist': '薄雾',
  'fog': '雾',
  'freezing fog': '冻雾',
  'patchy rain possible': '局部阵雨',
  'patchy rain nearby': '局部阵雨',
  'patchy light rain': '局部小雨',
  'light rain': '小雨',
  'moderate rain': '中雨',
  'heavy rain': '大雨',
  'torrential rain': '暴雨',
  'patchy light drizzle': '局部毛毛雨',
  'light drizzle': '毛毛雨',
  'patchy snow possible': '局部小雪',
  'patchy snow nearby': '局部小雪',
  'patchy light snow': '局部小雪',
  'light snow': '小雪',
  'moderate snow': '中雪',
  'heavy snow': '大雪',
  'blizzard': '暴风雪',
  'blowing snow': '吹雪',
  'ice pellets': '冰粒',
  'freezing drizzle': '冻毛毛雨',
  'light freezing rain': '小冻雨',
  'moderate or heavy freezing rain': '冻雨',
  'light rain shower': '小阵雨',
  'moderate or heavy rain shower': '大阵雨',
  'thunderstorm': '雷暴',
  'thundery outbreaks possible': '可能有雷暴',
  'light sleet': '小雨夹雪',
  'moderate or heavy sleet': '雨夹雪',
  'haze': '霾',
  'smoke': '烟霾',
  'dust': '扬尘',
  'sand': '沙尘',
  'widespread dust': '大范围扬尘',
};

// 风速 → 中文风力描述
function windDesc(kmph) {
  const k = parseFloat(kmph) || 0;
  if (k <= 12) return '微风';
  if (k <= 28) return '和风';
  if (k <= 38) return '劲风';
  if (k <= 49) return '强风';
  return '大风';
}

// 将英文天气描述转为中文
function toChineseDesc(raw) {
  if (!raw) return '未知天气';
  const lower = raw.toLowerCase().trim();
  return WEATHER_DESC_MAP[lower] || raw;
}

// 根据中文天气描述判断天气类型 → 前端选图标用
function classifyType(desc) {
  if (!desc) return 'cloudy';
  if (desc.includes('雷')) return 'thunderstorm';
  if (desc.includes('雨') || desc.includes('阵雨') || desc.includes('毛毛雨')) return 'rainy';
  if (desc.includes('雪') || desc.includes('冰')) return 'snowy';
  if (desc.includes('霾') || desc.includes('雾') || desc.includes('尘') || desc.includes('烟') || desc.includes('沙')) return 'haze';
  if (desc.includes('晴')) return 'sunny';
  if (desc.includes('云')) return 'cloudy';
  if (desc.includes('阴')) return 'overcast';
  return 'cloudy';
}

/**
 * 查询某个城市当天的天气概况，返回结构化数据供前端排版。
 * @param {string} city
 * @returns {Promise<{text:string, type:string, desc:string, temp:string, wind:string}>}
 */
async function fetchTodayWeather(city) {
  if (!city) throw new Error('尚未设置城市');

  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'curl' } });
  if (!resp.ok) {
    throw new Error(`天气查询失败 (${resp.status})`);
  }
  const data = await resp.json();

  const current = data.current_condition?.[0];
  const today = data.weather?.[0];
  if (!current || !today) {
    throw new Error('天气数据格式异常');
  }

  // 优先用 wttr.in 自带的中文描述，没有则从英文映射
  const rawDesc = current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || '未知天气';
  const desc = toChineseDesc(rawDesc);
  const maxTemp = today.maxtempC;
  const minTemp = today.mintempC;
  const wind = windDesc(current.windspeedKmph);
  const type = classifyType(desc);

  return {
    text: `${desc} · ${minTemp}~${maxTemp}℃ · ${wind}`,
    type: type,
    desc: desc,
    temp: `${minTemp} ~ ${maxTemp}℃`,
    wind: wind,
  };
}

module.exports = { fetchTodayWeather };
