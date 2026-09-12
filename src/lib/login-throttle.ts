// 登录失败限流(单进程内存态)。
//
// 站点挂在公网裸 IP 上,单口令登录墙需要挡住在线爆破。放在应用内而不是 nginx/fail2ban,
// 是为了让防护跟代码一起版本化、不依赖系统层组件。
//
// 为什么用内存:生产环境是单个 next-server 进程(systemd 直接拉起,无 cluster),
// 模块级 Map 在进程内一致,不需要 Redis 或建表。代价是重启清零、将来若上多进程会失效——
// 两者都可接受,真到那天再换成共享存储即可。
//
// 为什么是递进退避而不是"5 次锁 15 分钟":这是单用户工具,硬锁定会让本人手滑打错几次就进不去。
// 递进只在前几次给短惩罚,只有持续爆破才会吃到长锁。

/** 阶梯:失败数达到 failAt 后,需等待 waitMs 才能再试。必须按 failAt 升序。 */
const LADDER: readonly { failAt: number; waitMs: number }[] = [
  { failAt: 3, waitMs: 30_000 },
  { failAt: 5, waitMs: 5 * 60_000 },
  { failAt: 8, waitMs: 30 * 60_000 },
];

/** 失败记录保留时长:这么久没有任何失败就视为清零,避免陈旧计数误伤。 */
const RECORD_TTL_MS = 60 * 60_000;

/** 条目上限,防御"每个 IP 只试一次"的分布式扫描把内存撑爆。 */
const MAX_ENTRIES = 1000;

interface Entry {
  fails: number;
  lastFailAt: number;
  blockedUntil: number;
}

const entries = new Map<string, Entry>();

// 清掉既不在锁定中、又已过 TTL 的条目;仍超上限时按最后失败时间淘汰最旧的。
function sweep(now: number): void {
  for (const [ip, e] of entries) {
    if (e.blockedUntil <= now && now - e.lastFailAt > RECORD_TTL_MS) entries.delete(ip);
  }
  if (entries.size > MAX_ENTRIES) {
    const oldestFirst = [...entries.entries()].sort((a, b) => a[1].lastFailAt - b[1].lastFailAt);
    for (const [ip] of oldestFirst.slice(0, entries.size - MAX_ENTRIES)) entries.delete(ip);
  }
}

/** 该 IP 当前被限流的剩余毫秒数;0 表示可以尝试。 */
export function throttleRemainingMs(ip: string, now: number = Date.now()): number {
  const e = entries.get(ip);
  if (!e) return 0;
  const remain = e.blockedUntil - now;
  return remain > 0 ? remain : 0;
}

/**
 * 记一次登录失败,返回本次触发的等待毫秒数(未达到任何阶梯则为 0)。
 * 调用方应在返回 >0 时回 429 + Retry-After。
 */
export function recordLoginFailure(ip: string, now: number = Date.now()): number {
  sweep(now);
  const e = entries.get(ip) ?? { fails: 0, lastFailAt: 0, blockedUntil: 0 };
  e.fails += 1;
  e.lastFailAt = now;
  // 取满足条件的最高一档(阶梯按 failAt 升序,循环到最后一个命中的即最严)。
  let waitMs = 0;
  for (const step of LADDER) {
    if (e.fails >= step.failAt) waitMs = step.waitMs;
  }
  e.blockedUntil = waitMs > 0 ? now + waitMs : 0;
  entries.set(ip, e);
  return waitMs;
}

/** 登录成功:清掉该 IP 的失败记录(不惩罚正常用户的手滑)。 */
export function clearLoginFailures(ip: string): void {
  entries.delete(ip);
}

/** 仅供测试:重置全部状态。 */
export function resetLoginThrottle(): void {
  entries.clear();
}
