window.__ModuleLoader__.load({
	id: "dsh-cyber-im-avatar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

/* ===== inline web/panel.js (source of truth, do not edit this block) ===== */
/*__PANEL_JS__*/
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
						description: () => "关注、分身实例与手动发送"
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
		/**
		 * 启动诊断（临时）：把客户端半看到的这次启动写回宿主 `logs/client-boot.jsonl`。
		 * 只回答一个问题——本插件那一行是否在页面拿到的 boot 图里，导入有没有报错。
		 */
		function reportBoot(ctx) {
			try {
				const boot = window.__DSH_BOOT__ || {};
				const rows = Array.isArray(boot.entries) ? boot.entries : [];
				const row = rows.find((r) => r.id === "dsh-cyber-im-avatar") || null;
				let entries = null;
				try {
					const loader = ctx && ctx.loader;
					entries = loader ? [...loader.entries()].map((e) => ({
						name: e.options.name,
						fiber: !!e.fiber,
						state: e.fiber ? e.fiber.state : null,
					})) : null;
				} catch (e) { entries = "unreadable"; }
				let importError = null;
				try {
					const modules = ctx && ctx.modules;
					const ie = modules && typeof modules.importError === "function"
						? modules.importError("dsh-cyber-im-avatar") : null;
					importError = ie ? String(ie.message || ie) : null;
				} catch (e) { importError = "unreadable"; }
				const api = window.IM_STANDIN_API || "/plugins/im-standin";
				const token = window.IM_STANDIN_TOKEN || "";
				fetch(api + "/api/debug/boot", {
					method: "POST",
					headers: { "content-type": "application/json", "x-im-token": token },
					body: JSON.stringify({
						t: Math.round(performance.now()),
						ready: document.readyState,
						hasBoot: !!boot.entries,
						bootRows: rows.length,
						hasRow: !!row,
						row: row && {
							url: row.url,
							rev: row.rev,
							immediately: row.immediately === true,
							inject: row.inject || []
						},
						importError,
						entries
					}),
					keepalive: true
				}).catch(() => {});
			} catch (e) { /* 诊断失败不影响主流程 */ }
		}

		function apply(ctx) {
			reportBoot(ctx);
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
