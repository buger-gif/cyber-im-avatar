/**
 * 面板鉴权：本进程 token 先比，DSH 浏览器会话兜底。
 *
 * 为什么不能只看 token：桌面端用 `dsh-app://app/` 加载页面，index 由桌面壳从打包的
 * dist 直接读，宿主启动时通过一次 IPC 把 index-inject 快照交给页面；插件热重载会换掉
 * 模块级 token，但壳不会重取快照，页面刷新也只是把旧 token 再注入一次。DSH 自己的
 * 签名 cookie 由壳在每次转发时带上，热重载 / 宿主重启都不受影响。
 *
 * 边界：调用方已经过回环地址、Host 回环、Origin 同源三道检查；这里再要求
 * token 或 DSH 会话，二者都没有就 401。没有 connection 服务的宿主退回只认 token。
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {string} token 当前进程的随机 token
 * @param {{ requestRejection?: (req: unknown) => number | undefined } | null} connection
 * @returns {"token" | "dsh" | null} 通过时的凭据来源，未通过为 null
 */
export function requestAuthorized(req, token, connection) {
  if (req.headers["x-im-token"] === token) return "token";
  if (!connection || typeof connection.requestRejection !== "function") return null;
  try {
    // requestRejection 只在「完全放行」时返回 undefined；401/403 都算未通过。
    return connection.requestRejection(req) === undefined ? "dsh" : null;
  } catch {
    return null;
  }
}