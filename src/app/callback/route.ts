// Google OAuth 回调的路径别名:Cloud Console 里登记的回调是
// http://localhost:8765/callback(无 /api 前缀),与正式路由 /api/google/callback
// 指向同一处理器。授权时经 SSH 隧道(本地 8765 → 服务器 3000)访问,
// token 照常落到服务器库;详见 AGENTS.md 的隧道说明。
export { GET } from "@/app/api/google/callback/route";
