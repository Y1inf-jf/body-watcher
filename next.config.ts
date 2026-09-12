import type { NextConfig } from "next";

// 站点可公网访问（当前是裸 IP + HTTP），这里补一组基础安全响应头。
// 刻意没加的两项，理由写在下面：
// - HSTS：现在没有 TLS，发 HSTS 反而可能把浏览器锁在无法访问的状态；等域名备案 + HTTPS 配好再加。
// - CSP：Next 会注入内联 script/style，不带 nonce 就只能写 'unsafe-inline'（防护价值有限）；
//   带 nonce 需要改渲染链路，留作后续独立改动，不在这里半途而废。
const SECURITY_HEADERS = [
  // 禁止被 iframe 嵌套，防点击劫持
  { key: "X-Frame-Options", value: "DENY" },
  // 禁止浏览器按内容猜测 MIME 类型
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 跨站跳转不泄漏完整 URL（避免把可能含参数的路径带给第三方）
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 本应用不使用这些能力，全部关闭（已确认代码中无 getUserMedia / geolocation / payment 调用）
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
