// /plan 页面共享类型与日期辅助函数。

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSession {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface CoachNote {
  id: number;
  content: string;
  source: string;
  pinned: number;
  expires_at: string | null;
  created_at: string;
}

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// expires_at 是"有效期至",当天仍有效、次日过期(与注入侧 SQL 的 expires_at > now 口径一致)。
export const isExpired = (date: string | null) => date !== null && date < todayStr();

// 会话列表右侧时间标签:当天只显时间,跨年带年份。
export const sessionLabel = (s: ChatSession) => {
  const d = s.updated_at.slice(0, 10);
  const hm = s.updated_at.slice(11, 16);
  if (d === todayStr()) return `今天 ${hm}`;
  return d.slice(0, 5) === todayStr().slice(0, 5) ? d.slice(5) : d;
};
