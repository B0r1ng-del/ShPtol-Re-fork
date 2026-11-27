// ⚠ 这个模块是「手写 render() 到独立 root」的老实现 —— 它脱离了组件树，
//   在里面渲染的子树**拿不到发起方的 ref**（boxRef.current 恒为 null）。
//   Modal 曾因此报 `Cannot read properties of null (reading 'querySelector')`。
//
// ★ 首选 <Portal>（定义在 ui/components.js，底层是 vendor/preact-compat.module.js 的 createPortal）。
//   那条「game 的 vendor 里没有 preact-compat」的注释是**过时的错误信息** —— 文件一直都在，
//   loadout.js / regulationDispatch20261110.js 早就在 import 它。新代码请用 components.js 的 Portal。
//
// 本文件保留给仍在用的 5 处浮层（音乐菜单 / 助理编辑器 / 载入转场 / 登录抵达 / loadout），
// 它们的内容不依赖父 ref，所以手挂 root 也成立。

import { render } from '../../vendor/preact.module.js';
import { html } from './components.js';
import { useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';

export function portal({ children }) {
  const hostRef = useRef(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const host = document.createElement('div');
    host.className = 'portal-host';
    document.body.appendChild(host);
    hostRef.current = host;
    setReady(true);
    return () => {
      render(null, host);
      hostRef.current = null;
      try { host.remove(); } catch { /* 已经不在了 */ }
    };
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    render(html`${children}`, host);
  });

  return null;
}
