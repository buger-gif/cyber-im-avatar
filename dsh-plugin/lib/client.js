window.__ModuleLoader__.load({
	id: "dsh-cyber-im-avatar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

/* ===== inline web/panel.js (source of truth, do not edit this block) ===== */
/* panel.js — IM 值守面板（原生 DOM，无构建、无外部依赖）
 *
 * 数据只走 DSH 自己的 Web 服务：同源前缀 /plugins/im-standin，由插件宿主半
 * 转给进程内后端。插件不在本机开端口，所以这里也没有任何 127.0.0.1:xxxx。
 *
 * 宿主会注入 window.IM_STANDIN_API / window.IM_STANDIN_TOKEN（见 lib/index.js）。
 */
(function () {
  "use strict";

  var API = (typeof window !== "undefined" && window.IM_STANDIN_API) || "/plugins/im-standin";
  var PLAT = {
    feishu: { label: "飞书", short: "飞", color: "#4176e6" },
    wecom: { label: "企业微信", short: "企", color: "#22c55e" },
    dingtalk: { label: "钉钉", short: "钉", color: "#1890FF" }
  };
  var KIND = {
    dm: { label: "私聊", color: "var(--dsw-alias-state-business-primary,#4176e6)" },
    mention: { label: "@我", color: "var(--dsw-alias-state-warn-primary,#f59e0b)" },
    service: { label: "客服", color: "var(--dsw-alias-state-success-primary,#22c55e)" },
    fyi: { label: "知会", color: "var(--dsw-alias-label-tertiary,#81858c)" },
    out: { label: "已发", color: "var(--dsw-alias-label-tertiary,#81858c)" }
  };
  var MEDIA_LABEL = {
    image: "[图片]", file: "[文件]", audio: "[语音]", voice: "[语音]",
    media: "[视频]", video: "[视频]", sticker: "[表情]", post: "[富文本]",
    interactive: "[卡片]", share_chat: "[群名片]", share_user: "[个人名片]",
    system: "[系统消息]", merge_forward: "[合并转发]", location: "[位置]"
  };

  var SVG = {
    inbox: "M3 7.5 12 3l9 4.5v9L12 21 3 16.5v-9Zm0 0 9 4.5 9-4.5M12 12v9",
    headset: "M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1v-5Zm16 0h-3v6h2a1 1 0 0 0 1-1v-5Z",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 8a8 8 0 0 1 16 0",
    pulse: "M3 12h4l2-6 3 12 2.5-6H21",
    gear: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5a8 8 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a8 8 0 0 0-2-1.2L15.2 3h-4l-.4 2.7a8 8 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a8 8 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 2 1.2L11.2 21h4l.4-2.7a8 8 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z",
    search: "M20 20l-4.2-4.2M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z",
    users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-7 9a7 7 0 0 1 14 0M17 7.5a3 3 0 0 1 0 6M18 20a6 6 0 0 0-2-4.5",
    sync: "M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4",
    pause: "M9 5v14M15 5v14",
    play: "M8 5l11 7-11 7V5Z",
    back: "M15 5l-7 7 7 7",
    chev: "M6 9.5l6 6 6-6",
    send: "M4 12l16-8-6 16-3-6-7-2Z",
    spark: "M12 3v4m0 10v4M5 12H1m22 0h-4M6.3 6.3 3.5 3.5m17 17-2.8-2.8m0-11.4 2.8-2.8m-17 17 2.8-2.8M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
    plus: "M12 5v14M5 12h14",
    trash: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13",
    note: "M6 3h9l4 4v14H6V3Zm9 0v4h4M9 12h7M9 16h5",
    bell: "M12 3a5 5 0 0 0-5 5v4l-2 3h14l-2-3V8a5 5 0 0 0-5-5Zm-2 15a2 2 0 0 0 4 0",
    mute: "M12 3a5 5 0 0 0-5 5v4l-2 3h14l-2-3V8a5 5 0 0 0-5-5Zm-2 15a2 2 0 0 0 4 0M3.5 3.5l17 17",
    check: "M4 12l5 5L20 6",
    bot: "M12 3v3m-6 3h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Zm3 5v3m6-3v3",
    keyboard: "M3 8h18v9H3V8Zm3 3h.01M9 11h.01M12 11h.01M15 11h.01M18 11h.01M7 14h10"
  };

  function icon(name, size) {
    var d = SVG[name] || SVG.note;
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="' + d + '"/></svg>';
  }

  var CSS = [
    /* ---- 底座：颜色全部取 DSH 自己的语义 token（--dsw-alias-*）----
       宿主没注入 token（独立预览页、老版本 DSH）时，回退到 DSH 浅色调色板。
       深色不另配一套色，仍指向同一批 token，只换 fallback。 */
    ".ims-root{--bg:var(--dsw-alias-bg-base,#fff);--panel:var(--dsw-alias-bg-layer-1,#fff);",
    "--fg:var(--dsw-alias-label-primary,#0f1115);--fg2:var(--dsw-alias-label-secondary,#61666b);--fg3:var(--dsw-alias-label-tertiary,#81858c);",
    "--line:var(--dsw-alias-border-l2,rgba(0,0,0,.1));--line2:var(--dsw-alias-border-l3,rgba(0,0,0,.12));",
    "--hover:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));--sunk:var(--dsw-specific-sidebar-nav-item-hover,#f1f3f5);",
    "--accent:var(--dsw-alias-brand-primary,#0f1115);--on-accent:var(--dsw-alias-label-primary-foreground,#fff);",
    "--accent-hover:var(--dsw-alias-button-primary-hover,#43454a);",
    "--blue:var(--dsw-alias-state-business-primary,#4176e6);",
    "--danger:var(--dsw-alias-state-error-primary,#ec1313);--warn:var(--dsw-alias-state-warn-primary,#f59e0b);--ok:var(--dsw-alias-state-success-primary,#22c55e);",
    "--r:var(--dsw-radius-md,12px);--r-sm:var(--dsw-radius-sm,8px);",
    "--mono:var(--dsh-font-family-code-default,ui-monospace,SFMono-Regular,Menlo,monospace);",
    "--font:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',system-ui,sans-serif);",
    "--rowgap:9px;--pad:16px;font:13px/1.55 var(--font);color:var(--fg);-webkit-font-smoothing:antialiased}",
    ".ims-root *{box-sizing:border-box}",
    ".ims-root button{font:inherit;color:inherit}",
    ".ims-ico{display:inline-flex;align-items:center;justify-content:center;line-height:0}",

    /* 席位 */
    ".ims-seat{display:flex;align-items:center;gap:9px;width:100%;height:38px;padding:0 10px;border:0;border-radius:var(--r-sm);",
    "background:transparent;color:var(--fg2);font:inherit;cursor:pointer;overflow:hidden;text-align:left}",
    ".ims-seat:hover{background:var(--hover);color:var(--fg)}",
    ".ims-seat-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 18%,transparent)}",
    ".ims-seat-dot.off{background:var(--fg3);box-shadow:none}",
    ".ims-seat-dot.warn{background:var(--warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 20%,transparent)}",
    ".ims-seat-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".ims-seat-badge{flex:none;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--danger);",
    "color:#fff;font-size:11px;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}",

    /* 面板：CSS Grid 摆位，页签在上 */
    /* 面板：只以右侧栏停靠形态存在，铺满标签页宿主 */
    ".ims-panel{height:100%;min-height:0;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr) auto;",
    "grid-template-areas:'head' 'tabs' 'body' 'foot';background:var(--panel);overflow:hidden}",
    ".ims-foot{grid-area:foot;display:flex;align-items:center;gap:8px;padding:7px var(--pad);border-top:1px solid var(--line);",
    "font-size:11px;color:var(--fg3);background:var(--sunk);flex-wrap:wrap;min-width:0}",
    ".ims-head{grid-area:head;display:flex;align-items:center;gap:10px;padding:12px var(--pad);border-bottom:1px solid var(--line);flex:none;min-width:0}",
    ".ims-tabs{grid-area:tabs;display:flex;gap:2px;padding:8px 10px 0;flex:none;border-bottom:1px solid var(--line);overflow:auto;min-width:0}",
    ".ims-body{grid-area:body;min-height:0;min-width:0;width:100%;display:flex;flex-direction:column}",
    ".ims-title{font-size:13.5px;font-weight:650;display:flex;align-items:center;gap:8px;letter-spacing:.01em}",
    ".ims-sub{font-size:11px;color:var(--fg3);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:56ch}",
    ".ims-grow{flex:1;min-width:0}",

    /* 按钮 / 控件 */
    ".ims-btn{appearance:none;border:1px solid var(--line2);background:transparent;color:var(--fg2);font:inherit;",
    "font-size:12px;padding:5px 10px;border-radius:var(--r-sm);cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}",
    ".ims-btn:hover{background:var(--hover);color:var(--fg)}",
    ".ims-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}",
    ".ims-btn.primary:hover{background:var(--accent-hover);border-color:var(--accent-hover);color:var(--on-accent);filter:none}",
    ".ims-btn.ghost{border-color:transparent}",
    ".ims-btn.danger{color:var(--danger)}",
    ".ims-btn.mini{padding:2px 7px;font-size:11px}",
    ".ims-btn:disabled{opacity:.45;cursor:default}",
    ".ims-tab{display:flex;align-items:center;gap:8px;padding:7px 11px;border-radius:var(--r-sm);font-size:12.5px;",
    "color:var(--fg3);cursor:pointer;border:0;background:transparent;white-space:nowrap}",
    ".ims-tab:hover{color:var(--fg);background:var(--hover)}",
    ".ims-tab.on{background:var(--sunk);color:var(--fg);font-weight:620}",
    ".ims-tab .ims-num{margin-left:auto;font-size:11px;color:var(--on-accent);background:var(--danger);border-radius:8px;padding:0 5px}",
    ".ims-tab.on .ims-ico{color:var(--accent)}",
    ".ims-inp{flex:1;min-width:0;height:30px;border:1px solid var(--line2);border-radius:var(--r-sm);padding:0 9px;",
    "font:inherit;font-size:12.5px;color:var(--fg);background:var(--bg);outline:none}",
    ".ims-inp:focus{border-color:var(--blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 20%,transparent)}",
    /* 数字框不参与 flex 收缩：320 / 360 下也保持 92px，放不下由 .ims-rowline 换行 */
    ".ims-inp.ims-num{flex:0 0 92px;width:92px;min-width:92px;max-width:92px;text-align:right}",
    /* 标签与输入框成组换行：窄侧栏放不下时整组掉到下一行，不拆散配对 */
    ".ims-field{display:inline-flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0}",
    ".ims-select{height:30px;max-width:230px;border:1px solid var(--line2);border-radius:var(--r-sm);background:var(--bg);",
    "color:var(--fg);font:inherit;font-size:12px;padding:0 6px;outline:none;cursor:pointer}",
    ".ims-select:focus{border-color:var(--blue)}",
    ".ims-ta{width:100%;min-height:70px;max-height:180px;resize:vertical;border:1px solid var(--line2);border-radius:var(--r);",
    "padding:9px 11px;font:inherit;font-size:12.5px;line-height:1.6;color:var(--fg);background:var(--bg);outline:none}",
    ".ims-ta:focus{border-color:var(--blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 18%,transparent)}",
    ".ims-switch{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--fg2);cursor:pointer;user-select:none;white-space:nowrap}",
    ".ims-switch input{accent-color:var(--accent);margin:0}",
    ".ims-switch.hot input{accent-color:var(--warn)}",
    ".ims-switch.hot:has(input:checked){color:var(--warn);font-weight:600}",

    /* 收件箱 */
    ".ims-filters{display:flex;gap:6px;padding:10px var(--pad) 6px;flex:none;flex-wrap:wrap;align-items:center}",
    ".ims-chip{padding:3.5px 10px;border-radius:999px;border:1px solid var(--line);background:transparent;",
    "color:var(--fg3);font-size:11.5px;cursor:pointer;white-space:nowrap}",
    ".ims-chip:hover{color:var(--fg);border-color:var(--line2)}",
    ".ims-chip.on{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,transparent);font-weight:600}",
    ".ims-list{flex:1;overflow-y:auto;overflow-x:hidden;min-width:0;padding:2px 8px 12px}",
    ".ims-row{display:flex;gap:10px;padding:var(--rowgap) 10px;border-radius:var(--r-sm);cursor:pointer;align-items:flex-start;min-width:0}",
    ".ims-row:hover{background:var(--hover)}",
    ".ims-row:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}",
    ".ims-pdot{width:26px;height:26px;border-radius:var(--r-sm);flex:none;font-size:11.5px;display:flex;align-items:center;",
    "justify-content:center;font-weight:650;letter-spacing:.02em;background:color-mix(in srgb,var(--pc,var(--fg3)) 16%,transparent);color:var(--pc,var(--fg2))}",
    ".ims-row-main{flex:1;min-width:0}",
    ".ims-row-top{display:flex;align-items:center;gap:6px;min-width:0}",
    ".ims-name{font-size:12.8px;font-weight:620;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:26ch;flex:0 0 auto}",
    ".ims-row-sub{display:flex;align-items:center;gap:6px;min-width:0;margin-top:2px}",
    ".ims-snippet{font-size:12px;color:var(--fg3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;margin-top:0}",
    ".ims-row-side{flex:none;text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px}",
    ".ims-time{font-size:11px;color:var(--fg3);font-variant-numeric:tabular-nums}",
    ".ims-gcount{font-size:10.5px;font-weight:650;line-height:15px;padding:1px 6px;border-radius:9px;flex:none;letter-spacing:.02em;",
    "color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent)}",
    ".ims-caret{width:18px;height:18px;border-radius:5px;border:1px solid var(--line);background:transparent;color:var(--fg2);",
    "display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none;padding:0;line-height:1;font-size:9px}",
    ".ims-caret:hover{color:var(--fg);border-color:var(--line2)}",
    /* 屏蔽按钮：默认低调，悬停才红——避免手滑，也别抢了行点击 */
    ".ims-mute{width:20px;height:20px;border-radius:5px;border:1px solid transparent;background:transparent;color:var(--fg3);",
    "display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex:none;opacity:.55}",
    ".ims-row:hover .ims-mute,.ims-mute:focus-visible{opacity:1}",
    ".ims-mute:hover{color:var(--danger);border-color:var(--line2);background:var(--bg)}",
    ".ims-pv{margin:5px 0 2px;padding:4px 0 1px 11px;border-left:2px solid var(--line);display:flex;flex-direction:column;gap:5px}",
    ".ims-pv-item{font-size:11.6px;color:var(--fg2);line-height:1.55}",
    ".ims-pv-meta{color:var(--fg3);font-size:10.5px;margin-right:5px;font-variant-numeric:tabular-nums}",
    ".ims-tag{font-size:10px;padding:1px 6px;border-radius:5px;border:1px solid currentColor;line-height:15px;flex:none}",
    ".ims-unread{width:6px;height:6px;border-radius:50%;background:var(--danger);flex:none}",
    ".ims-empty{padding:38px 22px;text-align:center;color:var(--fg3);font-size:12px;line-height:1.9}",
    ".ims-empty .ims-ico{opacity:.5;margin-bottom:6px}",

    /* 会话详情 */
    ".ims-detail{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0}",
    ".ims-dhead{display:flex;align-items:center;gap:8px;padding:9px var(--pad);border-bottom:1px solid var(--line);flex:none;flex-wrap:wrap;min-width:0}",
    ".ims-thread{flex:1;overflow-y:auto;padding:14px var(--pad);display:flex;flex-direction:column;gap:9px;background:var(--bg)}",
    ".ims-msg{max-width:76%;padding:8px 11px;border-radius:var(--r);background:var(--panel);border:1px solid var(--line);",
    "white-space:pre-wrap;word-break:break-word;font-size:12.6px;line-height:1.62}",
    ".ims-msg.me{align-self:flex-end;background:var(--dsw-specific-bubble,#edf3fe);border-color:var(--dsw-specific-bubble-highlight,#d3e2ff)}",
    ".ims-msg-meta{font-size:10.5px;color:var(--fg3);margin-bottom:3px}",
    ".ims-link{color:var(--blue);text-decoration:none;margin-left:6px}",
    ".ims-link:hover{text-decoration:underline}",
    ".ims-compose{flex:none;border-top:1px solid var(--line);padding:10px var(--pad) 12px;display:flex;flex-direction:column;gap:8px}",
    ".ims-rowline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}",
    ".ims-found{padding:6px 0;border-top:1px solid var(--line)}",
    ".ims-found:first-child{border-top:0;padding-top:2px}",
    ".ims-hint{font-size:11px;color:var(--fg3)}",
    ".ims-warnchip{font-size:11px;color:var(--warn);border:1px solid currentColor;border-radius:5px;padding:1px 6px}",
    ".ims-draftchip{font-size:10.5px;color:var(--blue);background:color-mix(in oklab,var(--blue) 12%,transparent);border-radius:4px;",
    "padding:1px 5px;flex:none;letter-spacing:.02em}",
    ".ims-banner{display:flex;align-items:center;gap:8px;padding:7px var(--pad);font-size:11.5px;color:var(--fg2);",
    "background:var(--sunk);border-bottom:1px solid var(--line);min-width:0;flex-wrap:wrap}",
    ".ims-banner.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 10%,transparent)}",
    ".ims-card{border:1px solid var(--line);border-radius:var(--r);padding:11px 13px;margin:9px var(--pad);display:flex;flex-direction:column;gap:8px;background:var(--bg)}",
    ".ims-card-h{display:flex;align-items:center;gap:8px;font-size:12.6px;font-weight:640;min-width:0;flex-wrap:wrap}",
    ".ims-kv{display:flex;justify-content:space-between;gap:12px;font-size:11.5px;color:var(--fg3);min-width:0}",
    ".ims-kv>span:first-child{flex:none}",
    ".ims-kv>span:last-child{min-width:0;text-align:right}",
    ".ims-kv b{color:var(--fg2);font-weight:560}",
    ".ims-dot{width:7px;height:7px;border-radius:50%;flex:none}",
    ".ims-scroll{flex:1;overflow-y:auto;min-width:0;padding-bottom:14px}",
    ".ims-code{font-family:var(--mono);font-size:11px;color:var(--fg2);background:var(--sunk);border-radius:var(--r-sm);",
    "padding:9px;max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-word}",
    ".ims-err{color:var(--danger)}",
    ".ims-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:78px;background:var(--dsw-alias-toast-bg,#353638);",
    "color:var(--dsw-alias-toast-label,#fff);font-size:12px;padding:7px 14px;border-radius:999px;opacity:0;transition:opacity .18s;pointer-events:none;z-index:10000}",
    ".ims-toast.show{opacity:1}",

    /* 服务对象 / 习惯 */
    ".ims-avatar{width:34px;height:34px;border-radius:var(--r-sm);flex:none;display:flex;align-items:center;",
    "justify-content:center;font-weight:650;font-size:13px;background:color-mix(in srgb,var(--pc,var(--fg3)) 16%,transparent);color:var(--pc,var(--fg2))}",
    ".ims-notes{display:flex;flex-direction:column;gap:6px;margin-top:2px}",
    ".ims-profile{border:1px solid var(--line);border-radius:var(--r-sm);background:var(--sunk);padding:9px 11px;",
    "font-size:12px;line-height:1.68;color:var(--fg2);max-height:320px;overflow:auto;word-break:break-word}",
    ".ims-profile h3,.ims-profile h4,.ims-profile h5,.ims-profile h6{margin:9px 0 3px;color:var(--fg);font-size:12.5px;line-height:1.4}",
    ".ims-profile h3:first-child,.ims-profile h4:first-child,.ims-profile h5:first-child,.ims-profile h6:first-child{margin-top:0}",
    ".ims-profile p{margin:3px 0}",
    ".ims-md-li{margin:2px 0;padding-left:2px}",
    ".ims-md-quote{color:var(--fg3);font-size:11.5px;margin:3px 0}",
    ".ims-profile code{font-family:var(--mono);font-size:11px;background:var(--bg);border-radius:4px;padding:0 3px}",
    ".ims-note{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--fg2);line-height:1.6;",
    "padding:7px 9px;border-radius:var(--r-sm);background:var(--sunk)}",
    ".ims-note-at{font-size:10.5px;color:var(--fg3);font-variant-numeric:tabular-nums;flex:none;padding-top:2px;min-width:52px}",
    ".ims-note-body{flex:1;min-width:0}",
    ".ims-note-del{opacity:0;border:0;background:transparent;color:var(--fg3);cursor:pointer;padding:0 2px;line-height:0}",
    ".ims-note:hover .ims-note-del{opacity:1}",
    ".ims-note-del:hover{color:var(--danger)}",
    ".ims-wschip{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--fg2);background:var(--sunk);",
    "border-radius:6px;padding:2px 7px;max-width:230px;min-width:0;overflow:hidden;white-space:nowrap;flex:0 1 auto}",
    ".ims-wschip-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
    ".ims-wschip.unset{color:var(--fg3);font-style:italic}",
    ".ims-section{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--fg3);padding:14px var(--pad) 2px;font-weight:600}",
    ".ims-habits{display:flex;gap:6px;padding:7px var(--pad);border-bottom:1px solid var(--line);flex-wrap:wrap;align-items:center;background:var(--sunk)}",
    ".ims-habitchip{font-size:11px;color:var(--fg2);background:var(--bg);border:1px solid var(--line);border-radius:999px;",
    "padding:2px 9px;max-width:42ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    /* 深色：直接跟随 DSH 自己的主题解析结果。
       body[data-ds-dark-theme] 由 DSH ThemePresenter 在解析结果为深色时写入（含
       「跟随系统」解析成深色）；html[data-ds-theme-source=dark] 是固定深色主题的
       镜像，老版本缺 body 标记时兜底。CSS 祖先选择器随 DSH 切换主题即时生效，
       不需要刷新，也不需要 JS 监听。 */
    "body[data-ds-dark-theme] .ims-root,html[data-ds-theme-source=dark] .ims-root{",
    "--bg:var(--dsw-alias-bg-base,#151517);--panel:var(--dsw-alias-bg-layer-1,#232324);",
    "--fg:var(--dsw-alias-label-primary,#f9fafb);--fg2:var(--dsw-alias-label-secondary,#cfd3d6);--fg3:var(--dsw-alias-label-tertiary,#adb2b8);",
    "--line:var(--dsw-alias-border-l2,rgba(255,255,255,.12));--line2:var(--dsw-alias-border-l3,rgba(255,255,255,.16));",
    "--hover:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));--sunk:var(--dsw-specific-sidebar-nav-item-hover,#2c2c2e);",
    "--accent:var(--dsw-alias-brand-primary,#f9fafb);--on-accent:var(--dsw-alias-label-primary-foreground,#0f1115);",
    "--accent-hover:var(--dsw-alias-button-primary-hover,#ebeef2);",
    "--blue:var(--dsw-alias-state-business-primary,#5686fe);",
    "--danger:var(--dsw-alias-state-error-primary,#f25a5a);--warn:var(--dsw-alias-state-warn-primary,#f59e0b);--ok:var(--dsw-alias-state-success-primary,#22c55e);color-scheme:dark}",

    /* 席位独立挂载：只渲染角标与未读数，面板本体在右侧栏 */
    ".ims-root[data-mode=seat]{display:block;width:100%}",

    /* 右侧栏停靠：不浮、不遮、占满宿主 */
    ".ims-host{min-height:0}",
    ".ims-host-dock{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}",
    ".ims-root[data-mode=dock]{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--panel);--pad:12px}",
    ".ims-root[data-mode=dock] .ims-head{padding:8px 10px;gap:4px;border-bottom:1px solid var(--line)}",
    ".ims-root[data-mode=dock] .ims-title{font-size:13px}",
    ".ims-root[data-mode=dock] .ims-sub{font-size:10.5px;max-width:100%}",
    ".ims-root[data-mode=dock] .ims-btn-label{display:none}",
    ".ims-root[data-mode=dock] .ims-head .ims-btn{padding:5px 7px;gap:0}",
    ".ims-root[data-mode=dock] .ims-tabs{padding:5px 6px 0;gap:1px;overflow-x:auto;scrollbar-width:none}",
    ".ims-root[data-mode=dock] .ims-tab{padding:6px 7px;font-size:11.5px;gap:5px}",
    ".ims-root[data-mode=dock] .ims-tab .ims-ico svg{width:13px;height:13px}",
    ".ims-root[data-mode=dock] .ims-foot{padding:5px 9px;font-size:10px;gap:5px}",
    ".ims-root[data-mode=dock] .ims-toast{left:50%;bottom:16px;max-width:calc(100% - 20px)}"
  ].join("\n");

  function injectCss() {
    if (typeof document === "undefined") return;
    if (document.querySelector('style[data-plugin-css="im-standin"]')) return;
    var s = document.createElement("style");
    s.dataset.pluginCss = "im-standin";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k === "style") e.setAttribute("style", attrs[k]);
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false || c === "") continue;
      if (Array.isArray(c)) {
        for (var j = 0; j < c.length; j++) {
          var cj = c[j];
          if (cj === null || cj === undefined || cj === false || cj === "") continue;
          e.appendChild(typeof cj === "string" || typeof cj === "number" ? document.createTextNode(String(cj)) : cj);
        }
        continue;
      }
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    return e;
  }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || (opts.body ? "POST" : "GET"), headers: {} };
    if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    // 宿主每进程生成一个随机 token，注入到 index 里。没有它后端一律 401，
    // 免得同机别的页面顺着路径瞎试。拿不到说明页面还没刷新过新版。
    var tk = (typeof window !== "undefined" && window.IM_STANDIN_TOKEN) || "";
    if (tk) init.headers["x-im-token"] = tk;
    return fetch(API + path, init).then(function (r) {
      if (r.status === 401) {
        // DSH 重启后 token 会换，老页面还拿着旧值。自动刷一次把新 token 带进来；
        // 加个计数，避免 token 真对不上时无限刷新。
        try {
          var key = "ims_tok_reload";
          var n = parseInt(sessionStorage.getItem(key) || "0", 10);
          if (n < 1) {
            sessionStorage.setItem(key, String(n + 1));
            location.reload();
          }
        } catch (e) { /* 无痕模式等拿不到 sessionStorage，就只提示 */ }
        return { error: "会话凭据过期，刷新一下页面（⌘R）再试", auth: true };
      }
      try { sessionStorage.removeItem("ims_tok_reload"); } catch (e) { /* ignore */ }
      return r.json();
    });
  }

  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(ts * 1000), now = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    if (d.toDateString() === now.toDateString()) return pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
  }

  function todayStr() {
    var d = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /** 「3.2 小时前 / 2 天前」：只给日报的陈旧提示用，不参与别的读数。 */
  function relAge(ts) {
    if (!ts) return "";
    var h = (Date.now() / 1000 - ts) / 3600;
    if (h < 1) return Math.max(1, Math.round(h * 60)) + " 分钟前";
    if (h < 48) return (Math.round(h * 10) / 10) + " 小时前";
    return Math.round(h / 24) + " 天前";
  }

  function baseName(p) {
    if (!p) return "";
    var parts = String(p).replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || p;
  }

  // 「上次选的工作区」只存在浏览器本地：换 DSH 进程/升级插件都不影响，
  // 也不会把路径写进面板配置。拿不到 localStorage（无痕模式）就退化为自动推断。
  var WS_MEM_KEY = "ims_add_workspace";
  function readWsMemory() {
    try { return (window.localStorage && window.localStorage.getItem(WS_MEM_KEY)) || ""; }
    catch (e) { return ""; }
  }
  function writeWsMemory(v) {
    if (!v) return;
    try { if (window.localStorage) window.localStorage.setItem(WS_MEM_KEY, v); }
    catch (e) { /* ignore */ }
  }

  /**
   * 右侧栏面板：只以停靠形态存在。宿主给一块高度，面板铺满；
   * 不再提供居中浮层、遮罩或关闭按钮——退出面板就是切走右侧栏标签页。
   */
  function mountPanel(host) {
    injectCss();
    var S = {
      tab: "inbox", filter: "todo", items: [], counts: {}, status: null,
      inboxChats: 0, inboxTotal: 0, grouped: true, expanded: {},
      inboxLoaded: false, chatsLoaded: false, targetsLoaded: false,
      connError: null,
      detail: null, thread: [], threadOffline: false, threadError: "", sending: false,
      chats: [], targets: [], workspaces: [], doctor: null, cfg: null,
      search: { q: "", platform: "feishu", items: null, err: "", seq: 0,
                wc: { name: "", id: "", kind: "group" } },
      composerDrafts: {}, pollDraft: {},
      addWs: readWsMemory(), addWsPicked: false, detailWs: "", wsPicked: false,
      targetEdit: "", targetDrafts: {}, dead: false, timer: null,
      digest: null, digestDate: ""
    };

    var toastTimer = null;
    var panel = h("div", { class: "ims-panel" });
    var toast = h("div", { class: "ims-toast" });
    var root = h("div", { class: "ims-root", "data-mode": "dock" }, panel, toast);
    host.appendChild(root);

    // 键盘：Esc 从会话详情退回列表，⌘/Ctrl+Enter 直接发送当前草稿
    function onKey(e) {
      if (S.dead) return;
      if (e.key === "Escape") {
        if (S.targetEdit) { S.targetEdit = ""; paintBody(); return; }
        if (S.detail) { S.detail = null; paint(); }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && S.detail && S._sendBtn) {
        e.preventDefault();
        S._sendBtn.click();
      }
    }
    document.addEventListener("keydown", onKey);

    function say(msg) {
      toast.textContent = msg;
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2600);
    }

    // 手动拉一轮：不受 10 分钟间隔限制，拉完再把结果说出来
    function syncNow(btn) {
      var t0 = Date.now();
      if (btn) btn.disabled = true;
      say("正在拉取…");
      api("/api/poll", { method: "POST", body: {} }).then(function (r) {
        if (r && r.busy) {
          if (btn) btn.disabled = false;
          return say("上一轮还没跑完，等它结束");
        }
        var tries = 0;
        (function check() {
          tries++;
          loadStatus().then(function () {
            var lr = ((S.status || {}).poll || {}).last_result || {};
            if (lr.at && lr.at * 1000 >= t0 - 1500) {
              if (btn) btn.disabled = false;
              say("已拉 " + (lr.chats || 0) + " 个会话 · 新 " + (lr.new || 0) + " 条" +
                (lr.skipped ? " · 跳过 " + lr.skipped + " 个（刚拉过）" : ""));
              loadInbox(); loadChats();
              return;
            }
            if (tries > 40) {
              if (btn) btn.disabled = false;
              say("还在拉，稍后看列表就好");
              return;
            }
            setTimeout(check, 1000);
          });
        })();
      }).catch(function () {
        if (btn) btn.disabled = false;
        say("拉取失败：本地服务没响应");
      });
    }

    function refreshFoot() {
      var of = panel.querySelector(".ims-foot");
      if (of) of.replaceWith(foot());
    }

    // ---- 数据 -----------------------------------------------------------
    // 连接错误只有一个状态：哪个加载器失败就把它和重试入口记在这里，
    // 对应的加载器成功后再清掉。失败时绝不覆盖旧数据，空态只在成功且 0 条时出现。
    function shortReason(e) {
      var s = (e && typeof e === "object")
        ? (e.error || e.message || e.reason || "")
        : (e == null ? "" : e);
      s = String(s || "").replace(/\s+/g, " ").trim();
      return s ? s.slice(0, 80) : "请求失败";
    }
    function setConnError(by, e, retry) {
      var msg = (e && typeof e === "object") ? (e.error || e.message || e.reason || "") : e;
      var auth = !!(e && typeof e === "object" &&
        (e.auth || /会话凭据过期/.test(String(msg || ""))));
      S.connError = {
        by: by,
        text: auth ? "会话凭据过期，刷新页面（⌘R）" : ("本地服务连不上：" + shortReason(msg)),
        auth: auth,
        retry: retry || null
      };
    }
    function clearConnError(by) {
      if (S.connError && S.connError.by === by) S.connError = null;
    }

    function shareCounts() {
      try {
        window.dispatchEvent(new CustomEvent("im-standin:counts", { detail: S.counts || {} }));
      } catch (e) { /* 老浏览器不支持 CustomEvent 构造时忽略 */ }
    }
    function loadStatus() {
      return api("/api/status").then(function (d) {
        if (S.dead) return;
        if (!d || d.error) {
          setConnError("status", d || "状态为空", loadStatus);
          shareCounts();
          refreshFoot();
          paintBody();
          return;
        }
        S.status = d; S.counts = d.counts || {}; S.cfg = d.config || S.cfg;
        clearConnError("status");
        shareCounts();
        refreshFoot();
        if (S.tab === "status" || S.tab === "settings" || S.tab === "service") paintBody();
        if (S.tab === "inbox" && !S.detail) paintBody();
      }).catch(function (e) {
        if (S.dead) return;
        setConnError("status", e, loadStatus);
        refreshFoot();
        paintBody();
      });
    }
    // 日报只由 agent 写；这里只读文件，不解析、不统计。
    function loadDigest(date) {
      var d = date || S.digestDate || todayStr();
      S.digestDate = d;
      return api("/api/digest?date=" + encodeURIComponent(d)).then(function (r) {
        if (S.dead) return;
        if (!r || (r.ok === false && r.reason !== "bad_date")) {
          S.digest = { exists: false, error: "unreachable" };
        } else {
          S.digest = (r && r.ok === false) ? { exists: false, error: r.reason || "" } : (r || {});
        }
        if (S.tab === "attention") paintBody();
      }).catch(function () {
        if (S.dead) return;
        S.digest = { exists: false, error: "unreachable" };
        if (S.tab === "attention") paintBody();
      });
    }
    function loadInbox() {      // 默认拿聚合视图：一个人 / 一个群一行，同一人的连发不会再刷满列表。
      return api("/api/inbox?filter=" + encodeURIComponent(S.filter) + "&limit=40").then(function (d) {
        if (S.dead) return;
        if (!d || d.error) {
          setConnError("inbox", d || "收件箱为空", loadInbox);
          if (S.tab === "inbox" && !S.detail) paintBody();
          return;
        }
        S.items = d.items || [];
        S.counts = d.counts || S.counts;
        S.grouped = d.grouped !== false;
        S.inboxChats = d.chats || 0;
        S.inboxTotal = d.total || 0;
        S.inboxLoaded = true;
        clearConnError("inbox");
        shareCounts();
        if (S.tab === "inbox" && !S.detail) paintBody();
      }).catch(function (e) {
        if (S.dead) return;
        setConnError("inbox", e, loadInbox);
        if (S.tab === "inbox" && !S.detail) paintBody();
      });
    }
    function loadChats() {
      return api("/api/chats").then(function (d) {
        if (S.dead) return;
        if (!d || d.error) {
          setConnError("chats", d || "会话列表为空", loadChats);
          if (S.tab === "service") paintBody();
          return;
        }
        S.chats = d.items || [];
        S.chatsLoaded = true;
        clearConnError("chats");
        // 没有本地面板记忆时，默认沿用「最近在用的工作区」，而不是每次回 DSH 默认。
        if (!S.addWs && !S.addWsPicked) S.addWs = lastUsedWs() || "";
        refreshFoot();
        if (S.tab === "service") paintBody();
        if (S.tab === "inbox" && !S.detail) paintBody();
      }).catch(function (e) {
        if (S.dead) return;
        setConnError("chats", e, loadChats);
        if (S.tab === "service") paintBody();
        if (S.tab === "inbox" && !S.detail) paintBody();
      });
    }
    function loadTargets() {
      return api("/api/targets").then(function (d) {
        if (S.dead) return;
        if (!d || d.error) {
          setConnError("targets", d || "服务对象为空", loadTargets);
          if (S.tab === "targets") paintBody();
          return;
        }
        S.targets = d.items || [];
        S.targetsLoaded = true;
        clearConnError("targets");
        refreshFoot();
        if (S.tab === "targets") paintBody();
      }).catch(function (e) {
        if (S.dead) return;
        setConnError("targets", e, loadTargets);
        if (S.tab === "targets") paintBody();
      });
    }
    function loadWorkspaces() {
      return api("/api/workspaces").then(function (d) {
        if (!d || d.error) return;
        S.workspaces = d.items || [];
        S.defaultWs = d.default || "";
      }).catch(function () { /* 保留上一份，不把工作区选择器清空 */ });
    }
    function openThread(platform, chatId, msgId) {
      S.detail = { platform: platform, chat_id: chatId, msg_id: msgId };
      S.thread = []; S.threadOffline = false; S.threadError = "";
      S.detailWs = ""; S.wsPicked = false;
      paint();
      // fetch=1：点开时补拉这一次。群聊平时不进定时轮询，就靠这一下拿最新消息。
      api("/api/thread?platform=" + encodeURIComponent(platform) + "&chat_id=" + encodeURIComponent(chatId) +
          "&limit=30&fetch=1")
        .then(function (d) {
          if (S.dead) return;
          if (!d || (d.error && !d.chat)) {
            S.threadOffline = true;
            S.threadError = shortReason(d || "线程为空");
            paint();
            return;
          }
          S.thread = d.items || []; S.detail.chat = d.chat || {};
          S.threadOffline = !!d.offline; S.threadError = d.error || "";
          if (d.offline) say("在线拉取失败，先显示本地指针");
          else if (d.polled && d.polled.error) say("拉取失败：" + String(d.polled.error).slice(0, 60));
          else if (d.polled && d.polled.blocked) say("这个会话已屏蔽，不同步新消息");
          paint();
          if (msgId) api("/api/state", { body: { platform: platform, msg_id: msgId, state: "opened" } }).then(loadStatus);
        }).catch(function (e) {
          if (S.dead) return;
          S.threadOffline = true;
          S.threadError = shortReason(e);
          paint();
        });
    }

    // ---- 整体 -----------------------------------------------------------
    function paint() {
      if (S.dead) return;
      panel.textContent = "";
      panel.appendChild(head());
      panel.appendChild(tabs());
      panel.appendChild(body());
      panel.appendChild(foot());
      // 会话详情永远停在最新一条：否则新消息会被下面的草稿/提示条挡住
      if (S.detail) {
        requestAnimationFrame(function () {
          var th = panel.querySelector(".ims-thread");
          if (th) th.scrollTop = th.scrollHeight;
        });
      }
    }

    function foot() {
      var st = S.status || {};
      var poll = st.poll || {};
      var ins = st.instances || [];
      var busy = ins.filter(function (x) { return x.turn_state === "running"; }).length;
      var dsh = st.dsh || {};
      return h("div", { class: "ims-foot" },
        h("span", { class: "ims-dot", style: "background:" + (st.running ? "var(--ok)" : "var(--fg3)") }),
        h("span", { text: "分身 " + ((S.chats || []).filter(function (c) { return c.watching && !c.blocked; }).length) + " 个" }),
        busy ? h("span", { text: "· " + busy + " 个处理中" }) : null,
        (poll.blocked ? h("span", { text: "· 屏蔽 " + poll.blocked + " 个" }) : null),
        h("span", { class: "ims-grow" }),
        h("span", { text: (dsh.configured ? "DSH 值守会话就绪" : "DSH 未就绪") +
          " · 值守 " + (poll.fast_sec > 0 ? poll.fast_sec + " 秒" : "关") +
          " · 发现 " + (poll.interval_min || 10) + " 分钟" +
          (st.last_cycle_at ? " · 上轮 " + fmtTime(st.last_cycle_at) : "") }));
    }

    function head() {
      var st = S.status || {};
      var dotColor = !S.status ? "var(--fg3)"
        : ((S.connError || st.paused) ? "var(--warn)" : "var(--ok)");
      var svc = (st.instances || []).filter(function (x) { return x.turn_state === "running"; });
      var sub;
      if (!S.status) sub = "本地服务连接失败";
      else if (S.connError && S.connError.by === "status") sub = "本地服务连接失败 · 显示上次数据";
      else {
        sub = st.platforms ? st.platforms.map(function (p) {
          return (PLAT[p.platform] ? PLAT[p.platform].label : p.platform) + (p.logged_in ? "" : "（未登录）");
        }).join(" · ") + (st.last_cycle_at ? " · 同步于 " + fmtTime(st.last_cycle_at) : "") : "正在连接本地服务…";
      }
      if (svc.length) {
        sub += " · 处理中：" + svc.map(chatLabel).join("、");
      }
      return h("div", { class: "ims-head" },
        h("div", { style: "min-width:0" },
          h("div", { class: "ims-title" }, h("span", { class: "ims-dot", style: "background:" + dotColor }), "IM 值守"),
          h("div", { class: "ims-sub", text: sub })),
        h("span", { class: "ims-grow" }),
        h("button", {
          class: "ims-btn ghost", type: "button", title: "立刻拉一轮（不受 " + ((st.poll || {}).interval_min || 10) + " 分钟间隔限制）",
          onclick: function () { syncNow(this); }
        }, h("span", { class: "ims-ico", html: icon("sync", 15) }), h("span", { class: "ims-btn-label", text: "同步" })),
        h("button", {
          class: "ims-btn ghost", type: "button", title: st.paused ? "恢复值守" : "暂停值守",
          onclick: function () { api("/api/pause", { body: { paused: !st.paused } }).then(loadStatus); }
        }, h("span", { class: "ims-ico", html: icon(st.paused ? "play" : "pause", 15) }),
           h("span", { class: "ims-btn-label", text: st.paused ? "恢复" : "暂停" })),
        h("button", {
          class: "ims-btn ghost", type: "button", title: "设置",
          onclick: function () { S.tab = "settings"; S.detail = null; paint(); }
        }, h("span", { class: "ims-ico", html: icon("gear", 15) })));
    }

    function tabs() {
      var defs = [
        ["inbox", "收件箱", "inbox"],
        ["attention", "关注", "note"],
        ["service", "分身", "headset"],
        ["targets", "服务对象", "user"],
        ["status", "体检", "pulse"],
        ["settings", "设置", "gear"]
      ];
      var bar = h("div", { class: "ims-tabs" });
      defs.forEach(function (d) {
        var n = d[0] === "inbox" ? ((S.counts && S.counts.todo) || 0) : 0;
        bar.appendChild(h("button", {
          class: "ims-tab" + (S.tab === d[0] && !S.detail ? " on" : ""), type: "button",
          title: d[1],
          onclick: function () {
            S.tab = d[0]; S.detail = null; paint();
            if (d[0] === "service") loadChats();
            if (d[0] === "targets") loadTargets();
            if (d[0] === "attention") loadDigest();
            if (d[0] === "status") loadStatus().then(paint);
          }
        },
          h("span", { class: "ims-ico", html: icon(d[2], 15) }),
          h("span", { text: d[1] }),
          n ? h("span", { class: "ims-num", text: n > 99 ? "99+" : String(n) }) : null));
      });
      return bar;
    }

    function chatLabel(x) {
      return (x && (x.name || x.chat_name)) || "未命名会话";
    }

    function connBanner() {
      var ce = S.connError;
      if (!ce) return null;
      return h("div", { class: "ims-banner warn" },
        h("span", { class: "ims-ico", html: icon("bell", 13) }),
        h("span", { style: "flex:1;min-width:0;overflow-wrap:anywhere", text: ce.text }),
        ce.retry ? h("span", { class: "ims-hint", text: "·" }) : null,
        ce.retry ? h("button", {
          class: "ims-btn mini", type: "button", title: "重新加载这个页签的数据",
          onclick: function () {
            if (!S.connError || !S.connError.retry) return;
            this.disabled = true;
            S.connError.retry();
          }
        }, "重试") : null);
    }

    function body() {
      var wrap = h("div", { class: "ims-body" });
      if (S.connError) wrap.appendChild(connBanner());
      if (S.detail) { wrap.appendChild(detailView()); return wrap; }
      if (S.tab === "inbox") { wrap.appendChild(filters()); wrap.appendChild(inboxList()); }
      else if (S.tab === "attention") wrap.appendChild(attentionView());
      else if (S.tab === "service") wrap.appendChild(serviceView());
      else if (S.tab === "targets") wrap.appendChild(targetsView());
      else if (S.tab === "status") wrap.appendChild(statusView());
      else wrap.appendChild(settingsView());
      return wrap;
    }

    /** 焦点在可输入控件里：后台刷新只换头尾，不重建 body，别打断正在打的字。 */
    function typingFocus() {
      var a = typeof document !== "undefined" ? document.activeElement : null;
      if (!a) return false;
      var tag = String(a.tagName || "").toLowerCase();
      if (tag === "textarea") return true;
      if (tag !== "input") return false;
      var type = String(a.type || "text").toLowerCase();
      return ["checkbox", "radio", "button", "submit", "reset", "file"].indexOf(type) < 0;
    }

    function paintBody() {
      var b = panel.querySelector(".ims-body");
      if (!b) return paint();
      if (typingFocus()) {
        // 用户正在输入：只刷新页头/页脚，body 等失焦或下一次主动操作再重建。
        var h0 = panel.querySelector(".ims-head");
        if (h0) h0.replaceWith(head());
        var f0 = panel.querySelector(".ims-foot");
        if (f0) f0.replaceWith(foot());
        return;
      }
      b.replaceWith(body());
      var old = panel.querySelector(".ims-head");
      if (old) old.replaceWith(head());
      var of = panel.querySelector(".ims-foot");
      if (of) of.replaceWith(foot());
    }

    // ---- 工作区选择器 ---------------------------------------------------
    function wsTitle(path) {
      var hit = (S.workspaces || []).filter(function (w) { return w.path === path; })[0];
      return (hit && hit.title) || baseName(path) || path || "";
    }

    /** 最近在用的工作区：优先「当前绑定的会话」，其次最近加入的。 */
    function lastUsedWs() {
      var best = "", at = -1;
      (S.chats || []).forEach(function (c) {
        if (!c.workspace) return;
        var t = c.session_bound_at || c.added_at || c.last_sync || 0;
        if (t > at) { at = t; best = c.workspace; }
      });
      return best;
    }

    /** 新加入值守时的默认工作区：面板记忆 → 最近在用 → DSH 默认。 */
    function joinWorkspace() {
      return S.addWs || lastUsedWs() || S.defaultWs || "";
    }

    function rememberWs(v) {
      if (!v) return;
      S.addWs = v;
      writeWsMemory(v);
    }

    /** 展示用：显式绑定优先，否则说明「跟随 DSH 默认」。 */
    function effectiveLabel(chat) {
      chat = chat || {};
      if (chat.workspace) return wsTitle(chat.workspace);
      var t = chat.workspace_effective_title || (S.defaultWs ? wsTitle(S.defaultWs) : "");
      return t ? "默认 · " + t : "未绑定工作区";
    }

    /** 动作（现在处理/新建会话）要用的工作区：详情里改过就用新值，否则用已绑定值。 */
    function actionWs(chat) {
      if (S.wsPicked) return S.detailWs;
      return (chat && chat.workspace) || "";
    }

    function wsOptions(current, onPick, allowNone) {
      var sel = h("select", { class: "ims-select" });
      if (allowNone) {
        var def = S.defaultWs ? "（" + baseName(S.defaultWs) + "）" : "";
        sel.appendChild(h("option", { value: "" }, "跟随 DSH 默认" + def));
      }
      (S.workspaces || []).forEach(function (w) {
        sel.appendChild(h("option", { value: w.path, selected: current === w.path },
          w.title + (w.is_default ? " · 默认" : "")));
      });
      var known = (S.workspaces || []).some(function (w) { return w.path === current; });
      if (current && !known) {
        sel.appendChild(h("option", { value: current, selected: true }, baseName(current) + "（自定义）"));
      }
      sel.appendChild(h("option", { value: "__custom" }, "自定义路径…"));
      sel.addEventListener("change", function () {
        if (sel.value === "__custom") {
          var p = window.prompt("工作区路径（绝对路径）", current || "~/");
          if (!p) { sel.value = current || ""; return; }
          onPick(p);
          return;
        }
        onPick(sel.value);
      });
      return sel;
    }

    function pickWorkspace(platform, chatId, value, done) {
      api("/api/chat/workspace", { body: { platform: platform, chat_id: chatId, workspace: value } })
        .then(function (r) {
          if (!r.ok) {
            say(r.reason || "设置失败");
            if (done) done(r);   // 让调用方收起临时选择，界面回到已保存的值
            return;
          }
          if (value) rememberWs(value);
          say(value ? "工作区已设为 " + (r.label || baseName(value)) : "已取消工作区绑定");
          if (done) done(r);
        });
    }

    /** 加入值守：统一带上工作区，并说清落在哪。 */
    function joinWatch(platform, chatId, name, kind, after, wsOverride) {
      var ws = wsOverride === undefined ? joinWorkspace() : (wsOverride || "");
      return api("/api/watch", {
        body: { platform: platform, chat_id: chatId, name: name, kind: kind,
                watching: true, workspace: ws }
      }).then(function (r) {
        if (!r || r.ok === false) {
          say("加入失败：" + ((r && r.reason) || "未知原因"));
          return r;
        }
        if (ws) rememberWs(ws);
        say("已加入值守 · 工作区 " + (ws ? wsTitle(ws) : "跟随 DSH 默认"));
        if (after) after(r);
        else { loadChats(); loadTargets(); }
        return r;
      });
    }

    // ---- 收件箱 ---------------------------------------------------------
    function filters() {
      var defs = [["todo", "待回"], ["unread", "未读"], ["mention", "@我"], ["dm", "私聊"], ["all", "全部"]];
      var bar = h("div", { class: "ims-filters" });
      defs.forEach(function (d) {
        bar.appendChild(h("button", {
          class: "ims-chip" + (S.filter === d[0] ? " on" : ""), type: "button",
          onclick: function () { S.filter = d[0]; loadInbox().then(paint); }
        }, d[1]));
      });
      bar.appendChild(h("span", { class: "ims-grow" }));
      bar.appendChild(h("span", {
        class: "ims-hint",
        text: S.inboxChats ? (S.inboxChats + " 个会话 · " + S.inboxTotal + " 条") : ""
      }));
      return bar;
    }

    function chatOf(platform, chatId) {
      var hit = (S.chats || []).filter(function (c) {
        return c.platform === platform && c.chat_id === chatId;
      })[0];
      return hit || null;
    }

    /* 历史消息的正文不在本地：已处理/知会/已发的行只留指针。 */
    function msgText(content, state, kind, msgType) {
      if (content) return content.replace(/\s+/g, " ");
      var media = MEDIA_LABEL[msgType] || "";
      if (media) return media;
      if (state === "replied" || state === "ignored") return "历史消息 · 点开在线查看";
      if (kind === "fyi") return "知会消息 · 点开在线查看";
      if (kind === "out") return "已发消息 · 点开在线查看";
      return "";
    }

    function previewItem(m) {
      return h("div", { class: "ims-pv-item" },
        h("span", { class: "ims-pv-meta",
          text: (m.sender_name ? m.sender_name + " · " : "") + fmtTime(m.ts_epoch) }),
        msgText(m.content, m.state, m.kind, m.msg_type).slice(0, 160));
    }

    /* 一个会话一行：人多发几条不再刷屏，条数收进右侧角标，想看细节再展开。 */
    function inboxRow(g) {
      var key = g.key || (g.platform + ":" + g.chat_id);
      var p = PLAT[g.platform] || { label: g.platform, short: "?", color: "var(--fg3)" };
      var chat = chatOf(g.platform, g.chat_id);
      // 私聊不再用「私聊」标签占位置：头像与名称已经说明；群、@我、客服等有意义
      // 的 kind 仍保留。
      var kinds = (g.kinds || []).filter(function (k) {
        return k !== "dm";
      }).map(function (k) { return KIND[k] || KIND.fyi; });
      var expanded = !!S.expanded[key];
      var rest = (g.preview || []).slice(1);
      var running = !!chat && chat.turn_state === "running";
      var snippet = (g.sender_name && g.sender_name !== g.chat_name ? g.sender_name + "：" : "") +
        msgText(g.content, (g.preview && g.preview[0] || {}).state,
                (g.preview && g.preview[0] || {}).kind, g.msg_type);
      var name = g.chat_name || "未命名会话";
      // 工作区 chip 放到第二行，给名称留出完整宽度；chip 自己可以截断，但 title 保留全路径。
      var wsChip = chat && chat.watching ? h("span", {
        class: "ims-wschip" + (chat.workspace_missing ? " unset" : ""),
        title: chat.workspace
          ? chat.workspace + (chat.workspace_missing ? "（不存在）"
              : (chat.workspace_in_dsh ? "（DSH 工作区）" : "（不在 DSH 工作区列表里）"))
          : "未显式绑定，跟随 DSH 默认" +
            (chat.workspace_effective ? "：" + chat.workspace_effective : "")
      },
        h("span", { class: "ims-ico", html: icon("folder", 12) }),
        h("span", { class: "ims-wschip-txt",
                    text: chat.workspace
                      ? (chat.workspace_title || baseName(chat.workspace))
                      : effectiveLabel(chat) })) : null;

      var main = h("div", { class: "ims-row-main" },
        h("div", { class: "ims-row-top" },
          h("span", { class: "ims-name", title: g.chat_id ? "会话 ID（排障用）：" + g.chat_id : "",
                      text: name }),
          g.chat_kind === "group"
            ? h("span", { class: "ims-tag", style: "color:var(--fg3)", text: "群" })
            : null,
          kinds.map(function (k) {
            return h("span", { class: "ims-tag", style: "color:" + k.color, text: k.label });
          }),
          g.unread > 0 ? h("span", { class: "ims-unread" }) : null,
          running ? h("span", { class: "ims-draftchip", title: "agent 正在处理这通会话",
                               text: "处理中" }) : null,
          h("span", { class: "ims-grow" }),
          // 一眼烦的群 / 人，从收件箱这行直接屏蔽，不用点进去再找开关
          h("button", {
            class: "ims-mute", type: "button",
            title: "屏蔽：不再同步这个" + (g.chat_kind === "group" ? "群" : "人") + "的消息",
            onclick: function (e) {
              e.stopPropagation();
              confirmBlock(g.chat_name || "这个会话").then(function (ok) {
                if (!ok) return;
                setChatBlocked(g.platform, g.chat_id, true,
                               { name: g.chat_name, kind: g.chat_kind }).then(paintBody);
              });
            }
          }, h("span", { class: "ims-ico", html: icon("mute", 13) }))),
        h("div", { class: "ims-row-sub" },
          h("div", { class: "ims-snippet", text: snippet }),
          wsChip),
        expanded && rest.length
          ? h("div", { class: "ims-pv" },
              rest.map(previewItem),
              g.count - rest.length > 1
                ? h("div", { class: "ims-hint", text: "另有 " + (g.count - rest.length - 1) + " 条，点开看全部" })
                : null)
          : null);

      function open() { openThread(g.platform, g.chat_id, g.msg_id); }
      return h("div", {
        class: "ims-row", role: "button", tabindex: "0",
        "aria-label": name + "：" + snippet,
        title: snippet,
        onclick: open,
        onkeydown: function (e) {
          if (e.target !== this) return;
          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
            e.preventDefault();
            open();
          }
        }
      },
        h("div", { class: "ims-pdot", style: "--pc:" + p.color, text: p.short }),
        main,
        h("div", { class: "ims-row-side" },
          h("span", { class: "ims-time", text: fmtTime(g.last_epoch) }),
          g.count > 1 ? h("span", { class: "ims-gcount", text: g.count + " 条" }) : null,
          rest.length
            ? h("button", {
                class: "ims-caret", type: "button", tabindex: "-1",
                title: (expanded ? "收起" : "展开这个会话里其余 " + rest.length + " 条"),
                onclick: function (e) {
                  e.stopPropagation();
                  S.expanded[key] = !expanded;
                  paintBody();
                }
              }, h("span", {
                class: "ims-ico", html: icon("chev", 13),
                style: "display:flex;transition:transform .12s;" + (expanded ? "transform:rotate(180deg)" : "")
              }))
            : null));
    }

    function inboxEmptyText(filter) {
      var map = {
        todo: ["没有待回的消息", "值守在跑：私聊、@你 的消息会自动进这里"],
        unread: ["没有未读消息", "新消息进来会在这里亮红点"],
        mention: ["没有 @你 的消息", "群里只有精确 @你 才会进这里"],
        dm: ["没有私聊消息", "只显示值守范围里的私聊"],
        all: ["收件箱是空的", "值守在跑时，新消息会自动进这里"]
      };
      return map[filter] || map.all;
    }

    function inboxList() {
      var list = h("div", { class: "ims-list" });
      if (!S.items.length) {
        // 请求还没成功过就失败：只靠页签顶部的错误横幅，不伪装成「确实没有」。
        if (!S.inboxLoaded) return list;
        var copy = inboxEmptyText(S.filter);
        list.appendChild(h("div", { class: "ims-empty" },
          h("div", { class: "ims-ico", html: icon("inbox", 22) }),
          h("div", { text: copy[0] }),
          h("div", { text: copy[1] }),
          (S.filter === "todo" || S.filter === "all")
            ? h("div", { text: "同一个人的多条会合并成一行，不占地方" }) : null));
        return list;
      }
      S.items.forEach(function (g) { list.appendChild(inboxRow(g)); });
      return list;
    }

    // ---- 会话详情 -------------------------------------------------------
    /* 只重读一次会话（不补拉）：屏蔽/取消屏蔽、改工作区之后都靠它刷新头部状态 */
    function refreshDetail() {
      var d = S.detail;
      if (!d) return Promise.resolve(null);
      return api("/api/thread?platform=" + encodeURIComponent(d.platform) +
                 "&chat_id=" + encodeURIComponent(d.chat_id) + "&limit=30")
        .then(function (r) {
          if (S.dead) return r;
          if (!r || (r.error && !r.chat)) {
            S.threadOffline = true;
            S.threadError = shortReason(r || "线程为空");
            paint();
            return r;
          }
          S.detail.chat = r.chat || {};
          S.thread = r.items || [];
          S.threadOffline = !!r.offline; S.threadError = r.error || "";
          paint();
          return r;
        }).catch(function (e) {
          if (S.dead) return null;
          S.threadOffline = true;
          S.threadError = shortReason(e);
          paint();
          return null;
        });
    }

    function stateChip(chat) {
      if (chat.blocked) return h("span", { class: "ims-tag", style: "color:var(--danger)", text: "已屏蔽" });
      if ((chat.turn_state || "") === "running") {
        return h("span", { class: "ims-tag", style: "color:var(--ok)",
                           title: "agent 正在处理这通会话", text: "处理中" });
      }
      if (chat.last_ok === false) {
        return h("span", { class: "ims-tag", style: "color:var(--danger)", text: "上一轮失败" });
      }
      if (chat.watching) return h("span", { class: "ims-tag", style: "color:var(--accent)", text: "值守中" });
      return h("span", { class: "ims-tag", style: "color:var(--fg3)", text: "未值守" });
    }

    /* 去 DSH 会话：优先用 DSH 客户端自己的 uiWorkspace.openSession（和侧边栏点会话同一条路），
       老版本没有这个服务时，退回复制会话 id，不假装跳成功。 */
    function goSession(platform, chatId) {
      var chat = chatOf(platform, chatId) || (S.detail && S.detail.chat) || {};
      var sid = chat.dsh_session || "";
      if (!sid) return say("这个会话还没绑定 DSH 会话，等下次命中会自动创建");
      var ok = false;
      try {
        ok = !!(window.IMStandinPanel && window.IMStandinPanel.openSession &&
                window.IMStandinPanel.openSession(sid));
      } catch (e) { ok = false; }
      if (ok) return;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(sid).then(function () {
          say("本版 DSH 不支持面板跳转；会话 id 已复制");
        });
      } else {
        say("本版 DSH 不支持面板跳转");
      }
    }

    function goSessionBtn(platform, chatId, mini) {
      return h("button", {
        class: "ims-btn" + (mini ? " mini" : "") + " primary", type: "button",
        title: "在 DSH 主界面打开这通会话（同一个 session）",
        onclick: function () { goSession(platform, chatId); }
      }, h("span", { class: "ims-ico", html: icon("spark", mini ? 12 : 14) }), "去会话");
    }

    function newSessionBtn(d, chat) {
      chat = chat || (S.detail && S.detail.chat) || {};
      return h("button", {
        class: "ims-btn mini", type: "button",
        title: "打断这一轮、解绑当前 DSH 会话，下一轮命中开新会话（旧会话留在侧边栏，不再续聊）",
        onclick: function () {
          var ws = actionWs(chat);
          var where = ws ? wsTitle(ws) : effectiveLabel(chat);
          if (typeof window !== "undefined" && window.confirm &&
              !window.confirm("重开会话？会打断正在跑的这一轮，并解绑当前 DSH 会话" +
                              "（旧会话留在侧边栏，不再续聊）。\n" +
                              "下一轮命中会在「" + where + "」开新会话。")) return;
          api("/api/chat/session/reset", { method: "POST",
                                           body: { platform: d.platform, chat_id: d.chat_id,
                                                   workspace: ws } })
            .then(function (r) {
              say(r.ok ? "已重开：下一轮命中在「" + where + "」开新会话（旧会话留在侧边栏）"
                       : "没成功：" + (r.reason || "未知"));
              refreshDetail(); loadChats();
            });
        }
      }, "重开会话");
    }

    function detailView() {
      var d = S.detail, chat = d.chat || {};
      var wrap = h("div", { class: "ims-detail" });
      var p = PLAT[d.platform] || { label: d.platform };
      var watched = !!chat.watching;
      var running = (chat.turn_state || "") === "running";
      var draftKey = d.platform + ":" + d.chat_id;

      var dhead = h("div", { class: "ims-dhead" },
        h("button", { class: "ims-btn ghost", type: "button", title: "返回",
                      onclick: function () { S.detail = null; loadInbox().then(paint); } },
          h("span", { class: "ims-ico", html: icon("back", 15) })),
        h("span", { class: "ims-name", title: d.chat_id ? "会话 ID（排障用）：" + d.chat_id : "",
                    text: chat.name || "未命名会话" }),
        h("span", { class: "ims-tag", style: "color:" + (p.color || "var(--fg3)"), text: p.label }),
        chat.kind === "group"
          ? h("span", { class: "ims-tag", style: "color:" + (chat.timer === 1 ? "var(--ok)" : "var(--fg3)"),
                        text: chat.timer === 1 ? "定时拉" : "点开才拉" })
          : null,
        stateChip(chat),
        h("span", { class: "ims-grow" }),
        chat.dsh_session ? goSessionBtn(d.platform, d.chat_id, true) : null,
        (watched && !running && !chat.workspace_missing && (chat.pending || 0) > 0) ? h("button", {
          class: "ims-btn mini", type: "button",
          title: "把最新待回交给 agent，不等下一条新消息",
          onclick: function () {
            api("/api/chat/wake", { body: { platform: d.platform, chat_id: d.chat_id,
                                            workspace: actionWs(chat) } })
              .then(function (r) {
                if (r && r.ok) say("已唤醒 agent 处理 " + r.pending + " 条待回");
                else say(r && r.reason === "running" ? "agent 正在处理这一轮"
                  : (r && r.reason === "empty" ? "没有待回消息"
                  : (r && r.reason === "not_watching" ? "先打开这个会话的值守"
                  : "没唤醒：" + ((r && r.reason) || "未知"))));
                refreshDetail(); loadChats();
              });
          }
        }, h("span", { class: "ims-ico", html: icon("play", 13) }), "现在处理") : null,
        chat.blocked
          ? h("button", {
              class: "ims-btn mini", type: "button", title: "取消屏蔽：恢复同步这个会话的消息",
              onclick: function () {
                setChatBlocked(d.platform, d.chat_id, false, { name: chat.name, kind: chat.kind })
                  .then(refreshDetail);
              }
            }, "取消屏蔽")
          : h("button", {
              class: "ims-btn mini", type: "button",
              title: "屏蔽：值守不再同步这个会话（群或单聊都一样），也不进收件箱",
              onclick: function () {
                confirmBlock(chat.name || "这个会话").then(function (ok) {
                  if (!ok) return;
                  setChatBlocked(d.platform, d.chat_id, true, { name: chat.name, kind: chat.kind })
                    .then(refreshDetail);
                });
              }
            }, h("span", { class: "ims-ico", html: icon("mute", 13) }), "屏蔽"),
        h("button", {
          class: "ims-btn mini", type: "button",
          title: chat.blocked ? "已屏蔽，先取消屏蔽才能拉取" : "现在拉一次这个会话",
          disabled: !!chat.blocked,
          onclick: function () {
            api("/api/poll", { method: "POST", body: { platform: d.platform, chat_id: d.chat_id,
                                                       name: chat.name, kind: chat.kind } })
              .then(function (r) {
                say(r.fetched ? "已拉取 · 新 " + (r.new || 0) + " 条" + (r.woke ? " · 已唤醒 agent" : "")
                              : ("没拉：" + (r.skipped || r.error || "未知原因")));
                return api("/api/thread?platform=" + encodeURIComponent(d.platform) +
                           "&chat_id=" + encodeURIComponent(d.chat_id) + "&limit=30");
              })
              .then(function (r) {
                if (!r || (r.error && !r.chat)) return;
                S.detail.chat = r.chat; S.thread = r.items || []; paint();
              })
              .catch(function (e) { say("拉取失败：" + shortReason(e)); });
          }
        }, h("span", { class: "ims-ico", html: icon("sync", 13) }), "拉一次"),
        h("label", { class: "ims-switch", title: "值守：这个会话的新消息会唤醒 agent" },
          h("input", {
            type: "checkbox", checked: watched,
            onchange: function (e) {
              if (e.target.checked && !watched) {
                var ws = S.wsPicked ? S.detailWs : (chat.workspace || joinWorkspace());
                joinWatch(d.platform, d.chat_id, chat.name, chat.kind, function () {
                  refreshDetail(); loadChats();
                }, ws).then(function (r) {
                  if (!r || r.ok === false) e.target.checked = false;
                });
                return;
              }
              api("/api/watch", { body: { platform: d.platform, chat_id: d.chat_id,
                                          watching: e.target.checked, name: chat.name,
                                          kind: chat.kind } })
                .then(function () { say(e.target.checked ? "已加入值守" : "已移出值守"); })
                .then(loadChats)
                .then(refreshDetail);
            }
          }), "值守"));
      wrap.appendChild(dhead);
      wrap.appendChild(h("div", { class: "ims-hint", style: "padding:6px var(--pad) 0",
                                  text: "只显示最近 30 条；更早消息去 IM 客户端或 DSH 会话看" }));

      // 工作区常显：没值守也能先选好，加入时直接带上，避免「先跑默认、再改」。
      var wsCur = S.wsPicked ? S.detailWs
                : (chat.workspace || (!watched ? joinWorkspace() : ""));
      var wsHint = chat.workspace
        ? (chat.workspace_missing ? "目录不存在，改绑后才能处理"
           : (chat.workspace_in_dsh ? "DSH 工作区" : "不在 DSH 工作区列表里"))
        : "未显式绑定，跟随 DSH 默认" +
          (chat.workspace_effective_title ? "：" + chat.workspace_effective_title : "");
      wrap.appendChild(h("div", { class: "ims-rowline", style: "padding:0 var(--pad) 6px" },
        h("span", { class: "ims-hint", text: "工作区" }),
        wsOptions(wsCur, function (v) {
          S.detailWs = v; S.wsPicked = true;
          pickWorkspace(d.platform, d.chat_id, v, function () {
            S.wsPicked = false; loadChats(); refreshDetail();
          });
        }, true),
        h("span", { class: "ims-hint" + (chat.workspace_missing ? " ims-err" : ""),
                    text: wsHint }),
        h("span", { class: "ims-grow" }),
        watched ? null : h("span", { class: "ims-hint", text: "加入值守时生效" })));

      if (watched) {
        var sid = chat.dsh_session || "";
        wrap.appendChild(h("div", { class: "ims-rowline", style: "padding:0 var(--pad) 6px" },
          h("span", { class: "ims-hint", text: "DSH 会话" }),
          sid ? h("span", { class: "ims-wschip", title: sid },
                  h("span", { class: "ims-ico", html: icon("spark", 12) }),
                  sid.replace("session-", "").slice(0, 8) + "…")
              : h("span", { class: "ims-hint", text: "还没跑过；命中新消息时自动创建" }),
          h("span", { class: "ims-hint", title: chat.session_bound_at ? "绑于 " + fmtTime(chat.session_bound_at) : "",
                      text: (chat.session_turns || 0) + " 轮" }),
          h("span", { class: "ims-grow" }),
          newSessionBtn(d)));
        if (running) {
          wrap.appendChild(h("div", { class: "ims-hint", style: "padding:0 var(--pad) 6px",
                                      text: "agent 正在这通会话里处理；去会话能看到它拉消息、查工作区的过程。" }));
        } else if (chat.last_ok === false) {
          wrap.appendChild(h("div", { class: "ims-hint ims-err", style: "padding:0 var(--pad) 6px",
                                      text: "上一轮失败：" + (chat.last_reason || "未知原因") + "；下一轮有新消息会再喊。" }));
        } else if ((chat.pending || 0) > 0 && sid) {
          wrap.appendChild(h("div", { class: "ims-hint", style: "padding:0 var(--pad) 6px",
                                      text: "上一轮已完成；如果 agent 把草稿留在会话里，去会话确认后发送。" }));
        }
      }

      if (chat.blocked) {
        wrap.appendChild(h("div", { class: "ims-banner warn" },
          h("span", { class: "ims-ico", html: icon("mute", 13) }),
          h("span", { text: "已屏蔽：值守不再同步这个会话的新消息，它也不会出现在收件箱。下面只有屏蔽前的历史。" }),
          h("span", { class: "ims-grow" }),
          h("button", {
            class: "ims-btn mini", type: "button",
            onclick: function () {
              setChatBlocked(d.platform, d.chat_id, false, { name: chat.name, kind: chat.kind })
                .then(refreshDetail);
            }
          }, "取消屏蔽")));
      }

      // 这个人的画像：只看当前会话那一份，详情里只露摘要，编辑到「服务对象」。
      var tgt = (S.targets || []).filter(function (t) {
        return t.platform === d.platform && t.chat_id === d.chat_id;
      })[0];
      var prof = (tgt && tgt.profile_excerpt) || "";
      if (prof) {
        var strip = h("div", { class: "ims-habits" },
          h("span", { class: "ims-hint", style: "flex:none", text: "画像" }),
          h("span", { class: "ims-habitchip", title: tgt.profile_path || "", text: prof }),
          h("span", { class: "ims-grow" }),
          h("button", {
            class: "ims-btn mini ghost", type: "button",
            onclick: function () { S.tab = "targets"; S.detail = null; paint(); loadTargets(); }
          }, "查看 →"));
        wrap.appendChild(strip);
      }

      if (S.threadOffline) {
        wrap.appendChild(h("div", { class: "ims-banner warn" },
          h("span", { class: "ims-ico", html: icon("bell", 13) }),
          h("span", { text: "在线拉取失败，下面只有本地指针" +
            (S.threadError ? "：" + String(S.threadError).slice(0, 80) : "") })));
      } else if (S.threadError) {
        wrap.appendChild(h("div", { class: "ims-banner warn" },
          h("span", { class: "ims-ico", html: icon("bell", 13) }),
          h("span", { text: String(S.threadError).slice(0, 120) })));
      }

      var thread = h("div", { class: "ims-thread" });
      if (!S.thread.length) {
        thread.appendChild(h("div", { class: "ims-empty",
          text: chat.blocked ? "这个会话已屏蔽，不同步新消息"
            : ((S.threadOffline || S.threadError) ? "拉取失败，先看上面的错误提示" : "在线没有拉到消息") }));
      }
      S.thread.forEach(function (m) {
        var me = !!m.is_self;
        var body = msgText(m.content, m.state, m.kind, m.msg_type) || "（本地只有指针）";
        var meta = h("div", { class: "ims-msg-meta",
          text: (me ? "我" : (m.sender_name || "对方")) + " · " + (m.ts || fmtTime(m.ts_epoch)) });
        if (m.app_link) {
          meta.appendChild(h("a", { class: "ims-link", href: m.app_link,
            target: "_blank", rel: "noreferrer", text: "在飞书打开" }));
        } else if (MEDIA_LABEL[m.msg_type]) {
          meta.appendChild(h("span", { class: "ims-link",
            text: (m.media_paths && m.media_paths.length) ? "已在会话中附带" : "在 IM 客户端查看" }));
        }
        thread.appendChild(h("div", { class: "ims-msg" + (me ? " me" : "") },
          meta,
          body));
      });
      wrap.appendChild(thread);

      var ta = h("textarea", { class: "ims-ta", placeholder: "手动发一条（以你本人身份发出）；agent 的回复也会同步到这里" });
      ta.value = S.composerDrafts[draftKey] || "";
      ta.addEventListener("input", function () { S.composerDrafts[draftKey] = ta.value; });
      var hint = h("span", { class: "ims-hint", text: running ? "agent 处理中，手动发送不受影响" : "" });

      var sendBtn = h("button", { class: "ims-btn primary", type: "button" },
        h("span", { class: "ims-ico", html: icon("send", 14) }), "发送");
      S._sendBtn = sendBtn;
      sendBtn.addEventListener("click", function () {
        var text = ta.value.trim();
        if (!text) return say("先写点东西");
        sendBtn.disabled = true;
        api("/api/send", { body: { platform: d.platform, chat_id: d.chat_id, text: text, msg_id: d.msg_id } })
          .then(function (r) {
            sendBtn.disabled = false;
            if (r.ok) {
              say("已发出");
              ta.value = "";
              delete S.composerDrafts[draftKey];
              openThread(d.platform, d.chat_id, ""); loadStatus();
            } else say("发送失败：" + (r.reason || "未知原因"));
          }).catch(function (e) { sendBtn.disabled = false; say("发送失败：" + e); });
      });
      var canIgnore = !!d.msg_id && (chat.pending || 0) > 0;
      var ignoreBtn = h("button", {
        class: "ims-btn", type: "button", disabled: !canIgnore,
        title: canIgnore ? "把这一条标记为忽略；正文保留在本地"
                         : "没有可忽略的待回消息"
      }, "忽略这条");
      ignoreBtn.addEventListener("click", function () {
        if (!canIgnore) return;
        api("/api/state", { body: { platform: d.platform, msg_id: d.msg_id, state: "ignored" } })
          .then(function () { say("已忽略"); S.detail = null; loadInbox().then(paint); });
      });

      wrap.appendChild(h("div", { class: "ims-compose" },
        ta,
        h("div", { class: "ims-rowline" },
          sendBtn, ignoreBtn, h("span", { class: "ims-grow" }), hint)));
      S._ta = ta; S._hint = hint;
      return wrap;
    }

    // 单个会话的定时拉取开关（群默认 -1 = 点开才拉）
    function setChatTimer(c, timer) {
      api("/api/chat/timer", { body: { platform: c.platform, chat_id: c.chat_id,
                                       name: c.name, kind: c.kind, timer: timer } })
        .then(function (r) {
          if (!r.ok) return say("没改成：" + (r.reason || ""));
          c.timer = timer;
          say(timer === 1 ? "已加入定时检测（每轮会拉这个群）" : "已改为点开才拉");
          loadChats(); loadStatus();
        });
    }

    // 屏蔽是不可逆的本地动作：后端会忽略当前待回并清空正文，取消屏蔽也不恢复。
    function confirmBlock(name) {
      if (typeof window === "undefined" || !window.confirm) return Promise.resolve(true);
      return Promise.resolve(window.confirm(
        "屏蔽「" + (name || "这个会话") + "」？\n" +
        "会立即忽略它当前的待回，并清空本地保存的消息正文；取消屏蔽不会恢复。"));
    }

    // 屏蔽 / 取消屏蔽一个群或一个单聊：屏蔽后不同步（不拉取、不进收件箱）
    function setChatBlocked(platform, chatId, blocked, extra) {
      extra = extra || {};
      return api("/api/chat/block", { method: "POST", body: {
        platform: platform, chat_id: chatId, blocked: !!blocked,
        name: extra.name, kind: extra.kind
      } }).then(function (r) {
        if (!r || !r.ok) { say("没改成：" + ((r && r.reason) || "未知原因")); return r; }
        (S.chats || []).forEach(function (c) {
          if (c.platform === platform && c.chat_id === chatId) c.blocked = r.blocked ? 1 : 0;
        });
        say(blocked
          ? ("已屏蔽，之后不再同步" + (r.ignored ? "；顺手忽略 " + r.ignored + " 条待回" : ""))
          : "已取消屏蔽，点开或下一轮会重新同步");
        return Promise.all([loadChats(), loadInbox(), loadStatus()]).then(function () { return r; });
      });
    }

    // ---- 分身实例（原「客服」页）----------------------------------------
    function serviceView() {
      var scroll = h("div", { class: "ims-scroll" });
      var all = S.chats || [];
      // 这个页签只放「正在值守」的会话；找新会话用顶部搜索，
      // 群清单与已屏蔽都收起来（屏蔽恢复在设置里）。
      var watched = all.filter(function (c) { return c.watching && !c.blocked; });

      scroll.appendChild(searchCard());

      scroll.appendChild(h("div", { class: "ims-card" },
        h("div", { class: "ims-card-h" },
          h("span", { class: "ims-ico", html: icon("headset", 15) }),
          "值守中 " + (watched.length || "")),
        h("div", { class: "ims-hint", text: "值守 = 这通会话的新消息会唤醒 agent。一通会话绑一个 DSH 会话，默认永久复用；工作区决定 agent 调研的范围。" })));

      if (!watched.length && S.chatsLoaded) {
        scroll.appendChild(h("div", { class: "ims-empty", text: "还没有值守会话。用上面的搜索加入一个人或一个群，或到「收件箱」点开会话打开值守。" }));
      }
      watched.forEach(function (c) {
        var p = PLAT[c.platform] || { label: c.platform, color: "var(--fg3)" };
        var running = c.turn_state === "running";
        var tgt = (S.targets || []).filter(function (t) {
          return t.platform === c.platform && t.chat_id === c.chat_id;
        })[0];
        var prof = (tgt && tgt.profile_excerpt) || "";
        scroll.appendChild(h("div", { class: "ims-card" },
          h("div", { class: "ims-card-h" },
            h("div", { class: "ims-avatar", style: "--pc:" + p.color, text: (c.name || "?")[0] }),
            h("span", { class: "ims-name", text: c.name || "未命名会话" }),
            h("span", { class: "ims-tag", style: "color:" + p.color, text: p.label }),
            running ? h("span", { class: "ims-tag", style: "color:var(--ok)", text: "处理中" })
                    : (c.last_ok === false
                        ? h("span", { class: "ims-tag", style: "color:var(--danger)", text: "上轮失败" })
                        : h("span", { class: "ims-tag", style: "color:var(--accent)", text: "值守中" })),
            c.kind === "group" ? h("span", { class: "ims-tag", style: "color:var(--fg3)", text: "群" }) : null,
            h("span", { class: "ims-grow" }),
            c.dsh_session ? goSessionBtn(c.platform, c.chat_id, true) : null,
            h("button", { class: "ims-btn mini", type: "button", onclick: function () { openThread(c.platform, c.chat_id, ""); } }, "打开"),
            h("button", {
              class: "ims-btn mini danger", type: "button", title: "屏蔽：不再同步这个会话（值守配置保留，取消屏蔽后恢复）",
              onclick: function () {
                confirmBlock(c.name || "这个会话").then(function (ok) {
                  if (!ok) return;
                  setChatBlocked(c.platform, c.chat_id, true, { name: c.name, kind: c.kind })
                    .then(paint);
                });
              }
            }, "屏蔽")),
          h("div", { class: "ims-rowline" },
            h("span", { class: "ims-hint", text: "工作区" }),
            wsOptions(c.workspace || "", function (v) {
              pickWorkspace(c.platform, c.chat_id, v, loadChats);
            }, true),
            c.workspace
              ? (c.workspace_missing
                  ? h("span", { class: "ims-tag", style: "color:var(--danger)", text: "工作区不存在" })
                  : (c.workspace_in_dsh
                      ? null
                      : h("span", { class: "ims-tag", style: "color:var(--warn)", text: "不在 DSH 工作区里" })))
              : h("span", { class: "ims-hint",
                            text: "跟随 DSH 默认" + (c.workspace_effective_title ? "：" + c.workspace_effective_title : "") })),
          h("div", { class: "ims-rowline" },
            h("span", { class: "ims-hint", text: "DSH 会话" }),
            c.dsh_session
              ? h("span", { class: "ims-wschip", title: c.dsh_session },
                  h("span", { class: "ims-ico", html: icon("spark", 12) }),
                  c.dsh_session.replace("session-", "").slice(0, 8) + "…")
              : h("span", { class: "ims-hint", text: "还没跑过；命中新消息时自动创建" }),
            h("span", { class: "ims-hint", title: c.session_bound_at ? "绑于 " + fmtTime(c.session_bound_at) : "",
                        text: (c.session_turns || 0) + " 轮" }),
            (c.session_turns || 0) > 50
              ? h("span", { class: "ims-tag", style: "color:var(--warn)", text: "较长，可新建" }) : null,
            c.dsh_session ? h("button", {
              class: "ims-btn mini", type: "button",
              onclick: function () {
                if (navigator.clipboard) navigator.clipboard.writeText(c.dsh_session).then(function () { say("会话 id 已复制"); });
              }
            }, "复制") : null,
            h("span", { class: "ims-grow" }),
            newSessionBtn({ platform: c.platform, chat_id: c.chat_id }, c)),
          h("div", { class: "ims-kv" },
            h("span", null, h("b", { text: c.kind === "group" ? "群聊" : "私聊" }), " · " + (c.last_sync ? "上次同步 " + fmtTime(c.last_sync) : "还没同步"))),
          running
            ? h("div", { class: "ims-hint", text: "agent 正在这通会话里处理；去会话能看到它拉消息、查工作区的过程。" })
            : (c.last_ok === false
                ? h("div", { class: "ims-hint ims-err", text: "上一轮失败：" + (c.last_reason || "未知原因") + "；下一轮有新消息会再喊。" })
                : ((c.pending || 0) > 0 && c.dsh_session
                    ? h("div", { class: "ims-hint", text: "上一轮已完成；如果它把草稿留在会话里，去会话确认后发送。" })
                    : null)),
          prof ? h("div", { class: "ims-note" },
            h("span", { class: "ims-ico", html: icon("note", 13) }),
            h("span", { class: "ims-note-body", text: prof }))
            : h("div", { class: "ims-hint", text: "还没画像，去「服务对象」补一份；agent 起草时会更像你" }),
          h("div", { class: "ims-rowline" },
            h("label", { class: "ims-switch" },
              h("input", {
                type: "checkbox", checked: true,
                onchange: function (e) {
                  api("/api/watch", { body: { platform: c.platform, chat_id: c.chat_id,
                                              watching: e.target.checked } })
                    .then(loadChats);
                }
              }), "值守"),
            c.kind === "group" ? h("label", {
              class: "ims-switch", title: "开=按设置间隔定时检测这个群的 @我；关=只在点开时拉一次"
            },
              h("input", {
                type: "checkbox", checked: c.timer === 1,
                onchange: function (e) { setChatTimer(c, e.target.checked ? 1 : -1); }
              }), "定时检测 @我") : null,
            h("span", { class: "ims-grow" }),
            c.last_error ? h("span", { class: "ims-hint ims-err", text: String(c.last_error).slice(0, 36) }) : null,
            h("button", {
              class: "ims-btn danger mini", type: "button", title: "移出值守（不再唤醒 agent）",
              onclick: function () {
                if (running && typeof window !== "undefined" && window.confirm &&
                    !window.confirm("「" + (c.name || "这个会话") + "」正在处理中，" +
                                    "移出值守会打断当前 agent 轮次。继续？")) return;
                api("/api/unwatch", { body: { platform: c.platform, chat_id: c.chat_id } })
                  .then(function () { say("已移出值守"); loadChats(); });
              }
            }, "移出"))));
      });

      return scroll;
    }

    // 搜人 + 搜群：一个输入框、一个结果列表；只显示可读名称，不露 imid。
    function searchCard() {
      var sel = h("select", { class: "ims-select" });
      ["feishu", "wecom", "dingtalk"].forEach(function (k) {
        sel.appendChild(h("option", { value: k, selected: S.search.platform === k }, PLAT[k].label));
      });
      var inp = h("input", { class: "ims-inp", placeholder: "输入名称搜索（如 张三）" });
      inp.value = S.search.q;
      inp.addEventListener("input", function () { S.search.q = inp.value; syncClear(); });
      var go = h("button", { class: "ims-btn", type: "button" }, "搜索");
      // 搜完不需要时一键回到空白：清搜索词、清结果，但不动平台和手动加入表单。
      var clear = h("button", {
        class: "ims-btn ghost mini", type: "button", title: "清空搜索词和结果"
      }, "清空");
      var result = h("div", {});
      // 搜索是异步的：清空/换平台/重新搜都要让旧响应作废，否则清空后结果会再冒出来。
      // 序号放在 S.search 里，面板重绘后也仍然有效。

      function syncClear() {
        var any = !!(inp.value.trim() || S.search.q || S.search.items || S.search.err);
        clear.style.display = any ? "" : "none";
      }

      function clearSearch() {
        S.search.seq++;
        inp.value = "";
        S.search.q = ""; S.search.items = null; S.search.err = "";
        renderRows();
        inp.focus();
      }

      function renderRows() {
        syncClear();
        result.textContent = "";
        if (S.search.err) {
          result.appendChild(h("div", { class: "ims-hint ims-err", text: S.search.err }));
        }
        var items = S.search.items;
        if (!items) return;
        if (!items.length) {
          result.appendChild(h("div", { class: "ims-hint",
            text: S.search.platform === "wecom"
              ? "没搜到。企业微信只能按名字搜通讯录里的联系人。"
              : S.search.platform === "dingtalk"
                ? "没搜到。钉钉只搜得到本组织通讯录里的同事和你是成员的群。"
                : "没搜到。飞书只搜得到你可见的人、你是成员的群。" }));
          return;
        }
        items.forEach(function (x) {
          var chatId = x.chat_id || x.id;
          // 旧版本按 open_id 加入过的会话也认出来，避免同一个人再添一份。
          var known = chatOf(S.search.platform, chatId) || chatOf(S.search.platform, x.id);
          var matchId = (known && known.chat_id) || chatId;
          var watching = !!(known && known.watching && !known.blocked);
          var blocked = !!(known && known.blocked);
          var kind = x.kind === "group" ? "group" : "p2p";
          result.appendChild(h("div", { class: "ims-rowline ims-found" },
            h("div", { class: "ims-avatar", style: "--pc:" + ((PLAT[S.search.platform] || {}).color || "var(--fg3)"),
                       text: (x.name || "?")[0] }),
            h("span", { class: "ims-name", text: x.name }),
            h("span", { class: "ims-tag", style: "color:" + (kind === "group" ? "var(--fg3)" : "var(--accent)"),
                        text: kind === "group" ? "群" : "私聊" }),
            x.department ? h("span", { class: "ims-hint", text: x.department }) : null,
            h("span", { class: "ims-grow" }),
            blocked
              ? h("button", {
                  class: "ims-btn mini", type: "button",
                  onclick: function () {
                    setChatBlocked(S.search.platform, matchId, false, { name: x.name, kind: kind })
                      .then(function () { loadChats(); });
                  }
                }, "取消屏蔽")
              : watching
                ? h("span", { class: "ims-tag", style: "color:var(--ok)", text: "值守中" })
                : h("button", {
                    class: "ims-btn mini primary", type: "button",
                    onclick: function () {
                      joinWatch(S.search.platform, matchId, x.name, kind, function () {
                        loadChats().then(paintBody);
                      });
                    }
                  }, "加入值守"),
            known ? h("button", {
              class: "ims-btn mini", type: "button",
              onclick: function () { openThread(S.search.platform, matchId, ""); }
            }, "打开") : null));
        });
      }

      function doSearch() {
        if (go.disabled) return;
        var q = inp.value.trim();
        S.search.q = q;
        if (!q) { clearSearch(); return; }
        var platform = S.search.platform;
        var seq = ++S.search.seq;
        go.disabled = true; go.textContent = "…";
        Promise.all([
          api("/api/search", { body: { platform: platform, q: q } })
            .catch(function (e) { return { ok: false, items: [], error: String(e) }; }),
          api("/api/search/chats", { body: { platform: platform, q: q } })
            .catch(function (e) { return { ok: false, items: [], error: String(e) }; })
        ]).then(function (rs) {
          go.disabled = false; go.textContent = "搜索";
          if (S.dead || S.search.platform !== platform || seq !== S.search.seq) return;
          var people = (rs[0].items || []).map(function (u) {
            return { id: u.id, chat_id: u.chat_id || u.id, name: u.name,
                     department: u.department || "", kind: "p2p" };
          });
          var groups = (rs[1].items || []).map(function (c) {
            return { id: c.chat_id, chat_id: c.chat_id, name: c.name,
                     department: "", kind: c.kind === "p2p" ? "p2p" : "group" };
          });
          // 名字不可读的结果直接隐藏：界面上不出现 ou_ / oc_ 这类 imid。
          var merged = [], seen = {}, hidden = 0;
          people.concat(groups).forEach(function (x) {
            if (!x.name || !x.chat_id) { hidden++; return; }
            var key = platform + ":" + x.chat_id;
            if (seen[key]) return;
            seen[key] = 1;
            merged.push(x);
          });
          var ql = q.toLowerCase();
          merged.sort(function (a, b) {
            var an = String(a.name).toLowerCase(), bn = String(b.name).toLowerCase();
            var ar = an === ql ? 0 : (an.indexOf(ql) === 0 ? 1 : 2);
            var br = bn === ql ? 0 : (bn.indexOf(ql) === 0 ? 1 : 2);
            return ar - br || an.localeCompare(bn, "zh-CN");
          });
          S.search.items = merged;
          var errs = [];
          if (!rs[0].ok && rs[0].error) errs.push("搜人：" + rs[0].error);
          // 企微没有群搜索，这个错误不算失败，不弹给用户。
          if (!rs[1].ok && rs[1].error && !/不支持/.test(rs[1].error)) errs.push("搜群：" + rs[1].error);
          S.search.err = merged.length ? "" : errs.join(" · ");
          renderRows();
          if (hidden && merged.length) say("已隐藏 " + hidden + " 条没有可读名称的结果");
        });
      }
      go.addEventListener("click", doSearch);
      clear.addEventListener("click", clearSearch);
      inp.addEventListener("input", syncClear);
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); doSearch(); }
        else if (e.key === "Escape" && clear.style.display !== "none") {
          // Esc 只清搜索，不冒泡到全局（全局 Esc 是退回会话列表）。
          e.preventDefault(); e.stopPropagation(); clearSearch();
        }
      });
      sel.addEventListener("change", function () {
        S.search.seq++;
        S.search.platform = sel.value;
        S.search.items = null; S.search.err = "";
        wcForm.style.display = sel.value === "wecom" ? "" : "none";
        renderRows();
      });

      // 企微没有群枚举/群搜索：知道会话 ID 时用这个小表单手动加入。
      var wcName = h("input", { class: "ims-inp", placeholder: "显示名（只在本面板使用）" });
      var wcId = h("input", { class: "ims-inp", placeholder: "会话 ID / 对方 userid" });
      var wcKind = h("select", { class: "ims-select" },
        h("option", { value: "group" }, "群"),
        h("option", { value: "p2p" }, "私聊"));
      wcName.value = S.search.wc.name || "";
      wcId.value = S.search.wc.id || "";
      wcKind.value = S.search.wc.kind || "group";
      wcName.addEventListener("input", function () { S.search.wc.name = wcName.value; });
      wcId.addEventListener("input", function () { S.search.wc.id = wcId.value; });
      wcKind.addEventListener("change", function () { S.search.wc.kind = wcKind.value; });
      var wcAdd = h("button", { class: "ims-btn mini primary", type: "button" }, "加入值守");
      var wcForm = h("div", { style: S.search.platform === "wecom" ? "" : "display:none" },
        h("div", { class: "ims-rowline" },
          h("span", { class: "ims-hint", text: "手动加入企微会话" }), wcName, wcId, wcKind, wcAdd),
        h("div", { class: "ims-hint",
          text: "企微没有群搜索/群枚举，群聊只能在这里填会话 ID 加入；显示名只用于本面板，不写回平台。" }));
      wcAdd.addEventListener("click", function () {
        var name = wcName.value.trim();
        var chatId = wcId.value.trim();
        if (!name || !chatId) return say("先填显示名和会话 ID");
        wcAdd.disabled = true;
        joinWatch("wecom", chatId, name, wcKind.value, function () {
          S.search.wc = { name: "", id: "", kind: wcKind.value };
          wcName.value = ""; wcId.value = "";
          loadChats().then(paintBody);
        }).then(function (r) {
          wcAdd.disabled = false;
          if (!r || r.ok === false) return;
        }).catch(function (e) {
          wcAdd.disabled = false;
          say("加入失败：" + e);
        });
      });

      var card = h("div", { class: "ims-card" },
        h("div", { class: "ims-card-h" },
          h("span", { class: "ims-ico", html: icon("search", 15) }), "搜人 / 搜群"),
        h("div", { class: "ims-rowline" }, sel, inp, go, clear),
        h("div", { class: "ims-rowline" },
          h("span", { class: "ims-hint", text: "加入值守时绑定工作区" }),
          wsOptions(joinWorkspace(), function (v) {
            S.addWs = v; S.addWsPicked = true; rememberWs(v);
          }, true)),
        result,
        wcForm,
        h("div", { class: "ims-hint", text: "搜到后「加入值守」即可在值守列表里看到它；结果只显示名称，不显示平台 id。" }));
      renderRows();
      return card;
    }

    // ---- 服务对象 -------------------------------------------------------
    /** 极简 Markdown：标题/列表/引用/段落 + 粗体、行内代码；全部先转义，不接第三方库。 */
    function escHtml(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function inlineMd(s) {
      return escHtml(s)
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
    }
    function mdLite(text) {
      var out = [];
      String(text || "").split(/\r?\n/).forEach(function (line) {
        var t = line.trim();
        if (!t) return;
        var m = /^(#{1,4})\s+(.*)$/.exec(t);
        if (m) {
          var lv = Math.min(6, m[1].length + 2);
          out.push("<h" + lv + ">" + inlineMd(m[2]) + "</h" + lv + ">");
        } else if (/^[-*]\s+/.test(t)) {
          out.push("<div class=\"ims-md-li\">• " + inlineMd(t.replace(/^[-*]\s+/, "")) + "</div>");
        } else if (/^>\s?/.test(t)) {
          out.push("<div class=\"ims-md-quote\">" + inlineMd(t.replace(/^>\s?/, "")) + "</div>");
        } else {
          out.push("<p>" + inlineMd(t) + "</p>");
        }
      });
      return out.join("");
    }

    /* 画像文件头两行是模板元信息（平台 · chat_id），只在文件里给 agent 看；
       面板正文不展示内部 ID，需要排障时看 title 里的完整路径。 */
    function profileForDisplay(text) {
      return String(text || "").split(/\r?\n/).filter(function (line) {
        return !/^>\s*(飞书|企业微信|钉钉)\s*·/.test(line.trim());
      }).join("\n");
    }

    function targetsView() {
      var scroll = h("div", { class: "ims-scroll" });
      var list = S.targets || [];
      scroll.appendChild(h("div", { class: "ims-card" },
        h("div", { class: "ims-card-h" },
          h("span", { class: "ims-ico", html: icon("user", 15) }),
          "服务对象 " + (list.length ? "· " + list.length + " 个对象" : "")),
        h("div", { class: "ims-hint", text: "每个对象一份画像文件：只写下次值守会用到的信息，不保存聊天原文。agent 起草前只读这一份。" })));

      if (!list.length && S.targetsLoaded) scroll.appendChild(h("div", { class: "ims-empty", text: "还没有服务对象。在「分身」里加入联系人或打开一个会话。" }));

      list.forEach(function (t) {
        var p = PLAT[t.platform] || { label: t.platform, color: "var(--fg3)" };
        var chat = t.chat || {};
        var key = t.platform + ":" + t.name;
        var editing = S.targetEdit === key;
        var draft = S.targetDrafts[key];
        if (draft === undefined) draft = t.profile || "";
        var body;
        var editBtn;

        if (editing) {
          var ta = h("textarea", { class: "ims-ta", placeholder: "写下这个人的画像：是谁、怎么说话、在意什么、忌讳什么" });
          ta.value = draft;
          ta.style.minHeight = "240px";
          ta.addEventListener("input", function () { S.targetDrafts[key] = ta.value; });
          body = h("div", null,
            ta,
            h("div", { class: "ims-rowline" },
              h("button", {
                class: "ims-btn primary", type: "button",
                onclick: function () {
                  api("/api/targets/profile", {
                    body: { platform: t.platform, name: t.name, text: ta.value }
                  }).then(function (r) {
                    if (!r || r.ok === false) return say("保存失败：" + ((r && r.reason) || "未知原因"));
                    say("画像已保存");
                    S.targetEdit = ""; delete S.targetDrafts[key];
                    loadTargets();
                  });
                }
              }, "保存画像"),
              h("button", {
                class: "ims-btn", type: "button",
                onclick: function () {
                  S.targetEdit = ""; delete S.targetDrafts[key]; paintBody();
                }
              }, "取消"),
              h("span", { class: "ims-grow" }),
              h("span", { class: "ims-hint", text: "只写结论，不抄聊天原文" })));
          editBtn = null;
        } else {
          body = (t.profile || "").trim()
            ? h("div", { class: "ims-profile", html: mdLite(profileForDisplay(t.profile)) })
            : h("div", { class: "ims-hint", text: "画像还是空的。点「编辑画像」写下对方是谁、怎么说话、在意什么。" });
          editBtn = h("button", {
            class: "ims-btn mini", type: "button",
            onclick: function () {
              S.targetEdit = key; S.targetDrafts[key] = t.profile || ""; paintBody();
            }
          }, "编辑画像");
        }

        scroll.appendChild(h("div", { class: "ims-card",
          title: t.chat_id ? "对象 ID（排障用）：" + t.chat_id : "" },
          h("div", { class: "ims-card-h" },
            h("div", { class: "ims-avatar", style: "--pc:" + p.color, text: (t.name || "?")[0] }),
            h("span", { class: "ims-name", text: t.name }),
            h("span", { class: "ims-tag", style: "color:" + p.color, text: p.label }),
            chat.watching ? h("span", { class: "ims-tag", style: "color:var(--ok)", text: "值守中" }) : null,
            h("span", { class: "ims-grow" }),
            editBtn),
          h("div", { class: "ims-rowline" },
            h("span", { class: "ims-wschip", title: t.profile_path || "" },
              h("span", { class: "ims-ico", html: icon("note", 12) }),
              h("span", { class: "ims-wschip-txt", text: t.profile_path ? "画像文件" : "画像未生成" })),
            h("span", { class: "ims-hint",
              text: t.profile_updated_at ? "更新于 " + fmtTime(t.profile_updated_at) : "" })),
          body));
      });
      return scroll;
    }

    // ---- 体检 -----------------------------------------------------------
    // ---- 关注 -----------------------------------------------------------
    // 日报由 agent 按 skill 维护；面板只把文件原文摊开，不解析、不统计。
    function attentionView() {
      var d = S.digest || {};
      var date = S.digestDate || todayStr();
      var scroll = h("div", { class: "ims-scroll" });
      var picker = h("input", {
        class: "ims-inp", type: "date", value: date, style: "max-width:160px",
        onchange: function (e) { loadDigest(e.target.value); }
      });
      scroll.appendChild(h("div", { class: "ims-rowline", style: "padding:8px var(--pad) 6px" },
        h("span", { class: "ims-hint", text: "日期" }),
        picker,
        h("span", { class: "ims-grow" }),
        date !== todayStr()
          ? h("button", {
              class: "ims-btn mini ghost", type: "button",
              onclick: function () { loadDigest(todayStr()); }
            }, "回到今天")
          : (d.exists ? h("span", { class: "ims-hint", text: "最后更新 " + fmtTime(d.mtime) }) : null)));

      var stale = d.exists && d.mtime && (Date.now() / 1000 - d.mtime) > 24 * 3600;
      if (stale) {
        scroll.appendChild(h("div", { class: "ims-banner warn" },
          h("span", { class: "ims-ico", html: icon("bell", 13) }),
          h("span", { text: "最后更新于 " + relAge(d.mtime) + "，可能已经过时" })));
      }

      if (d.error === "bad_date") {
        scroll.appendChild(h("div", { class: "ims-empty", text: "日期格式不对" }));
        return scroll;
      }
      if (d.error === "unreachable") {
        scroll.appendChild(h("div", { class: "ims-banner warn" },
          h("span", { class: "ims-ico", html: icon("bell", 13) }),
          h("span", { text: "本地服务连不上：拿不到日报，先看页面顶部的错误提示" })));
        return scroll;
      }
      if (!d.exists) {
        scroll.appendChild(h("div", { class: "ims-empty", text: date === todayStr()
          ? "今天还没有日报。agent 会在下次被唤醒时写；现在没人找你就是没人在等。"
          : "这一天没有日报。" }));
        return scroll;
      }

      var pre = h("pre", {
        style: "white-space:pre-wrap;word-break:break-word;margin:0;padding:4px var(--pad) 16px;" +
               "font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--fg)"
      });
      pre.textContent = d.text || "";
      scroll.appendChild(pre);
      return scroll;
    }

    function statusView() {
      var st = S.status || {}, scroll = h("div", { class: "ims-scroll" });
      var ins = st.instances || [];
      var busy = ins.filter(function (x) { return x.turn_state === "running"; });
      scroll.appendChild(h("div", { class: "ims-card" },
        h("div", { class: "ims-card-h" },
          h("span", { class: "ims-dot", style: "background:" + (st.running ? "var(--ok)" : "var(--warn)") }),
          st.paused ? "已暂停" : (st.running ? "值守中" : "未在跑"),
          h("span", { class: "ims-grow" }),
          h("button", {
            class: "ims-btn ghost", type: "button", title: "重新取一次状态快照",
            onclick: function () { loadStatus().then(paint); }
          }, "刷新"),
          h("button", {
            class: "ims-btn", type: "button",
            onclick: function () { api("/api/doctor").then(function (d) { S.doctor = d; paint(); }); }
          }, "跑一次体检")),
        h("div", { class: "ims-kv" }, h("span", { text: "轮询" }),
          h("span", { text: "值守 " + (((st.poll || {}).fast_sec > 0)
            ? ((st.poll || {}).fast_sec + " 秒（" +
               (((st.poll || {}).last_fast || {}).targets || (((st.poll || {}).last_result || {}).targets || 0)) +
               " 个会话）")
            : "关") +
            " · 发现 " + ((st.poll || {}).interval_min || 10) + " 分钟 · 已完成 " +
            (st.cycles || 0) + " 轮慢车道 · 上轮 " + (st.last_cycle_ms || 0) + "ms" })),
        h("div", { class: "ims-kv" }, h("span", { text: "本轮范围" }),
          h("span", { text: "私聊 " + (((st.poll || {}).last_result || {}).targets || 0) +
            " 个候选 · 实拉 " + (((st.poll || {}).last_result || {}).chats || 0) +
            " 个 · 群勾了定时 " + (((st.poll || {}).timer_group) || 0) + " 个" })),
        h("div", { class: "ims-kv" }, h("span", { text: "待回 / 未读" }), h("span", { text: ((st.counts && st.counts.todo) || 0) + " / " + ((st.counts && st.counts.unread) || 0) })),
        h("div", { class: "ims-kv" }, h("span", { text: "分身实例" }), h("span", { text: ins.length ? ins.map(chatLabel).join("、") : "无" })),
        h("div", { class: "ims-kv" }, h("span", { text: "agent 处理中" }), h("span", { text: busy.length ? busy.map(chatLabel).join("、") : "无" })),
        h("div", { class: "ims-kv" }, h("span", { text: "值守会话" }), h("span", {
          text: (st.dsh && st.dsh.configured)
            ? "DSH 运行时可用 · 模型/凭据跟随 DSH 配置"
            : "DSH 运行时未就绪（看 dshconf 的 profile 与二进制）"
        }))));

      (st.platforms || []).forEach(function (p) {
        var meta = PLAT[p.platform] || {};
        var enabled = p.enabled !== false;
        scroll.appendChild(h("div", { class: "ims-card" },
          h("div", { class: "ims-card-h" },
            h("span", { class: "ims-dot", style: "background:" +
              (!enabled ? "var(--fg3)" : (p.logged_in ? "var(--ok)" : "var(--danger)")) }),
            meta.label || p.platform,
            h("span", { class: "ims-grow" }),
            enabled
              ? h("span", { class: "ims-hint", text: p.logged_in ? "授权正常" : "需要重新授权" })
              : null,
            enabled
              ? h("button", {
                  class: "ims-btn mini ghost", type: "button",
                  title: "停用后不再轮询 / 唤醒；值守配置与本地消息保留",
                  onclick: function () {
                    var label = meta.label || p.platform;
                    var msg = p.watched > 0
                      ? "停用" + label + "后，" + p.watched + " 个值守会话不再轮询、不再唤醒；" +
                        "配置与本地消息保留，随时可以再启用。继续？"
                      : "停用" + label + "？停用后不再轮询、不唤醒。";
                    if (typeof window !== "undefined" && window.confirm && !window.confirm(msg)) return;
                    api("/api/platforms", { body: { platform: p.platform, enabled: false } })
                      .then(function () { say("已停用" + label + "，值守配置保留"); return loadStatus(); })
                      .then(paint);
                  }
                }, "停用")
              : h("button", {
                  class: "ims-btn mini", type: "button",
                  title: "启用后才会拉取；不启用不占轮询",
                  onclick: function () {
                    api("/api/platforms", { body: { platform: p.platform, enabled: true } })
                      .then(function () { say("已启用" + (meta.label || p.platform)); return loadStatus(); })
                      .then(paint);
                  }
                }, "启用")),
          enabled ? h("div", { class: "ims-kv" }, h("span", { text: "本人" }),
            h("span", { title: p.self_id ? "本人 ID（排障用）：" + p.self_id : "",
                        text: p.self_name || "-" })) : null,
          enabled ? h("div", { class: "ims-kv" }, h("span", { text: "会话" }), h("span", { text: "发现 " + p.chats + " · 值守 " + p.watched })) : null,
          enabled ? h("div", { class: "ims-kv" }, h("span", { text: "CLI" }), h("span", { text: p.cli || "-" })) : null,
          !enabled ? h("div", { class: "ims-hint", text: "未启用：不轮询、不唤醒；勾上启用后才检查授权。" }) : null,
          enabled && p.last_error ? h("div", { class: "ims-hint ims-err", text: p.last_error }) : null));
      });

      if (S.doctor) {
        var dc = h("div", { class: "ims-card" },
          h("div", { class: "ims-card-h", text: "体检结果 · " + fmtTime(S.doctor.checked_at) }));
        (S.doctor.checks || []).forEach(function (c) {
          dc.appendChild(h("div", { class: "ims-kv" },
            h("span", null,
              h("span", { class: "ims-dot", style: "display:inline-block;margin-right:6px;background:" + (c.level === "ok" ? "var(--ok)" : c.level === "warn" ? "var(--warn)" : "var(--danger)") }),
              (c.label || c.platform) + " · " + c.name),
            h("span", { text: (c.detail || "").slice(0, 90) })));
        });
        scroll.appendChild(dc);
      }

      var errs = (st.errors || []);
      scroll.appendChild(h("div", { class: "ims-card" },
        h("div", { class: "ims-card-h", text: "最近错误 " + (errs.length || "") }),
        errs.length ? errs.map(function (e) {
          return h("div", { class: "ims-kv" },
            h("span", { text: fmtTime(e.ts) + " · " + (e.platform || "-") }),
            h("span", { class: "ims-err", text: (e.msg || "").slice(0, 90) }));
        }) : h("div", { class: "ims-hint", text: "没有错误" })));
      return scroll;
    }

    // ---- 设置 -----------------------------------------------------------
    function settingsView() {
      var cfg = S.cfg || { ui: {} };
      var st = S.status || {};
      var scroll = h("div", { class: "ims-scroll" });

      // 值守会话：模型/网关/凭据全部由 DSH 自己解析，插件不再有第二份配置
      var resolved = cfg.resolved || {};
      scroll.appendChild(h("div", { class: "ims-card" },
        h("div", { class: "ims-card-h" }, h("span", { class: "ims-ico", html: icon("bot", 15) }),
          "值守会话",
          h("span", { class: "ims-grow" }),
          h("span", { class: "ims-tag", style: "color:" + (resolved.dsh_ready ? "var(--ok)" : "var(--warn)"),
            text: resolved.dsh_ready ? "已就绪" : "未就绪" })),
        h("div", { class: "ims-kv" },
          h("span", { text: "运行时" }),
          h("span", { text: resolved.label || "跟随 DSH 配置" })),
        h("div", { class: "ims-kv" },
          h("span", { text: "单轮上限" }),
          h("span", { text: ((cfg.dsh || {}).timeout || 600) + " 秒 · 新消息到达会打断在飞 turn" })),
        h("div", { class: "ims-kv" },
          h("span", { text: "画像写权限" }),
          h("span", { class: "ims-tag",
            style: "color:" + ((cfg.dsh || {}).full_access ? "var(--warn)" : "var(--fg3)"),
            text: (cfg.dsh || {}).full_access ? "完整文件访问" : "工作区内" })),
        h("div", { class: "ims-rowline" },
          h("span", { class: "ims-hint", text: "agent 直接改 ~/.im-standin/profiles 需要完整文件访问；开启后它能写整个 home，只建议在信任的值守会话里开。" }),
          h("span", { class: "ims-grow" }),
          h("button", {
            class: "ims-btn", type: "button",
            onclick: function () {
              var next = !((S.cfg || {}).dsh || {}).full_access;
              if (next && !window.confirm("开启后 agent 可以写整个 home（包括画像目录），不再弹审批。只建议在信任的值守会话里使用。继续？")) return;
              api("/api/config", { body: { dsh: { full_access: next } } }).then(function (c) {
                S.cfg = c;
                say(next ? "已开启完整文件访问" : "已关闭完整文件访问");
                paint();
              });
            }
          }, (cfg.dsh || {}).full_access ? "关闭完整访问" : "开启完整访问")),
        h("div", { class: "ims-hint", text: "命中值守会话的新消息 → 在绑定的 DSH 会话里跑一轮 agent，由它自己调 IM CLI、查工作区、起草与发送。插件只负责拉取、唤醒和展示。" })));

      // 值守节奏：快车道（值守会话，秒级）+ 慢车道（发现新会话，分钟级）
      var pcfg = cfg.poll || {};
      var pollInfo = st.poll || {};
      var fast = h("input", { class: "ims-inp ims-num",
                              type: "number", min: "0", max: "600", step: "5" });
      fast.value = S.pollDraft.fast_sec !== undefined ? S.pollDraft.fast_sec
        : String(pcfg.fast_sec == null ? 60 : pcfg.fast_sec);
      var mins = h("input", { class: "ims-inp ims-num",
                              type: "number", min: String(pcfg.min_interval_min || 10), max: "240", step: "1" });
      mins.value = S.pollDraft.interval_min !== undefined ? S.pollDraft.interval_min
        : String(pcfg.interval_min || 10);
      var recent = h("input", { class: "ims-inp ims-num", type: "number", min: "1", max: "200" });
      recent.value = S.pollDraft.dm_recent !== undefined ? S.pollDraft.dm_recent
        : String(pcfg.dm_recent || 20);
      fast.addEventListener("input", function () { S.pollDraft.fast_sec = fast.value; });
      mins.addEventListener("input", function () { S.pollDraft.interval_min = mins.value; });
      recent.addEventListener("input", function () { S.pollDraft.dm_recent = recent.value; });
      var dueText = (pollInfo.fast_sec > 0 ? "值守 " + pollInfo.fast_sec + " 秒" : "快车道已关") +
        (pollInfo.due_in > 0 ? " · 发现约 " + Math.ceil(pollInfo.due_in / 60) + " 分钟后" : " · 发现马上就到");
      scroll.appendChild(h("div", { class: "ims-card" },
        h("div", { class: "ims-card-h" },
          h("span", { class: "ims-ico", html: icon("pulse", 15) }), "值守节奏",
          h("span", { class: "ims-grow" }),
          h("span", { class: "ims-tag", text: dueText })),
        h("div", { class: "ims-rowline" },
          h("span", { class: "ims-field" },
            h("span", { class: "ims-hint", text: "值守间隔(秒)" }), fast),
          h("span", { class: "ims-field" },
            h("span", { class: "ims-hint", text: "发现间隔(分钟)" }), mins),
          h("span", { class: "ims-field" },
            h("span", { class: "ims-hint", text: "私聊取前 N 个" }), recent),
          h("span", { class: "ims-grow" }),
          h("button", {
            class: "ims-btn primary", type: "button",
            onclick: function () {
              var v = Math.max(10, parseInt(mins.value, 10) || 10);
              var f = parseInt(fast.value, 10);
              if (!isFinite(f)) f = 60;
              f = Math.max(0, Math.min(600, f));
              if (f > 0 && f < 20) f = 20;
              api("/api/config", { body: { poll: {
                interval_min: v,
                fast_sec: f,
                dm_recent: Math.max(1, parseInt(recent.value, 10) || 20)
              } } }).then(function (c) {
                S.cfg = c;
                S.pollDraft = {};
                var cp = c.poll || {};
                mins.value = String(cp.interval_min || 10);
                fast.value = String(cp.fast_sec);
                recent.value = String(cp.dm_recent || 20);
                say(cp.fast_sec > 0
                  ? "已保存：值守 " + cp.fast_sec + " 秒一拉 · 发现每 " + cp.interval_min + " 分钟"
                  : "已保存：快车道关闭，只有每 " + cp.interval_min + " 分钟一轮");
                loadStatus();
                paint();
              });
            }
          }, "保存")),
        h("div", { class: "ims-hint", text: "值守会话按「值守间隔」拉，发现新会话按「发现间隔」；" +
          "0 = 关闭快车道，退回只跑发现间隔。" +
          "每个候选每次都是一次 IM 接口调用：N 个会话约 N×86400÷秒数 次/天，体检页有估算。" +
          "定时只拉「私聊」+ 你逐个勾了定时检测的群，群默认一律不碰。" }),
        h("div", { class: "ims-rowline" },
          h("button", {
            class: "ims-btn", type: "button",
            onclick: function () { syncNow(this); }
          }, "立即拉一轮"),
          h("span", { class: "ims-hint", text: "不受间隔限制；同一个会话 20 秒内不会重复拉。" }))));

      // 值守范围：群默认不拉，收件箱清理
      var groupTimerCount = ((S.chats || []).filter(function (c) {
        return c.kind === "group" && c.timer === 1;
      })).length;
      var blockedList = (S.chats || []).filter(function (c) { return c.blocked; });
      var cleanable = !!((S.counts && S.counts.todo > 0) || S.inboxTotal > 0);
      scroll.appendChild(h("div", { class: "ims-card" },
        h("div", { class: "ims-card-h", text: "值守范围" }),
        h("div", { class: "ims-kv" },
          h("span", { text: "私聊" }),
          h("span", { text: (pollInfo.timer_dm || 0) + " 个进定时轮询" })),
        h("div", { class: "ims-kv" },
          h("span", { text: "群聊" }),
          h("span", { text: (pollInfo.groups || 0) + " 个已知 · " + groupTimerCount +
            " 个勾了定时检测 · 其余点开才拉" })),
        h("div", { class: "ims-kv" },
          h("span", { text: "已屏蔽" }),
          h("span", { text: (pollInfo.blocked || 0) + " 个 · 不同步、不进收件箱" })),
        h("div", { class: "ims-hint", text: "群聊默认完全不进定时轮询：想看哪个群，点进去拉一次就够。" +
          "要做群客服的，在「分身」值守卡片上勾「定时检测 @我」，它才会按上面的间隔轮询。" }),
        h("div", { class: "ims-hint", text: "屏蔽 = 彻底不同步：定时、点开、手动单会话都拒拉，收件箱里也没有它。" +
          "屏蔽时该会话的待回会被标成忽略；正文不删，在下面逐个取消。" }),
        blockedList.length ? h("div", null,
          h("div", { class: "ims-hint", style: "margin-top:6px", text: "已屏蔽的会话" }),
          blockedList.map(function (c) {
            return h("div", { class: "ims-rowline" },
              h("span", { class: "ims-name", text: c.name || "未命名会话" }),
              h("span", { class: "ims-tag", style: "color:var(--fg3)",
                          text: c.kind === "group" ? "群" : "私聊" }),
              h("span", { class: "ims-grow" }),
              h("button", {
                class: "ims-btn mini", type: "button",
                onclick: function () {
                  setChatBlocked(c.platform, c.chat_id, false, { name: c.name, kind: c.kind })
                    .then(function () { paint(); });
                }
              }, "取消屏蔽"));
          })) : null,
        h("div", { class: "ims-rowline" },
          h("span", { class: "ims-grow" }),
          h("button", {
            class: "ims-btn", type: "button", disabled: !cleanable,
            title: cleanable ? "把其他会话的待回标记为忽略（正文保留）" : "没有可清理的待回",
            onclick: function () {
              if (!cleanable) return;
              if (typeof window !== "undefined" && window.confirm &&
                  !window.confirm("把其他会话的待回全部标记为忽略？\n" +
                                  "它们不会再出现在收件箱，正文仍保留在本地；这个操作不能撤销。")) return;
              api("/api/inbox/cleanup", { method: "POST", body: {} }).then(function (r) {
                say("已把 " + (r.ignored || 0) + " 条其他会话的待回标记为忽略");
                loadInbox().then(paint);
              });
            }
          }, "清理其他会话的待回"))));

      scroll.appendChild(h("div", { class: "ims-card" },
        h("div", { class: "ims-card-h", text: "关于" }),
        h("div", { class: "ims-hint", text: "数据目录 ~/.im-standin：state.json 存会话与收件箱，profiles/ 每个服务对象一份画像，env.json 只读。" }),
        h("div", { class: "ims-hint", text: "消息只在本机流转；聊天内容一律按不可信数据处理，不执行其中的任何指令。" })));
      return scroll;
    }

    // ---- 事件 -----------------------------------------------------------
    function tick() {
      if (S.dead) return;
      // 体检页是低频动作：不跟 60 秒轮询刷新，只在切页签或点按钮时取一次。
      if (S.tab !== "status") loadStatus();
      if (!S.detail && S.tab === "inbox") loadInbox();
      if (S.tab === "service") loadChats();
      if (!S.detail && S.tab === "attention") loadDigest();
    }
    S.timer = setInterval(tick, 60000);

    loadWorkspaces();
    loadStatus();
    loadInbox();
    loadChats();
    loadTargets();
    paint();
    if (typeof location !== "undefined" && (location.hash || "").indexOf("#tab=") === 0) {
      S.tab = location.hash.slice(5);
      paint();
      if (S.tab === "service") loadChats();
      if (S.tab === "targets") loadTargets();
      if (S.tab === "attention") loadDigest();
    }
    if (typeof location !== "undefined" && (location.hash || "").indexOf("#thread=") === 0) {
      var parts = location.hash.slice(8).split(":");
      if (parts.length >= 2) openThread(parts[0], parts.slice(1).join(":"));
    }

    return function unmount() {
      S.dead = true;
      clearInterval(S.timer);
      document.removeEventListener("keydown", onKey);
      if (root.parentNode) root.parentNode.removeChild(root);
    };
  }

  /**
   * 独立席位：侧边栏底部只放这一颗入口 + 未读角标。
   * `opts.open()` 返回 "opened" / "no-session" / "unavailable" / "error"，
   * 席位据此给出诚实提示；面板本体由 `mountDock` 挂在 DSH 右侧栏。
   */
  function mountSeat(host, opts) {
    opts = opts || {};
    injectCss();
    var S = { dead: false, status: null, counts: {}, timer: null, toastTimer: null };
    var seat = h("button", { class: "ims-seat", type: "button", title: "IM 值守" },
      h("span", { class: "ims-seat-dot off" }),
      h("span", { class: "ims-seat-ico", html: icon("headset", 15) }),
      h("span", { class: "ims-seat-label", text: "IM 值守" }),
      h("span", { class: "ims-seat-badge", style: "display:none" }));
    var toast = h("div", { class: "ims-toast" });
    var root = h("div", { class: "ims-root", "data-mode": "seat" }, seat, toast);
    host.appendChild(root);

    function say(msg) {
      toast.textContent = msg;
      toast.classList.add("show");
      clearTimeout(S.toastTimer);
      S.toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 3000);
    }

    function paintSeat() {
      var dot = seat.querySelector(".ims-seat-dot");
      var badge = seat.querySelector(".ims-seat-badge");
      var label = seat.querySelector(".ims-seat-label");
      var st = S.status;
      var n = (S.counts && S.counts.todo) || 0;
      dot.className = "ims-seat-dot" + (!st ? " off" : (st.paused ? " warn" : (st.running ? "" : " off")));
      label.textContent = !st ? "IM 值守（未连接）" : (st.paused ? "IM 值守 · 已暂停" : "IM 值守");
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.style.display = n > 0 ? "" : "none";
    }

    function load() {
      return api("/api/status").then(function (d) {
        if (S.dead) return;
        S.status = d; S.counts = d.counts || S.counts;
        paintSeat();
      }).catch(function () { S.status = null; paintSeat(); });
    }

    // 停靠面板拉完数据后广播计数，席位不用等下一个 60 秒才更新角标。
    function onCounts(e) {
      if (!e || !e.detail || S.dead) return;
      S.counts = e.detail;
      paintSeat();
    }
    window.addEventListener("im-standin:counts", onCounts);

    seat.addEventListener("click", function () {
      var r = "";
      try { r = opts.open ? opts.open() : ""; } catch (e) {
        console.warn("[im-standin] open dock failed:", String((e && e.message) || e));
        r = "error";
      }
      if (r === "no-session") say("先在中间打开一个会话；值守面板会停在右侧栏");
      else if (r === "unavailable") say("这个 DSH 版本没有右侧栏服务");
      else if (r === "error") say("右侧栏没打开，稍后再试");
      load();
    });

    load();
    S.timer = setInterval(load, 60000);
    return function unmount() {
      S.dead = true;
      clearInterval(S.timer);
      clearTimeout(S.toastTimer);
      window.removeEventListener("im-standin:counts", onCounts);
      if (root.parentNode) root.parentNode.removeChild(root);
    };
  }

  /** 右侧栏里的面板：铺满标签页宿主，没有浮层形态。 */
  function mountDock(host) {
    return mountPanel(host);
  }

  window.IMStandinPanel = {
    mountDock: mountDock, mountSeat: mountSeat, apiBase: API
  };
})();

/* ===== end inline ===== */

		/**
		 * 右侧栏标签页：DSH 的右侧栏（文件/终端/计划住的地方）才是常驻面板该待的
		 * 位置。这里注册一个页类型，面板本体挂在 `sidebar.right.pane.tab`，
		 * 侧边栏底部只保留一个入口席位。插件只提供停靠形态，没有浮层回退。
		 */
		const TAB_ID = "dsh-cyber-im-avatar/inbox";
		const TAB_KIND = "cyberImInbox";
		const TAB_TITLE = "IM 值守";

		function service(ctx, name) {
			try {
				return ctx && typeof ctx.get === "function" ? ctx.get(name) : null;
			} catch (e) {
				return null;
			}
		}

		/** 在“当前屏幕上的会话”的右侧栏打开值守面板。 */
		function openDock(ctx) {
			const right = service(ctx, "sidebarRight");
			if (!right) return "unavailable";
			let sid;
			try {
				sid = right.mounted && typeof right.mounted.getSnapshot === "function"
					? right.mounted.getSnapshot() : undefined;
			} catch (e) { sid = undefined; }
			if (!sid) return "no-session";
			try {
				right.openTab(TAB_KIND);
				return "opened";
			} catch (e) {
				console.warn("[im-standin] open right-sidebar tab failed:", String((e && e.message) || e));
				return "error";
			}
		}

		/** 跳转成功后，把值守面板在目标会话的右侧栏里再打开（右侧栏布局按会话存）。 */
		function reopenDock(ctx, tries) {
			const r = openDock(ctx);
			if (r !== "opened" && tries > 0) setTimeout(() => reopenDock(ctx, tries - 1), 150);
		}

		/** 面板里的「去会话」：切主界面到绑定会话，右侧栏尽量跟着留在新会话。 */
		function makeJump(ctx) {
			return (sessionId) => {
				if (!sessionId) return false;
				try {
					const nav = service(ctx, "uiWorkspace");
					if (!nav || typeof nav.openSession !== "function") return false;
					nav.openSession(sessionId);
					setTimeout(() => reopenDock(ctx, 3), 0);
					return true;
				} catch (e) {
					console.warn("[im-standin] openSession failed:", String((e && e.message) || e));
					return false;
				}
			};
		}

		function sidebarSlots(ctx) {
			try {
				const slots = ctx.slots;
				return slots && typeof slots.inject === "function" ? slots : null;
			} catch (e) {
				return null;
			}
		}

		/** 侧边栏底部入口：只依赖 slots，老 DSH 也能挂出来（点击会提示没有右侧栏）。 */
		function mountSeatUI(ctx) {
			const slots = sidebarSlots(ctx);
			if (!slots) {
				console.warn("[im-standin] slots service unavailable; seat not mounted");
				return false;
			}
			function Seat() {
				const ref = React.useRef(null);
				React.useEffect(() => {
					if (!ref.current) return undefined;
					let unmount = null;
					try {
						unmount = window.IMStandinPanel.mountSeat(ref.current, {
							open: () => openDock(ctx)
						});
					} catch (e) {
						console.error("[im-standin] seat mount failed:", e);
					}
					return () => { try { if (unmount) unmount(); } catch (e) { /* noop */ } };
				}, []);
				return React.createElement("div", { ref: ref, className: "ims-host" });
			}
			try {
				slots.inject("sidebar.footer.action", () => slots.register(
					{ name: "sidebar.footer.action", id: "dsh-cyber-im-avatar", order: 80 },
					Seat
				));
				console.info("[im-standin] seat mounted into sidebar.footer.action");
				return true;
			} catch (e) {
				console.error("[im-standin] seat registration failed:", e);
				return false;
			}
		}

		/** 右侧栏标签页：没有 sidebarRight 服务就不注册，绝不退回浮层。 */
		function registerDockTabUI(rootCtx, ctx) {
			// pane 槽必须挂在插件根 ctx 上：用 ctx.inject 回调里的子 ctx 注册，
			// 回调结束后槽会失活，右侧栏只剩「内容不可查看」占位。
			const slots = sidebarSlots(rootCtx);
			if (!slots) return false;
			const tabs = service(ctx, "sidebarRightTabs");
			const right = service(ctx, "sidebarRight");
			if (!tabs || !right) {
				console.warn("[im-standin] right-sidebar services unavailable; dock tab not registered");
				return false;
			}

			function DockBody() {
				const ref = React.useRef(null);
				React.useEffect(() => {
					if (!ref.current) return undefined;
					let unmount = null;
					try {
						unmount = window.IMStandinPanel.mountDock(ref.current);
					} catch (e) {
						console.error("[im-standin] dock mount failed:", e);
					}
					return () => { try { if (unmount) unmount(); } catch (e) { /* noop */ } };
				}, []);
				return React.createElement("div", { ref: ref, className: "ims-host ims-host-dock" });
			}

			try {
				const definition = {
					id: TAB_ID,
					kind: TAB_KIND,
					priority: "extension",
					multiple: false,
					title: () => TAB_TITLE,
					guide: [{
						id: "inbox",
						order: 30,
						title: () => TAB_TITLE,
						description: () => "收件箱、分身实例与手动发送"
					}]
				};
				// 生命周期挂在插件根 ctx 上：插件卸载时撤销注册，避免 HMR 后重复注册。
				if (typeof rootCtx.effect === "function") {
					rootCtx.effect(() => tabs.register(definition), "im-standin: right-sidebar tab type");
				} else {
					tabs.register(definition);
				}

				slots.inject("sidebar.right.pane.tab", () => slots.register(
					{ name: "sidebar.right.pane.tab", key: TAB_ID },
					DockBody
				));
				console.info("[im-standin] dock tab registered");
				return true;
			} catch (e) {
				console.error("[im-standin] right-sidebar registration failed:", e);
				return false;
			}
		}

		/**
		 * Client half entry. `slots` is a static dependency: the seat mounts
		 * immediately. The right-sidebar services are requested dynamically; if
		 * they never arrive the plugin stays as a seat that reports unavailable.
		 */
		function apply(ctx) {
			if (window.IMStandinPanel) window.IMStandinPanel.openSession = makeJump(ctx);

			mountSeatUI(ctx);
			if (ctx && typeof ctx.inject === "function") {
				ctx.inject(["sidebarRightTabs", "sidebarRight"], (c) => registerDockTabUI(ctx, c || ctx));
			} else {
				registerDockTabUI(ctx, ctx);
			}
		}
		apply.inject = ["slots"];

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});
